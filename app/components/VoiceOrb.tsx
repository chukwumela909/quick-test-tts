"use client";

import { useCallback, useRef } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

interface VoiceOrbProps {
  state: OrbState;
  onTap: () => void;
  onDoubleTap: () => void;
  compact?: boolean;
}

export default function VoiceOrb({
  state,
  onTap,
  onDoubleTap,
  compact = false,
}: VoiceOrbProps) {
  const lastTapRef = useRef(0);

  const handleClick = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      onDoubleTap();
    } else {
      setTimeout(() => {
        if (Date.now() - lastTapRef.current >= 280) {
          onTap();
        }
      }, 300);
    }
    lastTapRef.current = now;
  }, [onTap, onDoubleTap]);

  if (compact) {
    return (
      <button
        onClick={onTap}
        className="orb-idle-pulse orb-surface flex-shrink-0 rounded-full border border-white
                   h-[48px] w-[48px] cursor-pointer transition-transform duration-150 active:scale-95"
        aria-label="Switch to voice mode"
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-[12px]">
      {/* Orb container (relative for overlays) */}
      <button
        type="button"
        className="orb-float relative h-[180px] w-[180px] md:h-[200px] md:w-[200px] lg:h-[240px] lg:w-[240px] bg-transparent border-none p-0"
        onClick={handleClick}
        style={{ cursor: "pointer" }}
      >
        {/* Core orb circle */}
        <div
          className={`orb-surface absolute inset-0 rounded-full border border-white transition-all duration-500 ${
            state === "idle" ? "orb-idle-pulse" : "orb-surface-active"
          }`}
        />

        {/* Listening: radiating arcs */}
        {state === "listening" && (
          <>
            <div className="listening-arc" />
            <div className="listening-arc" />
            <div className="listening-arc" />
            <div className="listening-arc" />
          </>
        )}

        {/* Thinking: orbiting dots */}
        {state === "thinking" && (
          <div className="thinking-orbit">
            <div className="thinking-dot" />
            <div className="thinking-dot" />
            <div className="thinking-dot" />
            <div className="thinking-dot" />
          </div>
        )}

        {/* Speaking: emanating concentric rings */}
        {state === "speaking" && (
          <>
            <div className="speaking-ring" />
            <div className="speaking-ring" />
            <div className="speaking-ring" />
            <div className="speaking-ring" />
          </>
        )}
      </button>
    </div>
  );
}
