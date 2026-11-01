import { makeFetchSpeech, playWav } from "./index"
import { normalizeWav } from "./announce"

export type CliOptions = {
  text: string
  baseUrl: string
  model: string
  voice: string
}

export const CLI_DEFAULTS = {
  baseUrl: "http://127.0.0.1:8000",
  model: "tts-1",
  voice: "alloy",
}

const USAGE = "usage: bun run cli.ts [--base-url URL] [--model MODEL] [--voice VOICE] <text...>"

export function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { ...CLI_DEFAULTS, text: "" }
  const words: string[] = []
  const fail = (msg: string): never => {
    throw new Error(`${msg}\n${USAGE}`)
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--base-url") opts.baseUrl = argv[++i] ?? fail("--base-url needs a value")
    else if (arg === "--model") opts.model = argv[++i] ?? fail("--model needs a value")
    else if (arg === "--voice") opts.voice = argv[++i] ?? fail("--voice needs a value")
    else if (arg.startsWith("--")) fail(`unknown option ${arg}`)
    else words.push(arg)
  }
  opts.text = words.join(" ")
  return opts
}

async function main() {
  let opts: CliOptions
  try {
    opts = parseCliArgs(process.argv.slice(2))
  } catch (error) {
    console.error(String(error))
    process.exit(1)
  }
  if (!opts.text.trim()) {
    console.error(`error: no text given\n${USAGE}`)
    process.exit(1)
  }
  const started = Date.now()
  try {
    const wav = await makeFetchSpeech(opts.baseUrl, opts.model, opts.voice)(opts.text)
    await playWav(normalizeWav(wav))
    console.log(`announced "${opts.text}" in ${Date.now() - started} ms`)
  } catch (error) {
    console.error(`announce failed: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
