# PRD: AI Agent Communication Interface

## Problem Statement

Users want a personal AI agent — a Jarvis-like companion — that integrates into their daily life and is always available for conversation through natural voice and text chat. Today, most AI chat interfaces are utilitarian, desktop-centric, and text-only. There is no immersive, luxury-feeling interface that puts voice-first interaction at the center while still supporting rich text messaging. Users need an elegant, cinematic experience that makes speaking to their AI agent feel as natural as talking to a person, with seamless fallback to text when needed.

## Solution

Build a cinematic two-mode AI agent communication interface following the Bugatti design system (pure black canvas, white typography, monochromatic palette, monospace UI labels). The app has two distinct full-screen experiences — **Voice Mode** and **Chat Mode** — that never coexist on screen. Switching between them is a dramatic cinematic transformation triggered by swipe gestures.

**Voice Mode** (the default home) is an immersive, ambient experience dominated by a large centered orb. No messages are visible. The user taps the orb to speak, and the entire screen becomes a waveform animation. **Chat Mode** is a functional messaging interface with bubbles, streaming text, and a text input field with a small orb as a mic button.

Voice conversations appear as text transcripts in Chat Mode. Navigation is minimal — swipe gestures only, no visible buttons for mode switching. Users can access conversation history via a swipe-up drawer and configure their agent's persona (name, avatar, system prompt) in a dedicated settings page.

This is a **UI-only implementation** — no AI backend integration, no speech-to-text, no text-to-speech. All AI responses are mocked/placeholder. The architecture should be ready for future API integration but the PRD scope is strictly the visual interface and interaction design.

## User Stories

### Voice Mode
1. As a user, I want the app to open in Voice Mode by default, so that I can immediately speak to my agent.
2. As a user, I want to see a large centered voice orb (180px mobile / 240px desktop) on a pure black canvas, so that the interface feels cinematic and focused.
3. As a user, I want the orb to have a subtle idle pulse animation (opacity 1.0→0.6, 8-second cycle), so it feels alive even when not in use.
4. As a user, I want "TAP TO SPEAK" text below the orb in #999999, so I know how to start interacting.
5. As a user, I want to tap the orb to start voice input, transitioning to a listening state with concentric waveform arcs radiating outward.
6. As a user, I want the "TAP TO SPEAK" label to change to "LISTENING..." while I'm speaking, so I know the agent is capturing my voice.
7. As a user, I want the orb to automatically transition to a processing/thinking state (4 orbiting dots) after 2 seconds of silence, with a "THINKING..." label.
8. As a user, I want the orb to transition to a speaking state with concentric pulse circles emanating from center, so I know the agent is responding.
9. As a user, I want a full-screen waveform takeover during the speaking state, creating a cinematic visual-audio experience.
10. As a user, I want to double-tap the orb to skip/cancel the agent's response and return to idle.
11. As a user, I want visual distinction between all four orb states (idle, listening, thinking, speaking) through different animations, so I always know what's happening.

### Chat Mode
12. As a user, I want to swipe left to transition from Voice Mode to Chat Mode, so I can read and type messages.
13. As a user, I want the mode transition to be a dramatic 500ms slide+fade animation with the black canvas constant, so it feels like the app is transforming.
14. As a user, I want to see my messages as right-aligned bubbles in Chat Mode, so I can distinguish my input from the agent's responses.
15. As a user, I want to see the agent's responses as left-aligned bubbles with streamed text (appearing word by word), so the conversation feels real-time.
16. As a user, I want the agent's responses to support image/media cards embedded in the chat, so the agent can share visual content.
17. As a user, I want the message thread to auto-scroll to the latest message unless I've scrolled up to review history.
18. As a user, I want a text input field at the bottom of Chat Mode with a small orb (48px) as a mic button on the left, so I can type or switch back to voice.
19. As a user, I want to tap the small mic orb in the Chat Mode input area to swipe back to Voice Mode.
20. As a user, I want to swipe right to return from Chat Mode to Voice Mode.
21. As a user, I want voice conversations to appear as text transcripts in Chat Mode with a microphone icon marking voice-originated messages.
22. As a user, I want message timestamps visible in #999999 below each message, so I can track when conversations happened.

### Conversation History
23. As a user, I want to swipe up from either mode to open a conversation history drawer (60% viewport height, bottom sheet), so I can access past conversations.
24. As a user, I want the history drawer to list conversations grouped by date (Today, Yesterday, Earlier) with the first message as title and a relative timestamp.
25. As a user, I want to tap a conversation in the history drawer to load it (switching to Chat Mode automatically if in Voice Mode).
26. As a user, I want a "NEW CONVERSATION" button in the history drawer to start fresh.
27. As a user, I want to swipe down or tap X to close the history drawer.

### Settings
28. As a user, I want to access settings via swipe-down gesture or from the history drawer, navigating to a full settings page.
29. As a user, I want to set my agent's name, so the interface uses a personalized agent identity.
30. As a user, I want to set my agent's avatar/photo, so the agent has a visual identity in chat bubbles.
31. As a user, I want to set my agent's personality via a system prompt textarea, so I can customize behavior.
32. As a user, I want my persona settings to persist across sessions (localStorage), so I don't lose configuration.
33. As a user, I want a SAVE pill button and a DONE button to save and return to the previous screen.

### General
34. As a user, I want smooth cinematic transitions (400–500ms, ease-out) between all screens, so the experience feels polished and native.
35. As a user, I want the interface to work equally well on mobile and desktop, with responsive orb sizing and layout.
36. As a user, I want the entire interface to follow the Bugatti design system (pure black background, white text, monospace labels, pill buttons, no accent colors).
37. As a user, I want all UI labels to use uppercase monospace typography with 1.2–1.4px letter-spacing.
38. As a user, I want the app to feel fast — instant transitions, no loading spinners, so the luxury feel isn't broken by jank.

## UI/UX Design

### Design Philosophy

The app is two films, not two tabs. **Voice Mode** is an intimate, ambient experience — the orb dominates, the canvas breathes, the user speaks into a void and the void answers. **Chat Mode** is a sharp, functional experience — messages stack, input is ready, visual feedback serves reading. The 500ms cinematic transition between them signals a full context shift. They never coexist on screen.

### Screen 1: Voice Mode (Default Home)

**Layout:**
- Full viewport, 100% height and width, pure `#000000` background
- Voice orb centered at 50% width, 45% height (slightly above vertical center for thumb reachability)
- Orb diameter: **180px** (mobile <768px) / **240px** (desktop ≥1024px)
- Orb appearance: hollow white ring — `#000000` fill, `1px solid #ffffff` border
- Below orb (12px gap): "TAP TO SPEAK" label — 12px Bugatti Monospace, UPPERCASE, `#999999`, centered
- No other visible chrome — no hamburger, no settings icon, no buttons. Pure void + orb.

**Orb States & Animations:**

| State | Visual | Animation | Label Below Orb |
|-------|--------|-----------|-----------------|
| **Idle** | White hollow ring | Opacity pulse: 1.0 → 0.6 → 1.0, 8s cycle, ease-in-out | TAP TO SPEAK |
| **Listening** | White ring + 3–5 concentric waveform arcs radiating outward | Each arc starts at 60px radius, expands to 120px over 300ms, fades out. New arc spawns every 150ms. | LISTENING... |
| **Thinking** | White ring + 4 small dots (4px each) orbiting the perimeter | 360° rotation per 3s, linear, continuous. Dots connected by thin 1px lines. | THINKING... |
| **Speaking** | White ring + concentric circles emanating from center + full-screen waveform lines | Circles: appear at center, expand to 120px over 400ms, fade out. New circle every 200ms. Background: 20–30 horizontal 1px lines (#ffffff, alpha 0.3) animating upward. | SPEAKING... |

All transitions between states: **300ms**, easing `cubic-bezier(0.25, 0.46, 0.45, 0.94)`.

**Voice Flow (step by step):**

```
IDLE (pulsing orb, "TAP TO SPEAK")
  ↓ [User taps orb]
  ↓ 300ms: orb scales 1.0 → 1.08 → 1.0 (spring), waveform arcs begin
  ↓
LISTENING (arcs radiating, "LISTENING...")
  ↓ [User speaks; 2s silence detected]
  ↓ 300ms: arcs fade out, orbiting dots fade in
  ↓
THINKING (dots orbiting, "THINKING...")
  ↓ [Mock response ready, ~2–4s]
  ↓ 300ms: dots fade out, pulse circles + full-screen waveform fade in
  ↓
SPEAKING (emanating circles + waveform lines, "SPEAKING...")
  ↓ [Response complete]
  ↓ 500ms: waveform fades, circles shrink, idle pulse resumes
  ↓
IDLE (ready for next input)
```

**Interactions in Voice Mode:**
- **Tap orb**: idle → listening. listening → stops recording, triggers thinking.
- **Double-tap orb**: skips/cancels current response, returns to idle.
- **Swipe left**: transitions to Chat Mode (500ms cinematic slide).
- **Swipe up**: opens Conversation History drawer (400ms bottom sheet).
- **Swipe down**: opens Settings page (400ms fade transition).

### Screen 2: Chat Mode

**Transition from Voice Mode:**
- Triggered by swipe-left gesture
- Animation: Voice Mode elements fade out (0–200ms) while Chat Mode slides in from right (200–500ms). Black canvas stays constant — no visual discontinuity.
- Duration: **500ms**, easing: `cubic-bezier(0.34, 1.56, 0.64, 1)` (ease-out with slight overshoot).

**Layout:**

```
┌─────────────────────────────────────────┐
│  AGENT NAME              [status]       │  ← Top bar (48px)
│  online                                 │
├─────────────────────────────────────────┤
│                                         │
│         Agent message bubble (left)     │  ← Message thread
│                      12:34 PM           │     (fills remaining)
│                                         │
│              User message bubble (right)│
│              12:35 PM                   │
│                                         │
│         Agent streaming response...▊    │
│                                         │
├─────────────────────────────────────────┤
│ [◉] │ TYPE MESSAGE...           │ [→]  │  ← Input bar (56px)
└─────────────────────────────────────────┘
```

**Top Bar (48px height):**
- Left: Agent name — 14px Bugatti Monospace, UPPERCASE, `#ffffff`, 12px left padding
- Below name: "ONLINE" — 12px Bugatti Monospace, `#999999`
- No other elements in top bar

**Message Thread:**
- Fills space between top bar and input bar
- **Agent messages**: left-aligned, max-width 75%, no bubble background, text `#ffffff`, 6px border-radius
- **User messages**: right-aligned, max-width 70%, `#ffffff` text on `#000000`, 6px border-radius, 1px `#999999` border
- **Message spacing**: 12px between consecutive messages, 36px between exchange pairs
- **Timestamps**: 12px Bugatti Monospace, `#999999`, below each message
- **Streaming**: agent messages appear word-by-word (~50ms per word), cursor blinks at end until complete
- **Voice transcripts**: messages originating from voice show a small "MIC" label (10px, `#999999`) top-left of bubble
- **Auto-scroll**: thread scrolls to bottom on new messages unless user has scrolled up

**Input Bar (56px height):**
- Left: small voice orb — **48px** diameter, 1px `#ffffff` border, idle pulse. Tap to transition back to Voice Mode.
- Center: text input field — `#000000` background, 1px `#999999` border, 6px radius, 12px padding, `#ffffff` text, placeholder "TYPE MESSAGE..." in `#999999`, 12px Bugatti Monospace UPPERCASE
- Right: send button — pill, 1px `#ffffff` border, 9999px radius, "→" arrow symbol, 12px padding. Visible only when text is entered (150ms fade-in).

**Interactions in Chat Mode:**
- **Type + tap send / Enter**: sends message, clears input, agent response begins streaming
- **Tap small orb in input**: transitions to Voice Mode (swipe-right animation)
- **Swipe right**: transitions to Voice Mode
- **Swipe up**: opens Conversation History drawer
- **Swipe down**: opens Settings page

### Screen 3: Conversation History Drawer

**Trigger:** swipe-up from either Voice Mode or Chat Mode.

**Animation:** bottom sheet slides up over 400ms (ease-out). Semi-transparent `#000000` scrim (opacity 0.5) covers main content behind.

**Layout:**
- Height: **60%** of viewport on mobile, **70%** on desktop
- Background: `#000000`
- Close icon (X): top-right, 20px from edges, 24px, `#ffffff`

**Content:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  CONVERSATIONS                    ✕
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [TODAY]

  "Can you help me plan..."
  You and Agent · 5 MIN AGO          ›

  "What's the weather..."
  You and Agent · 3 HOURS AGO        ›

  [YESTERDAY]

  "Tell me a story"
  You and Agent · 8 MIN              ›

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        [ NEW CONVERSATION ]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

- **Title**: "CONVERSATIONS" — 14px Bugatti Monospace, UPPERCASE, `#ffffff`, 12px padding
- **Section headers**: "[TODAY]", "[YESTERDAY]", "[EARLIER]" — 12px Bugatti Monospace, UPPERCASE, `#999999`
- **Conversation cards** (each 72px height, 12px padding):
  - First line: excerpt of first message (14px Bugatti Monospace, `#ffffff`, truncated to 40 chars with "...")
  - Second line: "You and Agent · RELATIVE TIME" (12px Bugatti Monospace, `#999999`)
  - Right edge: disclosure chevron "›" (12px, `#999999`)
  - Separator: 1px `#333333` below each card
- **"NEW CONVERSATION" button**: centered at bottom, pill, 1px `#ffffff` border, 9999px radius, 14px UPPERCASE Bugatti Monospace, 12px×24px padding

**Interactions:**
- **Tap conversation**: closes drawer (400ms slide-down), loads that conversation. If in Voice Mode, auto-switches to Chat Mode.
- **Tap NEW CONVERSATION**: clears current conversation, closes drawer.
- **Tap X or swipe down**: closes drawer without action.

### Screen 4: Settings Page

**Trigger:** swipe-down from either mode, or tap SETTINGS in history drawer.

**Animation:** current screen fades out (400ms), Settings page fades in (400ms).

**Layout (scrollable, full screen):**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SETTINGS                         ✕
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [AGENT]

  AGENT NAME
  ┌────────────────────────────────┐
  │ Jarvis                         │
  └────────────────────────────────┘

  AGENT AVATAR
  ○ (64px circle, white border)
  [ CHANGE AVATAR ]

  SYSTEM PROMPT
  ┌────────────────────────────────┐
  │ You are a helpful AI           │
  │ assistant named Jarvis.        │
  │ Focus on brevity...            │
  └────────────────────────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     [ SAVE ]         [ DONE ]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

- **Background**: `#000000`
- **Title**: "SETTINGS" — 14px Bugatti Monospace, UPPERCASE, `#ffffff`, 20px left margin
- **Close icon**: top-right, 20px from edges
- **Section header**: "[AGENT]" — 12px Bugatti Monospace, UPPERCASE, `#999999`, 36px top margin
- **Field labels**: "AGENT NAME", "SYSTEM PROMPT" — 12px Bugatti Monospace, UPPERCASE, `#999999`, 12px bottom margin
- **Text input**: 40px height, 1px `#999999` border, 6px radius, `#000000` background, `#ffffff` text, 12px padding. Focus: border transitions to `#ffffff` (250ms ease).
- **Textarea**: same styling, min-height 80px, max-height 200px, auto-expanding.
- **Avatar circle**: 64px diameter, 1px `#ffffff` border, centered.
- **CHANGE AVATAR button**: pill, 1px `#ffffff` border, 12px×24px padding, 9999px radius, 12px Bugatti Monospace UPPERCASE.
- **SAVE button**: pill, 1px `#ffffff` border, 14px UPPERCASE. Disabled state: `#444444` text, `#333333` border (if no changes).
- **DONE button**: pill, 1px `#ffffff` border, 14px UPPERCASE. Saves and returns to previous screen.

**Interactions:**
- **Edit fields**: standard keyboard input
- **Tap SAVE**: persists to localStorage, brief visual confirmation
- **Tap DONE**: saves + returns to previous screen (reverse fade animation, 400ms)
- **Tap X**: returns without saving (or auto-saves on blur)
- **Swipe left**: returns to Voice Mode

### Empty State / First Visit

When the user opens the app for the first time:

1. Pure black screen — orb fades in over **600ms** (opacity 0→1, ease-out)
2. "TAP TO SPEAK" fades in **400ms after** orb finishes loading
3. No onboarding, no welcome text, no tutorials. The pulsing orb IS the affordance.
4. First tap initiates the voice flow; the agent greets the user with a mock response.
5. The conversation is auto-saved, seeding the history drawer.

### Navigation State Graph

```
              ┌─────────────────────────────┐
              │       VOICE MODE            │
              │  (Orb centered, immersive)  │
              └──────────┬──────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   Swipe Left      Swipe Up        Swipe Down
        │                │                │
        ▼                ▼                ▼
  ┌───────────┐  ┌──────────────┐  ┌──────────┐
  │ CHAT MODE │  │   HISTORY    │  │ SETTINGS │
  │ (Messages)│  │   DRAWER     │  │          │
  └─────┬─────┘  └──────┬───────┘  └────┬─────┘
        │                │               │
   Swipe Right    Tap conversation  Tap DONE
        │                │               │
        ▼                ▼               ▼
   VOICE MODE      CHAT MODE       Previous Mode
                  (auto-switch)
```

**Every transition is reversible.** Swipe-left/right toggles Voice↔Chat. Swipe-up opens history from either mode. Swipe-down opens settings from either mode. The black canvas is constant through all transitions.

### Responsive Behavior

| Breakpoint | Orb Size | Input Bar | History Drawer | Notes |
|---|---|---|---|---|
| Mobile (<640px) | 180px | 56px, full width | 60% height bottom sheet | Swipe gestures primary |
| Tablet (768–1023px) | 200px | 56px | 60% height | Same as mobile, larger type |
| Desktop (≥1024px) | 240px | 56px | 70% height, wider | Consider mouse-drag for swipe |
| Large Desktop (≥1536px) | 240px | 56px | 70% height | Max layout, ultra-wide hero |

### Animation & Transition Reference

| Transition | Duration | Easing | Description |
|---|---|---|---|
| Voice ↔ Chat mode switch | 500ms | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Fade-out + slide-in from direction of swipe |
| Orb state transitions | 300ms | `cubic-bezier(0.25, 0.46, 0.45, 0.94)` | Idle↔Listening↔Thinking↔Speaking |
| Idle orb pulse | 8000ms | ease-in-out | Continuous opacity 1.0→0.6→1.0 |
| History drawer open/close | 400ms | ease-out / ease-in | Bottom sheet slide up/down |
| Settings enter/exit | 400ms | ease-out | Fade in/out |
| First-visit orb appear | 600ms | ease-out | Opacity 0→1 |
| Send button appear | 150ms | ease-out | Fade in when text entered |

## Implementation Decisions

### Module Architecture

- **ChatEngine**: Manages conversation state — message list, mock streamed responses (simulated token-by-token delivery via timers). Exposes a simple interface for sending a message and receiving a stream of tokens. All AI responses are hardcoded/random mock data. This module is purely a state manager — no network calls. Voice interactions are recorded as transcript entries in the same message list.

- **VoiceOrb**: The central visual component for Voice Mode. Renders as a large circle centered on screen with four states: idle (opacity pulse), listening (concentric radiating arcs), thinking (orbiting dots), speaking (emanating circles + full-screen waveform lines). All animations use CSS animations/transitions — no heavy JS animation libraries. Also renders as a compact 48px version in Chat Mode's input bar.

- **VoiceMode**: The full-screen immersive voice experience. Composes VoiceOrb at center on pure black canvas. Manages the orb state machine (idle→listening→thinking→speaking→idle). Handles tap interactions and the voice flow lifecycle. No messages visible.

- **ChatMode**: The messaging experience. Renders the message thread (auto-scrolling bubbles, streaming text, media cards, voice transcript labels), the top bar (agent name/status), and the input bar (compact orb + text field + send button). Uses a simple message data structure: `{ role: 'user' | 'agent', content: string, type: 'text' | 'media', source: 'voice' | 'text', timestamp: Date }`.

- **ModeSwitch**: Orchestrates the cinematic transition between Voice Mode and Chat Mode. Manages swipe gesture detection (left/right), the 500ms cross-fade animation, and ensuring only one mode is rendered at a time. The black canvas is constant through transitions.

- **ConversationDrawer**: A bottom-sheet panel (swipe-up from either mode) listing past conversations grouped by date. Each entry shows a title (first message excerpt) and relative timestamp. Tapping loads that conversation. Conversations stored in localStorage.

- **AgentPersonaSettings**: A dedicated page for configuring the agent's name, avatar, and personality (system prompt textarea). Settings persist to localStorage. Follows Bugatti design — black background, white inputs with minimal borders, monospace labels.

- **NavigationShell**: The top-level layout that handles gesture routing between Voice Mode (default), Chat Mode, history drawer, and settings. All navigation is swipe-gesture-driven — no visible navigation buttons or tabs.

### Design System Adherence

- Strictly follows DESIGN.md: `#000000` background, `#ffffff` primary text, `#999999` secondary text
- All UI labels/buttons: uppercase Bugatti Monospace, 1.2–1.4px letter-spacing, weight 400
- Body text (messages): Bugatti Text Regular (Geist Sans maps here)
- Buttons: transparent with 1px white border, `9999px` border-radius (pill), `12px × 24px` padding
- Spacing: only values from the scale (4, 6, 12, 36, 48, 64px)
- Border radius: only 0, 6px, or 9999px
- No shadows, no gradients, no accent colors, no cards/elevated surfaces
- Responsive across all six breakpoints (640–1720px)

### State Management

- React state (useState/useReducer) — no external state management library
- Conversations and settings persisted to localStorage
- No server-side state, no database, no API calls

### Routing

- Next.js App Router with the following routes:
  - `/` — Main app shell (Voice Mode is default, Chat Mode is a client-side mode switch within the same route)
  - `/settings` — Agent persona configuration
- Voice Mode and Chat Mode are NOT separate routes — they are client-side state within `/`, animated by ModeSwitch
- History drawer is an overlay component, not a separate route

### Mock Data

- Agent responses are pre-written mock strings delivered token-by-token via `setInterval` to simulate streaming
- Media card mock data includes placeholder images
- Conversation history seeded with 2–3 mock conversations for demo purposes

## Testing Decisions

No tests are in scope for this PRD. The focus is strictly on building the visual interface and interaction design. Testing will be addressed in a future PRD once the UI is stable and API integration begins.

## Out of Scope

- AI backend integration (no OpenAI, no LLM API calls)
- Speech-to-text (STT) integration
- Text-to-speech (TTS) integration
- Real audio processing or waveform visualization from actual microphone input
- Authentication / user accounts
- Cloud persistence / database
- Push notifications
- Multi-user or shared conversations
- Accessibility audit (will be addressed separately)
- Automated tests
- Deployment / hosting configuration

## Further Notes

- The voice orb waveform animations during the "listening" state should be purely visual/decorative for now — they do not need to react to actual audio input. CSS-only or lightweight JS animations are preferred.
- The project uses Next.js 16 (with breaking changes from prior versions) — consult `node_modules/next/dist/docs/` for API changes before implementation.
- Tailwind CSS v4 is installed and should be the primary styling approach, following the Bugatti design system tokens.
- The architecture should make it straightforward to later replace the mock ChatEngine with a real API-backed engine without changing any UI components. The ChatEngine interface is the seam.
- localStorage is sufficient for all persistence needs in this phase. The schema should be simple and documented so it can later be migrated to a proper backend.
