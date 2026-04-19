import {
  createBitNetChatCompletion,
  getBitNetMessageText,
  readBitNetError,
} from "../../lib/bitnet";

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

    const bitNetRes = await createBitNetChatCompletion({
      messages: [
        { role: "system", content: META_SYSTEM_PROMPT },
        { role: "user", content: description.trim() },
      ],
      maxTokens: 160,
      temperature: 0.8,
      topP: 0.9,
    });

    if (!bitNetRes.ok) {
      const detail = await readBitNetError(bitNetRes);
      return Response.json(
        { error: detail || `BitNet error: ${bitNetRes.status}` },
        { status: bitNetRes.status }
      );
    }

    const data = await bitNetRes.json();
    const generated = getBitNetMessageText(data).trim();

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
