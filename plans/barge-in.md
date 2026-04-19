# Plan: Streaming Barge-In with Context Preservation

> Source PRD: [barge-in-prd.md](./barge-in-prd.md)

## Architectural decisions

- **Schema (Supabase `messages`)**: add `spoken_content text null`, `interrupted boolean not null default false`. Migration delivered as a new SQL file.
- **Message model**: extend `Message` with optional `spokenContent?: string` and `interrupted?: boolean`. Both round-trip through `rowToMessage`/`addMessage`.
- **TTS contract**: `enqueue(text)` and `speak(text)` continue to return `Promise<void>`. New module-level `getSpokenChunks(): string[]` returns chunks that completed playback since the last `stop()`/`speak()` boundary. `stop()` and `speak()` reset the tracker.
- **VoiceSession contract**: new optional `onInterrupted(spokenText: string)` config callback. Fires only when barge-in occurs after ≥500 ms of speaking. `onCancel` continues to fire on every cancel/barge-in (unchanged).
- **Interruption note**: passed to `/api/chat` as optional `interruptionNote: string` field; appended to the resolved system prompt server-side. Built client-side from the most-recent agent message when its `interrupted === true`.
- **Display**: spoken text in normal `#ffffff`, unspoken tail in `#666666` prefixed with " — ". No new colors.

---

## Phase 1: TTS spoken-chunk tracking

**User stories**: 8

### What to build

Extend `tts.ts` so the queue records every chunk text that **finishes** playback since the most recent `stop()` or `speak()` reset. Expose `getSpokenChunks()` returning that list. No behavior change to existing callers.

### Acceptance criteria

- [ ] `enqueue("a")`, await it: `getSpokenChunks() === ["a"]`.
- [ ] `enqueue("a"); enqueue("b"); enqueue("c"); stop()` partway through "b": `getSpokenChunks() === ["a"]` (only fully-played).
- [ ] `speak("x")` after a previous turn clears the tracker before queueing.
- [ ] Aborted (never started) chunks do not appear in the tracker.
- [ ] Vitest unit tests cover the three scenarios above with a mocked `Audio` element.

---

## Phase 2: VoiceSession interruption event

**User stories**: 1, 2, 7, 11

### What to build

In `voice-session.ts`:

1. Track `speakingStartedAt` (timestamp set when `setState("speaking")` runs).
2. In `bargeIn()` and in `cancel()` when previous state was `speaking`: read `getSpokenChunks()`, join into one string, and — if elapsed since `speakingStartedAt >= 500` ms — call the new `config.onInterrupted` callback before clearing TTS state.
3. Sub-500 ms barge-in continues to fire `onCancel` only (no `onInterrupted`).
4. Auto VAD barge-in path uses the same `bargeIn()` method so behavior matches.

### Acceptance criteria

- [ ] `onInterrupted` fires with the joined spoken-chunks string when the user taps after ≥500 ms of `speaking`.
- [ ] `onInterrupted` does NOT fire when barge-in occurs within 500 ms of speaking start.
- [ ] `onCancel` continues to fire on every barge-in.
- [ ] Vitest unit tests with mocked TTS + fake clock cover both timing branches and both manual/auto trigger paths.
- [ ] `npx tsc --noEmit` clean.

---

## Phase 3: Persist interruption metadata

**User stories**: 4, 10

### What to build

1. New SQL migration file in repo root: adds `spoken_content` and `interrupted` columns to `messages`.
2. Extend `Message`, `MessageRow`, `rowToMessage`, and `addMessage` to round-trip the new fields.
3. In `page.tsx`: wire `onInterrupted` to mutate the in-flight agent message — set `interrupted = true`, set `spokenContent` to the spoken portion, keep `content` as the full streamed text. Persist via the same `addMessage` flow.
4. Re-render Chat Mode: messages with `interrupted` show spoken text normally, unspoken tail (i.e. `content.slice(spokenContent.length)`) in `#666666` prefixed by " — ".

### Acceptance criteria

- [ ] After interrupting an agent reply, the saved row has `interrupted = true` and `spoken_content` populated.
- [ ] Reloading the page shows the interrupted message with the muted tail intact.
- [ ] Non-interrupted agent messages render exactly as before (no visual regression).
- [ ] `interrupted` flag is never set on user messages or text-mode agent messages.
- [ ] Migration file is documented in README or a comment header.

---

## Phase 4: Inject interruption note into next LLM turn

**User stories**: 5, 6

### What to build

1. In `page.tsx`, before calling `/api/chat`, inspect the most recent agent message in the active conversation. If `interrupted === true`, build an `interruptionNote` from its `spokenContent` (last full sentence) and include it in the request body.
2. In `/api/chat/route.ts`, accept optional `interruptionNote: string` (validated, max 500 chars). When present, append it to the resolved system prompt after the voice-style suffix.
3. The history built for the LLM replaces the interrupted agent message's `content` with its `spokenContent` so the model only sees what was actually heard.

### Acceptance criteria

- [ ] After interrupting and sending a follow-up, the request body contains `interruptionNote`.
- [ ] The interrupted agent message in the LLM history shows only `spokenContent`.
- [ ] Manual smoke test: agent acknowledges the interruption ("Got it — go ahead" / "Sure, what's up?") on the next turn instead of restating the cut-off content.
- [ ] When the previous turn was NOT interrupted, no `interruptionNote` is sent and behavior is unchanged.
- [ ] Pure helper `buildLlmHistory(messages)` has a Vitest unit test covering interrupted/non-interrupted cases.

---

## Phase 5: Polish & verification

**User stories**: 3, 9, 12

### What to build

- Confirm text-mode (Chat input) turns set neither flag.
- Confirm rapid tap-to-interrupt followed by immediate typing into chat input doesn't dead-lock state.
- Run `npx tsc --noEmit` and `npx next build`; fix any regressions.
- Update README with one-paragraph note about the barge-in feature and how to apply the new migration.

### Acceptance criteria

- [ ] Typecheck passes.
- [ ] `next build` succeeds.
- [ ] No console errors on a 5-turn voice conversation with one interruption.
- [ ] README mentions the new SQL migration.
