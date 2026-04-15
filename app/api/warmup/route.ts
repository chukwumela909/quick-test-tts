const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:1.7b";

/**
 * Preload the model into Ollama's GPU memory.
 * Sends a minimal non-streaming request with num_predict:1 so the model
 * loads and stays resident for keep_alive duration.
 */
export async function POST() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: "user", content: "hi" }],
        stream: false,
        think: false,
        keep_alive: "30m",
        options: { num_predict: 1 },
      }),
    });

    if (!res.ok) {
      return Response.json(
        { status: "error", detail: `Ollama returned ${res.status}` },
        { status: 502 }
      );
    }

    return Response.json({ status: "warm" });
  } catch {
    return Response.json({ status: "unreachable" }, { status: 503 });
  }
}
