/**
 * Browser-side Whisper STT using Transformers.js
 * Model: onnx-community/whisper-tiny (~40 MB, cached in IndexedDB after first load)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
let transcriber: any = null;
let loading: Promise<any> | null = null;

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
  return ((result as { text: string }).text ?? "").trim();
}
