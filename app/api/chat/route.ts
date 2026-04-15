/* ── Simple in-memory rate limiter (per IP, 20 req/min) ── */
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const hits = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = hits.get(ip)?.filter((t) => now - t < RATE_WINDOW_MS) ?? [];
  timestamps.push(now);
  hits.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT;
}

/* ── Input constraints ──────────────────────────────────── */
const MAX_MESSAGES = 20;
const MAX_CONTENT_LENGTH = 4000;

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:1.7b";

const FALLBACK_SYSTEM_PROMPT =
  "Think efficiently at a low depth. Avoid long internal reasoning and answer directly unless the task is very complex.";

export async function POST(req: Request) {
  /* ── Rate limit check ─────────────────────────────────── */
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (isRateLimited(ip)) {
    return Response.json(
      { error: "Too many requests. Please slow down." },
      { status: 429 }
    );
  }

  try {
    const { messages, systemPrompt } = await req.json();

    /* ── Input validation ───────────────────────────────── */
    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: "Messages array required" }, { status: 400 });
    }
    if (messages.length > MAX_MESSAGES) {
      return Response.json(
        { error: `Too many messages (max ${MAX_MESSAGES})` },
        { status: 400 }
      );
    }
    for (const m of messages) {
      if (typeof m.content !== "string" || m.content.length > MAX_CONTENT_LENGTH) {
        return Response.json(
          { error: `Message content too long (max ${MAX_CONTENT_LENGTH} chars)` },
          { status: 400 }
        );
      }
    }

    // Use client-provided system prompt if valid, otherwise fallback
    const finalSystemPrompt =
      typeof systemPrompt === "string" && systemPrompt.trim()
        ? systemPrompt.trim()
        : FALLBACK_SYSTEM_PROMPT;

    // Build message list — same shape as the raw Ollama REST API
    const ollamaMessages = [
      { role: "system", content: finalSystemPrompt },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role === "agent" ? "assistant" : m.role,
        content: String(m.content),
      })),
    ];

    // Direct fetch to Ollama REST API — no npm wrapper overhead
    const ollamaRes = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: ollamaMessages,
        stream: true,
        think: false,
        keep_alive: "30m",
        options: {
          num_predict: 1024,
          num_ctx: 30720,
          temperature: 0.7,
          top_k: 20,
          top_p: 0.85,
          repeat_penalty: 1.3,
          repeat_last_n: 256,
        },
      }),
    });

    if (!ollamaRes.ok) {
      const text = await ollamaRes.text().catch(() => "");
      if (ollamaRes.status === 404 || text.includes("model")) {
        return Response.json(
          { error: "Model not found. Make sure it is pulled on the Ollama server." },
          { status: 404 }
        );
      }
      return Response.json(
        { error: `Ollama error: ${ollamaRes.status}` },
        { status: ollamaRes.status }
      );
    }

    // Stream NDJSON from Ollama → pipe directly to client (zero-copy, no JS processing)
    const ollamaBody = ollamaRes.body;
    if (!ollamaBody) {
      return Response.json({ error: "No response body from Ollama" }, { status: 502 });
    }

    return new Response(ollamaBody, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err: unknown) {
    const error = err as { message?: string; code?: string };
    if (error.code === "ECONNREFUSED") {
      return Response.json(
        { error: "Ollama server unreachable" },
        { status: 503 }
      );
    }
    console.error("Ollama error:", err);
    return Response.json({ error: "LLM error" }, { status: 500 });
  }
}
