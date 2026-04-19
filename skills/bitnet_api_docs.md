# BitNet b1.58 2B4T - API Reference

**Base URL:** `http://185.209.230.171:8002`  
**Auth:** Add header `Authorization: Bearer bitnet2b` to all requests  
**Format:** All request/response bodies are JSON  
**Model:** BitNet b1.58 2B4T (1.1 GB, native 1-bit, ~18 tokens/sec on CPU)

---

## 1. Health Check

**GET /health** _(no auth needed)_

```bash
curl http://185.209.230.171:8002/health
```

Response: `{"status":"ok"}`

---

## 2. List Models

**GET /v1/models**

```bash
curl http://185.209.230.171:8002/v1/models \
  -H "Authorization: Bearer bitnet2b"
```

---

## 3. Chat Completions

**POST /v1/chat/completions**

Main endpoint. OpenAI-compatible. Supports system/user/assistant roles.

```bash
curl http://185.209.230.171:8002/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer bitnet2b" \
  -d '{
    "model": "bitnet",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user",   "content": "Explain black holes simply."}
    ],
    "max_tokens": 300,
    "temperature": 0.7,
    "top_p": 0.95,
    "stream": false
  }'
```

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `messages` | array | required | Array of `{role, content}` — role: `system` / `user` / `assistant` |
| `max_tokens` | int | 512 | Max tokens to generate |
| `temperature` | float | 0.8 | Creativity 0.0-2.0 (lower = more focused) |
| `top_p` | float | 0.95 | Nucleus sampling |
| `top_k` | int | 40 | Top-k sampling |
| `repeat_penalty` | float | 1.0 | Penalize repeated tokens (try 1.1) |
| `stop` | array | none | Stop strings e.g. `["User:", "\n\n"]` |
| `stream` | bool | false | Stream tokens as SSE |
| `seed` | int | random | Set for reproducible outputs |

---

## 4. Streaming Chat

**POST /v1/chat/completions** with `"stream": true`

Returns server-sent events (SSE). Each line: `data: {...}`. Ends with `data: [DONE]`

```bash
curl http://185.209.230.171:8002/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer bitnet2b" \
  -d '{"model":"bitnet","messages":[{"role":"user","content":"Write a poem."}],"stream":true}'
```

### JavaScript Streaming Example

```javascript
const res = await fetch("http://185.209.230.171:8002/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer bitnet2b"
  },
  body: JSON.stringify({
    model: "bitnet",
    messages: [{ role: "user", content: "Hello" }],
    stream: true
  })
})

const reader = res.body.getReader()
const decoder = new TextDecoder()

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  const lines = decoder.decode(value).split("\n")
  for (const line of lines) {
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      const json = JSON.parse(line.slice(6))
      process.stdout.write(json.choices[0].delta.content || "")
    }
  }
}
```

---

## 5. Text Completions (Raw)

**POST /v1/completions**

Raw completion — no chat template applied. Good for autocomplete and fill-in-the-blank.

```bash
curl http://185.209.230.171:8002/v1/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer bitnet2b" \
  -d '{
    "model": "bitnet",
    "prompt": "The capital of Nigeria is",
    "max_tokens": 50,
    "temperature": 0.5,
    "stop": ["\n"]
  }'
```

---

## 6. Embeddings

**POST /v1/embeddings**

Returns a float vector for the input text. Useful for semantic search and similarity.

```bash
curl http://185.209.230.171:8002/v1/embeddings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer bitnet2b" \
  -d '{"model": "bitnet", "input": "Hello world"}'
```

> Note: Restart server with `--embeddings` flag to fully enable embedding mode.

---

## 7. Tokenize

**POST /tokenize**

Count tokens before sending. Max context is **4096 tokens** (prompt + response combined).

```bash
curl http://185.209.230.171:8002/tokenize \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer bitnet2b" \
  -d '{"content": "How many tokens is this sentence?"}'
```

Response: `{"tokens": [1234, 5678, ...]}`

---

## 8. Detokenize

**POST /detokenize**

```bash
curl http://185.209.230.171:8002/detokenize \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer bitnet2b" \
  -d '{"tokens": [9906, 1917]}'
```

---

## 9. Server Info

**GET /props**

```bash
curl http://185.209.230.171:8002/props \
  -H "Authorization: Bearer bitnet2b"
```

Returns: context size, model name, chat template, server config.

---

## 10. Python SDK (OpenAI-compatible)

```bash
pip install openai
```

```python
from openai import OpenAI

client = OpenAI(
  base_url="http://185.209.230.171:8002/v1",
  api_key="bitnet2b"
)

# Chat
response = client.chat.completions.create(
  model="bitnet",
  messages=[
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user",   "content": "What is Port Harcourt known for?"}
  ],
  max_tokens=300,
  temperature=0.7
)
print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
  model="bitnet",
  messages=[{"role": "user", "content": "Tell me a story."}],
  stream=True
)
for chunk in stream:
  print(chunk.choices[0].delta.content or "", end="", flush=True)
```

---

## 11. Limits & Server Management

| Setting | Value |
|---------|-------|
| Max context | 4096 tokens (prompt + response) |
| Max response | 512 tokens (configurable) |
| Concurrency | 1 request at a time |
| Speed | ~18 tokens/second on CPU |

### Increase max response tokens

```bash
nano /etc/systemd/system/bitnet.service
# Change -n 512 to -n 1024
systemctl daemon-reload && systemctl restart bitnet
```

### Service Commands

```bash
systemctl status bitnet      # check status
systemctl restart bitnet     # restart server
systemctl stop bitnet        # stop server
journalctl -u bitnet -f      # live logs
```
