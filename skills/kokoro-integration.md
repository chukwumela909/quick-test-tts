# Kokoro TTS — Integration Guide (Public Endpoint)

Self-hosted open-source TTS with an OpenAI-compatible API. Runs on CPU.

> ⚠️ **This endpoint is public, unauthenticated, and HTTP-only.** Anyone with the URL can call it. Fine for testing; do **not** put it in production apps or commit it to public repos. Rotate / shut down when done.

---

## 1. Server reference

- **Base URL:** `http://54.38.215.166:8880`
- **Web UI (browser test):** <http://54.38.215.166:8880/web/>
- **Model:** `kokoro` (Kokoro-82M, v1.0)
- **Default voice:** `af_heart`
- **Audio formats:** `mp3`, `wav`, `opus`, `flac`, `aac`, `pcm`
- **Sample rate:** 24 kHz mono

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/audio/speech` | Synthesize text → audio (streaming or full) |
| GET  | `/v1/audio/voices` | List all 67 voices |
| POST | `/v1/audio/voices/combine` | Blend multiple voices |
| POST | `/dev/captioned_speech` | Audio + word-level timestamps |
| GET  | `/health` | Liveness probe |
| GET  | `/web/` | Built-in browser UI |

### Request body (OpenAI-compatible + extras)

```json
{
  "model": "kokoro",
  "input": "text to speak",
  "voice": "af_heart",
  "response_format": "mp3",
  "speed": 1.0,
  "stream": true,
  "lang_code": "a"
}
```

- `voice` accepts a single name **or** a blend like `"af_heart(2)+am_michael(1)"`
- `speed`: `0.25`–`4.0`
- `stream: true` → chunked transfer encoding, first bytes arrive in ~300–600 ms
- `lang_code`: `a`=US-EN, `b`=UK-EN, `e`=Spanish, `f`=French, `h`=Hindi, `i`=Italian, `j`=Japanese, `p`=Portuguese, `z`=Mandarin

### Popular voices
- **Female US:** `af_heart`, `af_bella`, `af_nicole`, `af_sarah`, `af_sky`
- **Male US:** `am_michael`, `am_adam`, `am_onyx`, `am_fenrir`
- **Female UK:** `bf_emma`, `bf_alice`, `bf_lily`
- **Male UK:** `bm_george`, `bm_daniel`, `bm_fable`

Full list:
```bash
curl http://54.38.215.166:8880/v1/audio/voices
```

---

## 2. cURL quickstarts

### Save to MP3
```bash
curl -X POST http://54.38.215.166:8880/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model":"kokoro","input":"Hello world","voice":"af_heart","response_format":"mp3"}' \
  -o out.mp3
```

### Stream straight to speakers (Linux/macOS)
```bash
curl -N -X POST http://54.38.215.166:8880/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model":"kokoro","input":"Streaming test","voice":"af_heart","response_format":"mp3","stream":true}' \
  | ffplay -nodisp -autoexit -loglevel quiet -
```

### Windows PowerShell
```powershell
$body = @{
  model = "kokoro"
  input = "Hello Amirize from Windows"
  voice = "af_heart"
  response_format = "mp3"
} | ConvertTo-Json

Invoke-RestMethod -Uri http://54.38.215.166:8880/v1/audio/speech `
  -Method POST -ContentType "application/json" -Body $body `
  -OutFile out.mp3
Start-Process out.mp3
```

---

## 3. Stream a Markdown file

Install once:
```bash
pip install requests markdown-it-py
sudo apt install ffmpeg   # for live playback (optional)
```

Save as `stream_md.py`:

```python
#!/usr/bin/env python3
"""
Stream a Markdown file to Kokoro TTS.
Usage:
  python stream_md.py notes.md out.mp3
  python stream_md.py notes.md - | ffplay -nodisp -autoexit -
"""
import sys, re, requests
from markdown_it import MarkdownIt

KOKORO_URL = "http://54.38.215.166:8880/v1/audio/speech"
VOICE      = "af_heart"
FORMAT     = "mp3"

def md_to_plaintext(md: str) -> str:
    html = MarkdownIt().render(md)
    text = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", text).strip()

def split_sentences(text: str, max_chars: int = 400):
    parts = re.split(r"(?<=[\.\!\?])\s+", text)
    buf = ""
    for p in parts:
        if len(buf) + len(p) + 1 > max_chars and buf:
            yield buf
            buf = p
        else:
            buf = f"{buf} {p}".strip()
    if buf:
        yield buf

def synth_stream(text: str, sink):
    payload = {
        "model": "kokoro",
        "input": text,
        "voice": VOICE,
        "response_format": FORMAT,
        "stream": True,
        "speed": 1.0,
    }
    with requests.post(KOKORO_URL, json=payload, stream=True, timeout=600) as r:
        r.raise_for_status()
        for chunk in r.iter_content(chunk_size=4096):
            if chunk:
                sink.write(chunk); sink.flush()

def main():
    if len(sys.argv) < 3:
        print("Usage: stream_md.py <input.md> <output.mp3|->"); sys.exit(1)
    md_path, out_path = sys.argv[1], sys.argv[2]
    with open(md_path, "r", encoding="utf-8") as f:
        text = md_to_plaintext(f.read())
    sink = sys.stdout.buffer if out_path == "-" else open(out_path, "wb")
    try:
        for sentence in split_sentences(text):
            print(f"[TTS] {sentence[:80]}...", file=sys.stderr)
            synth_stream(sentence, sink)
    finally:
        if sink is not sys.stdout.buffer:
            sink.close()

if __name__ == "__main__":
    main()
```

Run:
```bash
# Save to file
python stream_md.py notes.md out.mp3

# Live playback while streaming
python stream_md.py notes.md - | ffplay -nodisp -autoexit -loglevel quiet -

# Save + play at same time
python stream_md.py notes.md - | tee out.mp3 | ffplay -nodisp -autoexit -
```

**Why chunk by sentence?** Audio playback can start on sentence 1 while sentence 2 is still synthesizing — real end-to-end streaming.

---

## 4. OpenAI SDK drop-in

### Python
```python
from openai import OpenAI
client = OpenAI(base_url="http://54.38.215.166:8880/v1", api_key="not-needed")

with client.audio.speech.with_streaming_response.create(
    model="kokoro", voice="af_heart",
    input="Reading your notes now.",
    response_format="mp3",
) as r:
    r.stream_to_file("out.mp3")
```

### Node.js
```js
import OpenAI from "openai";
import fs from "fs";

const ai = new OpenAI({
  baseURL: "http://54.38.215.166:8880/v1",
  apiKey: "not-needed",
});

const res = await ai.audio.speech.create({
  model: "kokoro",
  voice: "af_heart",
  input: "Hello from Node.",
  response_format: "mp3",
});
fs.writeFileSync("out.mp3", Buffer.from(await res.arrayBuffer()));
```

### Node (streaming into an mp3 as it arrives)
```js
import fetch from "node-fetch";
import fs from "fs";

const res = await fetch("http://54.38.215.166:8880/v1/audio/speech", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "kokoro", input: "Streaming audio.",
    voice: "af_heart", response_format: "mp3", stream: true,
  }),
});
res.body.pipe(fs.createWriteStream("out.mp3"));
```

---

## 5. TaskHub / Express integration snippet

```js
// routes/speak.js — proxy endpoint that streams TTS to the client
import { Router } from "express";
const router = Router();

router.post("/speak", async (req, res) => {
  const { text, voice = "af_heart" } = req.body;
  const upstream = await fetch("http://54.38.215.166:8880/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "kokoro", input: text, voice,
      response_format: "mp3", stream: true,
    }),
  });
  res.setHeader("Content-Type", "audio/mpeg");
  upstream.body.pipe(res);
});
export default router;
```

---

## 6. Hermes integration

Swap Hermes' `text_to_speech` backend to hit the local Kokoro:

```yaml
text_to_speech:
  provider: openai-compatible
  base_url: http://54.38.215.166:8880/v1
  api_key: not-needed
  model: kokoro
  voice: af_heart
  response_format: mp3
```

Offline-capable (on the server), zero per-character cost, same API shape as OpenAI.

---

## 7. Tips & pitfalls

- **RTF on 8 vCPU ≈ 1.5–1.7** — synthesis ~1.6× real-time. Streaming hides this: TTFA stays under 1 s if chunks are short (<400 chars).
- **Keep chunks ≤ 400 chars.** Huge inputs serialize on the CPU.
- **Micro-gaps between chunks?** Raise `max_chars`, or post-process-concat with `sox`/`ffmpeg`.
- **Markdown cleanup matters** — code blocks and tables sound terrible spoken. Strip them if your source has lots of code.
- **Voice blending:** `"af_heart(2)+am_michael(1)"` → 2:1 weighted blend.
- **Health:** `curl http://54.38.215.166:8880/health` → `{"status":"healthy"}`.
- **Public endpoint ≠ secure.** Don't ship this URL in a client-side app. Use a server-side proxy (section 5) and rate-limit there.

---

## 8. Server ops (if you SSH into the host)

```bash
docker ps --filter name=kokoro-tts
docker logs -f kokoro-tts
docker restart kokoro-tts
docker stats kokoro-tts     # live CPU/RAM usage
```

Container is set to `restart=always`, so it survives Docker/daemon restarts.
