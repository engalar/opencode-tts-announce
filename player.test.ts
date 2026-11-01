import { describe, test, expect } from "bun:test"
import { collect, playAudio, type AudioSource } from "./player"

const streamOf = (chunks: Uint8Array[]): ReadableStream<Uint8Array> => {
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++])
      else controller.close()
    },
  })
}

describe("collect", () => {
  test("concatenates stream chunks in order", async () => {
    const bytes = await collect(streamOf([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])]))
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5])
  })

  test("empty stream yields empty bytes", async () => {
    expect((await collect(streamOf([]))).byteLength).toBe(0)
  })
})

describe("playAudio", () => {
  test("streams readable sources through playStream", async () => {
    let streamed: AudioSource | null = null
    let buffered: AudioSource | null = null
    await playAudio(streamOf([new Uint8Array([1])]), {
      playStream: async (s) => {
        streamed = s
      },
      playBuffered: async (w) => {
        buffered = w
      },
    })
    expect(streamed).not.toBeNull()
    expect(buffered).toBeNull()
  })

  test("falls back to buffered playback when streaming fails", async () => {
    let buffered = 0
    await playAudio(streamOf([new Uint8Array([9, 9])]), {
      playStream: async () => {
        throw new Error("no streamer")
      },
      playBuffered: async (w) => {
        buffered = w.byteLength
      },
    })
    expect(buffered).toBe(2)
  })

  test("raw bytes go straight to buffered playback, normalized", async () => {
    // 44-byte canonical header with sentinel sizes + 4 data bytes; expect patched sizes.
    const wav = new Uint8Array(48)
    const v = new DataView(wav.buffer)
    const ascii = (s: string, o: number) => {
      for (let i = 0; i < s.length; i++) wav[o + i] = s.charCodeAt(i)
    }
    ascii("RIFF", 0)
    v.setUint32(4, 0xffffffff, true)
    ascii("WAVE", 8)
    ascii("fmt ", 12)
    v.setUint32(16, 16, true)
    ascii("data", 36)
    v.setUint32(40, 0xffffffff, true)
    let normalized: number[] = []
    await playAudio(wav, {
      playBuffered: async (w) => {
        normalized = Array.from(w.slice(0, 48))
      },
    })
    const out = new DataView(new Uint8Array(normalized).buffer)
    expect(out.getUint32(4, true)).toBe(48 - 8)
    expect(out.getUint32(40, true)).toBe(48 - 44)
  })
})
