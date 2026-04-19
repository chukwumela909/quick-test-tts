"use client";

import { useCallback, useEffect, useState } from "react";
import VoiceOrb from "./VoiceOrb";
import { useVoiceSession } from "../lib/use-voice-session";
import type { VoiceSession } from "../lib/voice-session";

interface VoiceModeProps {
  session: VoiceSession | null;
  agentText: string | null;
  active: boolean;
}

export default function VoiceMode({
  session,
  agentText,
  active,
}: VoiceModeProps) {
  const { state, audioLevel, userTranscript } = useVoiceSession(session);
  const [firstVisit, setFirstVisit] = useState(true);

  // Drive session active/inactive with the panel's active prop.
  useEffect(() => {
    session?.setActive(active);
  }, [session, active]);

  // Dismiss first-visit animation after it plays.
  useEffect(() => {
    if (!firstVisit) return;
    const t = setTimeout(() => setFirstVisit(false), 1200);
    return () => clearTimeout(t);
  }, [firstVisit]);

  const handleTap = useCallback(() => {
    session?.tap();
  }, [session]);

  const handleDoubleTap = useCallback(() => {
    session?.interrupt();
  }, [session]);

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6">
      {/* Full-screen waveform lines (speaking state) */}
      {state === "speaking" && (
        <div className="absolute inset-0 flex flex-col justify-center gap-3 px-12 pointer-events-none">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="waveform-line"
              style={{ animationDelay: `${i * 0.1}s` }}
            />
          ))}
        </div>
      )}

      {/* User transcript — what you just said (shown while listening/thinking) */}
      {userTranscript && (state === "listening" || state === "thinking") && (
        <div className="absolute top-8 left-6 right-6 text-center">
          <p className="text-sm text-white/80 leading-relaxed">
            {userTranscript}
          </p>
        </div>
      )}

      {/* Orb + audio visualizer */}
      <div
        className={firstVisit ? "orb-entrance" : ""}
        style={{ marginTop: "-5vh" }}
      >
        {/* Audio level ring around orb while listening */}
        {state === "listening" && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ marginTop: "-5vh" }}
          >
            <div
              className="rounded-full border transition-all duration-100"
              style={{
                width: `${200 + audioLevel * 80}px`,
                height: `${200 + audioLevel * 80}px`,
                borderColor: `rgba(255, 255, 255, ${0.1 + audioLevel * 0.5})`,
                boxShadow:
                  audioLevel > 0.1
                    ? `0 0 ${audioLevel * 40}px rgba(255, 255, 255, ${audioLevel * 0.3})`
                    : "none",
              }}
            />
          </div>
        )}

        <VoiceOrb
          state={state}
          onTap={handleTap}
          onDoubleTap={handleDoubleTap}
        />
      </div>

      {/* Agent text — only while actively speaking */}
      {state === "speaking" && agentText && (
        <div className="absolute bottom-16 left-6 right-6 max-h-40 overflow-y-auto text-center">
          <p className="text-sm text-white/80 leading-relaxed">
            {agentText}
          </p>
        </div>
      )}

      {/* Idle hint — wake word + tap affordance */}
      {state === "idle" && (
        <div className="absolute bottom-16 left-6 right-6 text-center pointer-events-none">
          <p className="text-xs text-white/50 leading-relaxed">
            Say <span className="text-white/80">&ldquo;Hello Vivid&rdquo;</span> or tap to talk
          </p>
        </div>
      )}
    </div>
  );
}
