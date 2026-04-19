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
  /** Portion of `content` actually played as TTS before user barge-in. */
  spokenContent?: string;
  /** True if the user interrupted this agent message mid-speaking. */
  interrupted?: boolean;
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
  spoken_content: string | null;
  interrupted: boolean | null;
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
    spokenContent: row.spoken_content ?? undefined,
    interrupted: row.interrupted ?? false,
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
    spoken_content: message.spokenContent ?? null,
    interrupted: message.interrupted ?? false,
  });

  if (msgErr) {
    if (_retries > 0) {
      console.warn(`Retrying addMessage (${_retries} left):`, msgErr.message, msgErr.code, msgErr.details, msgErr.hint);
      await new Promise((r) => setTimeout(r, 1000));
      return addMessage(conversationId, message, _retries - 1);
    }
    console.error("Failed to insert message after retries:", JSON.stringify(msgErr));
    return;
  }

  // Update conversation's updated_at
  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}

/**
 * Remove a single message from a conversation. Used by the regenerate flow
 * which deletes the trailing agent reply before re-running the LLM.
 * Failures are logged but never thrown — the in-memory state is the source
 * of truth for the active session, so a transient DB error must not break
 * the UI.
 */
export async function deleteMessage(
  conversationId: string,
  messageId: string
): Promise<void> {
  const { error } = await supabase
    .from("messages")
    .delete()
    .eq("id", messageId);

  if (error) {
    console.warn("Failed to delete message:", error.message);
    return;
  }

  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}

/* ── LLM history projection ────────────────────── */

/**
 * Project chat history into the shape the LLM should see. For interrupted
 * agent messages, replace `content` with `spokenContent` so the model sees
 * only what the user actually heard — not the post-interruption tail it
 * never voiced.
 */
export function buildLlmHistory(
  messages: Message[]
): { role: MessageRole; content: string }[] {
  return messages.map((m) => ({
    role: m.role,
    content:
      m.role === "agent" && m.interrupted && m.spokenContent
        ? m.spokenContent
        : m.content,
  }));
}

/**
 * If the most recent agent message was interrupted, return a brief note
 * for the system prompt telling the model what was actually heard. Returns
 * null otherwise. Trimmed to the last full sentence so the prompt stays
 * tight.
 */
export function buildInterruptionNote(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "agent") continue;
    if (!m.interrupted || !m.spokenContent) return null;
    // Last full sentence (split on .!?), or the whole spoken text if no
    // terminal punctuation present.
    const sentences = m.spokenContent.match(/[^.!?]+[.!?]+/g);
    const tail = (sentences && sentences[sentences.length - 1]) || m.spokenContent;
    const clean = tail.trim().slice(0, 200);
    return `The user interrupted your previous message after you said: "${clean}". Acknowledge briefly if it makes sense, then respond to what they said.`;
  }
  return null;
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
