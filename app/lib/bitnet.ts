const DEFAULT_BITNET_BASE_URL = "http://185.209.230.171:8002";
const DEFAULT_BITNET_API_KEY = "bitnet2b";
const DEFAULT_BITNET_MODEL = "bitnet";

const encoder = new TextEncoder();

export type BitNetMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type BitNetChoice = {
  message?: { content?: string | null };
  delta?: { content?: string | null };
  text?: string | null;
};

type BitNetChatResponse = {
  choices?: BitNetChoice[];
  error?: string | { message?: string };
};

type BitNetChatRequest = {
  messages: BitNetMessage[];
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  signal?: AbortSignal;
};

export function getBitNetBaseUrl(): string {
  return process.env.BITNET_BASE_URL || DEFAULT_BITNET_BASE_URL;
}

export function getBitNetApiKey(): string {
  return process.env.BITNET_API_KEY || DEFAULT_BITNET_API_KEY;
}

export function getBitNetModel(): string {
  return process.env.BITNET_MODEL || DEFAULT_BITNET_MODEL;
}

function getBitNetHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getBitNetApiKey()}`,
    "Content-Type": "application/json",
  };
}

export async function createBitNetChatCompletion({
  messages,
  stream = false,
  maxTokens,
  temperature,
  topP,
  topK,
  repeatPenalty,
  signal,
}: BitNetChatRequest): Promise<Response> {
  return fetch(`${getBitNetBaseUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: getBitNetHeaders(),
    body: JSON.stringify({
      model: getBitNetModel(),
      messages,
      stream,
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
      top_k: topK,
      repeat_penalty: repeatPenalty,
    }),
    cache: "no-store",
    signal,
  });
}

export async function listBitNetModels(signal?: AbortSignal): Promise<Response> {
  return fetch(`${getBitNetBaseUrl()}/v1/models`, {
    headers: {
      Authorization: `Bearer ${getBitNetApiKey()}`,
    },
    cache: "no-store",
    signal,
  });
}

export async function readBitNetError(response: Response): Promise<string> {
  const fallback = `BitNet error: ${response.status}`;
  const text = await response.text().catch(() => "");

  if (!text) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text) as BitNetChatResponse;
    const err = parsed.error;
    if (typeof err === "string" && err.trim()) {
      return err;
    }
    if (
      err &&
      typeof err === "object" &&
      typeof err.message === "string" &&
      err.message.trim()
    ) {
      return err.message;
    }
  } catch {
    // Fall back to raw upstream text when the error is not valid JSON.
  }

  return text;
}

export function getBitNetMessageText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const choices = (payload as BitNetChatResponse).choices;
  const firstChoice = Array.isArray(choices) ? choices[0] : undefined;
  const content =
    firstChoice?.message?.content ??
    firstChoice?.delta?.content ??
    firstChoice?.text ??
    "";

  return typeof content === "string" ? content : "";
}

function enqueueBitNetDelta(
  line: string,
  controller: ReadableStreamDefaultController<Uint8Array>
) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return;
  }

  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") {
    return;
  }

  try {
    const parsed = JSON.parse(payload);
    const text = getBitNetMessageText(parsed);
    if (!text) {
      return;
    }

    controller.enqueue(
      encoder.encode(JSON.stringify({ message: { content: text } }) + "\n")
    );
  } catch {
    // Ignore malformed or partial upstream events.
  }
}

export function bitNetSseToNdjson(
  body: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = body.getReader();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            enqueueBitNetDelta(line, controller);
          }
        }

        buffer += decoder.decode();
        if (buffer.trim()) {
          enqueueBitNetDelta(buffer, controller);
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });
}