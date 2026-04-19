const KOKORO_URL =
  process.env.KOKORO_URL || "http://54.38.215.166:8880/v1/audio/speech";
const KOKORO_VOICE = process.env.KOKORO_VOICE || "af_heart";

/**
 * Proxy POST to Kokoro (OpenAI-compatible /v1/audio/speech) with streaming.
 * Accepts JSON `{ text, voice?, speed? }`, returns streamed `audio/mpeg`.
 * The body is forwarded chunk-by-chunk so the client can play audio while
 * synthesis is still running.
 */
export async function POST(req: Request) {
  let text: string;
  let voice: string;
  let speed: number;
  try {
    const body = await req.json();
    const t = body?.text;
    if (typeof t !== "string" || !t.trim()) {
      return Response.json({ error: "text field required" }, { status: 400 });
    }
    if (t.length > 2000) {
      return Response.json(
        { error: "Text too long (max 2000 chars)" },
        { status: 400 }
      );
    }
    text = t.trim();
    voice = typeof body?.voice === "string" && body.voice ? body.voice : KOKORO_VOICE;
    speed = typeof body?.speed === "number" ? body.speed : 1.0;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const upstream = await fetch(KOKORO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "kokoro",
        input: text,
        voice,
        response_format: "mp3",
        stream: true,
        speed,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!upstream.ok || !upstream.body) {
      return Response.json(
        { error: `TTS server error: ${upstream.status}` },
        { status: 502 }
      );
    }

    // Stream the mp3 bytes straight through. The browser side uses MSE
    // (see app/lib/tts.ts) so playback starts on the first chunk.
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "TTS server unreachable" }, { status: 503 });
  }
}
