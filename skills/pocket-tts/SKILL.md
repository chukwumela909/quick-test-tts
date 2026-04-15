---
name: pocket-tts
description: Integrate a full conversational AI interface into a Next.js web app. Covers multi-turn chat state, streaming responses, voice input/output, session management, and UI patterns. Pairs with Ollama (local LLM) + pocket-tts for a fully local voice assistant.
version: 1.0.0
tags: [conversation, chat, next.js, streaming, voice, tts, multi-turn, session, react, ui]
related_skills: [ollama-api]
---

# Conversational Web App Integration

Build a full-featured conversational AI into a Next.js web app — text chat, streaming, voice input, TTS output, and session history.

**User context:** VMI server at 185.209.230.171, Ollama at :11434, pocket-tts at :8000. Architecture: Next.js (frontend + API routes) → Ollama → pocket-tts.

---

## ARCHITECTURE OVERVIEW

```
User input (text or mic)
  ↓
React component (message history state)
  ↓
POST /api/chat  (Next.js route)
  ↓
Ollama /api/chat  (LLM)
  ↓
Response text → optionally POST to pocket-tts
  ↓
Render text + play audio
```

---

## 1. CONVERSATION STATE (React)

```typescript
// lib/types.ts
export type Role = 'user' | 'assistant' | 'system'

export interface Message {
  id: string
  role: Role
  content: string
  timestamp: number
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
}
```

```typescript
// hooks/useConversation.ts
'use client'
import { useState, useCallback, useRef } from 'react'
import { Message, Role } from '@/lib/types'

export function useConversation(systemPrompt?: string) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const buildHistory = (msgs: Message[]) =>
    [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...msgs.map(m => ({ role: m.role, content: m.content })),
    ]

  const sendMessage = useCallback(async (content: string) => {
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }

    setMessages(prev => [...prev, userMsg])
    setIsLoading(true)
    setError(null)

    const assistantId = crypto.randomUUID()
    setMessages(prev => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '', timestamp: Date.now() },
    ])

    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          messages: buildHistory([...messages, userMsg]),
        }),
      })

      if (!res.ok) throw new Error(`API error: ${res.status}`)

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        fullText += chunk
        setMessages(prev =>
          prev.map(m => m.id === assistantId ? { ...m, content: fullText } : m)
        )
      }

      return fullText  // caller can pipe to TTS
    } catch (err: any) {
      if (err.name === 'AbortError') return null
      setError(err.message)
      setMessages(prev => prev.filter(m => m.id !== assistantId))
      return null
    } finally {
      setIsLoading(false)
    }
  }, [messages, systemPrompt])

  const stopGeneration = () => abortRef.current?.abort()

  const clearHistory = () => setMessages([])

  const resetTo = (index: number) =>
    setMessages(prev => prev.slice(0, index + 1))

  return { messages, isLoading, error, sendMessage, stopGeneration, clearHistory, resetTo }
}
```

---

## 2. API ROUTE (Streaming)

```typescript
// app/api/chat/route.ts
import { Ollama } from 'ollama'

const ollama = new Ollama({ host: process.env.OLLAMA_HOST || 'http://185.209.230.171:11434' })

export async function POST(req: Request) {
  try {
    const { messages, model = 'llama3.2', options = {} } = await req.json()

    const stream = await ollama.chat({
      model,
      messages,
      stream: true,
      keep_alive: '15m',
      options: {
        temperature: 0.7,
        num_predict: 512,
        ...options,
      },
    })

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunk.message.content
            if (text) controller.enqueue(encoder.encode(text))
          }
        } catch (e) {
          controller.error(e)
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
  } catch (err: any) {
    if (err.code === 'ECONNREFUSED')
      return Response.json({ error: 'LLM server unreachable' }, { status: 503 })
    if (err.status === 404)
      return Response.json({ error: 'Model not found' }, { status: 404 })
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

---

## 3. VOICE INPUT (Web Speech API)

```typescript
// hooks/useVoiceInput.ts
'use client'
import { useState, useRef, useCallback } from 'react'

export function useVoiceInput(onTranscript: (text: string) => void) {
  const [isListening, setIsListening] = useState(false)
  const [interim, setInterim] = useState('')
  const recognitionRef = useRef<any>(null)

  const startListening = useCallback(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Speech recognition not supported in this browser')
      return
    }

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const recognition = new SR()
    recognitionRef.current = recognition

    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => setIsListening(true)
    recognition.onend = () => { setIsListening(false); setInterim('') }

    recognition.onresult = (event: any) => {
      let final = ''
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) final += result[0].transcript
        else interimText += result[0].transcript
      }
      setInterim(interimText)
      if (final) onTranscript(final.trim())
    }

    recognition.onerror = (e: any) => {
      console.error('Speech error:', e.error)
      setIsListening(false)
    }

    recognition.start()
  }, [onTranscript])

  const stopListening = () => recognitionRef.current?.stop()

  return { isListening, interim, startListening, stopListening }
}
```

---

## 4. TTS OUTPUT (pocket-tts)

```typescript
// lib/tts.ts
let currentAudio: HTMLAudioElement | null = null

export async function speak(text: string, ttsUrl = 'http://185.209.230.171:8000/tts') {
  // Stop any playing audio
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }

  const form = new FormData()
  form.append('text', text)

  const res = await fetch(ttsUrl, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`TTS error: ${res.status}`)

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  currentAudio = audio

  return new Promise<void>((resolve, reject) => {
    audio.onended = () => { URL.revokeObjectURL(url); resolve() }
    audio.onerror = reject
    audio.play().catch(reject)
  })
}

export function stopSpeaking() {
  currentAudio?.pause()
  currentAudio = null
}
```

---

## 5. CHAT UI COMPONENT

```tsx
// components/ChatInterface.tsx
'use client'
import { useState, useRef, useEffect } from 'react'
import { useConversation } from '@/hooks/useConversation'
import { useVoiceInput } from '@/hooks/useVoiceInput'
import { speak, stopSpeaking } from '@/lib/tts'

const SYSTEM_PROMPT = 'You are a helpful, concise assistant.'

export default function ChatInterface() {
  const [input, setInput] = useState('')
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const { messages, isLoading, error, sendMessage, stopGeneration, clearHistory } =
    useConversation(SYSTEM_PROMPT)

  const handleSend = async (text: string) => {
    if (!text.trim()) return
    setInput('')
    const reply = await sendMessage(text)
    if (voiceEnabled && reply) {
      await speak(reply)
    }
  }

  const { isListening, interim, startListening, stopListening } = useVoiceInput(handleSend)

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto p-4">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">AI Assistant</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setVoiceEnabled(v => !v)}
            className={`px-3 py-1 rounded text-sm ${voiceEnabled ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
          >
            {voiceEnabled ? 'Voice On' : 'Voice Off'}
          </button>
          <button onClick={clearHistory} className="px-3 py-1 rounded text-sm bg-gray-200">
            Clear
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-500 text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-900 rounded-bl-sm'
              }`}
            >
              {msg.content || (isLoading ? '...' : '')}
            </div>
          </div>
        ))}
        {error && <p className="text-red-500 text-sm text-center">{error}</p>}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="flex gap-2 items-end">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend(input)
            }
          }}
          placeholder={interim || 'Type a message...'}
          rows={1}
          className="flex-1 resize-none rounded-xl border px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        {/* Mic button */}
        <button
          onMouseDown={startListening}
          onMouseUp={stopListening}
          onTouchStart={startListening}
          onTouchEnd={stopListening}
          className={`p-2 rounded-xl ${isListening ? 'bg-red-500 text-white' : 'bg-gray-200'}`}
        >
          🎤
        </button>
        {/* Send/Stop */}
        <button
          onClick={() => isLoading ? stopGeneration() : handleSend(input)}
          className={`px-4 py-2 rounded-xl text-sm font-medium ${
            isLoading ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'
          }`}
        >
          {isLoading ? 'Stop' : 'Send'}
        </button>
      </div>
    </div>
  )
}
```

---

## 6. SESSION PERSISTENCE (localStorage)

```typescript
// hooks/usePersistedConversation.ts
'use client'
import { useEffect } from 'react'
import { Message } from '@/lib/types'

const STORAGE_KEY = 'chat_history'

export function usePersistedConversation() {
  const loadHistory = (): Message[] => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  }

  const saveHistory = (messages: Message[]) => {
    // Keep last 100 messages max
    const trimmed = messages.slice(-100)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  }

  const clearHistory = () => localStorage.removeItem(STORAGE_KEY)

  return { loadHistory, saveHistory, clearHistory }
}
```

---

## 7. MULTI-SESSION (multiple conversations)

```typescript
// lib/sessions.ts
import { Conversation, Message } from './types'

const SESSIONS_KEY = 'chat_sessions'
const ACTIVE_KEY = 'active_session'

export function getSessions(): Conversation[] {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]')
  } catch { return [] }
}

export function saveSession(conv: Conversation) {
  const sessions = getSessions().filter(s => s.id !== conv.id)
  sessions.unshift(conv)
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, 20))) // keep 20
}

export function newSession(firstMessage?: string): Conversation {
  return {
    id: crypto.randomUUID(),
    title: firstMessage?.slice(0, 40) || 'New Chat',
    messages: [],
    createdAt: Date.now(),
  }
}

export function setActiveSession(id: string) {
  localStorage.setItem(ACTIVE_KEY, id)
}

export function getActiveSessionId(): string | null {
  return localStorage.getItem(ACTIVE_KEY)
}
```

---

## 8. CONTEXT WINDOW MANAGEMENT

```typescript
// lib/trimHistory.ts
// Trim history to stay within token budget (rough: 1 token ≈ 4 chars)
export function trimHistory(
  messages: Array<{ role: string; content: string }>,
  maxTokens = 3000,
  systemPrompt = ''
) {
  const systemTokens = Math.ceil(systemPrompt.length / 4)
  let budget = maxTokens - systemTokens

  // Always keep last N messages, trim oldest first
  const trimmed = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = Math.ceil(messages[i].content.length / 4)
    if (budget - tokens < 0) break
    budget -= tokens
    trimmed.unshift(messages[i])
  }
  return trimmed
}
```

---

## 9. ENV SETUP

```bash
# .env.local
OLLAMA_HOST=http://185.209.230.171:11434
NEXT_PUBLIC_TTS_URL=http://185.209.230.171:8000/tts
NEXT_PUBLIC_DEFAULT_MODEL=llama3.2
```

---

## PITFALLS

- Web Speech API: only works over HTTPS or localhost — won't work on plain HTTP production
- pocket-tts CORS: must allow the Next.js origin in pocket-tts server config, or proxy via Next.js API route
- Streaming + Vercel: streaming works in App Router but times out at 10s on Hobby plan; use self-hosted or Edge runtime
- Context overflow: always trim history before sending — Ollama 4096 default context fills up fast in long chats
- Auto-scroll: use useLayoutEffect instead of useEffect if scroll jank appears
- Mobile mic: use touchstart/touchend, not mousedown — mobile won't trigger mouse events
- TTS: play() requires a user gesture on mobile — don't call it outside of event handlers
- Stop button: send AbortController signal to both fetch AND ollama client to fully cancel streaming
- Session state: crypto.randomUUID() needs HTTPS — falls back to Math.random() on plain HTTP
