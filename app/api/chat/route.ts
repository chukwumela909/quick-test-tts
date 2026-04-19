import {
  bitNetSseToNdjson,
  createBitNetChatCompletion,
  readBitNetError,
  type BitNetMessage,
} from "../../lib/bitnet";

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
const MAX_RESPONSE_TOKENS_TEXT = 384;
const MAX_RESPONSE_TOKENS_VOICE = 160;
const MAX_VOICE_HISTORY = 6;

const FALLBACK_SYSTEM_PROMPT =
  "Think efficiently at a low depth. Avoid long internal reasoning and answer directly unless the task is very complex.";

const VOICE_STYLE_SUFFIX =
  "\n\nThis is a spoken voice conversation. Reply in 1\u20133 short sentences, under ~40 words. Use plain prose\u2014no lists, headings, code fences, or markdown. Prefer contractions and a natural spoken cadence.";

const TEXT_STYLE_SUFFIX =
  "\n\nFormatting: render replies in GitHub-Flavored Markdown when it improves clarity. " +
  "Use bullet lists for enumerations, numbered lists for ordered steps, and tables for any " +
  "comparison or set of records with shared fields. Use fenced code blocks with a language tag " +
  "for code or shell commands, and `inline code` for identifiers, file paths, and short snippets. " +
  "Use **bold** for key terms and short headings (##) only when the response has multiple distinct " +
  "sections. For short conversational answers, reply in plain prose without headings or lists. " +
  "Never wrap an entire short answer in a code block. Do not invent data to fill a table.";

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
    const { messages, systemPrompt, mode, interruptionNote } = await req.json();
    const isVoice = mode === "voice";

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

    // Use client-provided system prompt if valid, otherwise fallback.
    // Voice turns get a short-reply suffix appended so the agent reply starts
    // fast and doesn't ramble past a spoken attention span.
    const basePrompt =
      typeof systemPrompt === "string" && systemPrompt.trim()
        ? systemPrompt.trim()
        : FALLBACK_SYSTEM_PROMPT;
    let finalSystemPrompt = isVoice
      ? basePrompt + VOICE_STYLE_SUFFIX
      : basePrompt + TEXT_STYLE_SUFFIX;
    // If the previous agent turn was cut off, tell the model what the user
    // actually heard so it can acknowledge naturally instead of restating.
    if (typeof interruptionNote === "string") {
      const note = interruptionNote.trim().slice(0, 500);
      if (note) finalSystemPrompt += "\n\n" + note;
    }

    // Trim history aggressively for voice to reduce prompt-processing time.
    const trimmedMessages = isVoice
      ? messages.slice(-MAX_VOICE_HISTORY)
      : messages;

    const providerMessages: BitNetMessage[] = [
      { role: "system", content: finalSystemPrompt },
      ...trimmedMessages.map(
        (m: { role: string; content: string }): BitNetMessage => ({
          role:
            m.role === "agent" || m.role === "assistant"
              ? "assistant"
              : m.role === "system"
                ? "system"
                : "user",
          content: String(m.content),
        })
      ),
    ];

    const bitNetRes = await createBitNetChatCompletion({
      messages: providerMessages,
      stream: true,
      maxTokens: isVoice ? MAX_RESPONSE_TOKENS_VOICE : MAX_RESPONSE_TOKENS_TEXT,
      temperature: 0.7,
      topK: 20,
      topP: 0.85,
      repeatPenalty: 1.3,
      signal: req.signal,
    });

    if (!bitNetRes.ok) {
      const detail = await readBitNetError(bitNetRes);
      if (bitNetRes.status === 404 || detail.toLowerCase().includes("model")) {
        return Response.json(
          { error: "BitNet model not found or unavailable." },
          { status: 404 }
        );
      }
      return Response.json(
        { error: detail || `BitNet error: ${bitNetRes.status}` },
        { status: bitNetRes.status }
      );
    }

    const bitNetBody = bitNetRes.body;
    if (!bitNetBody) {
      return Response.json({ error: "No response body from BitNet" }, { status: 502 });
    }

    return new Response(bitNetSseToNdjson(bitNetBody), {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache, no-transform",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err: unknown) {
    const error = err as { message?: string; code?: string };
    if (error.code === "ECONNREFUSED") {
      return Response.json(
        { error: "BitNet server unreachable" },
        { status: 503 }
      );
    }
    console.error("BitNet error:", err);
    return Response.json({ error: "LLM error" }, { status: 500 });
  }
}
