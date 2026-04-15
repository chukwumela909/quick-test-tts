"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import VoiceOrb, { type OrbState } from "./VoiceOrb";
import { speak, stop as stopTTS } from "../lib/tts";
import { transcribe, loadModel, isModelReady, setProgressCallback } from "../lib/stt";

/* ── Silence-detection constants ─────────────────────── */
const SILENCE_THRESHOLD = 10; // average byte-frequency amplitude
const SILENCE_DURATION = 2000; // ms of quiet before auto-stop
const MAX_RECORD_MS = 30_000; // hard cap on recording length

interface VoiceModeProps {
  onVoiceMessage: (text: string) => void;
  agentSpeaking: boolean;
  agentText: string | null;
  onAgentFinished: () => void;
  active: boolean;
}

export default function VoiceMode({
  onVoiceMessage,
  agentSpeaking,
  agentText,
  onAgentFinished,
  active,
}: VoiceModeProps) {
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [firstVisit, setFirstVisit] = useState(true);
  const [modelStatus, setModelStatus] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0); // 0-1 for mic visualizer
  const [userTranscript, setUserTranscript] = useState<string | null>(null);
  const pendingListenRef = useRef(false);

  /* Refs for recording pipeline */
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const spokenTextRef = useRef<string | null>(null);

  /* ── Pre-load Whisper model on mount ─────────────── */
  useEffect(() => {
    if (isModelReady()) {
      setModelStatus("ready");
      return;
    }
    setModelStatus("downloading");
    setProgressCallback((info) => {
      if (info.status === "progress" && info.progress != null) {
        setModelStatus(`downloading ${Math.round(info.progress)}%`);
      } else if (info.status === "ready") {
        setModelStatus("ready");
      }
    });
    loadModel()
      .then(() => {
        setModelStatus("ready");
        if (pendingListenRef.current) {
          pendingListenRef.current = false;
          startListening();
        }
      })
      .catch((err) => {
        console.warn("Whisper model preload failed:", err);
        setModelStatus("failed");
      })
      .finally(() => setProgressCallback(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dismiss first-visit animation after it plays
  useEffect(() => {
    if (firstVisit) {
      const t = setTimeout(() => setFirstVisit(false), 1200);
      return () => clearTimeout(t);
    }
  }, [firstVisit]);

  /* ── Tear down recording cleanly ─────────────────── */
  const cleanupRecording = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    clearTimeout(maxTimerRef.current);
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  // When mode switches away, stop everything
  useEffect(() => {
    if (!active) {
      cleanupRecording();
      stopTTS();
      setOrbState("idle");
    }
  }, [active, cleanupRecording]);

  // When streaming finishes (agentSpeaking goes false & we have text), play TTS
  useEffect(() => {
    if (!agentSpeaking && orbState === "thinking" && agentText) {
      if (spokenTextRef.current === agentText) return;
      spokenTextRef.current = agentText;
      setOrbState("speaking");
      speak(agentText)
        .catch((err) => {
          // TTS server down — skip audio, just return to idle
          console.warn("TTS unavailable, skipping:", err.message);
        })
        .finally(() => {
          setOrbState("idle");
          onAgentFinished();
        });
    }
  }, [agentSpeaking, agentText, orbState, onAgentFinished]);

  /* ── Start recording via MediaRecorder + silence VAD ── */
  const startListening = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Release mic immediately
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        audioCtxRef.current?.close().catch(() => {});
        audioCtxRef.current = null;

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        if (blob.size === 0) {
          setOrbState("idle");
          return;
        }

        // Transcribe with Whisper
        try {
          setTranscribing(true);
          const text = await transcribe(blob);
          setTranscribing(false);
          if (text) {
            setUserTranscript(text);
            spokenTextRef.current = null;
            onVoiceMessage(text);
            // stay "thinking" — agent will stream, then TTS fires
          } else {
            setOrbState("idle");
          }
        } catch (err) {
          console.error("Whisper transcription failed:", err);
          setTranscribing(false);
          setOrbState("idle");
        }
      };

      /* Silence detection via AnalyserNode */
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const sourceNode = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      sourceNode.connect(analyser);
      const freqData = new Uint8Array(analyser.frequencyBinCount);
      let silenceStart = 0;

      const checkSilence = () => {
        if (!recorderRef.current || recorderRef.current.state !== "recording") return;
        analyser.getByteFrequencyData(freqData);
        const avg = freqData.reduce((a, b) => a + b, 0) / freqData.length;

        // Update visual level (normalize 0-80 range to 0-1)
        setAudioLevel(Math.min(1, avg / 80));

        if (avg < SILENCE_THRESHOLD) {
          if (!silenceStart) silenceStart = Date.now();
          else if (Date.now() - silenceStart > SILENCE_DURATION) {
            setAudioLevel(0);
            stopRecording();
            return;
          }
        } else {
          silenceStart = 0;
        }
        rafRef.current = requestAnimationFrame(checkSilence);
      };

      recorder.start();
      setOrbState("listening");
      setUserTranscript(null);
      rafRef.current = requestAnimationFrame(checkSilence);

      // Hard time limit
      maxTimerRef.current = setTimeout(() => stopRecording(), MAX_RECORD_MS);
    } catch (err) {
      console.error("Microphone access denied:", err);
      setOrbState("idle");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onVoiceMessage]);

  /* ── Stop recording → triggers onstop → transcribe ── */
  const stopRecording = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    clearTimeout(maxTimerRef.current);
    if (recorderRef.current?.state === "recording") {
      setOrbState("thinking");
      recorderRef.current.stop();
    }
    recorderRef.current = null;
  }, []);

  const handleTap = useCallback(() => {
    if (orbState === "idle") {
      if (!isModelReady()) {
        // Model still loading — queue listen for when it's ready
        pendingListenRef.current = true;
        return;
      }
      startListening();
    } else if (orbState === "listening") {
      stopRecording();
    }
  }, [orbState, startListening, stopRecording]);

  const handleDoubleTap = useCallback(() => {
    cleanupRecording();
    stopTTS();
    setOrbState("idle");
    if (orbState === "speaking") {
      onAgentFinished();
    }
  }, [orbState, onAgentFinished, cleanupRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRecording();
      stopTTS();
    };
  }, [cleanupRecording]);

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6">
      {/* Full-screen waveform lines (speaking state) */}
      {orbState === "speaking" && (
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

      {/* User transcript (what you said) */}
      {userTranscript && orbState !== "idle" && (
        <div
          className="absolute top-8 left-6 right-6 text-center"
          style={{ fontFamily: "var(--font-geist-mono)" }}
        >
          <p className="text-[10px] uppercase tracking-[0.2em] mb-2" style={{ color: "#555" }}>
            YOU SAID
          </p>
          <p className="text-sm text-white/80 leading-relaxed">
            &ldquo;{userTranscript}&rdquo;
          </p>
        </div>
      )}

      {/* Orb + audio visualizer */}
      <div
        className={firstVisit ? "orb-entrance" : ""}
        style={{ marginTop: "-5vh" }}
      >
        {/* Audio level ring around orb while listening */}
        {orbState === "listening" && (
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
                boxShadow: audioLevel > 0.1
                  ? `0 0 ${audioLevel * 40}px rgba(255, 255, 255, ${audioLevel * 0.3})`
                  : "none",
              }}
            />
          </div>
        )}

        <VoiceOrb
          state={orbState}
          onTap={handleTap}
          onDoubleTap={handleDoubleTap}
        />

        {/* Audio level bars while listening */}
        {orbState === "listening" && (
          <div className="flex items-end justify-center gap-[4px] h-10 mt-3">
            {Array.from({ length: 9 }).map((_, i) => {
              const dist = Math.abs(i - 4);
              const barLevel = Math.max(0.08, audioLevel * (1 - dist * 0.12));
              return (
                <div
                  key={i}
                  className="w-[4px] rounded-full"
                  style={{
                    height: `${barLevel * 100}%`,
                    backgroundColor: audioLevel > 0.05 ? "#fff" : "#333",
                    transition: "height 75ms ease-out, background-color 150ms",
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Status area below the orb */}
      <div
        className="mt-4 text-center min-h-[60px]"
        style={{ fontFamily: "var(--font-geist-mono)" }}
      >
        {/* Model loading */}
        {modelStatus && modelStatus !== "ready" && (
          <p className="text-xs tracking-[0.2em] uppercase" style={{ color: "#666" }}>
            {modelStatus === "failed"
              ? "MODEL LOAD FAILED — TAP TO RETRY"
              : modelStatus.startsWith("downloading")
                ? `LOADING VOICE MODEL... ${modelStatus.replace("downloading ", "")}`
                : "LOADING VOICE MODEL..."}
          </p>
        )}

        {/* Transcribing */}
        {transcribing && (
          <p className="text-xs tracking-[0.2em] uppercase animate-pulse" style={{ color: "#999" }}>
            PROCESSING SPEECH...
          </p>
        )}

        {/* Waiting for agent */}
        {orbState === "thinking" && !transcribing && (
          <p className="text-xs tracking-[0.2em] uppercase" style={{ color: "#999" }}>
            WAITING FOR AGENT...
          </p>
        )}

        {/* Agent response text (streaming or final) */}
        {(orbState === "thinking" || orbState === "speaking") && agentText && !transcribing && (
          <div className="mt-3 max-h-[120px] overflow-y-auto">
            <p className="text-[10px] uppercase tracking-[0.2em] mb-1" style={{ color: "#555" }}>
              AGENT
            </p>
            <p className="text-xs text-white/60 leading-relaxed">
              {agentText.length > 200 ? agentText.slice(0, 200) + "..." : agentText}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
