let currentAudio: HTMLAudioElement | null = null;

/**
 * Send text to pocket-tts via our API proxy and play the audio.
 * Returns a promise that resolves when playback finishes.
 */
export async function speak(text: string): Promise<void> {
  stop();

  const form = new FormData();
  form.append("text", text);

  const res = await fetch("/api/tts", { method: "POST", body: form });
  if (!res.ok) throw new Error(`TTS error: ${res.status}`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;

  return new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      resolve();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      reject(new Error("Audio playback failed"));
    };
    audio.play().catch((err) => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      reject(err);
    });
  });
}

/** Stop any currently playing TTS audio. */
export function stop(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
}

/** Whether audio is currently playing. */
export function isSpeaking(): boolean {
  return currentAudio !== null && !currentAudio.paused;
}
