// Throwaway end-to-end check: exercises the exact plugin pipeline
// (createSpeaker -> fetch -> playAudio) against the live TTS server.
import { createAnnouncer } from "./index"

const baseUrl = process.env.TTS_BASE_URL ?? "http://127.0.0.1:8000"

const health = await fetch(`${baseUrl}/health`)
const healthBody = await health.json()
console.log("health:", JSON.stringify(healthBody))
if (healthBody.model_loaded !== true) {
  console.error("model not loaded")
  process.exit(1)
}

const { speaker } = createAnnouncer({ baseUrl })
const t0 = Date.now()
await speaker.say("任务完成")
console.log(`announced "任务完成" in ${Date.now() - t0} ms (fetch + synthesis + playback)`)
