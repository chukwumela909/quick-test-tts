"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import VoiceOrb from "./VoiceOrb";
import type { Message } from "../lib/chat-engine";

interface ChatModeProps {
  messages: Message[];
  streamingContent: string | null;
  agentName: string;
  modelReady: boolean;
  onSendMessage: (text: string) => void;
  onSwitchToVoice: () => void;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ChatMode({
  messages,
  streamingContent,
  agentName,
  modelReady,
  onSendMessage,
  onSwitchToVoice,
}: ChatModeProps) {
  const [input, setInput] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!userScrolledRef.current && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const handleScroll = useCallback(() => {
    if (!threadRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = threadRef.current;
    userScrolledRef.current = scrollHeight - scrollTop - clientHeight > 64;
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInput("");
    userScrolledRef.current = false;
  }, [input, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="flex flex-1 flex-col bg-black">
      {/* Top bar */}
      <div className="flex-shrink-0 px-[12px] pt-[12px] pb-[6px]">
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
      <div
        ref={threadRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-[12px] py-[12px]"
        style={{ scrollBehavior: "smooth" }}
      >
        {messages.length === 0 && streamingContent === null && (
          <div className="flex h-full items-center justify-center">
            <span
              className="font-mono text-[12px] uppercase text-secondary"
              style={{ letterSpacing: "1.2px" }}
            >
              START A CONVERSATION
            </span>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={msg.id}
            className={`flex flex-col ${
              msg.role === "user" ? "items-end" : "items-start"
            } ${i > 0 ? "mt-[12px]" : ""}`}
          >
            {/* Voice transcript label */}
            {msg.source === "voice" && (
              <span
                className="font-mono text-[10px] uppercase text-secondary mb-[4px]"
                style={{ letterSpacing: "1px" }}
              >
                MIC
              </span>
            )}

            {/* Message bubble */}
            <div
              className={`rounded-[6px] px-[12px] py-[6px] font-sans text-[16px] leading-[1.5] ${
                msg.role === "user"
                  ? "border border-secondary text-white max-w-[70%]"
                  : "text-white max-w-[75%]"
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
              {msg.content}
            </div>

            {/* Timestamp */}
            <span
              className="font-mono text-[12px] text-secondary mt-[4px]"
              style={{ letterSpacing: "1.2px" }}
            >
              {formatTime(msg.timestamp)}
            </span>
          </div>
        ))}

        {/* Streaming message */}
        {streamingContent !== null && (
          <div className="flex flex-col items-start mt-[12px]">
            <div className="text-white max-w-[75%] rounded-[6px] px-[12px] py-[6px] font-sans text-[16px] leading-[1.5]">
              <span>{streamingContent}</span>
              <span className="streaming-cursor" />
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 flex items-center gap-[12px] px-[12px] py-[6px]">
        {/* Small orb */}
        <VoiceOrb
          state="idle"
          onTap={onSwitchToVoice}
          onDoubleTap={onSwitchToVoice}
          compact
        />

        {/* Text input */}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="TYPE MESSAGE..."
          className="flex-1 bg-black border border-secondary rounded-[6px] px-[12px] py-[6px]
                     font-mono text-[12px] uppercase text-white placeholder:text-secondary
                     outline-none focus:border-white transition-colors duration-250"
          style={{ letterSpacing: "1.2px", height: "40px" }}
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          className={`flex-shrink-0 rounded-[9999px] border border-white px-[12px] py-[6px]
                      font-mono text-[14px] text-white bg-transparent cursor-pointer
                      transition-opacity duration-150
                      ${input.trim() ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          aria-label="Send message"
        >
          →
        </button>
      </div>
    </div>
  );
}
