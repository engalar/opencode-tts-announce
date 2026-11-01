import { Plugin } from "@opencode/plugin"
import { appendFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSpeaker, normalizeWav, phraseFor, type Phrases } from "./announce"

export type Options = {
  /** Base URL of the faster-qwen3-tts OpenAI-compatible server. */
  baseUrl?: string
  /** Model name sent in the request body (server currently ignores it). */
  model?: string
  /** Voice name configured on the server (voices.json entry or default). */
  voice?: string
  /** Override the canned phrases. */
  phrases?: Partial<Phrases>
}

const DEFAULTS = {
  baseUrl: "http://127.0.0.1:8000",
  model: "tts-1",
  voice: "alloy",
  phrases: { idle: "任务完成", error: "出错了", permission: "需要授权" } as Phrases,
}

/** Requests a WAV from the OpenAI-compatible /v1/audio/speech endpoint. */
export function makeFetchSpeech(baseUrl: string, model: string, voice: string) {
  return async (text: string): Promise<Uint8Array> => {
    const res = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text, voice, response_format: "wav" }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) throw new Error(`TTS server returned ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
}

/** Picks the platform audio player: PowerShell SoundPlayer / afplay / paplay+aplay. */
function playerCommands(file: string): Array<[string, string[]]> {
  switch (process.platform) {
    case "win32":
      return [
        [
          "powershell",
          ["-NoProfile", "-Command", `(New-Object Media.SoundPlayer '${file.replaceAll("'", "''")}').PlaySync()`],
        ],
      ]
    case "darwin":
      return [["afplay", [file]]]
    default:
      return [
        ["paplay", [file]],
        ["aplay", ["-q", file]],
      ]
  }
}

function runPlayer(cmd: string, args: string[], onOutput?: (chunk: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    let output = ""
    child.stdout?.on("data", (d) => (output += d))
    child.stderr?.on("data", (d) => (output += d))
    child.on("error", reject)
    child.on("close", (code) => {
      onOutput?.(output.trim())
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exited with ${code}${output ? `: ${output.trim().slice(0, 500)}` : ""}`))
    })
  })
}

/** Writes the WAV to a temp file and plays it, trying each player in order. */
export async function playWav(wav: Uint8Array, onOutput?: (chunk: string) => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "opencode-tts-"))
  const file = join(dir, "announce.wav")
  try {
    await writeFile(file, wav)
    let lastError: unknown = new Error("no audio player available")
    for (const [cmd, args] of playerCommands(file)) {
      try {
        await runPlayer(cmd, args, onOutput)
        return
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export default Plugin.define({
  id: "tts-announce",
  // v0.1.1: file-based diagnostics
  async setup(ctx) {
    const options = (ctx.options ?? {}) as Options
    const baseUrl = options.baseUrl ?? DEFAULTS.baseUrl
    const model = options.model ?? DEFAULTS.model
    const voice = options.voice ?? DEFAULTS.voice
    const phrases: Phrases = { ...DEFAULTS.phrases, ...options.phrases }

    const log = (line: string) => {
      try {
        appendFileSync(join(tmpdir(), "tts-announce.log"), `${new Date().toISOString()} ${line}\n`)
      } catch {}
      console.error(`[tts-announce] ${line}`)
    }
    const speaker = createSpeaker({
      fetchSpeech: makeFetchSpeech(baseUrl, model, voice),
      play: (wav) => playWav(normalizeWav(wav), (out) => out && log(`player output: ${out}`)),
      log,
    })
    log(`setup: baseUrl=${baseUrl} voice=${voice} model=${model}`)

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          const phrase = phraseFor(event.type, phrases)
          if (!phrase) continue
          log(`announce on ${event.type}`)
          void speaker.say(phrase)
        }
      } catch (error) {
        console.error("[tts-announce] event stream ended:", error)
        log(`event stream ended: ${error}`)
      }
    })()

    return () => controller.abort()
  },
})
