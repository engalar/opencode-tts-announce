import { describe, test, expect } from "bun:test"
import { parseCliArgs } from "./cli"

describe("parseCliArgs", () => {
  test("plain text becomes the utterance", () => {
    expect(parseCliArgs(["任务完成"])).toEqual({
      text: "任务完成",
      baseUrl: "http://127.0.0.1:8000",
      model: "tts-1",
      voice: "alloy",
    })
  })

  test("multiple words are joined", () => {
    expect(parseCliArgs(["你好", "世界"]).text).toBe("你好 世界")
  })

  test("--voice overrides the default", () => {
    expect(parseCliArgs(["--voice", "echo", "hi"]).voice).toBe("echo")
  })

  test("--base-url and --model override defaults", () => {
    const opts = parseCliArgs(["--base-url", "http://x:1234", "--model", "big", "hi"])
    expect(opts.baseUrl).toBe("http://x:1234")
    expect(opts.model).toBe("big")
    expect(opts.text).toBe("hi")
  })

  test("flag after text still parses", () => {
    expect(parseCliArgs(["hi", "--voice", "echo"]).text).toBe("hi")
  })

  test("unknown option throws", () => {
    expect(() => parseCliArgs(["--wat", "hi"])).toThrow("--wat")
  })

  test("missing flag value throws", () => {
    expect(() => parseCliArgs(["--voice"])).toThrow("--voice")
  })

  test("empty argv yields empty text", () => {
    expect(parseCliArgs([]).text).toBe("")
  })
})
