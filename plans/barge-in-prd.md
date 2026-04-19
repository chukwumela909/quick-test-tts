# PRD: Streaming Barge-In with Context Preservation

## Problem Statement

When the user interrupts the agent mid-speech (taps the orb during `speaking`, or speaks loudly enough to trigger the auto-VAD barge-in), the agent stops talking — but it forgets *what it had just said* and *where it was cut off*. From the user's perspective:

1. The transcript saved to chat history shows the **full** agent message (including the unspoken portion), so the user can't tell what they actually heard.
2. On the next turn, the agent has no idea it was interrupted, so it can't acknowledge the interruption ("Sorry — go ahead") or reference the half-finished thought.
3. There's no visual signal in chat that the previous agent message was cut short.

This makes barge-in feel like it works mechanically (TTS stops fast) but breaks the conversational illusion the moment the next turn starts. The agent "talks over itself" by repeating things it already said, or answers a follow-up as if its previous message landed in full.

## Solution

Track which portion of each agent message was **actually spoken aloud** before barge-in, persist that boundary alongside the message, and feed it back into the LLM on the next turn so the agent knows it was interrupted and at what point.

User-visible changes:

1. When the user barges in, the saved agent message in chat shows the spoken portion as normal text and the unspoken portion as visually muted (#666666) with a small "—" prefix marking the cut point.
2. On the next agent turn, the system prompt receives a brief note: *"Your previous message was interrupted after: <last spoken sentence>. Acknowledge briefly if appropriate."*
3. Manual barge-in (tap during speaking) and auto barge-in (VAD-triggered) behave identically from the user's point of view — both preserve context.
4. If the user barges in within ~500 ms of the agent starting (effectively before any meaningful speech), no interruption marker is added — treat as a normal turn replacement.

## User Stories

1. As a user, when I tap the orb while the agent is speaking, I want the agent to stop within ~150 ms, so the interruption feels instantaneous.
2. As a user, when I start speaking loudly while the agent is mid-reply, I want it to stop on its own, so I don't have to tap.
3. As a user, after I interrupt the agent, I want my next message to go through immediately without any "thinking…" delay caused by leftover state.
4. As a user, when I scroll back through chat history, I want to clearly see which agent messages I cut off and roughly where.
5. As a user, when I interrupt the agent and then ask a follow-up, I want the agent to know it was cut off, so it doesn't repeat what I already heard or pretend the full message landed.
6. As a user, when the agent acknowledges my interruption, I want it to be brief and natural ("Got it — go ahead", not a paragraph), so the conversation flow is preserved.
7. As a user, if I barge in within the first half-second of the agent speaking, I don't want a half-sentence fragment cluttering chat history — treat it as if the agent never started.
8. As a developer, I want the spoken-portion boundary to be tracked at the chunk level (the unit the TTS queue plays), so the saved boundary matches exactly what the user heard.
9. As a user, I want chat-mode messages (typed) to behave unchanged — no interruption tracking applies to text turns.
10. As a user, I want my interruption to abort any in-flight LLM streaming for that turn (which already happens) AND mark the message as interrupted in storage, so refreshing the page preserves what I saw.
11. As a developer, I want the interruption signal to flow through the existing onCancel callback path without adding a parallel event channel, so the state machine stays simple.
12. As a user, I want the visual "interrupted" affordance in chat to use the existing monochrome design system (no new colors), so it matches the Bugatti aesthetic.

## Implementation Decisions

### Modules modified

- **TTS module (`tts.ts`)**: Add a per-`enqueue` completion signal that resolves with the playback outcome (`{ played: boolean }`). Add a query function `getSpokenChunks()` that returns the ordered list of chunk texts that finished playback since the last `stop()`. Cleared by `stop()` and on any new `speak()`/`enqueue()` after a stop.

- **VoiceSession (`voice-session.ts`)**:
  - On `bargeIn()` and on `cancel()` while `state === "speaking"`, capture the current spoken-chunks list from the TTS module before clearing it.
  - Add a new event `{ type: "interrupted", spokenText: string, fullText: string | null }` emitted only when barge-in occurs during speaking. `fullText` may be null if streaming was still in flight; the page layer fills it in.
  - Add a config callback `onInterrupted?(spokenText: string)` so `page.tsx` can mutate the in-flight agent message before persisting.

- **Chat engine (`chat-engine.ts`)**:
  - Extend `Message` with optional `spokenContent?: string` (the portion actually heard) and `interrupted?: boolean`.
  - Persist both in Supabase (new columns).
  - When building history for the next LLM call, if the most-recent agent message has `interrupted === true`, replace its `content` with `spokenContent` and prepend a brief system note via the chat route's existing system-prompt builder.

- **Chat API route (`/api/chat`)**: Accept an optional `interruptionNote` in the request body; when present, append it to the resolved system prompt (after the voice-style suffix). The page layer sends this note when the most recent agent turn was interrupted.

- **page.tsx**: Wire `onInterrupted` to update the streaming/last agent message: replace `content` with `spokenContent` for the LLM-facing field, keep `content = fullText` for display, set `interrupted = true`. Also send `interruptionNote` on the next `/api/chat` call when applicable.

- **ChatMode (`ChatMode.tsx`)**: Render `interrupted` agent messages as two spans — the spoken portion in normal text, the unspoken portion in `#666666` with a leading "— " separator.

### Schema change (Supabase)

Add to `messages` table:

- `spoken_content text null` — the portion the user actually heard (only for interrupted agent messages).
- `interrupted boolean not null default false`.

Migration provided as a new SQL file in repo root.

### Interruption note format

Sent to the LLM as a suffix to the existing system prompt only when the immediately previous agent turn was interrupted:

```
The user interrupted your previous message after you said: "<last spoken sentence>". Acknowledge briefly if it makes sense, then respond to what they said.
```

Trim spokenText to the last full sentence (split on `.!?`) to keep the prompt clean.

### Edge cases & decisions

- **Sub-500ms barge-in**: If `now - speakingStartedAt < 500`, emit `onCancel` only (no interruption marker, no message persisted). Existing `cancel()` already handles abort-during-speaking; we just suppress the interruption event.
- **Auto vs manual barge-in**: identical handling. Both go through `bargeIn()`.
- **Interruption during streaming (LLM not done)**: `spokenContent` reflects what TTS played; `content` (display) reflects whatever streamed before abort. The next-turn note still uses the spoken portion only.
- **Identical consecutive replies**: existing `lastSpokenText` dedup is cleared on barge-in (already implemented).
- **Page refresh after interruption**: `interrupted` and `spoken_content` are persisted, so chat-mode rendering and next-turn behavior survive reload.

## Testing Decisions

Tests verify external behavior, not internals. Existing pattern in repo: no formal test files yet — manual via `npx tsc --noEmit` + `npx next build` + browser flow. We add **Vitest unit tests** for two deep modules.

### What gets tested

1. **TTS queue spoken-tracking** (`tts.ts`)
   - `enqueue` then natural completion: `getSpokenChunks()` returns all chunks in order.
   - `enqueue` × 3, `stop()` partway through second clip: `getSpokenChunks()` returns only the chunks that fully played (chunk 1 only, since chunk 2 was mid-flight).
   - New `enqueue()` after `stop()` clears prior history.

2. **VoiceSession interruption event** (`voice-session.ts`)
   - With mocked deps: drive `state → speaking`, simulate user tap, assert `interrupted` event fires with the expected spoken text from mock TTS.
   - Sub-500ms barge-in: assert `onCancel` fires but `interrupted` does NOT.
   - Auto VAD barge-in path: assert same event with same payload.

3. **Chat history augmentation** (logic-only, in `chat-engine.ts` or `page.tsx` helper)
   - Pure function `buildLlmHistory(messages)` that, given an interrupted last agent message, returns history with that message's `content` replaced by `spokenContent`. Test multiple shapes (interrupted middle message vs last message).

### Prior art

No tests exist in the repo today, so this PR establishes the pattern: Vitest, jsdom for any DOM-touching tests, mocks for browser APIs (MediaRecorder, AudioContext, fetch). Test file colocated as `*.test.ts` next to source.

## Out of Scope

- Replacing the current barge-in detector (already works well).
- Cross-device sync of interruption state (Supabase persists; no special replication logic).
- Visualizing the interruption in Voice Mode (only Chat Mode shows the truncation marker).
- Configurable barge-in sensitivity in Settings UI.
- Automatic resumption ("Want me to finish that thought?") — punt to a future "conversation modes" PRD.
- Onboarding/tutorial that explains barge-in.

## Further Notes

- The TTS module already emits per-clip `done` promises; the spoken-chunks tracker is a small additive layer.
- The interruption note injection is the lightest-weight way to give the LLM context without changing the message format — no system role per turn, no schema gymnastics.
- The `onInterrupted` callback lives next to existing `onTranscript` / `onCancel`, keeping `VoiceSession`'s public surface small and consistent.
- Once this lands, "Conversation Modes" (from the brainstorm) becomes much more interesting because each mode can specify its own interruption-acknowledgement style.
