import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { normalizeWav, type AudioSource } from "./announce"

export type AudioSink = {
  /** Streaming player (e.g. ffplay on stdin); omit on platforms without one. */
  playStream?: (stream: ReadableStream<Uint8Array>) => Promise<void>
  /** Buffered fallback: complete, header-normalized WAV. */
  playBuffered: (wav: Uint8Array) => Promise<void>
}

export function isReadable(x: unknown): x is ReadableStream<Uint8Array> {
  return typeof (x as { getReader?: unknown })?.getReader === "function"
}

export async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.byteLength
    }
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** Streams through playStream when possible; otherwise collects and plays buffered. */
export async function playAudio(audio: AudioSource, sink: AudioSink): Promise<void> {
  if (isReadable(audio)) {
    if (sink.playStream) {
      try {
        await sink.playStream(audio)
        return
      } catch {
        // Streamer missing or failed mid-way; fall through to the buffered path.
      }
    }
    return sink.playBuffered(normalizeWav(await collect(audio)))
  }
  return sink.playBuffered(normalizeWav(audio))
}

function findFfplay(): string | null {
  const env = process.env.TTS_FFPLAY
  if (env && existsSync(env)) return env
  const links = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links", "ffplay.exe")
  if (existsSync(links)) return links
  // Version-pinned winget package dirs: Gyan.FFmpeg_*/ffmpeg-*/bin/ffplay.exe
  try {
    const packages = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages")
    if (existsSync(packages)) {
      for (const entry of readdirSync(packages)) {
        if (!entry.startsWith("Gyan.FFmpeg")) continue
        const dir = join(packages, entry)
        for (const build of readdirSync(dir)) {
          const candidate = join(dir, build, "bin", "ffplay.exe")
          if (existsSync(candidate)) return candidate
        }
      }
    }
  } catch {}
  return null
}

function writeChunk(stdin: NodeJS.WritableStream, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve) => {
    if ((stdin as NodeJS.WriteStream).write(chunk)) resolve()
    else stdin.once("drain", resolve)
  })
}

/** ffplay fed from stdin plays the WAV as chunks arrive. */
export function makeStreamPlayer(ffplayPath?: string): ((stream: ReadableStream<Uint8Array>) => Promise<void>) | undefined {
  const ffplay = ffplayPath ?? findFfplay()
  if (!ffplay) return undefined
  return (stream) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(ffplay, ["-nodisp", "-autoexit", "-loglevel", "quiet", "-i", "pipe:0"], {
        stdio: ["pipe", "ignore", "ignore"],
        windowsHide: true,
      })
      child.on("error", reject)
      child.on("close", (code) => {
        if (code === 0) resolve()
        else reject(new Error(`ffplay exited with ${code}`))
      })
      void (async () => {
        const reader = stream.getReader()
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) await writeChunk(child.stdin, value)
          }
          child.stdin.end()
        } catch (error) {
          child.kill()
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })()
    })
}
