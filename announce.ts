export type Phrases = {
  idle: string
  error: string
  permission: string
}

export type SpeakerDeps = {
  fetchSpeech: (text: string) => Promise<Uint8Array>
  play: (wav: Uint8Array) => Promise<void>
  /** Diagnostics sink; defaults to console.error. */
  log?: (line: string) => void
}

/** Maps an OpenCode event type to the phrase key that should be announced. */
const EVENT_KEYS: Record<string, keyof Phrases> = {
  // Observed on turn completion in OpenCode v2.2.x (session.idle kept for older builds).
  "session.execution.succeeded": "idle",
  "session.idle": "idle",
  "session.execution.failed": "error",
  "permission.asked": "permission",
}

export function phraseFor(eventType: string, phrases: Phrases): string | undefined {
  const key = EVENT_KEYS[eventType]
  return key ? phrases[key] : undefined
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
        const wav = await deps.fetchSpeech(text)
        log(`synthesized ${wav.byteLength} bytes for "${text}"`)
        await deps.play(wav)
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
