"use client";

import type { Conversation } from "../lib/chat-engine";
import { getConversationTitle, getRelativeTime, groupByDate } from "../lib/chat-engine";

interface ConversationDrawerProps {
  conversations: Conversation[];
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
  closing: boolean;
}

export default function ConversationDrawer({
  conversations,
  onSelect,
  onNew,
  onClose,
  closing,
}: ConversationDrawerProps) {
  const groups = groupByDate(conversations);

  return (
    <>
      {/* Scrim */}
      <div
        className={`absolute inset-0 bg-black/50 z-40 ${closing ? "fade-exit" : "fade-enter"}`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-50 bg-black border-t border-secondary
                    ${closing ? "drawer-exit" : "drawer-enter"}
                    h-[60vh] lg:h-[70vh] flex flex-col`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-[12px] py-[12px] flex-shrink-0">
          <span
            className="font-mono text-[14px] uppercase text-white"
            style={{ letterSpacing: "1.4px" }}
          >
            CONVERSATIONS
          </span>
          <button
            onClick={onClose}
            className="font-mono text-[14px] text-white cursor-pointer bg-transparent border-none"
            aria-label="Close drawer"
          >
            ✕
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto px-[12px]">
          {groups.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <span
                className="font-mono text-[12px] uppercase text-secondary"
                style={{ letterSpacing: "1.2px" }}
              >
                NO CONVERSATIONS YET
              </span>
            </div>
          )}

          {groups.map((group) => (
            <div key={group.label}>
              {/* Date group label */}
              <div
                className="font-mono text-[12px] uppercase text-secondary py-[6px]"
                style={{ letterSpacing: "1.2px" }}
              >
                [{group.label}]
              </div>

              {group.items.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => onSelect(conv.id)}
                  className="w-full text-left py-[12px] border-b border-border-dim cursor-pointer
                             bg-transparent hover:bg-white/5 transition-colors duration-150"
                >
                  <div
                    className="font-mono text-[14px] text-white truncate"
                    style={{ letterSpacing: "1.2px" }}
                  >
                    &quot;{getConversationTitle(conv)}&quot;
                  </div>
                  <div
                    className="font-mono text-[12px] text-secondary mt-[4px]"
                    style={{ letterSpacing: "1.2px" }}
                  >
                    You and Agent · {getRelativeTime(conv.updatedAt)}
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* New conversation button */}
        <div className="flex-shrink-0 flex justify-center px-[12px] py-[12px]">
          <button
            onClick={onNew}
            className="rounded-[9999px] border border-white px-[24px] py-[12px]
                       bg-transparent font-mono text-[14px] uppercase text-white cursor-pointer
                       transition-opacity duration-150 hover:opacity-75 active:opacity-60"
            style={{ letterSpacing: "1.4px" }}
          >
            NEW CONVERSATION
          </button>
        </div>
      </div>
    </>
  );
}
