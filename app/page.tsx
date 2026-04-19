"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import VoiceMode from "./components/VoiceMode";
import ChatMode from "./components/ChatMode";
import ConversationDrawer from "./components/ConversationDrawer";
import Settings from "./components/Settings";
import {
  type Message,
  type Conversation,
  type MessageSource,
  createMessage,
  createConversation,
  loadConversations,
  addMessage,
  deleteMessage,
  loadActiveConversationId,
  saveActiveConversationId,
  buildLlmHistory,
  buildInterruptionNote,
} from "./lib/chat-engine";
import { type AgentPersona, loadPersona, DEFAULT_PERSONA } from "./lib/persona";
import { VoiceSession } from "./lib/voice-session";

type Mode = "voice" | "chat";

const SWIPE_THRESHOLD = 80;
const AXIS_LOCK_DISTANCE = 10;
const RUBBER_BAND = 0.2;
const SNAP_MS = 400;

export default function Home() {
  /* ── Core state ─────────────────────────────────────── */
  const [mode, setMode] = useState<Mode>("voice");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [persona, setPersona] = useState<AgentPersona>(DEFAULT_PERSONA);

  /* ── Overlay state ──────────────────────────────────── */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsClosing, setSettingsClosing] = useState(false);

  /* ── Streaming state ────────────────────────────────── */
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [lastAgentText, setLastAgentText] = useState<string | null>(null);
  const [session, setSession] = useState<VoiceSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  // Live context of the currently-streaming agent turn, exposed so the
  // VoiceSession.onInterrupted callback can commit the partial agent message
  // synchronously the instant a barge-in occurs — without racing the new
  // turn that startListening kicks off. Cleared when the stream ends or is
  // committed by the interruption path.
  const activeStreamRef = useRef<{
    conversationId: string;
    getFullText: () => string;
    committed: boolean;
  } | null>(null);
  const personaRef = useRef<AgentPersona>(persona);
  const handleUserMessageRef = useRef<
    (text: string, source: MessageSource) => void
  >(() => {});

  useEffect(() => {
    personaRef.current = persona;
  }, [persona]);

  /* ── Conversations ref (avoids stale closures) ─────── */
  const conversationsRef = useRef(conversations);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  /* ── Drag gesture refs ──────────────────────────────── */
  const sliderRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragAxisRef = useRef<"x" | "y" | null>(null);
  const dragDeltaRef = useRef({ x: 0, y: 0 });
  const wasDraggingRef = useRef(false);
  const modeRef = useRef<Mode>(mode);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  /* ── Hydration: load persisted data ─────────────────── */
  useEffect(() => {
    async function init() {
      const loaded = await loadConversations();
      const savedId = loadActiveConversationId();
      if (loaded.length === 0) {
        const fresh = await createConversation();
        setConversations([fresh]);
        setActiveId(fresh.id);
        saveActiveConversationId(fresh.id);
      } else {
        setConversations(loaded);
        setActiveId(
          savedId && loaded.find((c) => c.id === savedId) ? savedId : loaded[0].id
        );
      }
      setPersona(await loadPersona());
    }
    init();
  }, []);

  /* ── Model warmup: preload on mount + periodic ping ── */
  const warmupDoneRef = useRef(false);
  const warmupPromiseRef = useRef<Promise<void> | null>(null);
  const [modelReady, setModelReady] = useState(false);

  useEffect(() => {
    // Warmup with retry — model loading can take time
    let cancelled = false;
    const doWarmup = async (retries = 3): Promise<void> => {
      for (let i = 0; i < retries; i++) {
        if (cancelled) return;
        try {
          const res = await fetch("/api/warmup", { method: "POST" });
          if (res.ok) {
            warmupDoneRef.current = true;
            if (!cancelled) setModelReady(true);
            return;
          }
        } catch {
          // Retry on network error
        }
        // Wait 2s before retry (except on last attempt)
        if (i < retries - 1) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      // Allow messaging even if all retries fail
      warmupDoneRef.current = true;
      if (!cancelled) setModelReady(true);
    };

    warmupPromiseRef.current = doWarmup();

    // Keep model warm every 25 min (keep_alive is 30m)
    const interval = setInterval(() => {
      fetch("/api/warmup", { method: "POST" }).catch(() => {});
    }, 25 * 60 * 1000);

    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  /* ── Derived: active conversation + messages ────────── */
  const activeConv = conversations.find((c) => c.id === activeId) ?? null;
  const messages: Message[] = activeConv?.messages ?? [];

  /* ── Helpers: update conversation in state + persist ── */
  const appendMessage = useCallback(
    (conversationId: string, message: Message) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, messages: [...c.messages, message], updatedAt: new Date() }
            : c
        )
      );
      // Fire-and-forget persist to Supabase
      addMessage(conversationId, message);
    },
    []
  );

  /* ── Stream agent response from the chat provider ────── */
  const streamAgentResponse = useCallback(
    async (
      conversationId: string,
      currentMessages: Message[],
      shouldSpeak: boolean
    ) => {
      // Abort any in-flight request
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      streamingRef.current = true;

      setStreamingContent("");
      setLastAgentText(null);

      // Build history for the API (last 10 messages for lower latency).
      // buildLlmHistory swaps interrupted agent messages' content for the
      // spokenContent so the model only sees what the user actually heard.
      const recent = currentMessages.slice(-10);
      const history = buildLlmHistory(recent);
      const interruptionNote = buildInterruptionNote(recent);

      // Auto-timeout after 30s
      const timeoutId = setTimeout(() => controller.abort(), 30_000);

      // Hoisted so the catch branch can persist whatever streamed so far
      // when the user barges in mid-reply.
      let fullText = "";
      // Publish a handle on this stream so onInterrupted can commit the
      // partial agent message synchronously. Cleared on natural completion,
      // by the interruption-commit path, or in the catch's non-abort branch.
      activeStreamRef.current = {
        conversationId,
        getFullText: () => fullText,
        committed: false,
      };
      const myStream = activeStreamRef.current;

      // Wait for warmup to finish so the model is loaded before first request
      if (!warmupDoneRef.current && warmupPromiseRef.current) {
        await warmupPromiseRef.current;
      }

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history,
            systemPrompt: personaRef.current.systemPrompt,
            mode: shouldSpeak ? "voice" : "text",
            interruptionNote: interruptionNote ?? undefined,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          throw new Error(err.error || `HTTP ${res.status}`);
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let ndjsonBuffer = "";
        // Offset into fullText up to which we've already dispatched TTS chunks.
        let spokenUpto = 0;
        let firstChunkFired = false;

        // Determine the next chunk of `fullText` to hand off to TTS.
        //
        // First chunk: emit on the FIRST phrase break (, ; : — . ! ? \n) once
        // we have at least ~20 characters. This shaves ~500–1500ms off TTFA
        // because Kokoro can start synthesizing while the LLM is still
        // producing the rest of the reply.
        //
        // Subsequent chunks: emit on the LAST sentence boundary seen. Longer
        // chunks preserve prosody and avoid chunk-boundary micro-gaps.
        const FIRST_MIN_CHARS = 15;
        const drainSpeakable = (
          text: string,
          from: number,
          first: boolean
        ): [string, number] => {
          const tail = text.slice(from);
          if (first) {
            // Emit at first phrase break past the minimum char threshold.
            const re = /[,;:\u2014.!?\n]/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(tail)) !== null) {
              const end = m.index + 1;
              if (end >= FIRST_MIN_CHARS) {
                return [tail.slice(0, end), from + end];
              }
            }
            return ["", from];
          }
          const re = /[^.!?\n]*[.!?\n]+(?:\s|$)/g;
          let lastEnd = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(tail)) !== null) {
            lastEnd = re.lastIndex;
          }
          if (lastEnd === 0) return ["", from];
          return [tail.slice(0, lastEnd), from + lastEnd];
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Parse the NDJSON stream returned by /api/chat
          ndjsonBuffer += decoder.decode(value, { stream: true });
          const lines = ndjsonBuffer.split("\n");
          ndjsonBuffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              const text = parsed.message?.content;
              if (text) fullText += text;
            } catch {
              // Incomplete JSON — skip
            }
          }

          // In voice turns the streaming text isn't rendered anywhere visible
          // (VoiceMode shows the final `lastAgentText`), so skip the state
          // update to avoid render churn that contends with the TTS pump.
          if (!shouldSpeak) setStreamingContent(fullText);

          // Pump complete chunks into the TTS queue as soon as they land.
          if (shouldSpeak && session) {
            const [chunk, nextUpto] = drainSpeakable(
              fullText,
              spokenUpto,
              !firstChunkFired
            );
            if (chunk) {
              session.speakChunk(chunk);
              spokenUpto = nextUpto;
              firstChunkFired = true;
            }
          }
        }

        // Process any remaining buffer
        if (ndjsonBuffer.trim()) {
          try {
            const parsed = JSON.parse(ndjsonBuffer);
            const text = parsed.message?.content;
            if (text) fullText += text;
          } catch {
            // Ignore
          }
        }

        // Commit final message
        clearTimeout(timeoutId);
        setStreamingContent(null);
        abortRef.current = null;
        streamingRef.current = false;

        // Interruption path may have already committed this turn; in that
        // case we just clean up state and return.
        if (myStream.committed) {
          if (activeStreamRef.current === myStream) activeStreamRef.current = null;
          return;
        }

        if (fullText.trim()) {
          const trimmed = fullText.trim();
          const agentMsg = createMessage("agent", trimmed, "text");
          appendMessage(conversationId, agentMsg);
          setLastAgentText(trimmed);
          if (shouldSpeak && session) {
            // Flush any trailing partial sentence into the queue.
            const remainder = fullText.slice(spokenUpto).trim();
            if (remainder) session.speakChunk(remainder);
            // Wait for all queued clips to finish so state returns to idle.
            void session.endSpeaking();
          }
        }
        if (activeStreamRef.current === myStream) activeStreamRef.current = null;
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        const aborted = (err as Error).name === "AbortError";
        if (aborted) {
          streamingRef.current = false;
          // The interruption-commit path (onInterrupted) already handled
          // persistence if it fired. If not, this is a non-interruption
          // abort (e.g. cancel via onCancel) — drop the partial.
          setStreamingContent(null);
          if (activeStreamRef.current === myStream) activeStreamRef.current = null;
          return;
        }
        console.error("Streaming error:", err);
        setStreamingContent(null);
        abortRef.current = null;
        streamingRef.current = false;

        // Show error as agent message
        const errorMsg = createMessage(
          "agent",
          `Error: ${(err as Error).message || "Failed to get response"}`,
          "text"
        );
        appendMessage(conversationId, errorMsg);
      }
    },
    [appendMessage, session]
  );

  /* ── Handle user message (voice or text) ────────────── */
  const handleUserMessage = useCallback(
    (text: string, source: MessageSource) => {
      const cid = activeId;
      if (!cid) return;

      // Prevent duplicate agent responses if already streaming
      if (streamingRef.current) {
        if (abortRef.current) abortRef.current.abort();
      }

      const userMsg = createMessage("user", text, source);
      appendMessage(cid, userMsg);

      // Read from ref to avoid stale closure on rapid sends
      const latestConv = conversationsRef.current.find((c) => c.id === cid);
      const updatedMessages = [...(latestConv?.messages ?? []), userMsg];
      const shouldSpeak = source === "voice";
      streamAgentResponse(cid, updatedMessages, shouldSpeak);
    },
    [activeId, appendMessage, streamAgentResponse]
  );

  // Keep a ref so the VoiceSession's onTranscript callback (created once) always
  // calls the latest handleUserMessage with current activeId/persona/etc.
  useEffect(() => {
    handleUserMessageRef.current = handleUserMessage;
  }, [handleUserMessage]);

  /* ── Regenerate the last agent reply ───────────────── */
  const handleRegenerate = useCallback(
    (messageId: string) => {
      const cid = activeId;
      if (!cid) return;
      // Refuse to regenerate while a stream is in flight — the user should
      // either let it finish or hit STOP first.
      if (streamingRef.current) return;

      const conv = conversationsRef.current.find((c) => c.id === cid);
      if (!conv) return;
      const last = conv.messages[conv.messages.length - 1];
      // Only the trailing agent reply is eligible. This keeps regenerate
      // strictly destructive (one row), no branch / cascade semantics.
      if (!last || last.id !== messageId || last.role !== "agent") return;

      const prefix = conv.messages.slice(0, -1);

      // Drop the trailing agent message from local state, then fire the DB
      // delete (best-effort — failures log a warning, do not block UI).
      setConversations((prev) =>
        prev.map((c) =>
          c.id === cid
            ? { ...c, messages: prefix, updatedAt: new Date() }
            : c
        )
      );
      void deleteMessage(cid, messageId);

      // Re-run the LLM with the same prior history. Regenerate is text-only;
      // voice barge-in already covers the spoken-mode equivalent.
      streamAgentResponse(cid, prefix, false);
    },
    [activeId, streamAgentResponse]
  );

  /* ── Voice session lifecycle ────────────────────────── */
  useEffect(() => {
    const s = new VoiceSession({
      onTranscript: (text) => {
        handleUserMessageRef.current(text, "voice");
      },
      onCancel: () => {
        abortRef.current?.abort();
      },
      onInterrupted: (spokenText) => {
        // Commit the partial agent message synchronously before any new turn
        // starts. Reading from activeStreamRef avoids racing the new
        // streamAgentResponse that startListening will eventually trigger.
        const stream = activeStreamRef.current;
        if (stream && !stream.committed) {
          stream.committed = true;
          const fullText = stream.getFullText().trim();
          const trimmed = fullText || spokenText;
          const agentMsg = createMessage("agent", trimmed, "text");
          agentMsg.spokenContent = spokenText;
          agentMsg.interrupted = true;
          appendMessage(stream.conversationId, agentMsg);
          setLastAgentText(trimmed);
        }
        // Aborting the in-flight LLM stream lets the catch branch unwind
        // quickly. The committed flag prevents double-persist.
        abortRef.current?.abort();
      },
    });
    setSession(s);
    return () => s.dispose();
  }, []);

  useEffect(() => {
    session?.setActive(mode === "voice");
  }, [session, mode]);

  /* ── Overlay helpers ────────────────────────────────── */
  const openDrawer = useCallback(() => {
    if (settingsOpen) return;
    setDrawerClosing(false);
    setDrawerOpen(true);
  }, [settingsOpen]);

  const closeDrawer = useCallback(() => {
    setDrawerClosing(true);
    setTimeout(() => {
      setDrawerOpen(false);
      setDrawerClosing(false);
    }, 400);
  }, []);

  const openSettings = useCallback(() => {
    if (drawerOpen) return;
    setSettingsClosing(false);
    setSettingsOpen(true);
  }, [drawerOpen]);

  const closeSettings = useCallback(() => {
    setSettingsClosing(true);
    setTimeout(() => {
      setSettingsOpen(false);
      setSettingsClosing(false);
    }, 300);
  }, []);

  /* ── Conversation management ────────────────────────── */
  const handleSelectConversation = useCallback(
    (id: string) => {
      setActiveId(id);
      saveActiveConversationId(id);
      closeDrawer();
    },
    [closeDrawer]
  );


  const handleNewConversation = useCallback(async () => {
    const fresh = await createConversation();
    setConversations((prev) => [fresh, ...prev]);
    setActiveId(fresh.id);
    saveActiveConversationId(fresh.id);
    closeDrawer();
  }, [closeDrawer]);

  /* ── Slider transform helpers ───────────────────────── */
  const setSliderPos = useCallback((x: number, animate: boolean) => {
    if (!sliderRef.current) return;
    sliderRef.current.style.transition = animate
      ? `transform ${SNAP_MS}ms cubic-bezier(0.25, 1, 0.5, 1)`
      : "none";
    sliderRef.current.style.transform = `translateX(${x}px)`;
  }, []);

  const getContainerWidth = useCallback(() => {
    return containerRef.current?.offsetWidth ?? window.innerWidth;
  }, []);

  const getBaseX = useCallback(() => {
    return modeRef.current === "voice" ? 0 : -getContainerWidth();
  }, [getContainerWidth]);

  /* ── Drag start / move / end ────────────────────────── */
  const handleDragStart = useCallback(
    (x: number, y: number) => {
      if (drawerOpen || settingsOpen) return;
      dragStartRef.current = { x, y };
      dragAxisRef.current = null;
      dragDeltaRef.current = { x: 0, y: 0 };
      // Disable transition so transform follows the finger exactly
      setSliderPos(getBaseX(), false);
    },
    [drawerOpen, settingsOpen, setSliderPos, getBaseX]
  );

  const handleDragMove = useCallback(
    (x: number, y: number) => {
      if (!dragStartRef.current) return;
      const dx = x - dragStartRef.current.x;
      const dy = y - dragStartRef.current.y;

      // Lock axis after small movement
      if (!dragAxisRef.current) {
        if (
          Math.abs(dx) > AXIS_LOCK_DISTANCE ||
          Math.abs(dy) > AXIS_LOCK_DISTANCE
        ) {
          dragAxisRef.current = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        } else return;
      }

      if (dragAxisRef.current === "x") {
        const ww = getContainerWidth();
        const base = getBaseX();
        let targetX = base + dx;

        // Rubber-band at edges (past voice=0 or past chat=-ww)
        if (targetX > 0) {
          targetX = targetX * RUBBER_BAND;
        } else if (targetX < -ww) {
          const excess = -ww - targetX;
          targetX = -ww - excess * RUBBER_BAND;
        }

        dragDeltaRef.current.x = dx;
        setSliderPos(targetX, false);
      }

      dragDeltaRef.current.y = dy;
    },
    [getBaseX, setSliderPos]
  );

  // Stable refs for overlay callbacks (used inside handleDragEnd to avoid re-registration)
  const openDrawerRef = useRef(openDrawer);
  openDrawerRef.current = openDrawer;
  const openSettingsRef = useRef(openSettings);
  openSettingsRef.current = openSettings;

  const handleDragEnd = useCallback(() => {
    if (!dragStartRef.current) return;
    const axis = dragAxisRef.current;
    const dx = dragDeltaRef.current.x;
    const dy = dragDeltaRef.current.y;

    wasDraggingRef.current = axis !== null;

    if (axis === "x") {
      const ww = getContainerWidth();
      let newMode = modeRef.current;
      if (dx < -SWIPE_THRESHOLD && modeRef.current === "voice") newMode = "chat";
      else if (dx > SWIPE_THRESHOLD && modeRef.current === "chat")
        newMode = "voice";

      const snapX = newMode === "voice" ? 0 : -ww;
      setSliderPos(snapX, true);
      if (newMode !== modeRef.current) setMode(newMode);
    } else if (axis === "y") {
      if (dy < -SWIPE_THRESHOLD) openDrawerRef.current();
      else if (dy > SWIPE_THRESHOLD) openSettingsRef.current();
    }

    dragStartRef.current = null;
    dragAxisRef.current = null;
    dragDeltaRef.current = { x: 0, y: 0 };
  }, [setSliderPos]);

  /* ── Pointer-down on container (start drag) ─────────── */
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = e.target as HTMLElement;
      const tag = el.tagName;
      // Don't start drag on interactive elements
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "BUTTON" ||
        el.closest("button") ||
        el.closest("input") ||
        el.closest("textarea")
      ) {
        return;
      }
      handleDragStart(e.clientX, e.clientY);
    },
    [handleDragStart]
  );

  /* ── Window-level pointermove / pointerup ───────────── */
  const dragMoveRef = useRef(handleDragMove);
  dragMoveRef.current = handleDragMove;
  const dragEndRef = useRef(handleDragEnd);
  dragEndRef.current = handleDragEnd;

  useEffect(() => {
    const onMove = (e: PointerEvent) => dragMoveRef.current(e.clientX, e.clientY);
    const onUp = () => dragEndRef.current();

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  /* ── Prevent click from firing after a drag ─────────── */
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (wasDraggingRef.current) {
      e.stopPropagation();
      e.preventDefault();
      wasDraggingRef.current = false;
    }
  }, []);

  /* ── Snap slider on window resize ───────────────────── */
  useEffect(() => {
    const onResize = () => {
      if (!dragStartRef.current && sliderRef.current) {
        const x = modeRef.current === "voice" ? 0 : -(containerRef.current?.offsetWidth ?? window.innerWidth);
        sliderRef.current.style.transition = "none";
        sliderRef.current.style.transform = `translateX(${x}px)`;
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* ── Cleanup streaming on unmount ───────────────────── */
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return (
    <div className="flex-1 bg-black flex justify-center overflow-hidden">
      <div
        ref={containerRef}
        className="relative w-full max-w-2xl h-full flex flex-col overflow-hidden md:border-x md:border-border-dim"
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
      >
        {/* Ambient depth layers (behind everything) */}
        <div className="ambient-backdrop" aria-hidden />
        <div className="ambient-vignette" aria-hidden />
        <div className="ambient-grain" aria-hidden />

        {/* Mode indicator dots */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex gap-1.5">
        <div
          className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
            mode === "voice" ? "bg-white" : "bg-secondary"
          }`}
        />
        <div
          className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
            mode === "chat" ? "bg-white" : "bg-secondary"
          }`}
        />
      </div>

      {/* Chat-mode nav (settings & history buttons) */}
      {mode === "chat" && !drawerOpen && !settingsOpen && (
        <div className="absolute top-3 z-30 flex w-full justify-between px-4">
          <button
            onClick={openDrawer}
            className="font-mono text-[10px] text-secondary uppercase transition-colors hover:text-white"
            style={{ letterSpacing: "1.2px" }}
          >
            HISTORY
          </button>
          <button
            onClick={openSettings}
            className="font-mono text-[10px] text-secondary uppercase transition-colors hover:text-white"
            style={{ letterSpacing: "1.2px" }}
          >
            SETTINGS
          </button>
        </div>
      )}

      {/* ── Horizontal slider — both modes side-by-side ── */}
      <div
        ref={sliderRef}
        className="relative z-10 flex flex-1 min-h-0"
        style={{
          width: "200%",
          willChange: "transform",
          transform: "translateX(0px)",
        }}
      >
        {/* Voice panel */}
        <div
          className="flex h-full"
          style={{
            width: "50%",
            flexShrink: 0,
            touchAction: "none",
            pointerEvents: mode === "voice" ? "auto" : "none",
          }}
        >
          <VoiceMode
            session={session}
            agentText={lastAgentText}
            active={mode === "voice"}
          />
        </div>

        {/* Chat panel */}
        <div
          className="flex h-full"
          style={{
            width: "50%",
            flexShrink: 0,
            touchAction: "pan-y",
            pointerEvents: mode === "chat" ? "auto" : "none",
          }}
        >
          <ChatMode
            messages={messages}
            streamingContent={streamingContent}
            agentName={persona.name}
            modelReady={modelReady}
            onSendMessage={(text) => handleUserMessage(text, "text")}
            onSwitchToVoice={() => {
              setSliderPos(0, true);
              setMode("voice");
            }}
            onStopGenerating={() => {
              // Commit whatever has streamed so far before aborting, so the
              // user keeps the partial answer in their thread.
              const stream = activeStreamRef.current;
              if (stream && !stream.committed) {
                stream.committed = true;
                const partial = stream.getFullText().trim();
                if (partial) {
                  const agentMsg = createMessage("agent", partial, "text");
                  appendMessage(stream.conversationId, agentMsg);
                  setLastAgentText(partial);
                }
              }
              abortRef.current?.abort();
            }}
            onRegenerate={handleRegenerate}
          />
        </div>
      </div>

      {/* Bottom hint removed — voice screen is orb + transcripts only */}

      {/* Conversation drawer overlay */}
      {drawerOpen && (
        <ConversationDrawer
          conversations={conversations}
          onSelect={handleSelectConversation}
          onNew={handleNewConversation}
          onClose={closeDrawer}
          closing={drawerClosing}
        />
      )}

      {/* Settings overlay */}
      {settingsOpen && (
        <Settings
          onClose={closeSettings}
          closing={settingsClosing}
          onPersonaChange={setPersona}
        />
      )}
      </div>
    </div>
  );
}
