import { describe, test, expect } from "bun:test"
import { phraseFor, createSpeaker, normalizeWav, type Phrases } from "./announce"

const PHRASES: Phrases = { idle: "任务完成", error: "出错了", permission: "需要授权" }

describe("phraseFor", () => {
  test("session.execution.succeeded → idle phrase", () => {
    expect(phraseFor("session.execution.succeeded", PHRASES)).toBe("任务完成")
  })

  test("subagent success → sub-idle phrase", () => {
    expect(phraseFor("session.execution.succeeded", { ...PHRASES, subIdle: "子任务完成" }, true)).toBe("子任务完成")
  })

  test("subagent success without sub phrase falls back to the main one", () => {
    expect(phraseFor("session.execution.succeeded", PHRASES, true)).toBe("任务完成")
  })

  test("subagent failure → sub-error phrase", () => {
    expect(phraseFor("session.execution.failed", { ...PHRASES, subError: "子任务出错了" }, true)).toBe("子任务出错了")
  })

  test("permission phrase is the same regardless of session kind", () => {
    expect(phraseFor("permission.asked", PHRASES, true)).toBe("需要授权")
  })

  test("session.idle → idle phrase", () => {
    expect(phraseFor("session.idle", PHRASES)).toBe("任务完成")
  })

  test("session.execution.failed → error phrase", () => {
    expect(phraseFor("session.execution.failed", PHRASES)).toBe("出错了")
  })

  test("permission.asked → permission phrase", () => {
    expect(phraseFor("permission.asked", PHRASES)).toBe("需要授权")
  })

  test("unmapped event → undefined", () => {
    expect(phraseFor("session.created", PHRASES)).toBeUndefined()
  })

  test("custom phrase overrides the default entry", () => {
    expect(phraseFor("session.idle", { ...PHRASES, idle: "all done" })).toBe("all done")
  })
})

describe("normalizeWav", () => {
  // Canonical 44-byte header: RIFF <riffSize> WAVE fmt <16 bytes> data <dataSize>.
  const canonicalWav = (riffSize: number, dataSize: number, dataBytes = 4): Uint8Array => {
    const total = 44 + dataBytes
    const b = new Uint8Array(total)
    const v = new DataView(b.buffer)
    const ascii = (s: string, o: number) => {
      for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i)
    }
    ascii("RIFF", 0)
    v.setUint32(4, riffSize, true)
    ascii("WAVE", 8)
    ascii("fmt ", 12)
    v.setUint32(16, 16, true)
    v.setUint16(20, 1, true)
    v.setUint16(22, 1, true)
    v.setUint32(24, 24000, true)
    v.setUint32(28, 48000, true)
    v.setUint16(32, 2, true)
    v.setUint16(34, 16, true)
    ascii("data", 36)
    v.setUint32(40, dataSize, true)
    return b
  }

  test("patches streaming-sentinel sizes from the actual byte length", () => {
    const wav = canonicalWav(0xffffffff, 0xffffffff)
    const out = normalizeWav(wav)
    const v = new DataView(out.buffer)
    expect(v.getUint32(4, true)).toBe(wav.byteLength - 8)
    expect(v.getUint32(40, true)).toBe(wav.byteLength - 44)
    expect(out.byteLength).toBe(wav.byteLength)
  })

  test("leaves a valid header untouched", () => {
    const wav = canonicalWav(40, 4)
    const out = normalizeWav(wav)
    const v = new DataView(out.buffer)
    expect(v.getUint32(4, true)).toBe(40)
    expect(v.getUint32(40, true)).toBe(4)
  })

  test("does not mutate the input", () => {
    const wav = canonicalWav(0xffffffff, 0xffffffff)
    normalizeWav(wav)
    const v = new DataView(wav.buffer)
    expect(v.getUint32(4, true)).toBe(0xffffffff)
  })
})

describe("createSpeaker", () => {
  test("fetches speech, then plays the returned audio", async () => {
    const calls: string[] = []
    const speaker = createSpeaker({
      fetchSpeech: async (text) => {
        calls.push(`fetch:${text}`)
        return new TextEncoder().encode("RIFF-wav-bytes")
      },
      play: async (wav) => {
        calls.push(`play:${new TextDecoder().decode(wav)}`)
      },
    })
    await speaker.say("任务完成")
    expect(calls).toEqual(["fetch:任务完成", "play:RIFF-wav-bytes"])
  })

  test("serializes overlapping utterances in request order", async () => {
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const speaker = createSpeaker({
      fetchSpeech: async (text) => {
        order.push(`fetch:${text}`)
        return new TextEncoder().encode(text)
      },
      play: async () => {
        await gate
        order.push("play:done")
      },
    })
    const first = speaker.say("一")
    const second = speaker.say("二")
    release()
    await Promise.all([first, second])
    expect(order).toEqual(["fetch:一", "play:done", "fetch:二", "play:done"])
  })

  test("skips playback silently when the TTS server is unreachable", async () => {
    const calls: string[] = []
    const speaker = createSpeaker({
      fetchSpeech: async () => {
        throw new Error("ECONNREFUSED")
      },
      play: async () => {
        calls.push("play")
      },
    })
    await expect(speaker.say("任务完成")).resolves.toBeUndefined()
    expect(calls).toEqual([])
  })

  test("a failed playback does not block the next utterance", async () => {
    const order: string[] = []
    const speaker = createSpeaker({
      fetchSpeech: async (text) => {
        order.push(`fetch:${text}`)
        return new TextEncoder().encode(text)
      },
      play: async (wav) => {
        const text = new TextDecoder().decode(wav)
        if (text === "一") throw new Error("no audio device")
        order.push(`play:${text}`)
      },
    })
    await speaker.say("一")
    await speaker.say("二")
    expect(order).toEqual(["fetch:一", "fetch:二", "play:二"])
  })
})
