# Plan: AI Agent Communication Interface

> Source PRD: PRD.md

## Architectural decisions

Durable decisions that apply across all phases:

- **Routes**: `/` (main app shell — Voice Mode + Chat Mode as client-side state), `/settings` (agent persona configuration)
- **Mode management**: Voice Mode and Chat Mode are client-side state within `/`, never separate routes. Mode is tracked via React state in the NavigationShell.
- **Data models**:
  - `Message { id, role: 'user' | 'agent', content: string, type: 'text' | 'media', source: 'voice' | 'text', timestamp: Date }`
  - `Conversation { id, messages: Message[], createdAt: Date, updatedAt: Date }`
  - `AgentPersona { name: string, avatarUrl: string | null, systemPrompt: string }`
- **State management**: React state (useState/useReducer), no external libraries. localStorage for persistence.
- **Styling**: Tailwind CSS v4 with Bugatti design system tokens. Geist Mono maps to Bugatti Monospace. Geist Sans maps to Bugatti Text Regular. Colors: only `#000000`, `#ffffff`, `#999999`.
- **Animations**: CSS animations/transitions only. No heavy JS animation libraries. Custom easing: `cubic-bezier(0.25, 0.46, 0.45, 0.94)` for orb states, `cubic-bezier(0.34, 1.56, 0.64, 1)` for mode switches.
- **Component boundary**: All interactive components are Client Components (`'use client'`). The root layout is a Server Component.
- **Spacing scale**: Only 4, 6, 12, 36, 48, 64px values.
- **Border radius scale**: Only 0, 6px, 9999px.

---

## Phase 1: Design System Foundation + Voice Mode Idle

**User stories**: #1, #2, #3, #4, #36, #37

### What to build

Wire up the Bugatti design system tokens into the Tailwind/CSS layer (black canvas, white text, monospace fonts, spacing scale). Replace the boilerplate homepage with Voice Mode's idle state: a full-viewport black canvas with a centered 180/240px pulsing orb and "TAP TO SPEAK" label below it. The orb is a hollow white ring that pulses opacity 1.0→0.6 on an 8-second CSS animation cycle. No interactivity yet — just the static visual with the idle animation.

### Acceptance criteria

- [ ] `globals.css` updated: background `#000000`, foreground `#ffffff`, Bugatti spacing/color tokens in Tailwind `@theme`
- [ ] Root layout metadata updated (title, description)
- [ ] Homepage renders full-viewport black canvas
- [ ] Voice orb renders centered at 50% width, 45% height — 180px on mobile, 240px on desktop
- [ ] Orb is a hollow white ring (`1px solid #ffffff`, `#000000` fill)
- [ ] Idle pulse animation runs (opacity 1.0→0.6→1.0, 8s, ease-in-out)
- [ ] "TAP TO SPEAK" label appears below orb: 12px Geist Mono, uppercase, `#999999`, 1.2px letter-spacing
- [ ] No other visible chrome on screen
- [ ] `npm run build` succeeds with no errors

---

## Phase 2: Voice Orb State Machine

**User stories**: #5, #6, #7, #8, #9, #10, #11

### What to build

Make the orb interactive with a full state machine: idle→listening→thinking→speaking→idle. Tap the orb to transition from idle to listening (concentric arcs radiating outward). After a mock 3-second "recording" period, auto-transition to thinking (orbiting dots). After a mock 2-second "processing" period, transition to speaking (emanating circles + full-screen waveform lines). After the mock response duration completes, return to idle. Double-tap cancels and returns to idle. Each state has its own CSS animation and label text update. All transitions are 300ms.

### Acceptance criteria

- [ ] Tap orb in idle → listening state: concentric waveform arcs animate outward, label changes to "LISTENING..."
- [ ] After mock 3s, auto-transition to thinking: orbiting dots (4 dots, 3s rotation), label "THINKING..."
- [ ] After mock 2s, auto-transition to speaking: emanating circles from center + background waveform lines, label "SPEAKING..."
- [ ] After mock response duration (~4s), auto-return to idle
- [ ] Double-tap during any active state → immediate return to idle
- [ ] All state transitions animate over 300ms with correct easing
- [ ] Orb scales 1.0→1.08→1.0 (spring) on initial tap
- [ ] Full-screen waveform lines (20-30 horizontal lines, white alpha 0.3) visible during speaking state

---

## Phase 3: Chat Mode + Mode Switching

**User stories**: #12, #13, #14, #17, #18, #20, #22, #34, #38

### What to build

Add Chat Mode as a second full-screen experience. Swipe left from Voice Mode triggers a 500ms cinematic transition (fade out Voice, slide in Chat from right). Chat Mode has: top bar (agent name + "ONLINE" status), message thread area with pre-loaded mock messages (user right-aligned with `#999999` border, agent left-aligned no background), timestamps below each message, input bar at bottom (48px compact orb left, text input center, hidden send button right). The compact orb and swipe right return to Voice Mode. Messages are static/hardcoded for now — no sending capability yet.

### Acceptance criteria

- [ ] Swipe left on Voice Mode triggers Chat Mode transition
- [ ] Transition: 500ms, Voice fades out + Chat slides in from right, black canvas constant
- [ ] Chat Mode top bar: agent name (14px mono uppercase white), "ONLINE" below (12px mono `#999999`)
- [ ] Message thread renders mock messages: user right-aligned (1px `#999999` border, 6px radius), agent left-aligned (no border)
- [ ] Timestamps below each message (12px mono `#999999`)
- [ ] Input bar (56px): compact 48px orb left (idle pulse), text input center (placeholder "TYPE MESSAGE..."), send invisible
- [ ] Tap compact orb → transition back to Voice Mode (reverse animation)
- [ ] Swipe right → transition back to Voice Mode
- [ ] Auto-scroll to bottom of message thread
- [ ] Responsive: layout works on mobile and desktop

---

## Phase 4: ChatEngine + Streaming

**User stories**: #15, #16, #21

### What to build

Build the ChatEngine module as a React hook/context that manages conversation state and mock streaming. When the user types a message and taps send (or Enter), the message appears as a user bubble, then the agent response streams in word-by-word (~50ms per word) with a blinking cursor. Voice-originated messages show a "MIC" label. Add image/media card support with placeholder images in mock data. Wire the voice flow (Phase 2) into ChatEngine so voice interactions create transcript entries.

### Acceptance criteria

- [ ] `useChatEngine` hook exposes: messages, sendMessage, isStreaming
- [ ] Send button appears when text is entered (150ms fade-in), disappears on empty
- [ ] User types + sends → user bubble appears instantly (right-aligned)
- [ ] Agent response streams word-by-word (~50ms/word) with cursor blink
- [ ] Streaming complete → cursor disappears, timestamp shows
- [ ] Mock responses selected from pre-written pool of 5-10 responses
- [ ] Voice-originated messages display "MIC" label (10px, `#999999`) top-left of bubble
- [ ] Image/media card messages render with placeholder image and caption
- [ ] Voice flow completion in Voice Mode creates transcript entries visible in Chat Mode
- [ ] Auto-scroll follows streaming unless user has scrolled up

---

## Phase 5: Conversation History Drawer

**User stories**: #23, #24, #25, #26, #27

### What to build

Add the conversation history drawer as a bottom sheet triggered by swipe-up from either mode. The drawer shows past conversations grouped by date (Today, Yesterday, Earlier), each with first-message excerpt and relative timestamp. Tapping a conversation loads it and switches to Chat Mode if needed. "NEW CONVERSATION" button at bottom clears the current thread. All conversations are persisted to localStorage. Seed 2-3 mock conversations on first visit.

### Acceptance criteria

- [ ] Swipe up from Voice Mode or Chat Mode opens history drawer
- [ ] Drawer: bottom sheet, 60% height mobile / 70% desktop, `#000000` background, scrim behind
- [ ] "CONVERSATIONS" title (14px mono uppercase), X close button top-right
- [ ] Conversations grouped under [TODAY], [YESTERDAY], [EARLIER] section headers
- [ ] Each card: first message excerpt (40 chars, truncated), relative timestamp, chevron
- [ ] Tap conversation → drawer closes, that conversation loads in Chat Mode
- [ ] If in Voice Mode, auto-switches to Chat Mode on conversation select
- [ ] "NEW CONVERSATION" pill button at bottom, clears current thread
- [ ] Swipe down or tap X closes drawer without action
- [ ] Conversations persist to localStorage, survive page reload
- [ ] 2-3 mock conversations seeded on first visit

---

## Phase 6: Settings Page + Persona Persistence

**User stories**: #28, #29, #30, #31, #32, #33

### What to build

Create the `/settings` route with agent persona configuration: name field, avatar circle + change button, system prompt textarea. All fields follow Bugatti design (black background, `#999999` border inputs, `#ffffff` on focus). SAVE and DONE pill buttons at bottom. Settings persist to localStorage. The agent name from settings appears in Chat Mode's top bar. Navigate to settings via swipe-down from either mode. DONE returns to the previous mode with a 400ms fade.

### Acceptance criteria

- [ ] Swipe down from Voice or Chat Mode navigates to `/settings`
- [ ] Settings page: "SETTINGS" title, X close button, [AGENT] section header
- [ ] Agent name text input (40px, `#999999` border, focus → `#ffffff` border)
- [ ] Agent avatar: 64px circle with 1px white border, CHANGE AVATAR pill button
- [ ] System prompt textarea (min 80px, max 200px, auto-expanding)
- [ ] SAVE button: disabled state (`#444444`/`#333333`) when no changes, enabled (`#ffffff`) on change
- [ ] DONE button: saves + returns to previous screen (400ms fade)
- [ ] All settings persisted to localStorage
- [ ] Agent name from settings displayed in Chat Mode top bar
- [ ] Settings survive page reload

---

## Phase 7: Responsive Polish + Gesture Refinement

**User stories**: #35, #24 (mobile)

### What to build

Final polish pass: ensure responsive orb sizing works across all breakpoints (180px→200px→240px). Resolve swipe gesture conflicts (up/down vs scroll in Chat Mode). Add desktop mouse-drag support for mode switching. Ensure all animations hit 60fps. Test and fix layout on narrow viewports (320px). Confirm spacing uses only the Bugatti scale (4/6/12/36/48/64px). Audit all typography for mono-caps discipline and correct letter-spacing.

### Acceptance criteria

- [ ] Orb: 180px on <640px, 200px on 768-1023px, 240px on ≥1024px
- [ ] Swipe-up for history does not conflict with Chat Mode thread scroll
- [ ] Desktop: mouse drag left/right triggers mode switch
- [ ] All animations render at 60fps on mid-range mobile device
- [ ] Layout does not break at 320px viewport width
- [ ] All spacing values audit-clean against Bugatti scale
- [ ] All UI labels are uppercase Geist Mono with 1.2-1.4px letter-spacing
- [ ] All border-radius values are 0, 6px, or 9999px only
- [ ] No accent colors present anywhere — only `#000000`, `#ffffff`, `#999999`
