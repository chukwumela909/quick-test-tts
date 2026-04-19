/**
 * Sentence-streaming TTS queue (Kokoro backend).
 *
 * `speak(text)`   — classic one-shot. Flushes the queue and plays a single clip.
 * `enqueue(text)` — append a clip; synthesis and playback both stream so
 *                   audio begins on the first mp3 chunk. Clips play back-to-back
 *                   via MediaSource Extensions. Resolves when that clip ends.
 * `flush()`       — resolves when every currently-queued clip has finished.
 * `stop()`        — abort synthesis, stop playback, drop the queue.
 */

type TtsAudio = HTMLAudioElement & {
  _ttsUrl?: string;
  _ttsCleanup?: () => void;
};

type QueueItem = {
  text: string;
  audioPromise: Promise<TtsAudio>;
  abort: AbortController;
  done: Promise<void>;
  resolveDone: () => void;
  rejectDone: (err: unknown) => void;
};

let queue: QueueItem[] = [];
let currentAudio: TtsAudio | null = null;
let playLoop: Promise<void> | null = null;
// Chunks whose playback ran to completion since the last `stop()`/`speak()`
// reset. Used by VoiceSession to record what the user actually heard before
// a barge-in. Order matches enqueue order.
let spokenChunks: string[] = [];

const MSE_MIME = "audio/mpeg";
const canUseMse =
  typeof window !== "undefined" &&
  typeof window.MediaSource !== "undefined" &&
  window.MediaSource.isTypeSupported(MSE_MIME);

/**
 * Fetch mp3 from /api/tts and wrap it in an Audio element. When MSE is
 * available, appends bytes to a SourceBuffer as they arrive so playback
 * can start before synthesis completes. Falls back to a blob URL otherwise.
 */
async function synthesize(
  text: string,
  signal: AbortSignal
): Promise<TtsAudio> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) throw new Error(`TTS error: ${res.status}`);
  if (!res.body) throw new Error("TTS response has no body");

  if (!canUseMse) {
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url) as TtsAudio;
    audio._ttsUrl = url;
    return audio;
  }

  const mediaSource = new MediaSource();
  const audio = new Audio() as TtsAudio;
  const url = URL.createObjectURL(mediaSource);

  // IMPORTANT: attach the sourceopen listener BEFORE assigning src. Some
  // browsers can dispatch the event synchronously once the element has a
  // media source, and we'd miss it otherwise.
  const openPromise = new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      mediaSource.removeEventListener("sourceopen", onOpen);
      resolve();
    };
    mediaSource.addEventListener("sourceopen", onOpen);
    signal.addEventListener(
      "abort",
      () => reject(new DOMException("Aborted", "AbortError")),
      { once: true }
    );
  });
  audio.src = url;
  audio._ttsUrl = url;

  await openPromise;

  const sb = mediaSource.addSourceBuffer(MSE_MIME);
  const reader = res.body.getReader();

  // Pump chunks in the background. Playback can begin as soon as the first
  // buffer is appended; we don't await this whole loop.
  const pump = (async () => {
    try {
      while (true) {
        if (signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        await new Promise<void>((resolve, reject) => {
          const onEnd = () => {
            sb.removeEventListener("updateend", onEnd);
            sb.removeEventListener("error", onErr);
            resolve();
          };
          const onErr = () => {
            sb.removeEventListener("updateend", onEnd);
            sb.removeEventListener("error", onErr);
            reject(new Error("SourceBuffer error"));
          };
          sb.addEventListener("updateend", onEnd);
          sb.addEventListener("error", onErr);
          sb.appendBuffer(value);
        });
      }
      if (mediaSource.readyState === "open") {
        try {
          mediaSource.endOfStream();
        } catch {
          /* already ended */
        }
      }
    } catch {
      if (mediaSource.readyState === "open") {
        try {
          mediaSource.endOfStream("network");
        } catch {
          /* ignore */
        }
      }
    }
  })();

  audio._ttsCleanup = () => {
    try {
      reader.cancel().catch(() => {});
    } catch {
      /* ignore */
    }
    pump.catch(() => {});
  };
  return audio;
}

async function runPlayLoop(): Promise<void> {
  while (queue.length > 0) {
    const item = queue[0];
    try {
      const audio = await item.audioPromise;
      if (item.abort.signal.aborted) {
        audio._ttsCleanup?.();
        if (audio._ttsUrl) URL.revokeObjectURL(audio._ttsUrl);
        item.resolveDone();
        queue.shift();
        continue;
      }
      currentAudio = audio;
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("Audio playback failed"));
        audio.play().catch(reject);
      });
      audio._ttsCleanup?.();
      if (audio._ttsUrl) URL.revokeObjectURL(audio._ttsUrl);
      currentAudio = null;
      // Record only chunks that finished playback naturally — aborted clips
      // (handled in the abort-branch above) and errored clips (catch below)
      // never reach here.
      spokenChunks.push(item.text);
      item.resolveDone();
    } catch (err) {
      currentAudio = null;
      if (item.abort.signal.aborted) item.resolveDone();
      else item.rejectDone(err);
    }
    queue.shift();
  }
  playLoop = null;
}

/**
 * Append a sentence/chunk for back-to-back playback. Synthesis starts
 * immediately and begins streaming; playback happens in FIFO order.
 */
export function enqueue(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return Promise.resolve();

  const abort = new AbortController();
  let resolveDone!: () => void;
  let rejectDone!: (err: unknown) => void;
  const done = new Promise<void>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });

  const audioPromise = synthesize(trimmed, abort.signal);
  // Swallow unhandled rejection — play loop handles it.
  audioPromise.catch(() => {});

  queue.push({
    text: trimmed,
    audioPromise,
    abort,
    done,
    resolveDone,
    rejectDone,
  });

  if (!playLoop) playLoop = runPlayLoop();
  return done;
}

/** One-shot speak: flush any pending queue, play this text alone. */
export async function speak(text: string): Promise<void> {
  stop();
  return enqueue(text);
}

/**
 * Snapshot of chunks fully played since the last `stop()` or `speak()`.
 * VoiceSession reads this immediately before calling `stop()` during a
 * barge-in to know what the user actually heard.
 */
export function getSpokenChunks(): string[] {
  return spokenChunks.slice();
}

/** Wait for every currently-queued clip to finish playing. */
export async function flush(): Promise<void> {
  if (!queue.length) return;
  const last = queue[queue.length - 1];
  await last.done.catch(() => {});
}

/** Stop everything: abort pending synthesis, halt playback, drop the queue. */
export function stop(): void {
  // Reset spoken-chunks history. Any caller that needs the prior list must
  // read it via getSpokenChunks() BEFORE calling stop().
  spokenChunks = [];
  for (const item of queue) {
    item.abort.abort();
    // Resolve immediately; the play loop will see the abort flag and skip.
    item.resolveDone();
    item.audioPromise
      .then((a) => {
        a._ttsCleanup?.();
        if (a._ttsUrl) URL.revokeObjectURL(a._ttsUrl);
      })
      .catch(() => {});
  }
  queue = [];
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio._ttsCleanup?.();
    if (currentAudio._ttsUrl) URL.revokeObjectURL(currentAudio._ttsUrl);
    currentAudio = null;
  }
}

/** Whether audio is currently playing. */
export function isSpeaking(): boolean {
  return currentAudio !== null && !currentAudio.paused;
}
