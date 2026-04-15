-- ═══════════════════════════════════════════════════════════════
-- Migration: System Prompt Templates + Agent Persona in Supabase
-- Run this in the Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Agent persona (single row — one "active" persona config)
create table if not exists agent_persona (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'JARVIS',
  avatar_url  text not null default '',
  system_prompt text not null default 'You are a helpful AI assistant. Be concise and direct.',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2. Prompt templates (saved reusable system prompts)
create table if not exists prompt_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  content     text not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Seed a default persona row if table is empty
insert into agent_persona (name, avatar_url, system_prompt)
select 'JARVIS', '', 'You are a helpful AI assistant. Be concise and direct.'
where not exists (select 1 from agent_persona limit 1);

-- Seed a few starter templates
insert into prompt_templates (name, content, is_default) values
  ('Concise Assistant', 'You are a helpful AI assistant. Be concise and direct.', true),
  ('Creative Writer', 'You are a creative writing assistant. Be imaginative, use vivid language, and help craft compelling narratives.', false),
  ('Code Expert', 'You are an expert programmer. Write clean, efficient code. Explain your reasoning briefly. Prefer practical solutions over theoretical ones.', false)
on conflict do nothing;

-- Enable RLS (adjust policies to your auth setup)
alter table agent_persona enable row level security;
alter table prompt_templates enable row level security;

-- Allow anonymous read/write (single-user app — tighten if you add auth)
create policy "Allow all on agent_persona" on agent_persona for all using (true) with check (true);
create policy "Allow all on prompt_templates" on prompt_templates for all using (true) with check (true);
