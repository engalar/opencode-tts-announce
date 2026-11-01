// Throwaway end-to-end check: exercises the exact plugin pipeline
// (createSpeaker -> makeFetchSpeech -> playWav) against the live TTS server.
import { makeFetchSpeech, playWav } from "./index"
import { createSpeaker } from "./announce"

const baseUrl = "http://127.0.0.1:8000"

const health = await fetch(`${baseUrl}/health`)
const healthBody = await health.json()
console.log("health:", JSON.stringify(healthBody))
if (healthBody.model_loaded !== true) {
  console.error("model not loaded")
  process.exit(1)
}

const speaker = createSpeaker({
  fetchSpeech: makeFetchSpeech(baseUrl, "tts-1", "alloy"),
  play: playWav,
})

const t0 = Date.now()
await speaker.say("任务完成")
console.log(`announced "任务完成" in ${Date.now() - t0} ms (fetch + synthesis + playback)`)
