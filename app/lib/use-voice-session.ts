"use client";

import { useSyncExternalStore } from "react";
import type {
  VoiceSession,
  VoiceSessionSnapshot,
} from "./voice-session";

const EMPTY_SNAPSHOT: VoiceSessionSnapshot = {
  state: "idle",
  modelStatus: "idle",
  modelProgress: undefined,
  audioLevel: 0,
  userTranscript: null,
};

/**
 * Subscribes to a VoiceSession and projects its snapshot into React. Returns
 * `EMPTY_SNAPSHOT` before the session has been created (first render while
 * page.tsx's session-init effect is still pending).
 */
export function useVoiceSession(
  session: VoiceSession | null
): VoiceSessionSnapshot {
  return useSyncExternalStore(
    (onChange) => (session ? session.subscribe(onChange) : () => {}),
    () => (session ? session.getSnapshot() : EMPTY_SNAPSHOT),
    () => EMPTY_SNAPSHOT
  );
}
