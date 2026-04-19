/**
 * Framework-agnostic voice conversation state machine.
 *
 * Owns the full lifecycle: microphone capture, dual STT path selection
 * (Web Speech realtime vs Whisper on-blob), VAD silence detection,
 * model preload race, TTS playback, and cancellation. Emits events so a
 * UI layer (see use-voice-session.ts) can render without owning any of
 * this logic.
 *
 * The caller (page.tsx) only does three things:
 *   1. Instantiates once, provides an onTranscript callback.
 *   2. On transcript: streams the agent reply, then calls session.speak(reply).
 *   3. On mode switch: session.setActive(mode === "voice").
 */

import {
  transcribe,
  loadModel,
  isModelReady,
  setProgressCallback,
  startRealtimeTranscription,
  startWakeWordListener,
  supportsRealtimeTranscription,
  type RealtimeTranscriptionSession,
} from "./stt";
import {
  speak as ttsSpeak,
  enqueue as ttsEnqueue,
  flush as ttsFlush,
  stop as ttsStop,
  getSpokenChunks as ttsGetSpokenChunks,
} from "./tts";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

export type ModelStatus = "idle" | "downloading" | "ready" | "failed";

export type VoiceSessionEvent =
  | { type: "state"; state: OrbState }
  | { type: "userTranscript"; text: string; final: boolean }
  | { type: "audioLevel"; level: number }
  | { type: "modelStatus"; status: ModelStatus; progress?: number }
  | { type: "error"; stage: "mic" | "stt" | "tts"; message: string };

export type VoiceSessionSnapshot = {
  state: OrbState;
  modelStatus: ModelStatus;
  modelProgress: number | undefined;
  audioLevel: number;
  userTranscript: string | null;
};

export type VoiceSessionDeps = {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  AudioContextCtor: typeof AudioContext;
  MediaRecorderCtor: typeof MediaRecorder;
  supportsRealtime: () => boolean;
  startRealtime: typeof startRealtimeTranscription;
  startWakeWord: typeof startWakeWordListener;
  transcribeBlob: (blob: Blob) => Promise<string>;
  loadModel: () => Promise<void>;
  isModelReady: () => boolean;
  setProgressCallback: typeof setProgressCallback;
  speak: (text: string) => Promise<void>;
  enqueueSpeech: (text: string) => Promise<void>;
  flushSpeech: () => Promise<void>;
  stopSpeaking: () => void;
  getSpokenChunks: () => string[];
  now: () => number;
};

export type VoiceSessionVad = {
  threshold?: number; // amplitude below which silence starts accruing
  silenceMs?: number; // ms of quiet before auto-stop
  maxRecordMs?: number; // hard cap on a single recording
};

export type VoiceSessionConfig = {
  /**
   * Called when STT finalizes a user utterance. The caller should stream
   * the agent reply and, when complete, call `session.speak(reply)`.
   */
  onTranscript: (text: string) => void;
  /**
   * Called when the session is interrupted while non-idle (e.g. double-tap
   * during `thinking` or `speaking`). Callers use this to abort any in-flight
   * chat fetch they own.
   */
  onCancel?: () => void;
  /**
   * Called when the user barges in during `speaking` after at least
   * `INTERRUPTION_GRACE_MS` of TTS playback. `spokenText` is the
   * concatenation of every TTS chunk that finished playing before the
   * interruption — i.e. exactly what the user heard. Not fired for
   * sub-grace barge-ins or for `cancel()` triggered outside `speaking`.
   */
  onInterrupted?: (spokenText: string) => void;
  /**
   * If true (default), the session auto-transitions from `speaking` back to
   * `listening` once the agent finishes talking, so conversation flows
   * without requiring a tap. A tap while listening still stops the mic;
   * a tap while thinking/speaking still interrupts.
   */
  continuous?: boolean;
  /**
   * Wake-word / proactive-listen config. When enabled, the session passively
   * monitors the mic while `idle`:
   *   1. A continuous SpeechRecognition watches for the wake pattern
   *      (default /\bvivid\b/i) and auto-advances into a real turn.
   *   2. VAD on the shared analyser detects sustained voice-band energy; if
   *      speech is heard but no wake word fires within the grace window,
   *      the agent proactively asks `proactivePromptText` and starts
   *      listening.
   * Defaults to on when `continuous` is true.
   */
  wake?: {
    enabled?: boolean;
    /** Regex a transcript must match to count as a wake utterance. */
    pattern?: RegExp;
    /** Line spoken when speech is detected but the wake word wasn't said. */
    proactivePromptText?: string;
    /**
     * Minimum ms between proactive prompts. Prevents microwave/cough from
     * making the assistant repeatedly interrogate the user. Default 15 s.
     */
    proactiveCooldownMs?: number;
    /**
     * How long (ms) we wait after hearing speech for the wake-word
     * recognizer to match before firing the proactive prompt. Default 2500.
     */
    proactiveGraceMs?: number;
  };
  vad?: VoiceSessionVad;
  deps?: Partial<VoiceSessionDeps>;
};

const DEFAULT_VAD = { threshold: 10, silenceMs: 600, maxRecordMs: 30_000 };

// Minimum ms between speaking-state entry and barge-in for the interruption
// event to fire. Below this, the agent had effectively not started — treat
// as a normal cancel with no chat-history marker.
const INTERRUPTION_GRACE_MS = 500;

/**
 * Voice-band energy computation shared across all VAD loops.
 *
 * Two bands instead of one: voiced speech has strong energy in BOTH
 * the fundamental band (94–400 Hz) and the formant band (400–3400 Hz).
 * Broadband noise (fans, HVAC, wind) spreads energy fairly evenly across
 * the spectrum, so requiring both bands to clear their thresholds — or
 * equivalently, using the minimum of the two — sharply rejects it.
 *
 * Bin layout assumes fftSize=512. At 48 kHz, each bin is ~94 Hz wide; at
 * 44.1 kHz, ~86 Hz. The bands below tolerate both sample rates with a few-
 * hundred-Hz slack, which is well within normal speaker variation.
 */
const VAD_LOW_LO = 1;   // ~94 Hz
const VAD_LOW_HI = 4;   // ~376 Hz  (fundamentals)
const VAD_HIGH_LO = 5;  // ~470 Hz
const VAD_HIGH_HI = 37; // ~3472 Hz (formants)

function voiceBandEnergy(freq: Uint8Array<ArrayBuffer>): number {
  let low = 0;
  for (let i = VAD_LOW_LO; i <= VAD_LOW_HI; i++) low += freq[i];
  low /= (VAD_LOW_HI - VAD_LOW_LO + 1);
  let high = 0;
  for (let i = VAD_HIGH_LO; i <= VAD_HIGH_HI; i++) high += freq[i];
  high /= (VAD_HIGH_HI - VAD_HIGH_LO + 1);
  // Require energy in BOTH bands — return the minimum so the weaker band
  // gates the decision. Broadband noise lifts both roughly equally, but
  // our thresholds are set against a calibrated floor, so only a genuine
  // signal that's louder than ambient in BOTH bands will clear them.
  return Math.min(low, high);
}

function defaultDeps(): VoiceSessionDeps {
  return {
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    AudioContextCtor: AudioContext,
    MediaRecorderCtor: MediaRecorder,
    supportsRealtime: supportsRealtimeTranscription,
    startRealtime: startRealtimeTranscription,
    startWakeWord: startWakeWordListener,
    transcribeBlob: transcribe,
    loadModel,
    isModelReady,
    setProgressCallback,
    speak: ttsSpeak,
    enqueueSpeech: ttsEnqueue,
    flushSpeech: ttsFlush,
    stopSpeaking: ttsStop,
    getSpokenChunks: ttsGetSpokenChunks,
    now: Date.now,
  };
}

export class VoiceSession {
  private deps: VoiceSessionDeps;
  private vad: Required<VoiceSessionVad>;
  private continuous: boolean;
  private listeners = new Set<(e: VoiceSessionEvent) => void>();
  private snapshotListeners = new Set<() => void>();

  private state: OrbState = "idle";
  private modelStatus: ModelStatus = "idle";
  private active = true;
  private disposed = false;

  private snapshot: VoiceSessionSnapshot = {
    state: "idle",
    modelStatus: "idle",
    modelProgress: undefined,
    audioLevel: 0,
    userTranscript: null,
  };

  // Shared audio primitives — created once per active session and reused
  // across listening and barge-in. Keeps the mic stream and AudioContext hot
  // so each turn doesn't pay a 50–150ms cold-start tax, and avoids a second
  // concurrent getUserMedia during playback (which glitches TTS on iOS).
  private sharedStream: MediaStream | null = null;
  private sharedCtx: AudioContext | null = null;
  private sharedAnalyser: AnalyserNode | null = null;
  private sharedFreq: Uint8Array<ArrayBuffer> | null = null;
  private sharedStreamPromise: Promise<void> | null = null;

  // Capture resources (recorder-specific lifetime)
  private rafId = 0;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  // audioLevel throttle — emit at ~15Hz instead of every RAF tick.
  private lastAudioLevelEmit = 0;

  // Barge-in (piggybacks on sharedAnalyser while speaking)
  private bargeRaf = 0;
  // Wall-clock ms when state most recently entered "speaking". Used to gate
  // the onInterrupted event so a barge-in within the first ~500 ms of TTS
  // (effectively before the user could parse anything) doesn't pollute chat
  // history with a half-sentence fragment.
  private speakingStartedAt = 0;

  // STT state
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private recognition: RealtimeTranscriptionSession | null = null;
  private discardCapture = false;
  private pendingListen = false;
  // Guards concurrent startListening() calls (rapid tap / continuous loop).
  private listenStarting = false;
  // Marks this listening session as already submitted so a late
  // Web Speech `onend` can't fire onTranscript a second time.
  private submittedThisTurn = false;

  // TTS dedup (cleared every turn; guards against a single reply echoing
  // twice if speak() is called with the same text by accident).
  private lastSpokenText: string | null = null;
  // Timestamp of last /api/warmup ping; used to debounce listen-side warmup.
  private lastWarmupAt = 0;

  // Wake-word / proactive-listen config (resolved in ctor).
  private wakeEnabled: boolean;
  private wakePattern: RegExp;
  private proactivePromptText: string;
  private proactiveCooldownMs: number;
  private proactiveGraceMs: number;

  // Wake-word runtime state.
  private wakeSession: RealtimeTranscriptionSession | null = null;
  private wakeRaf = 0;
  // Timestamp when we first detected sustained speech in idle. Reset when
  // speech ends or the wake word fires. Used to gate the proactive prompt.
  private wakeSpeechDetectedAt = 0;
  // Last proactive "Did you say something?" — used for cooldown.
  private lastProactiveAt = 0;
  // Set true while proactivePrompt() is running to suppress reentry.
  private proactiveInFlight = false;

  constructor(private config: VoiceSessionConfig) {
    this.deps = { ...defaultDeps(), ...(config.deps ?? {}) };
    this.vad = { ...DEFAULT_VAD, ...(config.vad ?? {}) };
    this.continuous = config.continuous ?? true;
    const wake = config.wake ?? {};
    this.wakeEnabled = wake.enabled ?? this.continuous;
    this.wakePattern = wake.pattern ?? /\bvivid\b/i;
    this.proactivePromptText =
      wake.proactivePromptText ?? "Did you say something?";
    this.proactiveCooldownMs = wake.proactiveCooldownMs ?? 15_000;
    this.proactiveGraceMs = wake.proactiveGraceMs ?? 2500;
    this.preloadModel();
  }

  /* ── Public surface ───────────────────────────────── */

  on(listener: (e: VoiceSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Subscribe to snapshot changes. Intended for `useSyncExternalStore`;
   * prefer `on()` for raw event access.
   */
  subscribe(listener: () => void): () => void {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  getSnapshot(): VoiceSessionSnapshot {
    return this.snapshot;
  }

  getState(): OrbState {
    return this.state;
  }

  getModelStatus(): ModelStatus {
    return this.modelStatus;
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) {
      this.cancel();
      this.stopWakeMonitor();
      // Close the persistent mic when leaving voice mode — no reason to
      // keep the indicator on while the user is typing.
      this.releaseSharedAudio();
    } else if (this.state === "idle") {
      // Re-entering voice mode while idle — spin wake monitor back up.
      void this.startWakeMonitor();
    }
  }

  /**
   * Context-aware tap handler.
   * idle      → start listening (queues if model is still loading)
   * listening → stop recording (transitions to thinking)
   * speaking  → barge in: stop TTS and start listening immediately
   * thinking  → ignored (LLM in-flight; use interrupt() to abort)
   */
  tap(): void {
    if (!this.active || this.disposed) return;
    if (this.state === "idle") {
      if (!this.deps.supportsRealtime() && !this.deps.isModelReady()) {
        this.pendingListen = true;
        return;
      }
      void this.startListening();
    } else if (this.state === "listening") {
      this.stopRecording();
    } else if (this.state === "speaking") {
      // Manual barge-in. The auto VAD may have backed off after false
      // triggers, but the user deserves an immediate interrupt path.
      this.stopBargeInMonitor();
      this.bargeIn();
    }
  }

  /**
   * Double-tap / barge. Releases all resources, stops TTS, returns to idle,
   * and fires `onCancel` so the caller can abort any in-flight chat fetch.
   */
  interrupt(): void {
    this.cancel();
  }

  /**
   * Manual transcript submission (bypasses STT). Moves state to `thinking`
   * and fires onTranscript. Used internally when STT finalizes; exposed for
   * tests.
   */
  submitTranscript(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || !this.active || this.disposed) return;
    // Latch so a late Web Speech `onend` firing after stop() can't submit
    // the same utterance twice.
    if (this.submittedThisTurn) return;
    this.submittedThisTurn = true;
    // A new turn is starting; clear last-reply dedup so identical answers
    // to identical user prompts still play.
    this.lastSpokenText = null;
    // Update proactive-prompt cooldown so the wake monitor doesn't pester
    // the user the instant this turn ends and we return to idle.
    this.lastProactiveAt = this.deps.now();
    this.emit({ type: "userTranscript", text: trimmed, final: true });
    this.setState("thinking");
    this.config.onTranscript(trimmed);
  }

  /**
   * Play the agent reply. No-op unless state is `thinking` (i.e. this turn
   * originated from voice). Deduplicates identical consecutive replies.
   */
  async speak(text: string): Promise<void> {
    if (!this.active || this.disposed) return;
    const trimmed = text.trim();
    if (!trimmed) {
      if (this.state === "thinking") this.setState("idle");
      return;
    }
    if (this.lastSpokenText === trimmed) return;
    if (this.state !== "thinking") return;

    this.lastSpokenText = trimmed;
    this.setState("speaking");
    try {
      await this.deps.speak(trimmed);
    } catch (err) {
      this.emit({
        type: "error",
        stage: "tts",
        message: (err as Error).message,
      });
    } finally {
      // Re-check via method call so TS doesn't narrow using the earlier guard;
      // `cancel()` may have mutated state while TTS was awaiting.
      if (this.getState() === "speaking") this.finishTurn();
    }
  }

  /**
   * Streaming TTS: enqueue one sentence/chunk as it arrives from the LLM.
   * First call transitions `thinking → speaking`. Safe to call repeatedly;
   * clips play back-to-back in FIFO order.
   */
  speakChunk(text: string): void {
    if (!this.active || this.disposed) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this.state !== "thinking" && this.state !== "speaking") return;
    if (this.state === "thinking") this.setState("speaking");
    this.deps.enqueueSpeech(trimmed).catch((err) => {
      this.emit({
        type: "error",
        stage: "tts",
        message: (err as Error).message,
      });
    });
  }

  /**
   * Await completion of all enqueued chunks and return to idle.
   * No-op if not currently speaking.
   */
  async endSpeaking(): Promise<void> {
    if (!this.active || this.disposed) return;
    // If nothing was enqueued (empty reply), just return to idle.
    if (this.state === "thinking") {
      this.finishTurn();
      return;
    }
    if (this.state !== "speaking") return;
    try {
      await this.deps.flushSpeech();
    } finally {
      if (this.getState() === "speaking") this.finishTurn();
    }
  }

  /**
   * End-of-turn hook. In continuous mode, reopens the mic so the user can
   * keep talking without tapping. Otherwise returns to idle.
   */
  private finishTurn(): void {
    if (this.disposed || !this.active) {
      this.setState("idle");
      return;
    }
    if (this.continuous) {
      // Go straight from speaking→listening — no idle flash. startListening
      // will no-op if a concurrent call is already in flight, and will set
      // state to "listening" optimistically on entry.
      void this.startListening();
      // If startListening synchronously short-circuited (e.g. not active,
      // disposed, or a listen is already starting) we still need to leave
      // a consistent state. A non-listening, non-idle state here would be
      // a bug; fall through to idle to be safe on the next microtask.
      if (this.state === "speaking") this.setState("idle");
    } else {
      this.setState("idle");
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.stopWakeMonitor();
    this.releaseSharedAudio();
    this.listeners.clear();
    this.snapshotListeners.clear();
    this.deps.setProgressCallback(null);
  }

  /* ── Internals ───────────────────────────────────────── */

  private emit(event: VoiceSessionEvent): void {
    for (const l of this.listeners) l(event);
    this.updateSnapshot(event);
  }

  private updateSnapshot(event: VoiceSessionEvent): void {
    const prev = this.snapshot;
    let next = prev;
    switch (event.type) {
      case "state":
        next = {
          ...prev,
          state: event.state,
          // Clear transcript when returning to idle/listening so a new turn
          // starts clean.
          userTranscript:
            event.state === "idle" || event.state === "listening"
              ? null
              : prev.userTranscript,
        };
        break;
      case "audioLevel":
        if (prev.audioLevel === event.level) return;
        next = { ...prev, audioLevel: event.level };
        break;
      case "userTranscript":
        next = { ...prev, userTranscript: event.text || null };
        break;
      case "modelStatus":
        next = {
          ...prev,
          modelStatus: event.status,
          modelProgress: event.progress,
        };
        break;
      case "error":
        return;
    }
    if (next === prev) return;
    this.snapshot = next;
    for (const l of this.snapshotListeners) l();
  }

  private setState(next: OrbState): void {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    this.emit({ type: "state", state: next });

    // Barge-in monitor lifecycle: only runs while the agent is speaking.
    if (next === "speaking") {
      this.speakingStartedAt = this.deps.now();
      void this.startBargeInMonitor();
    } else if (prev === "speaking") {
      this.stopBargeInMonitor();
    }

    // Wake-word / proactive monitor runs ONLY in idle. Any other state
    // means either we own the mic (listening / recording) or we're
    // intentionally blocking user input (thinking / speaking) — in both
    // cases a passive recognizer would conflict or self-trigger.
    if (next === "idle") {
      void this.startWakeMonitor();
    } else if (prev === "idle") {
      this.stopWakeMonitor();
    }

    // Entering `listening` is the earliest point we know the user is about to
    // speak and the next agent turn is imminent. Kick the TTS server awake in
    // the background so first-sentence synthesis hits a hot cache — but only
    // if we haven't pinged it recently. In continuous mode this would
    // otherwise run every turn and compete with the real TTS request for CPU
    // on the (single-threaded) Kokoro server.
    if (next === "listening" && typeof fetch !== "undefined") {
      const since = this.deps.now() - this.lastWarmupAt;
      if (since > 60_000) {
        this.lastWarmupAt = this.deps.now();
        fetch("/api/warmup", { method: "POST" }).catch(() => {});
      }
    }
  }

  /**
   * Watches the shared analyser during `speaking` for sustained voice-band
   * energy coming from the user's microphone. When detected, stop TTS and
   * drop into `listening` — the user has barged in. Browser-level echo
   * cancellation on the shared mic stream keeps most of the agent's own
   * audio from self-triggering; what leaks through is handled by the
   * calibration window and voice-band filtering below.
   *
   * Calibration model:
   *   - For the first ~300 ms we take the MINIMUM voice-band energy seen.
   *     That min represents "what the mic hears with only TTS bleed + room
   *     tone, no user speech." Using the minimum (not the mean) is
   *     important — the TTS waveform is bursty so an EMA-from-frame-0 sits
   *     way too high and makes real speech invisible.
   *   - After calibration, threshold = max(MIN_FLOOR, floor * RATIO).
   *   - Floor continues to adapt slowly (EMA) on quiet frames only, so
   *     changes in TTS volume over the utterance don't desensitize us.
   */
  private async startBargeInMonitor(): Promise<void> {
    if (this.bargeRaf || this.disposed) return;
    try {
      await this.ensureSharedAudio();
    } catch {
      // Barge-in is best-effort — if the mic is unavailable the user can tap.
      return;
    }
    const analyser = this.sharedAnalyser;
    const freq = this.sharedFreq;
    if (!analyser || !freq || this.state !== "speaking" || this.disposed) return;

    // Lower ratio + floor than before: echo cancellation + min-based
    // calibration mean the adaptive floor tracks real residual bleed, not
    // peak bleed. 2.2x is enough head-room without eating quiet speech.
    const RATIO = 2.2;
    const MIN_FLOOR = 8;
    // Time-based gate (ms, not RAF frames) so background tabs and low-FPS
    // devices get the same sensitivity as a 60fps foreground tab.
    const MIN_SPEECH_MS = 120;
    const NOISE_EMA = 0.03;
    // We need BOTH enough time AND some actual audible input to conclude
    // calibration. Bare-time calibration is fragile: Kokoro first-chunk
    // latency can exceed 300 ms, so we'd finish "calibrating" during pure
    // silence, then mistake the first TTS bleed for user speech. Require
    // both conditions so calibration waits for real TTS bleed to appear.
    const CALIBRATION_MS = 300;
    const CALIBRATION_MAX_MS = 1500; // give up waiting for TTS bleed eventually
    const TICK_GAP_RESET_MS = 500;

    const startedAt = this.deps.now();
    let calibrationMin = Infinity;
    let calibrationSawSignal = false;
    let calibrated = false;
    let noiseFloor = 0;
    let speechStartedAt = 0;
    let lastTickAt = startedAt;

    const tick = () => {
      if (this.state !== "speaking" || this.disposed) {
        this.stopBargeInMonitor();
        return;
      }
      if (this.sharedAnalyser !== analyser) {
        this.stopBargeInMonitor();
        return;
      }
      analyser.getByteFrequencyData(freq);
      const voiceBand = voiceBandEnergy(freq);

      const now = this.deps.now();
      if (now - lastTickAt > TICK_GAP_RESET_MS) {
        speechStartedAt = 0;
      }
      lastTickAt = now;

      if (!calibrated) {
        // Require the signal to be clearly above the DC-offset noise of
        // an otherwise-silent mic (~0–2). A threshold of 4 avoids
        // declaring "signal seen" from mic self-noise alone.
        if (voiceBand > 4) calibrationSawSignal = true;
        if (voiceBand < calibrationMin) calibrationMin = voiceBand;
        const elapsed = now - startedAt;
        const enoughTime = elapsed >= CALIBRATION_MS;
        const forceFinish = elapsed >= CALIBRATION_MAX_MS;
        if ((enoughTime && calibrationSawSignal) || forceFinish) {
          noiseFloor = Number.isFinite(calibrationMin) ? calibrationMin : 0;
          calibrated = true;
        } else {
          this.bargeRaf = requestAnimationFrame(tick);
          return;
        }
      }

      const threshold = Math.max(MIN_FLOOR, noiseFloor * RATIO);

      if (voiceBand > threshold) {
        if (!speechStartedAt) speechStartedAt = now;
        else if (now - speechStartedAt >= MIN_SPEECH_MS) {
          // User has been above threshold long enough — barge in.
          this.stopBargeInMonitor();
          this.bargeIn();
          return;
        }
      } else {
        // Quiet frame: decay the speech timer and adapt the floor.
        speechStartedAt = 0;
        noiseFloor = noiseFloor * (1 - NOISE_EMA) + voiceBand * NOISE_EMA;
      }
      this.bargeRaf = requestAnimationFrame(tick);
    };
    this.bargeRaf = requestAnimationFrame(tick);
  }

  private stopBargeInMonitor(): void {
    cancelAnimationFrame(this.bargeRaf);
    this.bargeRaf = 0;
  }

  /**
   * Passive wake-word + ambient-speech monitor. Runs while the session is
   * idle and active. Has two jobs:
   *
   *   1. Keep a continuous SpeechRecognition open and match incoming
   *      transcripts against `wakePattern`. A match jumps us straight into
   *      a turn — if the utterance had content beyond the wake word
   *      ("hello vivid, what's the weather") we submit that content
   *      immediately; otherwise we open the mic for a follow-up.
   *
   *   2. Watch shared-analyser voice-band energy. If sustained speech is
   *      heard but no wake word has matched within `proactiveGraceMs`, and
   *      we haven't prompted recently, ask the user if they said anything
   *      — then start listening for the reply.
   *
   * Both jobs are best-effort. Missing mic permission, unsupported
   * SpeechRecognition, or transient errors simply degrade to "tap to talk".
   */
  private async startWakeMonitor(): Promise<void> {
    if (
      !this.wakeEnabled ||
      !this.active ||
      this.disposed ||
      this.state !== "idle"
    ) {
      return;
    }
    if (this.wakeSession || this.wakeRaf) return;

    try {
      await this.ensureSharedAudio();
    } catch {
      // Without a mic there's nothing to monitor — silently skip. Tap
      // still works because startListening retries getUserMedia.
      return;
    }
    if (this.state !== "idle" || !this.active || this.disposed) return;

    // Start continuous wake-word recognition (if supported).
    if (this.deps.supportsRealtime()) {
      this.wakeSession = this.deps.startWakeWord({
        onTranscript: (text) => this.handleWakeTranscript(text),
        onError: () => {
          // Permission revoked or hard failure — stop trying for this session.
          this.wakeSession = null;
        },
      });
    }

    // Start the VAD loop for proactive-prompt detection.
    this.wakeSpeechDetectedAt = 0;
    const analyser = this.sharedAnalyser;
    const freq = this.sharedFreq;
    if (!analyser || !freq) return;

    // Thresholds mirror the listen-side VAD but slightly stricter — we don't
    // want ambient TV chatter 15 ft away tripping the proactive prompt.
    // Uses the same dual-band voiceBandEnergy() as every other loop.
    const RATIO = 3;
    const MIN_FLOOR = 10;
    const MIN_SPEECH_MS = 250;
    const NOISE_EMA = 0.05;
    const CALIBRATION_MS = 300;
    const TICK_GAP_RESET_MS = 500;

    const startedAt = this.deps.now();
    let calibrationMin = Infinity;
    let calibrated = false;
    let noiseFloor = 0;
    let speechStartedAt = 0;
    let lastTickAt = startedAt;

    const tick = () => {
      if (this.state !== "idle" || !this.active || this.disposed) {
        this.stopWakeMonitor();
        return;
      }
      if (this.sharedAnalyser !== analyser) {
        this.stopWakeMonitor();
        return;
      }
      analyser.getByteFrequencyData(freq);
      const voiceBand = voiceBandEnergy(freq);

      const now = this.deps.now();
      if (now - lastTickAt > TICK_GAP_RESET_MS) {
        speechStartedAt = 0;
        // Drop any stale pending-speech marker too — the user may have
        // been quiet for minutes while the tab was hidden.
        this.wakeSpeechDetectedAt = 0;
      }
      lastTickAt = now;

      if (!calibrated) {
        if (voiceBand < calibrationMin) calibrationMin = voiceBand;
        if (now - startedAt >= CALIBRATION_MS) {
          noiseFloor = Number.isFinite(calibrationMin) ? calibrationMin : 0;
          calibrated = true;
        }
        this.wakeRaf = requestAnimationFrame(tick);
        return;
      }

      const threshold = Math.max(MIN_FLOOR, noiseFloor * RATIO);

      if (voiceBand > threshold) {
        if (!speechStartedAt) speechStartedAt = now;
        if (
          !this.wakeSpeechDetectedAt &&
          now - speechStartedAt >= MIN_SPEECH_MS
        ) {
          this.wakeSpeechDetectedAt = now;
        }
      } else {
        speechStartedAt = 0;
        noiseFloor = noiseFloor * (1 - NOISE_EMA) + voiceBand * NOISE_EMA;
        // If the speech has stopped AND we never matched the wake word,
        // check whether enough grace time has elapsed to prompt proactively.
        if (this.wakeSpeechDetectedAt && !this.proactiveInFlight) {
          const heardFor = now - this.wakeSpeechDetectedAt;
          const sinceLastPrompt = now - this.lastProactiveAt;
          if (
            heardFor >= this.proactiveGraceMs &&
            sinceLastPrompt >= this.proactiveCooldownMs
          ) {
            this.wakeSpeechDetectedAt = 0;
            void this.proactivePrompt();
            return; // don't schedule another tick; proactivePrompt drives state
          }
          // Stale detection: if we heard speech long ago and no prompt
          // condition ever cleared, forget it so the timer doesn't stockpile.
          if (heardFor > this.proactiveGraceMs * 2) {
            this.wakeSpeechDetectedAt = 0;
          }
        }
      }
      this.wakeRaf = requestAnimationFrame(tick);
    };
    this.wakeRaf = requestAnimationFrame(tick);
  }

  private stopWakeMonitor(): void {
    cancelAnimationFrame(this.wakeRaf);
    this.wakeRaf = 0;
    this.wakeSpeechDetectedAt = 0;
    if (this.wakeSession) {
      try {
        this.wakeSession.stop();
      } catch {
        /* ignore */
      }
      this.wakeSession = null;
    }
  }

  /**
   * Process a wake-listener transcript. If it matches the wake pattern,
   * strip the wake phrase and either submit the trailing content as the
   * user's message (same turn — no extra tap needed) or open the mic for
   * a follow-up when nothing meaningful followed the wake word.
   */
  private handleWakeTranscript(text: string): void {
    if (this.state !== "idle" || !this.active || this.disposed) return;
    if (!this.wakePattern.test(text)) return;

    // Cancel any pending proactive prompt — the user IS addressing us.
    this.wakeSpeechDetectedAt = 0;

    // Find the wake-word match in the transcript and drop everything up
    // to and including it (plus trailing punctuation). Using exec() rather
    // than splicing via `new RegExp(pattern.source)` sidesteps issues where
    // a user-supplied pattern contains capture groups or escapes that
    // would break when embedded in a larger regex.
    const match = this.wakePattern.exec(text);
    const after = match
      ? text.slice((match.index ?? 0) + match[0].length)
      : text;
    const stripped = after.replace(/^[\s,.:;!?—-]+/, "").trim();

    this.stopWakeMonitor();

    if (stripped.length >= 3) {
      // Meaningful content after the wake word — submit as a full turn.
      this.emit({ type: "userTranscript", text: stripped, final: true });
      this.submittedThisTurn = false; // submitTranscript will latch it
      this.submitTranscript(stripped);
    } else {
      // Just the wake word — open the mic so the user can continue speaking.
      void this.startListening();
    }
  }

  /**
   * Speak a short prompt ("Did you say something?") and then drop into
   * listening so the reply is captured. Manages state transitions directly
   * since we're bypassing the normal onTranscript → speak() flow.
   */
  private async proactivePrompt(): Promise<void> {
    if (this.proactiveInFlight) return;
    if (this.state !== "idle" || !this.active || this.disposed) return;
    this.proactiveInFlight = true;
    this.lastProactiveAt = this.deps.now();
    // Stop wake monitoring while we speak — our own TTS would otherwise
    // bleed into the recognizer (and into the VAD loop) and cause loops.
    this.stopWakeMonitor();

    // Manually advance state: idle → thinking → speaking → (finishTurn).
    // Calling deps.speak directly bypasses the thinking-guard in speak().
    this.setState("thinking");
    this.setState("speaking");
    try {
      await this.deps.speak(this.proactivePromptText);
    } catch {
      // TTS failure — just fall back to listening.
    } finally {
      this.proactiveInFlight = false;
      if (this.getState() === "speaking") {
        // finishTurn() handles continuous-mode transition to listening.
        this.finishTurn();
      }
    }
  }

  /**
   * Barge-in triggered mid-speaking. Stop TTS, drop any queued chunks, and
   * jump into listening so we capture whatever the user says next. We do NOT
   * call onCancel — by the time the agent is speaking, the LLM request is
   * already finished.
   */
  private bargeIn(): void {
    this.maybeEmitInterrupted();
    this.deps.stopSpeaking();
    this.lastSpokenText = null;
    // Go idle first so startListening's state transitions are clean.
    this.setState("idle");
    void this.startListening();
  }

  /**
   * Snapshot what the user actually heard and fire onInterrupted, but only
   * if we've been speaking long enough for the interruption to be meaningful.
   * MUST be called BEFORE deps.stopSpeaking(), since stop() resets the
   * spoken-chunks tracker.
   */
  private maybeEmitInterrupted(): void {
    if (this.state !== "speaking") return;
    if (!this.config.onInterrupted) return;
    const elapsed = this.deps.now() - this.speakingStartedAt;
    if (elapsed < INTERRUPTION_GRACE_MS) return;
    const chunks = this.deps.getSpokenChunks();
    const spokenText = chunks.join(" ").trim();
    if (!spokenText) return;
    try {
      this.config.onInterrupted(spokenText);
    } catch {
      // Caller-supplied callback — don't let a thrown error break the
      // state machine mid-transition.
    }
  }

  private setModelStatus(status: ModelStatus, progress?: number): void {
    this.modelStatus = status;
    this.emit({ type: "modelStatus", status, progress });
  }

  private cancel(): void {
    const wasBusy = this.state !== "idle";
    // Capture interruption BEFORE stopSpeaking() resets the tracker.
    this.maybeEmitInterrupted();
    this.pendingListen = false;
    this.discardCapture = true;
    this.submittedThisTurn = true; // prevent late onFinal from submitting

    this.recognition?.abort();
    this.recognition = null;

    if (this.recorder?.state === "recording") {
      try {
        this.recorder.stop();
      } catch {
        /* recorder already in terminal state */
      }
    }
    this.recorder = null;
    this.chunks = [];

    this.releaseAudio();
    // setState("idle") below will also stopBargeInMonitor via the
    // prev === "speaking" branch, so calling it here is redundant.
    this.deps.stopSpeaking();
    this.lastSpokenText = null;
    this.setState("idle");
    if (wasBusy) this.config.onCancel?.();
  }

  private preloadModel(): void {
    if (this.deps.supportsRealtime()) {
      this.setModelStatus("ready");
      return;
    }
    if (this.deps.isModelReady()) {
      this.setModelStatus("ready");
      return;
    }
    this.setModelStatus("downloading");
    this.deps.setProgressCallback((info) => {
      if (info.status === "progress" && info.progress != null) {
        this.setModelStatus("downloading", Math.round(info.progress));
      } else if (info.status === "ready") {
        this.setModelStatus("ready");
      }
    });
    this.deps
      .loadModel()
      .then(() => {
        if (this.disposed) return;
        this.setModelStatus("ready");
        if (this.pendingListen && this.active) {
          this.pendingListen = false;
          void this.startListening();
        }
      })
      .catch((err) => {
        if (this.disposed) return;
        console.warn("Whisper model preload failed:", err);
        this.setModelStatus("failed");
      })
      .finally(() => {
        if (!this.disposed) this.deps.setProgressCallback(null);
      });
  }

  private releaseAudio(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
    // NOTE: shared stream/ctx/analyser are NOT released here — they persist
    // across turns. releaseSharedAudio() handles that on dispose/setActive(false).
    this.emit({ type: "audioLevel", level: 0 });
  }

  /**
   * Lazily acquire a long-lived mic stream + AudioContext + analyser, reused
   * across listening and barge-in. Idempotent; concurrent callers share the
   * same promise.
   */
  private async ensureSharedAudio(): Promise<void> {
    if (this.sharedStream && this.sharedAnalyser) return;
    if (this.sharedStreamPromise) return this.sharedStreamPromise;
    this.sharedStreamPromise = (async () => {
      try {
        const stream = await this.deps.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (this.disposed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const ctx = new this.deps.AudioContextCtor();
        // Some browsers create the context in "suspended" state due to
        // autoplay policies, even after a user gesture. A suspended
        // context returns all-zero frequency data, which silently breaks
        // every VAD loop.
        if (ctx.state === "suspended") {
          try {
            await ctx.resume();
          } catch {
            /* best-effort */
          }
        }
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        // Detect mid-session track death (USB mic unplugged, device
        // switched in OS). The captured stream stays but emits silence.
        // Drop shared state so the next ensureSharedAudio() reopens.
        stream.getTracks().forEach((t) => {
          t.addEventListener("ended", () => {
            if (this.sharedStream === stream) {
              this.releaseSharedAudio();
              // Surface a mic error so the UI can react — track-end
              // means the device was unplugged or reassigned and no
              // further VAD work is possible until we re-acquire.
              this.emit({
                type: "error",
                stage: "mic",
                message: "Microphone disconnected",
              });
            }
          });
        });
        this.sharedStream = stream;
        this.sharedCtx = ctx;
        this.sharedAnalyser = analyser;
        this.sharedFreq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      } finally {
        this.sharedStreamPromise = null;
      }
    })();
    return this.sharedStreamPromise;
  }

  private releaseSharedAudio(): void {
    this.sharedStream?.getTracks().forEach((t) => t.stop());
    this.sharedStream = null;
    this.sharedAnalyser = null;
    this.sharedFreq = null;
    this.sharedCtx?.close().catch(() => {});
    this.sharedCtx = null;
  }

  private startAudioMonitor(onSilence?: () => void): void {
    const analyser = this.sharedAnalyser;
    const freq = this.sharedFreq;
    if (!analyser || !freq) return;

    // Speech-based VAD using dual-band voiceBandEnergy() (see module-level
    // helper). Min-calibration on the first 250 ms makes us resilient to
    // the user already speaking when the mic opens (common in continuous
    // mode, where listening starts immediately after TTS ends).
    const SPEECH_RATIO = 2.5;
    const MIN_FLOOR = 6;
    const MIN_SPEECH_MS = 200;
    const NOISE_EMA = 0.05;
    const LEVEL_EMIT_MS = 66;
    const CALIBRATION_MS = 250;
    // If the user never speaks at all, abort the listen turn instead of
    // sitting open for the full maxRecordMs. Measured from tick start.
    const NO_SPEECH_TIMEOUT_MS = 5000;
    // Wall-clock gap that indicates RAF was paused (backgrounded tab or
    // OS sleep). Reset accumulators — times measured across a gap are lies.
    const TICK_GAP_RESET_MS = 500;

    const startedAt = this.deps.now();
    let calibrationMin = Infinity;
    let calibrated = false;
    let noiseFloor = 0;
    let speechStartedAt = 0;
    let heardSpeech = false;
    let silenceStart = 0;
    let lastTickAt = startedAt;

    const tick = () => {
      // If sharedStream died (mic unplugged) the shared analyser may
      // have been released from under us. Abort — a fresh listen-start
      // will reacquire through ensureSharedAudio.
      if (this.sharedAnalyser !== analyser) return;
      analyser.getByteFrequencyData(freq);

      const voiceBand = voiceBandEnergy(freq);

      // Throttle UI meter updates — no one needs 60 Hz of "still 0.3".
      const nowMs = this.deps.now();
      if (nowMs - this.lastAudioLevelEmit >= LEVEL_EMIT_MS) {
        this.lastAudioLevelEmit = nowMs;
        let totalSum = 0;
        for (let i = 0; i < freq.length; i++) totalSum += freq[i];
        this.emit({
          type: "audioLevel",
          level: Math.min(1, totalSum / freq.length / 80),
        });
      }

      // Detect tab-visibility gaps. RAF pauses on hidden tabs, and on
      // wake the next tick carries a stale wall-clock "speechStartedAt"
      // that would instantly fire silence or speech triggers. Reset
      // everything — including heardSpeech — since a multi-minute gap
      // means the user's utterance is effectively stale.
      if (nowMs - lastTickAt > TICK_GAP_RESET_MS) {
        speechStartedAt = 0;
        silenceStart = 0;
        heardSpeech = false;
      }
      lastTickAt = nowMs;

      if (!calibrated) {
        if (voiceBand < calibrationMin) calibrationMin = voiceBand;
        if (nowMs - startedAt >= CALIBRATION_MS) {
          noiseFloor = Number.isFinite(calibrationMin) ? calibrationMin : 0;
          calibrated = true;
        }
        this.rafId = requestAnimationFrame(tick);
        return;
      }

      const threshold = Math.max(MIN_FLOOR, noiseFloor * SPEECH_RATIO);
      const isSpeech = voiceBand > threshold;

      if (isSpeech) {
        if (!speechStartedAt) speechStartedAt = nowMs;
        silenceStart = 0;
        if (!heardSpeech && nowMs - speechStartedAt >= MIN_SPEECH_MS) {
          heardSpeech = true;
        }
      } else {
        speechStartedAt = 0;
        noiseFloor = noiseFloor * (1 - NOISE_EMA) + voiceBand * NOISE_EMA;

        if (onSilence) {
          if (heardSpeech) {
            if (!silenceStart) silenceStart = nowMs;
            else if (nowMs - silenceStart > this.vad.silenceMs) {
              onSilence();
              return;
            }
          } else if (nowMs - startedAt >= NO_SPEECH_TIMEOUT_MS) {
            // User tapped the mic but never said anything. Bail directly
            // to idle — no "thinking" flash since we never heard an
            // utterance to submit.
            this.releaseAudio();
            this.recognition?.abort();
            this.recognition = null;
            if (this.recorder?.state === "recording") {
              this.discardCapture = true;
              try {
                this.recorder.stop();
              } catch {
                /* recorder already terminal */
              }
            }
            this.setState("idle");
            return;
          }
        }
      }

      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
    this.maxTimer = setTimeout(
      () => this.stopRecording(),
      this.vad.maxRecordMs
    );
  }

  private async startListening(): Promise<void> {
    if (!this.active || this.disposed) return;
    // Guard against concurrent entry (rapid tap, or continuous loop racing
    // with a tap). getUserMedia is awaited so without this two mic streams
    // and two recorders can spin up.
    if (this.listenStarting || this.state === "listening") return;
    this.listenStarting = true;
    this.pendingListen = false;
    this.discardCapture = false;
    this.submittedThisTurn = false;
    try {
      await this.startListeningImpl();
    } finally {
      this.listenStarting = false;
    }
  }

  private async startListeningImpl(): Promise<void> {
    // Flip the UI to "listening" immediately — the user shouldn't see an idle
    // flash while we reach into getUserMedia. If acquisition fails we reset
    // to idle in the catch blocks.
    this.setState("listening");

    // Ensure the persistent mic stream + analyser are ready. Cold path on
    // turn 1; warm (~0ms) on every subsequent turn.
    try {
      await this.ensureSharedAudio();
    } catch (err) {
      this.emit({
        type: "error",
        stage: "mic",
        message: (err as Error).message,
      });
      this.setState("idle");
      return;
    }
    if (!this.active || this.disposed || this.state !== "listening") return;
    const sharedStream = this.sharedStream;
    if (!sharedStream) {
      this.setState("idle");
      return;
    }

    // Realtime (Web Speech) path
    if (this.deps.supportsRealtime()) {
      this.startAudioMonitor();

      const recog = this.deps.startRealtime({
        onError: (err) => {
          this.recognition = null;
          this.releaseAudio();
          this.emit({ type: "error", stage: "stt", message: err.message });
          this.setState("idle");
        },
        onFinal: (text) => {
          this.recognition = null;
          this.releaseAudio();
          if (!text.trim() || !this.active) {
            this.setState("idle");
            return;
          }
          this.submitTranscript(text);
        },
        onInterim: (text) => {
          if (!this.active) return;
          this.emit({ type: "userTranscript", text, final: false });
        },
      });

      if (recog) {
        this.recognition = recog;
        return;
      }
      this.releaseAudio();
      // Fall through to Whisper path if constructor returned null
    }

    // Whisper path (MediaRecorder on the shared stream + post-hoc transcribe)
    try {
      const recorder = new this.deps.MediaRecorderCtor(sharedStream);
      this.recorder = recorder;
      this.chunks = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };

      recorder.onstop = async () => {
        this.releaseAudio();
        const discard = this.discardCapture || !this.active;
        this.discardCapture = false;
        const blob = new Blob(this.chunks, { type: recorder.mimeType });
        this.chunks = [];

        if (discard || blob.size === 0) {
          this.setState("idle");
          return;
        }

        try {
          const text = await this.deps.transcribeBlob(blob);
          if (!this.active || this.disposed) return;
          if (!text.trim()) {
            this.setState("idle");
            return;
          }
          this.submitTranscript(text);
        } catch (err) {
          this.emit({
            type: "error",
            stage: "stt",
            message: (err as Error).message,
          });
          this.setState("idle");
        }
      };

      recorder.start();
      this.startAudioMonitor(() => this.stopRecording());
    } catch (err) {
      this.releaseAudio();
      this.emit({
        type: "error",
        stage: "mic",
        message: (err as Error).message,
      });
      this.setState("idle");
    }
  }

  private stopRecording(): void {
    this.pendingListen = false;

    if (this.recognition) {
      this.setState("thinking");
      const recog = this.recognition;
      this.recognition = null;
      this.releaseAudio();
      recog.stop();
      return;
    }

    if (this.recorder?.state === "recording") {
      this.setState("thinking");
      this.recorder.stop();
      return;
    }

    this.recorder = null;
  }
}
