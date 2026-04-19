-- ═══════════════════════════════════════════════════════════════
-- Migration: Barge-in interruption tracking
-- Adds columns to track which portion of an agent message was actually
-- spoken aloud before the user interrupted. Run after the prompts migration.
-- ═══════════════════════════════════════════════════════════════

alter table messages
  add column if not exists spoken_content text,
  add column if not exists interrupted boolean not null default false;
