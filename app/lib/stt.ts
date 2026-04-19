/**
 * Browser-side Whisper STT using Transformers.js
 * Model: onnx-community/whisper-tiny (~40 MB, cached in IndexedDB after first load)
 */

type BrowserSpeechRecognitionAlternative = {
  transcript: string;
};

type BrowserSpeechRecognitionResult = {
  isFinal: boolean;
  length: number;
  0: BrowserSpeechRecognitionAlternative;
};

type BrowserSpeechRecognitionResultList = {
  length: number;
  [index: number]: BrowserSpeechRecognitionResult;
};

type BrowserSpeechRecognitionEvent = Event & {
  resultIndex: number;
  results: BrowserSpeechRecognitionResultList;
};

type BrowserSpeechRecognitionErrorEvent = Event & {
  error?: string;
  message?: string;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onend: ((event: Event) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let transcriber: any = null;
let loading: Promise<any> | null = null;

function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export type RealtimeTranscriptionSession = {
  stop: () => void;
  abort: () => void;
};

type RealtimeTranscriptionOptions = {
  onError: (error: Error) => void;
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
  language?: string;
};

export function supportsRealtimeTranscription(): boolean {
  return getSpeechRecognitionConstructor() !== null;
}

export function startRealtimeTranscription({
  onError,
  onFinal,
  onInterim,
  language = "en-US",
}: RealtimeTranscriptionOptions): RealtimeTranscriptionSession | null {
  const SpeechRecognition = getSpeechRecognitionConstructor();
  if (!SpeechRecognition) {
    return null;
  }

  const recognition = new SpeechRecognition();
  let aborted = false;
  let finalizedText = "";

  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = language;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let interimText = "";

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const transcript = result[0]?.transcript ?? "";

      if (result.isFinal) {
        finalizedText = normalizeTranscript(`${finalizedText} ${transcript}`);
      } else {
        interimText = `${interimText} ${transcript}`;
      }
    }

    onInterim(normalizeTranscript(`${finalizedText} ${interimText}`));
  };

  recognition.onerror = (event) => {
    if (aborted || event.error === "aborted") {
      return;
    }

    onError(new Error(event.message || event.error || "Speech recognition failed"));
  };

  recognition.onend = () => {
    if (aborted) {
      return;
    }

    const finalText = normalizeTranscript(finalizedText);
    onInterim(finalText);
    onFinal(finalText);
  };

  recognition.start();

  return {
    stop() {
      if (aborted) {
        return;
      }
      recognition.stop();
    },
    abort() {
      if (aborted) {
        return;
      }
      aborted = true;
      onInterim("");
      recognition.abort();
    },
  };
}

export type WakeWordListenerOptions = {
  /** Called with every final transcript chunk (continuous mode). */
  onTranscript: (text: string) => void;
  /** Called on unrecoverable errors (e.g. permission revoked). */
  onError?: (error: Error) => void;
  language?: string;
};

/**
 * Passive continuous SpeechRecognition used for wake-word detection while
 * the session is idle. Auto-restarts on `onend` since Chrome's implementation
 * stops itself every ~30s even with `continuous = true`. Only final results
 * are surfaced — interim chunks are unreliable for wake-word matching.
 *
 * Returns null if the browser lacks SpeechRecognition. The caller owns the
 * mic stream; this listener does NOT open its own.
 */
export function startWakeWordListener({
  onTranscript,
  onError,
  language = "en-US",
}: WakeWordListenerOptions): RealtimeTranscriptionSession | null {
  const SpeechRecognition = getSpeechRecognitionConstructor();
  if (!SpeechRecognition) return null;

  let aborted = false;
  let recognition: BrowserSpeechRecognition | null = null;

  const spawn = () => {
    if (aborted) return;
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = language;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result.isFinal) continue;
        const text = normalizeTranscript(result[0]?.transcript ?? "");
        if (text) onTranscript(text);
      }
    };
    rec.onerror = (event) => {
      // "no-speech" and "aborted" are normal lifecycle events — don't bubble.
      if (aborted) return;
      const err = event.error;
      if (err === "no-speech" || err === "aborted") return;
      if (err === "not-allowed" || err === "service-not-allowed") {
        aborted = true;
        onError?.(new Error(event.message || err));
        return;
      }
      // Transient: network, audio-capture, etc. Let onend restart us.
    };
    rec.onend = () => {
      if (aborted) return;
      // Auto-restart — Chrome silently ends continuous recognition every
      // ~30 s, and we want a persistent wake-word ear until explicitly
      // stopped by the state machine.
      try {
        spawn();
      } catch {
        /* if spawn fails, wake listener just goes dormant */
      }
    };

    try {
      rec.start();
      recognition = rec;
    } catch {
      // `start()` throws if a prior session hasn't fully ended yet. Retry on
      // next tick — onend of the prior session will have cleared by then.
      setTimeout(spawn, 100);
    }
  };

  spawn();

  return {
    stop() {
      if (aborted) return;
      aborted = true;
      try {
        recognition?.stop();
      } catch {
        /* ignore */
      }
    },
    abort() {
      if (aborted) return;
      aborted = true;
      try {
        recognition?.abort();
      } catch {
        /* ignore */
      }
    },
  };
}

async function getTranscriber() {
  if (transcriber) return transcriber;
  if (loading) return loading;

  loading = (async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const t = await pipeline(
      "automatic-speech-recognition",
      "onnx-community/whisper-tiny",
      {
        dtype: "fp32",
        progress_callback: (info: any) => {
          if (onProgress) onProgress(info);
        },
      },
    );
    transcriber = t;
    loading = null;
    return t;
  })();

  return loading;
}

/** Callback for model loading progress. */
export type ProgressCallback = (info: { status: string; progress?: number }) => void;

let onProgress: ProgressCallback | null = null;

/** Set a callback to receive download/load progress updates. */
export function setProgressCallback(cb: ProgressCallback | null): void {
  onProgress = cb;
}

/** Pre-download & cache the Whisper model so first transcription is fast. */
export async function loadModel(): Promise<void> {
  await getTranscriber();
}

/** Returns true once the model has been loaded into memory. */
export function isModelReady(): boolean {
  return transcriber !== null;
}

/**
 * Transcribe an audio Blob (webm, ogg, wav, etc.) → text.
 * Internally resamples to 16 kHz mono PCM for Whisper.
 */
export async function transcribe(audioBlob: Blob): Promise<string> {
  const t = await getTranscriber();

  const arrayBuffer = await audioBlob.arrayBuffer();

  // Decode into an AudioBuffer at the browser's native sample rate
  const tempCtx = new AudioContext();
  const decoded = await tempCtx.decodeAudioData(arrayBuffer);
  await tempCtx.close();

  // Resample to 16 kHz mono via OfflineAudioContext
  const TARGET_RATE = 16_000;
  const length = Math.ceil(decoded.duration * TARGET_RATE);
  const offlineCtx = new OfflineAudioContext(1, length, TARGET_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();
  const pcm = rendered.getChannelData(0);

  const result = await t(pcm);
  return normalizeTranscript((result as { text: string }).text ?? "");
}
