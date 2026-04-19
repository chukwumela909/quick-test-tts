"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useLayoutEffect,
} from "react";
import VoiceOrb from "./VoiceOrb";
import MessageContent from "./MessageContent";
import type { Message } from "../lib/chat-engine";

interface ChatModeProps {
  messages: Message[];
  streamingContent: string | null;
  agentName: string;
  modelReady: boolean;
  onSendMessage: (text: string) => void;
  onSwitchToVoice: () => void;
  onStopGenerating?: () => void;
  onRegenerate?: (messageId: string) => void;
}

const STARTER_PROMPTS = [
  "Explain a concept like I'm five",
  "Draft a polite follow-up email",
  "Compare two options as a table",
  "Help me debug a code snippet",
];

const COMPOSER_MAX_HEIGHT_PX = 160;

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [text]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="msg-action-btn"
      aria-label="Copy message"
    >
      {copied ? "COPIED" : "COPY"}
    </button>
  );
}

function RegenerateButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="msg-action-btn"
      aria-label="Regenerate response"
    >
      ↻ REGEN
    </button>
  );
}

export default function ChatMode({
  messages,
  streamingContent,
  agentName,
  modelReady,
  onSendMessage,
  onSwitchToVoice,
  onStopGenerating,
  onRegenerate,
}: ChatModeProps) {
  const [input, setInput] = useState("");
  const [userScrolled, setUserScrolled] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isStreaming = streamingContent !== null;
  const hasContent = messages.length > 0 || isStreaming;

  // When the user switches conversations the messages array reference flips
  // but its first-message id changes. Reset scroll-tracking state so a
  // stale "scrolled away" flag from the previous thread doesn't leave the
  // jump-to-latest chip stuck on screen.
  const firstMessageId = messages[0]?.id ?? null;
  useEffect(() => {
    userScrolledRef.current = false;
    setUserScrolled(false);
  }, [firstMessageId]);

  // Auto-scroll thread to bottom when new content arrives unless the user
  // has manually scrolled away.
  useEffect(() => {
    if (!userScrolledRef.current && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const handleScroll = useCallback(() => {
    if (!threadRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = threadRef.current;
    const away = scrollHeight - scrollTop - clientHeight > 64;
    userScrolledRef.current = away;
    setUserScrolled(away);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
    userScrolledRef.current = false;
    setUserScrolled(false);
  }, []);

  // Auto-grow the composer up to the cap, then let it scroll internally.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
  }, [input]);

  const handleSend = useCallback(
    (textOverride?: string) => {
      const trimmed = (textOverride ?? input).trim();
      if (!trimmed) return;
      onSendMessage(trimmed);
      if (textOverride === undefined) setInput("");
      userScrolledRef.current = false;
      setUserScrolled(false);
    },
    [input, onSendMessage]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Don't send mid-IME composition (e.g. Japanese / Chinese input).
      if (
        e.key === "Enter" &&
        !e.shiftKey &&
        !e.nativeEvent.isComposing
      ) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Find the most recent agent message — used to gate the REGEN button so it
  // only appears on the trailing agent reply when nothing is streaming.
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const canRegenerate =
    !!onRegenerate &&
    !isStreaming &&
    !!lastMessage &&
    lastMessage.role === "agent" &&
    !!lastMessage.content;

  return (
    <div className="relative flex flex-1 flex-col">
      {/* Top bar */}
      <div className="glass-surface flex-shrink-0 px-[12px] pt-[12px] pb-[6px] border-b border-white/5">
        <div
          className="font-mono text-[14px] uppercase text-white"
          style={{ letterSpacing: "1.4px" }}
        >
          {agentName}
        </div>
        <div
          className={`font-mono text-[12px] uppercase ${modelReady ? "text-secondary" : "text-yellow-500 animate-pulse"}`}
          style={{ letterSpacing: "1.2px" }}
        >
          {modelReady ? "ONLINE" : "LOADING..."}
        </div>
      </div>

      {/* Message thread */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={threadRef}
          onScroll={handleScroll}
          className="absolute inset-0 overflow-y-auto px-[12px] py-[12px]"
          style={{ scrollBehavior: "smooth" }}
        >
          {!hasContent && (
            <div className="flex h-full flex-col items-center justify-center gap-[16px] px-[12px]">
              <span
                className="font-mono text-[12px] uppercase text-secondary"
                style={{ letterSpacing: "1.2px" }}
              >
                START A CONVERSATION
              </span>
              <div className="flex flex-wrap justify-center gap-[8px] max-w-[420px]">
                {STARTER_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handleSend(p)}
                    className="starter-chip"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => {
            const isAgent = msg.role === "agent";
            const isLast = i === messages.length - 1;
            const showRegen = isAgent && isLast && canRegenerate;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  isAgent ? "items-start msg-row-agent" : "items-end"
                } ${i > 0 ? "mt-[12px]" : ""}`}
              >
                {msg.source === "voice" && (
                  <span
                    className="font-mono text-[10px] uppercase text-secondary mb-[4px]"
                    style={{ letterSpacing: "1px" }}
                  >
                    MIC
                  </span>
                )}

                <div
                  className={`rounded-[10px] px-[14px] py-[8px] font-sans text-[16px] leading-[1.5] ${
                    isAgent
                      ? "bubble-agent text-white max-w-[75%]"
                      : "bubble-user text-white max-w-[70%]"
                  }`}
                >
                  {msg.type === "media" && msg.mediaUrl && (
                    <div className="mb-[6px] rounded-[6px] overflow-hidden">
                      <div className="bg-secondary/20 h-[160px] flex items-center justify-center">
                        <span className="font-mono text-[12px] uppercase text-secondary">
                          IMAGE
                        </span>
                      </div>
                    </div>
                  )}
                  {isAgent ? (
                    msg.interrupted && msg.spokenContent ? (
                      <>
                        <MessageContent content={msg.spokenContent} />
                        {msg.content.length > msg.spokenContent.length && (
                          <div style={{ color: "#666666", marginTop: 4 }}>
                            <MessageContent
                              content={
                                "— " +
                                msg.content
                                  .slice(msg.spokenContent.length)
                                  .trimStart()
                              }
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      <MessageContent content={msg.content} />
                    )
                  ) : (
                    <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
                  )}
                </div>

                <div
                  className={`mt-[4px] flex items-center gap-[8px] ${
                    isAgent ? "" : "flex-row-reverse"
                  }`}
                >
                  <span
                    className="font-mono text-[12px] text-secondary"
                    style={{ letterSpacing: "1.2px" }}
                  >
                    {formatTime(msg.timestamp)}
                  </span>
                  {isAgent && msg.content && <CopyButton text={msg.content} />}
                  {showRegen && onRegenerate && (
                    <RegenerateButton onClick={() => onRegenerate(msg.id)} />
                  )}
                </div>
              </div>
            );
          })}

          {isStreaming && (
            <div className="flex flex-col items-start mt-[12px]">
              <div className="bubble-agent text-white max-w-[75%] rounded-[10px] px-[14px] py-[8px] font-sans text-[16px] leading-[1.5]">
                {streamingContent ? (
                  <MessageContent content={streamingContent} streaming />
                ) : (
                  <span
                    className="font-mono text-[12px] text-secondary"
                    style={{ letterSpacing: "1.2px" }}
                  >
                    THINKING
                  </span>
                )}
                <span className="streaming-cursor" />
              </div>
              {onStopGenerating && (
                <button
                  type="button"
                  onClick={onStopGenerating}
                  className="stop-btn mt-[8px]"
                  aria-label="Stop generating"
                >
                  ■ STOP
                </button>
              )}
            </div>
          )}
        </div>

        {/* Floating jump-to-latest chip */}
        {userScrolled && hasContent && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="jump-latest-btn"
            aria-label="Jump to latest message"
          >
            ↓ LATEST
          </button>
        )}
      </div>

      {/* Composer */}
      <div className="glass-surface flex-shrink-0 flex items-end gap-[12px] px-[12px] py-[8px] border-t border-white/5">
        <div className="pb-[2px]">
          <VoiceOrb
            state="idle"
            onTap={onSwitchToVoice}
            onDoubleTap={onSwitchToVoice}
            compact
          />
        </div>

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="TYPE MESSAGE..."
          className="composer-textarea flex-1 bg-white/[0.03] border border-white/15 rounded-[10px] px-[14px] py-[8px]
                     font-mono text-[12px] uppercase text-white placeholder:text-secondary
                     outline-none focus:border-white/60 focus:bg-white/[0.06]
                     transition-colors duration-250 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]
                     resize-none"
          style={{
            letterSpacing: "1.2px",
            minHeight: "40px",
            maxHeight: `${COMPOSER_MAX_HEIGHT_PX}px`,
            lineHeight: "1.4",
          }}
        />

        <button
          onClick={() => handleSend()}
          className={`flex-shrink-0 rounded-[9999px] border border-white px-[12px] py-[6px]
                      font-mono text-[14px] text-white bg-transparent cursor-pointer
                      transition-opacity duration-150 mb-[2px]
                      ${input.trim() ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          aria-label="Send message"
        >
          →
        </button>
      </div>
    </div>
  );
}
