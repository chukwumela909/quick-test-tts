---
name: ollama-api
description: Use Ollama as a local LLM runtime via its HTTP API. Covers all endpoints — chat, generate, embeddings, model management — plus OpenAI-compatible routes. Reference for integrating Ollama into apps (Next.js, Python, curl, etc). Focused on consuming APIs, not server setup.
version: 2.0.0
tags: [ollama, llm, inference, api, local-ai, openai-compatible, streaming, next.js, vercel-ai-sdk]
---

# Ollama API Skill

Ollama runs a local HTTP server (default: http://localhost:11434) exposing a REST API for LLM inference. No API key needed. Full docs: https://docs.ollama.com/api

**User context:** VMI server at 185.209.230.171, pocket-tts at :8000, Ollama at :11434. Architecture: Flutter/browser -> Next.js API route -> Ollama on remote VPS.

---

## PACKAGE OPTIONS

### Option 1: Native @ollama/ollama client (recommended for full features)
```bash
npm i ollama
```
- Full TypeScript types, AsyncGenerator streaming
- Supports: chat, generate, embeddings, tools, thinking, structured output, multimodal
- Node: `import ollama from 'ollama'`
- Browser: `import ollama from 'ollama/browser'`

### Option 2: openai SDK pointed at Ollama (best for OpenAI compatibility)
```bash
npm i openai
```
- Drop-in for apps already using openai SDK
- Less Ollama-specific features (no native thinking, fewer options)
- Always requires a dummy apiKey

### Option 3: ollama-ai-provider (for Vercel AI SDK integration)
```bash
npm i ollama-ai-provider ai
```
- Works with Vercel AI SDK's streamText, useChat, generateObject
- Requires Ollama >= 0.5.0
- Tool streaming is simulated (not native) — use with caution

---

## CORE API ENDPOINTS

### 1. Chat Completion (recommended for conversations)

```
POST /api/chat
```

```bash
# Non-streaming (simpler for voice assistant use case)
curl http://localhost:11434/api/chat -d '{
  "model": "llama3.2",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Why is the sky blue?"}
  ],
  "stream": false
}'
```

Response:
```json
{
  "model": "llama3.2",
  "message": {"role": "assistant", "content": "Due to Rayleigh scattering..."},
  "done": true,
  "total_duration": 5191566416,
  "eval_count": 298
}
```

Key parameters:
- `model` (required)
- `messages` — array of {role, content} — include full history for multi-turn
- `stream` (bool, default true)
- `format` — "json" or JSON schema for structured output
- `options` — temperature, seed, top_k, top_p, num_ctx, etc.
- `keep_alive` — e.g. "10m", 0 to unload, -1 to keep forever
- `tools` — function definitions for tool calling
- `think` — bool or "high"/"medium"/"low" for reasoning models

### 2. Generate Completion (single-turn, raw)

```
POST /api/generate
```

```bash
curl http://localhost:11434/api/generate -d '{
  "model": "llama3.2",
  "prompt": "Why is the sky blue?",
  "stream": false
}'
```

Response:
```json
{
  "model": "llama3.2",
  "response": "The sky is blue because of Rayleigh scattering...",
  "done": true
}
```

With options:
```json
{
  "model": "llama3.2",
  "prompt": "Write a haiku",
  "stream": false,
  "options": {
    "temperature": 0.8,
    "seed": 42,
    "num_ctx": 4096,
    "top_k": 20,
    "top_p": 0.9,
    "num_predict": 100
  }
}
```

Load/unload model:
```bash
# Load into memory
curl http://localhost:11434/api/generate -d '{"model": "llama3.2"}'
# Unload from memory
curl http://localhost:11434/api/generate -d '{"model": "llama3.2", "keep_alive": 0}'
```

### 3. Embeddings

```
POST /api/embed
```

```bash
curl http://localhost:11434/api/embed -d '{
  "model": "all-minilm",
  "input": ["First sentence.", "Second sentence."]
}'
```

---

## STREAMING IN NEXT.JS APP ROUTER

### Method 1: Native ollama client + ReadableStream (recommended)

```typescript
// app/api/chat/route.ts
import { Ollama } from 'ollama'

const ollama = new Ollama({ host: 'http://185.209.230.171:11434' })

export async function POST(req: Request) {
  const { messages } = await req.json()

  const stream = await ollama.chat({
    model: 'llama3.2',
    messages,
    stream: true,
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const text = chunk.message.content
          if (text) controller.enqueue(encoder.encode(text))
        }
      } catch (err) {
        controller.error(err)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
```

### Method 2: openai SDK + ReadableStream

```typescript
// app/api/chat/route.ts
import OpenAI from 'openai'

// Singleton — create once, reuse across requests
const ollamaClient = new OpenAI({
  baseURL: 'http://185.209.230.171:11434/v1/',
  apiKey: 'ollama',
})

export async function POST(req: Request) {
  const { messages } = await req.json()

  const stream = await ollamaClient.chat.completions.create({
    model: 'llama3.2',
    messages,
    stream: true,
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || ''
          if (text) controller.enqueue(encoder.encode(text))
        }
      } catch (err) {
        controller.error(err)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
```

### Method 3: Vercel AI SDK with ollama-ai-provider

```typescript
// app/api/chat/route.ts
import { createOllama } from 'ollama-ai-provider'
import { streamText } from 'ai'

const ollama = createOllama({
  baseURL: 'http://185.209.230.171:11434/api',
})

export async function POST(req: Request) {
  const { messages } = await req.json()

  const result = await streamText({
    model: ollama('llama3.2'),
    messages,
  })

  return result.toDataStreamResponse()
}
```

Frontend useChat hook (works with Method 3):
```typescript
'use client'
import { useChat } from 'ai/react'

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit } = useChat()
  return (
    <div>
      {messages.map(m => (
        <div key={m.id}>{m.role}: {m.content}</div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
        <button type="submit">Send</button>
      </form>
    </div>
  )
}
```

### Consuming a streaming response on the frontend (plain fetch)

```typescript
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages }),
})

const reader = response.body!.getReader()
const decoder = new TextDecoder()
let fullText = ''

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  const chunk = decoder.decode(value, { stream: true })
  fullText += chunk
  // update UI incrementally
  setDisplayText(fullText)
}

// After stream ends — send fullText to TTS
await sendToTTS(fullText)
```

---

## TOOL CALLING (Native Client)

```typescript
import { Ollama } from 'ollama'

const ollama = new Ollama({ host: 'http://185.209.230.171:11434' })

// Define tools
const tools = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather for a city',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
        },
        required: ['city'],
      },
    },
  },
]

// Tool implementations
const availableFunctions: Record<string, Function> = {
  get_weather: ({ city }: { city: string }) => `22°C, sunny in ${city}`,
}

async function chatWithTools(userMessage: string) {
  const messages = [{ role: 'user', content: userMessage }]

  // First call — may return tool_calls
  const response = await ollama.chat({
    model: 'llama3.1:8b',  // must be a tool-capable model
    messages,
    tools,
  })

  if (response.message.tool_calls) {
    // Execute each tool call
    for (const call of response.message.tool_calls) {
      const fn = availableFunctions[call.function.name]
      if (fn) {
        const result = fn(call.function.arguments)
        // Add assistant message + tool result
        messages.push(response.message)
        messages.push({
          role: 'tool',
          content: String(result),
          tool_name: call.function.name,  // optional but good practice
        })
      }
    }

    // Second call with tool results
    const final = await ollama.chat({ model: 'llama3.1:8b', messages })
    return final.message.content
  }

  return response.message.content
}
```

Find tool-capable models: https://ollama.com/search?c=tool

---

## CONNECTION MANAGEMENT

### Singleton client pattern (important for Next.js)

```typescript
// lib/ollama.ts — create once, import everywhere
import { Ollama } from 'ollama'

let _client: Ollama | null = null

export function getOllamaClient(): Ollama {
  if (!_client) {
    _client = new Ollama({
      host: process.env.OLLAMA_HOST || 'http://localhost:11434',
      // fetch: customFetch,  // optional: inject custom fetch for retries/auth
    })
  }
  return _client
}
```

```typescript
// Usage in route handler
import { getOllamaClient } from '@/lib/ollama'

export async function POST(req: Request) {
  const ollama = getOllamaClient()
  // ...
}
```

### keep_alive recommendations

```typescript
// For voice assistant — keep model warm between turns
const response = await ollama.chat({
  model: 'llama3.2',
  messages,
  keep_alive: '10m',  // keep loaded 10 mins after last request
})

// Pre-warm model on app startup
await ollama.chat({
  model: 'llama3.2',
  messages: [],
  keep_alive: '30m',
})
```

### Abort / timeout

```typescript
import { Ollama } from 'ollama'

const ollama = new Ollama({ host: 'http://185.209.230.171:11434' })

// Abort after timeout
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 30_000) // 30s

try {
  const stream = await ollama.chat({
    model: 'llama3.2',
    messages,
    stream: true,
  }, { signal: controller.signal })

  for await (const chunk of stream) {
    // process chunk
  }
} catch (err: any) {
  if (err.name === 'AbortError') {
    console.log('Request timed out or was cancelled')
  }
} finally {
  clearTimeout(timeout)
}
```

---

## STRUCTURED OUTPUT

```typescript
// Using JSON schema — forces model to match the shape
const response = await ollama.chat({
  model: 'llama3.1:8b',
  messages: [{ role: 'user', content: 'Extract: John is 25 years old.' }],
  format: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'integer' },
    },
    required: ['name', 'age'],
  },
  stream: false,
})

const data = JSON.parse(response.message.content)
```

---

## ERROR HANDLING

```typescript
export async function POST(req: Request) {
  try {
    const ollama = getOllamaClient()
    const { messages } = await req.json()

    const stream = await ollama.chat({
      model: 'llama3.2',
      messages,
      stream: true,
    })

    // ... return stream

  } catch (err: any) {
    // Model not found / not pulled
    if (err.status === 404 || err.message?.includes('model')) {
      return Response.json({ error: 'Model not found. Pull it first.' }, { status: 404 })
    }
    // Connection refused — Ollama not running
    if (err.code === 'ECONNREFUSED') {
      return Response.json({ error: 'Ollama server unreachable' }, { status: 503 })
    }
    // Context overflow
    if (err.message?.includes('context')) {
      return Response.json({ error: 'Context window exceeded' }, { status: 400 })
    }
    // Generic
    console.error('Ollama error:', err)
    return Response.json({ error: 'LLM error' }, { status: 500 })
  }
}
```

---

## OPENAI-COMPATIBLE API (/v1/ routes)

Available endpoints:
- `POST /v1/chat/completions`
- `POST /v1/completions`
- `POST /v1/embeddings`
- `GET /v1/models`
- `POST /v1/responses` (v0.13.3+)

```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'http://185.209.230.171:11434/v1/',
  apiKey: 'ollama',  // required by SDK, ignored by Ollama
})

// Streaming
const stream = await client.chat.completions.create({
  model: 'llama3.2',
  messages: [{ role: 'user', content: 'Hello!' }],
  stream: true,
})
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '')
}
```

Alias model to OpenAI name (for apps that hardcode gpt-* names):
```bash
ollama cp llama3.2 gpt-3.5-turbo
```

---

## VOICE ASSISTANT PIPELINE (with pocket-tts)

```
User speech -> Web Speech API
  -> transcript text
  -> POST /api/chat (Next.js route)
  -> Ollama chat (stream: false for simplicity, or stream for faster first audio)
  -> response text
  -> POST http://185.209.230.171:8000/tts (pocket-tts, multipart/form-data)
  -> audio stream
  -> Web Audio API plays it
  -> repeat
```

Non-streaming (simpler, lower latency for short responses):
```typescript
// app/api/voice-chat/route.ts
import { getOllamaClient } from '@/lib/ollama'

export async function POST(req: Request) {
  const { messages } = await req.json()
  const ollama = getOllamaClient()

  const response = await ollama.chat({
    model: 'llama3.2',
    messages,
    stream: false,
    keep_alive: '10m',
    options: { num_predict: 150 },  // keep responses short for voice
  })

  return Response.json({ text: response.message.content })
}
```

Frontend voice loop:
```typescript
async function voiceTurn(transcript: string) {
  // 1. Send to LLM
  const res = await fetch('/api/voice-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [...history, { role: 'user', content: transcript }] }),
  })
  const { text } = await res.json()

  // 2. Send to TTS
  const form = new FormData()
  form.append('text', text)
  const ttsRes = await fetch('http://185.209.230.171:8000/tts', {
    method: 'POST',
    body: form,
  })

  // 3. Play audio
  const blob = await ttsRes.blob()
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  audio.play()
}
```

---

## MODEL MANAGEMENT ENDPOINTS

```bash
GET  /api/tags         # list local models
POST /api/show         # model info: {"model": "llama3.2"}
POST /api/pull         # pull model: {"model": "llama3.2"}
DELETE /api/delete     # delete: {"model": "llama3.2"}
POST /api/copy         # copy: {"source": "llama3.2", "destination": "my-model"}
POST /api/create       # create from base + system prompt
GET  /api/ps           # list models loaded in memory
GET  /api/version      # Ollama version
```

Create custom model:
```bash
curl http://localhost:11434/api/create -d '{
  "model": "my-assistant",
  "from": "llama3.2",
  "system": "You are a concise voice assistant. Keep responses under 2 sentences."
}'
```

---

## OPTIONS REFERENCE

Pass inside `options` object:

| Parameter | Description | Default |
|-----------|-------------|---------|
| temperature | Creativity 0.0–1.0 | 0.8 |
| seed | Reproducibility | random |
| num_ctx | Context window (tokens) | 4096 |
| num_predict | Max tokens to generate | -1 (unlimited) |
| top_k | Top-K sampling | 40 |
| top_p | Nucleus sampling | 0.9 |
| repeat_penalty | Penalize repetition | 1.1 |
| stop | Stop sequences array | [] |
| num_gpu | GPU layers | model default |
| num_thread | CPU threads | system default |

Set context window globally:
```bash
OLLAMA_CONTEXT_LENGTH=8192 ollama serve
```

---

## PITFALLS

- Models must be pulled before use — unknown model returns 404
- Default context is 4096 tokens — increase with num_ctx or OLLAMA_CONTEXT_LENGTH
- Ollama binds to localhost by default — set OLLAMA_HOST=0.0.0.0 for external access + add firewall rules
- openai SDK requires apiKey even though Ollama ignores it — pass any non-empty string
- Tool calling only works on supported models — check https://ollama.com/search?c=tool
- Stream=true (default) returns newline-delimited JSON chunks — set stream:false for simplicity
- Durations in responses are nanoseconds
- keep_alive defaults to 5m — model unloads after idle, causing slow first request; use -1 or longer value to keep warm
- ollama-ai-provider: tool streaming is SIMULATED (not native) — may be unreliable
- In Next.js App Router route handlers, always create client as singleton (module-level or via lib/) to avoid reconnecting on every request
- For voice assistants, keep responses short with num_predict to reduce TTS latency
- Abort signals work on the native ollama client — pass {signal} as second arg to chat()
