import { supabase } from "./supabase";

/* ── Types ────────────────────────────────────────────── */

export interface AgentPersona {
  id: string;
  name: string;
  avatarUrl: string;
  systemPrompt: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/* ── Defaults (used before Supabase responds) ─────────── */

export const DEFAULT_PERSONA: AgentPersona = {
  id: "",
  name: "JARVIS",
  avatarUrl: "",
  systemPrompt: "You are a helpful AI assistant. Be concise and direct.",
};

/* ── Persona CRUD ─────────────────────────────────────── */

export async function loadPersona(): Promise<AgentPersona> {
  const { data, error } = await supabase
    .from("agent_persona")
    .select("*")
    .limit(1)
    .single();

  if (error || !data) {
    console.error("Failed to load persona:", error);
    return DEFAULT_PERSONA;
  }

  return {
    id: data.id,
    name: data.name,
    avatarUrl: data.avatar_url,
    systemPrompt: data.system_prompt,
  };
}

export async function savePersona(persona: AgentPersona): Promise<void> {
  if (persona.id) {
    // Update existing row
    const { error } = await supabase
      .from("agent_persona")
      .update({
        name: persona.name,
        avatar_url: persona.avatarUrl,
        system_prompt: persona.systemPrompt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", persona.id);

    if (error) console.error("Failed to update persona:", error);
  } else {
    // Insert new row (first time)
    const { error } = await supabase.from("agent_persona").insert({
      name: persona.name,
      avatar_url: persona.avatarUrl,
      system_prompt: persona.systemPrompt,
    });

    if (error) console.error("Failed to insert persona:", error);
  }
}

/* ── Prompt Template CRUD ─────────────────────────────── */

export async function loadTemplates(): Promise<PromptTemplate[]> {
  const { data, error } = await supabase
    .from("prompt_templates")
    .select("*")
    .order("created_at", { ascending: true });

  if (error || !data) {
    console.error("Failed to load templates:", error);
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    content: row.content,
    isDefault: row.is_default,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }));
}

export async function saveTemplate(
  template: Omit<PromptTemplate, "createdAt" | "updatedAt">
): Promise<PromptTemplate | null> {
  if (template.id) {
    // Update existing
    const { data, error } = await supabase
      .from("prompt_templates")
      .update({
        name: template.name,
        content: template.content,
        is_default: template.isDefault,
        updated_at: new Date().toISOString(),
      })
      .eq("id", template.id)
      .select()
      .single();

    if (error || !data) {
      console.error("Failed to update template:", error);
      return null;
    }

    return {
      id: data.id,
      name: data.name,
      content: data.content,
      isDefault: data.is_default,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };
  } else {
    // Insert new
    const { data, error } = await supabase
      .from("prompt_templates")
      .insert({
        name: template.name,
        content: template.content,
        is_default: template.isDefault,
      })
      .select()
      .single();

    if (error || !data) {
      console.error("Failed to create template:", error);
      return null;
    }

    return {
      id: data.id,
      name: data.name,
      content: data.content,
      isDefault: data.is_default,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };
  }
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("prompt_templates")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Failed to delete template:", error);
    return false;
  }
  return true;
}
