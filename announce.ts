export type Phrases = {
  idle: string
  error: string
  permission: string
  /** Subagent (child session) variants; fall back to the main phrases. */
  subIdle?: string
  subError?: string
}

export type AudioSource = Uint8Array | ReadableStream<Uint8Array>

export type SpeakerDeps = {
  fetchSpeech: (text: string) => Promise<AudioSource>
  play: (audio: AudioSource) => Promise<void>
  /** Diagnostics sink; defaults to console.error. */
  log?: (line: string) => void
}

/** Maps an OpenCode event type to the phrase key that should be announced. */
const EVENT_KEYS: Record<string, keyof Phrases> = {
  // Canonical completion signal in OpenCode v2.2.x. session.idle is deliberately
  // unmapped: subagent sessions emit BOTH execution.succeeded and session.idle,
  // which announced twice.
  "session.execution.succeeded": "idle",
  "session.execution.failed": "error",
  "permission.asked": "permission",
}

export function phraseFor(eventType: string, phrases: Phrases, isSubagent = false): string | undefined {
  const key = EVENT_KEYS[eventType]
  if (!key) return undefined
  if (isSubagent && key === "idle") return phrases.subIdle ?? phrases.idle
  if (isSubagent && key === "error") return phrases.subError ?? phrases.error
  return phrases[key]
}

/**
 * Patches streaming-sentinel WAV sizes. faster-qwen3-tts serves non-streaming
 * responses with the streaming header (RIFF/data size = 0xFFFFFFFF), which
 * Windows SoundPlayer rejects as "not a valid wave file".
 */
export function normalizeWav(wav: Uint8Array): Uint8Array {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  if (wav.byteLength < 44) return wav
  const riff = Buffer.from(wav.slice(0, 4)).toString("latin1")
  const wave = Buffer.from(wav.slice(8, 12)).toString("latin1")
  if (riff !== "RIFF" || wave !== "WAVE") return wav
  const needsPatch = v.getUint32(4, true) === 0xffffffff || v.getUint32(40, true) === 0xffffffff
  if (!needsPatch) return wav
  const out = new Uint8Array(wav)
  const ov = new DataView(out.buffer)
  ov.setUint32(4, out.byteLength - 8, true)
  ov.setUint32(40, out.byteLength - 44, true)
  return out
}

export function createSpeaker(deps: SpeakerDeps) {
  const log = deps.log ?? ((line: string) => console.error(`[tts-announce] ${line}`))
  let chain: Promise<void> = Promise.resolve()

  const enqueue = (text: string): Promise<void> => {
    const run = async () => {
      try {
        const audio = await deps.fetchSpeech(text)
        const streamed = typeof (audio as { getReader?: unknown }).getReader === "function"
        log(`audio ready (${streamed ? "stream" : `${(audio as Uint8Array).byteLength} bytes`}) for "${text}"`)
        await deps.play(audio)
        log(`played "${text}"`)
      } catch (error) {
        // Silent for the user, visible in the diagnostics sink.
        log(`announce failed for "${text}": ${error}`)
      }
    }
    const queued = chain.then(run)
    // Keep the chain resolved so one failure never blocks later utterances.
    chain = queued.catch(() => {})
    return queued
  }

  return {
    say(text: string): Promise<void> {
      return enqueue(text)
    },
  }
}
