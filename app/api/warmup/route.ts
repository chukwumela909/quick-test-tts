import { listBitNetModels, readBitNetError } from "../../lib/bitnet";

const KOKORO_URL =
  process.env.KOKORO_URL || "http://54.38.215.166:8880/v1/audio/speech";
const KOKORO_VOICE = process.env.KOKORO_VOICE || "af_heart";

/**
 * Best-effort TTS warm-up. Fires a tiny synth request and discards the audio.
 * Failure is non-fatal: TTS latency is separate from BitNet readiness.
 */
async function warmTts(): Promise<"warm" | "error"> {
  try {
    const res = await fetch(KOKORO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "kokoro",
        input: "ok",
        voice: KOKORO_VOICE,
        response_format: "mp3",
        stream: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return "error";
    // Drain the body so the server considers the request complete.
    await res.arrayBuffer().catch(() => {});
    return "warm";
  } catch {
    return "error";
  }
}

/**
 * Probe the BitNet upstream (and TTS in parallel) before the first turn.
 */
export async function POST() {
  const ttsPromise = warmTts();
  try {
    const res = await listBitNetModels();

    if (!res.ok) {
      const detail = await readBitNetError(res);
      return Response.json(
        { status: "error", detail: detail || `BitNet returned ${res.status}` },
        { status: 502 }
      );
    }

    const tts = await ttsPromise;
    return Response.json({ status: "warm", tts });
  } catch {
    // Await TTS so we don't leave a dangling request.
    await ttsPromise.catch(() => {});
    return Response.json({ status: "unreachable" }, { status: 503 });
  }
}
