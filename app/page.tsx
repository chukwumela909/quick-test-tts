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
  loadActiveConversationId,
  saveActiveConversationId,
} from "./lib/chat-engine";
import { type AgentPersona, loadPersona, DEFAULT_PERSONA } from "./lib/persona";

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
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [lastAgentText, setLastAgentText] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  const personaRef = useRef<AgentPersona>(persona);

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

  /* ── Stream agent response from Ollama ───────────────── */
  const streamAgentResponse = useCallback(
    async (conversationId: string, currentMessages: Message[]) => {
      // Abort any in-flight request
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      streamingRef.current = true;

      setAgentSpeaking(true);
      setStreamingContent("");

      // Build history for the API (last 10 messages for lower latency)
      const history = currentMessages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Auto-timeout after 30s
      const timeoutId = setTimeout(() => controller.abort(), 30_000);

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
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          throw new Error(err.error || `HTTP ${res.status}`);
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        let ndjsonBuffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Parse NDJSON lines from Ollama passthrough
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

          // Update streaming UI directly — React 18 batches these automatically
          setStreamingContent(fullText);
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
        setAgentSpeaking(false);
        abortRef.current = null;
        streamingRef.current = false;

        if (fullText.trim()) {
          const agentMsg = createMessage("agent", fullText.trim(), "text");
          appendMessage(conversationId, agentMsg);
          setLastAgentText(fullText.trim());
        }
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        if ((err as Error).name === "AbortError") {
          streamingRef.current = false;
          return;
        }
        console.error("Streaming error:", err);
        setStreamingContent(null);
        setAgentSpeaking(false);
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
    [appendMessage]
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
      streamAgentResponse(cid, updatedMessages);
    },
    [activeId, appendMessage, streamAgentResponse]
  );

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
        className="flex flex-1 min-h-0"
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
            onVoiceMessage={(text) => handleUserMessage(text, "voice")}
            agentSpeaking={agentSpeaking}
            agentText={lastAgentText}
            onAgentFinished={() => {
              setAgentSpeaking(false);
              setLastAgentText(null);
            }}
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
          />
        </div>
      </div>

      {/* Bottom hint (voice mode only, no overlays) */}
      {mode === "voice" && !drawerOpen && !settingsOpen && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20">
          <span
            className="font-mono text-[10px] text-secondary uppercase"
            style={{ letterSpacing: "1.2px" }}
          >
            SWIPE LEFT FOR CHAT · UP FOR HISTORY
          </span>
        </div>
      )}

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
