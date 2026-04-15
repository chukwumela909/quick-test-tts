import { supabase } from "./supabase";

export type MessageSource = "voice" | "text";
export type MessageType = "text" | "media";
export type MessageRole = "user" | "agent";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  type: MessageType;
  source: MessageSource;
  timestamp: Date;
  mediaUrl?: string;
}

export interface Conversation {
  id: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

/* ── Row types from Supabase ─────────────────────────── */
interface ConversationRow {
  id: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  type: MessageType;
  source: MessageSource;
  media_url: string | null;
  created_at: string;
}

/* ── Helpers ──────────────────────────────────────────── */
function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    type: row.type,
    source: row.source,
    timestamp: new Date(row.created_at),
    mediaUrl: row.media_url ?? undefined,
  };
}

function rowToConversation(row: ConversationRow, messages: MessageRow[]): Conversation {
  return {
    id: row.id,
    messages: messages.map(rowToMessage),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function createMessage(
  role: MessageRole,
  content: string,
  source: MessageSource,
  type: MessageType = "text",
  mediaUrl?: string
): Message {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    type,
    source,
    timestamp: new Date(),
    mediaUrl,
  };
}

/* ── Supabase CRUD ───────────────────────────────────── */

export async function loadConversations(): Promise<Conversation[]> {
  const { data: convRows, error } = await supabase
    .from("conversations")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(30);

  if (error || !convRows) {
    console.error("Failed to load conversations:", error);
    return [];
  }

  // Fetch all messages for these conversations in one query
  const convIds = convRows.map((c: ConversationRow) => c.id);
  if (convIds.length === 0) return [];

  const { data: msgRows, error: msgErr } = await supabase
    .from("messages")
    .select("*")
    .in("conversation_id", convIds)
    .order("created_at", { ascending: true })
    .limit(1000);

  if (msgErr) {
    console.error("Failed to load messages:", msgErr);
  }

  const msgsByConv = new Map<string, MessageRow[]>();
  for (const msg of (msgRows ?? []) as MessageRow[]) {
    const arr = msgsByConv.get(msg.conversation_id) ?? [];
    arr.push(msg);
    msgsByConv.set(msg.conversation_id, arr);
  }

  return (convRows as ConversationRow[]).map((c) =>
    rowToConversation(c, msgsByConv.get(c.id) ?? [])
  );
}

export async function createConversation(): Promise<Conversation> {
  const { data, error } = await supabase
    .from("conversations")
    .insert({})
    .select()
    .single();

  if (error || !data) {
    console.error("Failed to create conversation:", error);
    // Fallback
    return {
      id: crypto.randomUUID(),
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  return rowToConversation(data as ConversationRow, []);
}

export async function addMessage(
  conversationId: string,
  message: Message,
  _retries = 2
): Promise<void> {
  const { error: msgErr } = await supabase.from("messages").insert({
    id: message.id,
    conversation_id: conversationId,
    role: message.role,
    content: message.content,
    type: message.type,
    source: message.source,
    media_url: message.mediaUrl ?? null,
  });

  if (msgErr) {
    if (_retries > 0) {
      console.warn(`Retrying addMessage (${_retries} left):`, msgErr.message);
      await new Promise((r) => setTimeout(r, 1000));
      return addMessage(conversationId, message, _retries - 1);
    }
    console.error("Failed to insert message after retries:", msgErr);
    return;
  }

  // Update conversation's updated_at
  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}

/* ── Active conversation (still localStorage — per-device) ── */
const STORAGE_ACTIVE = "agent-active-conversation";

export function loadActiveConversationId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_ACTIVE);
}

export function saveActiveConversationId(id: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_ACTIVE, id);
}

/* ── Display helpers (unchanged) ─────────────────────── */

export function getConversationTitle(conv: Conversation): string {
  if (conv.messages.length === 0) return "New conversation";
  const first = conv.messages[0];
  const text = first.content.slice(0, 40);
  return text.length < first.content.length ? text + "..." : text;
}

export function getRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "JUST NOW";
  if (minutes < 60) return `${minutes} MIN AGO`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} HOUR${hours > 1 ? "S" : ""} AGO`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "YESTERDAY";
  return `${days} DAYS AGO`;
}

export function groupByDate(
  conversations: Conversation[]
): { label: string; items: Conversation[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  const groups: Record<string, Conversation[]> = {
    TODAY: [],
    YESTERDAY: [],
    EARLIER: [],
  };

  for (const c of conversations) {
    const d = new Date(c.updatedAt);
    if (d >= today) groups.TODAY.push(c);
    else if (d >= yesterday) groups.YESTERDAY.push(c);
    else groups.EARLIER.push(c);
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({
      label,
      items: items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
    }));
}
