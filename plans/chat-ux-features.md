# Chat UX Features PRD

## Problem Statement

The chat mode works for one-shot single-line questions, but several friction points hurt longer or more iterative conversations:

1. The composer is a single-line `<input>`. Users cannot draft multi-line questions, paste code or logs, or use line breaks naturally. Long pastes overflow horizontally and become unreadable.
2. When the agent gives an answer the user does not like, the only recourse is to manually re-type the question. There is no "try again" affordance.
3. While the agent is streaming a long reply, scrolling up to re-read earlier context locks the user out of the live tokens at the bottom — they must remember to scroll back manually and have no signal that new content is arriving.
4. A first-time user lands on an empty thread with only the placeholder text "START A CONVERSATION" and no concrete suggestion of what to ask.

## Solution

Four focused additions to the existing `ChatMode` surface:

1. **Multi-line auto-growing composer** — replace the input with a textarea that grows up to a small cap (≈6 lines), then scrolls internally. `Enter` sends, `Shift+Enter` inserts a newline. IME composition is respected.
2. **Regenerate** — the most recent agent message gains a `REGEN` action next to `COPY`. Activating it deletes that message (locally and from Supabase) and re-runs the LLM with the same prior history.
3. **Jump-to-latest button** — when the user has scrolled away from the bottom while there is unread streaming or new content, a small floating chip appears in the bottom-right of the thread. Tapping it smooth-scrolls back to the latest token and re-arms auto-follow.
4. **Starter prompts** — the empty-state shows the existing label plus 4 short, tap-to-send suggestion chips ("Explain a concept", "Draft an email", "Compare two options as a table", "Help me debug code").

## User Stories

1. As a chat user, I want to press Shift+Enter to add a newline so I can format a multi-paragraph question.
2. As a chat user, I want Enter alone to send my message so the keyboard flow stays fast.
3. As a chat user, I want the composer to grow as I type so I can see all of what I am drafting without horizontal overflow.
4. As a chat user, I want the composer to stop growing past a sensible cap so the message thread does not get squeezed off-screen.
5. As a chat user typing in Japanese (or any IME), I want pressing Enter while composing a character to commit the IME selection rather than sending the message prematurely.
6. As a chat user, I want a one-tap "regenerate" on the agent's last reply so I can sample a different answer without re-typing.
7. As a chat user, I want regenerate to be hidden while the model is still streaming so I cannot accidentally double-fire requests.
8. As a chat user, I want regenerate to disappear once I send a follow-up message, because it would no longer regenerate the latest turn.
9. As a chat user, when I scroll up to re-read older messages while the agent is still typing, I want a clear "↓ LATEST" indicator that lets me jump back to the live edge in one tap.
10. As a chat user, I want the indicator to only appear when there is actually content below — not when I am already at the bottom.
11. As a chat user, I want the indicator to disappear automatically once I am back at the bottom or once auto-scroll resumes.
12. As a first-time chat user, I want a few example prompts I can tap to send so I can see the agent in action without thinking up a question.
13. As a first-time chat user, I want those starter prompts to disappear as soon as a real conversation begins so they do not clutter the thread.
14. As a chat user, I want regenerate to fail gracefully (no orphaned bubble, no infinite spinner) if the network drops mid-request.
15. As a chat user, I want my draft text preserved in the composer if I tap regenerate — regenerate operates on the agent reply, not on what I am about to type.

## Implementation Decisions

### Modules

- **`ChatMode` component** — owns composer, thread rendering, jump-to-latest button, starter prompts, and surfacing of `onRegenerate` on the last agent message. Receives `onRegenerate(messageId)` from the parent; emits `onSendMessage(text)` for both typed and starter-chip sends.
- **`chat-engine` library** — gains a `deleteMessage(conversationId, messageId)` helper that performs a single-row delete from the `messages` Supabase table and bumps the parent conversation's `updated_at`. Mirrors the existing `addMessage` retry-and-warn pattern: failures log a warning but never throw to the UI.
- **`page.tsx` (Home)** — adds a `handleRegenerate(messageId)` callback wired to `ChatMode`. The handler:
  1. Refuses to act if the engine is currently streaming (`streamingRef.current`).
  2. Reads the current conversation from `conversationsRef` (avoiding stale closures).
  3. Validates that `messageId` is the **last** message and has `role === "agent"`. Otherwise no-ops.
  4. Removes that message from in-memory state and fires the Supabase delete (fire-and-forget, identical pattern to `addMessage`).
  5. Calls the existing `streamAgentResponse(cid, prefix, /*shouldSpeak*/ false)` with the messages array up to but not including the removed agent reply.

### Composer behavior

- The composer becomes a `<textarea>` with `rows={1}` and a max-height of approximately 6 line-heights (`6em` line-height-relative), beyond which it scrolls internally.
- Auto-grow: on every change, the element's `style.height` is reset to `auto` then set to `min(scrollHeight, maxPx)` inside a `useLayoutEffect` keyed on the input value.
- `onKeyDown`: send when `e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing`. Shift+Enter falls through to default newline insertion.

### Jump-to-latest

- The existing `userScrolledRef` boolean is mirrored into a `userScrolled` React state so changes drive a re-render. The chip renders only when `userScrolled === true` AND the thread has rendered content (messages or active streaming).
- The chip is absolutely positioned inside the thread container so it sits inside the message area, not over the composer or top bar.
- Tapping the chip scrolls the thread to its bottom and clears `userScrolled` (both ref and state).

### Regenerate UX

- The `REGEN` button only renders on the very last message in the array, only when that message has `role === "agent"`, and only when `streamingContent === null`. While streaming, the existing in-flight `STOP` chip remains the only relevant control.
- The button shares the existing `msg-action-btn` style class, so hover-reveal behavior is consistent with `COPY`.

### Starter prompts

- A small static array of 4 prompts lives in `ChatMode`. They render as chips in the empty-state container, below the existing "START A CONVERSATION" label.
- Tapping a chip calls `onSendMessage(promptText)` directly — the same path as the textarea, so the parent's `handleUserMessage` runs unchanged.

### Out-of-scope hardening (intentional)

- We do **not** delete subsequent messages when regenerating, because regenerate is gated to only run on the last message in the conversation; there are no subsequent messages by construction. This avoids cascade-delete complexity in the data layer.
- We do **not** branch the conversation tree. Regenerate is destructive: the previous reply is gone.

### API & schema

- No API contract changes. Regenerate reuses the existing `/api/chat` endpoint with `mode: "text"`.
- No schema changes. The existing `messages` table supports row deletion by primary key.

## Testing Decisions

This codebase has no automated test suite today, so testing is manual smoke verification along these flows:

- **Composer**: type single line + Enter → sends. Shift+Enter → newline, Enter → sends. Paste a 30-line block → grows to cap then scrolls internally. IME compose (e.g. Mac Japanese input) → Enter during composition does not send.
- **Regenerate**: send a message, wait for reply, click `REGEN` → previous reply is removed from the thread, a new reply streams in its place. Click `REGEN` while a reply is mid-stream → button is not visible. Send a follow-up after regenerating → previous-turn `REGEN` button is no longer visible.
- **Jump-to-latest**: send a message that produces a long reply. While streaming, scroll up. Verify the chip appears. Click → scroll snaps to bottom, chip disappears, auto-follow resumes for subsequent tokens.
- **Starter prompts**: open a fresh conversation. Verify chips render. Tap one → it sends as a normal user message and chips disappear. Send a manual message first → chips never appear because the conversation is no longer empty.

A good test for these features asserts external behavior only — chip visibility, message presence/absence, scroll position — not internal state names or call counts.

## Out of Scope

- Editing a previously-sent user message (would require fork/branch semantics).
- Slash-command palette and quick actions overlay.
- Token / character count meter under the composer.
- Voice-mode regenerate. Regenerate is text-mode only because voice barge-in already serves the equivalent need.
- Persisting the composer draft across page reloads.
- Virtualization for very long threads.

## Further Notes

- Keep the visual language consistent with the existing dark-glass aesthetic: hairline borders at `rgba(255,255,255,0.12-0.18)`, mono-uppercase labels at 10–12px with letter-spacing, no emoji.
- Respect `prefers-reduced-motion` for any new animations (the jump-to-latest chip should still appear, just without sliding).
