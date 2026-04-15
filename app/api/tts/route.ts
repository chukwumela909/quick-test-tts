const TTS_URL = process.env.TTS_URL || "http://185.209.230.171:8000/tts";

/**
 * Proxy POST to pocket-tts to avoid CORS issues.
 * Accepts FormData with a "text" field, returns audio blob.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const text = form.get("text");

    if (!text || typeof text !== "string" || !text.trim()) {
      return Response.json({ error: "Text field required" }, { status: 400 });
    }

    if (text.length > 2000) {
      return Response.json({ error: "Text too long (max 2000 chars)" }, { status: 400 });
    }

    const ttsForm = new FormData();
    ttsForm.append("text", text.trim());

    const res = await fetch(TTS_URL, {
      method: "POST",
      body: ttsForm,
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      return Response.json(
        { error: `TTS server error: ${res.status}` },
        { status: 502 }
      );
    }

    const audioBlob = await res.blob();

    return new Response(audioBlob, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "audio/wav",
        "Content-Length": String(audioBlob.size),
      },
    });
  } catch {
    return Response.json({ error: "TTS server unreachable" }, { status: 503 });
  }
}
