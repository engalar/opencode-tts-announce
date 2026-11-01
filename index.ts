import { Plugin } from "@opencode/plugin"
import { appendFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSpeaker, phraseFor, type AudioSource, type Phrases } from "./announce"
import { makeStreamPlayer, playAudio, type AudioSink } from "./player"
import { acquireLeader } from "./leader"

export type Options = {
  /** Base URL of the faster-qwen3-tts OpenAI-compatible server. */
  baseUrl?: string
  /** Model name sent in the request body (server currently ignores it). */
  model?: string
  /** Voice name configured on the server (voices.json entry or default). */
  voice?: string
  /** Stream synthesis output into ffplay as it arrives (default true). */
  streaming?: boolean
  /** Override the canned phrases. */
  phrases?: Partial<Phrases>
}

const DEFAULTS = {
  baseUrl: "http://127.0.0.1:8000",
  model: "tts-1",
  voice: "alloy",
  streaming: true,
  phrases: { idle: "任务完成", error: "出错了", permission: "需要授权" } as Phrases,
}

/** Writes the WAV to a temp file and plays it, trying each buffered player in order. */
export async function playWav(wav: Uint8Array): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "opencode-tts-"))
  const file = join(dir, "announce.wav")
  try {
    await writeFile(file, wav)
    let lastError: unknown = new Error("no audio player available")
    for (const [cmd, args] of playerCommands(file)) {
      try {
        await runPlayer(cmd, args)
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

/** Shared announce pipeline: one speech queue over the TTS server and local players. */
export function createAnnouncer(options: AnnouncerOptions = {}, log?: (line: string) => void) {
  const baseUrl = options.baseUrl ?? DEFAULTS.baseUrl
  const model = options.model ?? DEFAULTS.model
  const voice = options.voice ?? DEFAULTS.voice
  const streaming = options.streaming ?? DEFAULTS.streaming

  const sink: AudioSink = { playStream: makeStreamPlayer(), playBuffered: playWav }

  const fetchSpeech = async (text: string): Promise<AudioSource> => {
    const res = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text, voice, response_format: "wav" }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) throw new Error(`TTS server returned ${res.status}`)
    if (streaming && res.body) return res.body
    return new Uint8Array(await res.arrayBuffer())
  }

  return {
    speaker: createSpeaker({
      fetchSpeech,
      play: (audio) => playAudio(audio, sink),
      log,
    }),
    describe: `baseUrl=${baseUrl} voice=${voice} model=${model} streaming=${streaming}`,
  }
}

export type AnnouncerOptions = Options

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

export default Plugin.define({
  id: "tts-announce",
  async setup(ctx) {
    const options = (ctx.options ?? {}) as Options
    const phrases: Phrases = { ...DEFAULTS.phrases, ...options.phrases }

    const log = (line: string) => {
      try {
        appendFileSync(join(tmpdir(), "tts-announce.log"), `${new Date().toISOString()} ${line}\n`)
      } catch {}
      console.error(`[tts-announce] ${line}`)
    }

    // Exactly one loaded instance (across locations/processes) announces; the rest stay silent.
    const leader = acquireLeader(join(tmpdir(), "opencode-tts-announce.leader"))
    if (!leader.isLeader) {
      log("non-leader instance, staying silent")
      return
    }

    const { speaker, describe } = createAnnouncer(options, log)
    log(`setup (leader): ${describe}`)

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
        log(`event stream ended: ${error}`)
      }
    })()

    return () => {
      controller.abort()
      leader.release()
    }
  },
})
