const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:1.7b";

const META_SYSTEM_PROMPT = `You are a system prompt engineer. The user will describe what kind of AI assistant they want. Your job is to write a clear, concise system prompt that defines that assistant's role, personality, and behavior.

Rules:
- Output ONLY the system prompt text — no explanation, no preamble, no quotes around it.
- Keep it under 400 characters.
- Be specific about tone, style, and constraints.
- Write in second person ("You are...").`;

export async function POST(req: Request) {
  try {
    const { description } = await req.json();

    if (typeof description !== "string" || !description.trim()) {
      return Response.json(
        { error: "Description is required" },
        { status: 400 }
      );
    }

    if (description.length > 500) {
      return Response.json(
        { error: "Description too long (max 500 chars)" },
        { status: 400 }
      );
    }

    const ollamaRes = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: "system", content: META_SYSTEM_PROMPT },
          { role: "user", content: description.trim() },
        ],
        stream: false,
        think: false,
        options: {
          num_predict: 200,
          temperature: 0.8,
          top_p: 0.9,
        },
      }),
    });

    if (!ollamaRes.ok) {
      return Response.json(
        { error: `Ollama error: ${ollamaRes.status}` },
        { status: ollamaRes.status }
      );
    }

    const data = await ollamaRes.json();
    const generated = data.message?.content?.trim() ?? "";

    if (!generated) {
      return Response.json(
        { error: "Failed to generate prompt" },
        { status: 500 }
      );
    }

    return Response.json({ prompt: generated });
  } catch (err) {
    console.error("Generate prompt error:", err);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
