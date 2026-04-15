"use client";

import { useState, useEffect, useCallback } from "react";
import {
  type AgentPersona,
  type PromptTemplate,
  loadPersona,
  savePersona,
  loadTemplates,
  saveTemplate,
  deleteTemplate,
  DEFAULT_PERSONA,
} from "../lib/persona";

interface SettingsProps {
  onClose: () => void;
  closing: boolean;
  onPersonaChange: (persona: AgentPersona) => void;
}

type SettingsView = "main" | "templates" | "generate";

export default function Settings({ onClose, closing, onPersonaChange }: SettingsProps) {
  const [persona, setPersona] = useState<AgentPersona>(DEFAULT_PERSONA);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<SettingsView>("main");

  // Template state
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<{ name: string; content: string } | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);

  // AI generation state
  const [generateInput, setGenerateInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState<string | null>(null);

  /* ── Load persona + templates from Supabase on mount ── */
  useEffect(() => {
    async function init() {
      const [p, t] = await Promise.all([loadPersona(), loadTemplates()]);
      setPersona(p);
      setTemplates(t);
      setLoading(false);
    }
    init();
  }, []);

  /* ── Save / Done handlers ──────────────────────────── */
  const handleSave = useCallback(async () => {
    await savePersona(persona);
    onPersonaChange(persona);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, [persona, onPersonaChange]);

  const handleDone = useCallback(async () => {
    await savePersona(persona);
    onPersonaChange(persona);
    onClose();
  }, [persona, onPersonaChange, onClose]);

  /* ── Apply a template to the current system prompt ─── */
  const applyTemplate = useCallback((content: string) => {
    setPersona((prev) => ({ ...prev, systemPrompt: content }));
    setView("main");
  }, []);

  /* ── Save current prompt as new template ───────────── */
  const handleSaveAsTemplate = useCallback(async () => {
    if (!editingTemplate || !editingTemplate.name.trim()) return;
    setTemplateSaving(true);

    const result = await saveTemplate({
      id: "",
      name: editingTemplate.name.trim(),
      content: editingTemplate.content,
      isDefault: false,
    });

    if (result) {
      setTemplates((prev) => [...prev, result]);
    }
    setEditingTemplate(null);
    setTemplateSaving(false);
  }, [editingTemplate]);

  /* ── Delete a template ─────────────────────────────── */
  const handleDeleteTemplate = useCallback(async (id: string) => {
    const ok = await deleteTemplate(id);
    if (ok) setTemplates((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /* ── AI prompt generation ───────────────────────────── */
  const handleGenerate = useCallback(async () => {
    if (!generateInput.trim()) return;
    setGenerating(true);
    setGeneratedPrompt(null);

    try {
      const res = await fetch("/api/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: generateInput.trim() }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error);
      }

      const data = await res.json();
      setGeneratedPrompt(data.prompt);
    } catch (err) {
      console.error("Generation failed:", err);
      setGeneratedPrompt(null);
    } finally {
      setGenerating(false);
    }
  }, [generateInput]);

  /* ── Shared pill button style ───────────────────────── */
  const pillBtn =
    "rounded-[9999px] border border-white px-[16px] py-[8px] bg-transparent font-mono text-[11px] uppercase text-white cursor-pointer transition-opacity duration-150 hover:opacity-75 active:opacity-60";
  const pillBtnSmall =
    "rounded-[9999px] border border-secondary px-[12px] py-[4px] bg-transparent font-mono text-[10px] uppercase text-secondary cursor-pointer transition-all duration-150 hover:border-white hover:text-white";
  const sectionLabel =
    "font-mono text-[12px] uppercase text-secondary mb-[6px]";
  const letterSp = { letterSpacing: "1.2px" };

  if (loading) {
    return (
      <div className={`absolute inset-0 z-50 bg-black flex items-center justify-center ${closing ? "fade-exit" : "fade-enter"}`}>
        <span className="font-mono text-[12px] text-secondary uppercase" style={letterSp}>
          LOADING...
        </span>
      </div>
    );
  }

  return (
    <div
      className={`absolute inset-0 z-50 bg-black flex flex-col overflow-y-auto
                  ${closing ? "fade-exit" : "fade-enter"}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-[12px] py-[12px] flex-shrink-0">
        <span
          className="font-mono text-[14px] uppercase text-white"
          style={{ letterSpacing: "1.4px" }}
        >
          {view === "main" ? "SETTINGS" : view === "templates" ? "TEMPLATES" : "GENERATE PROMPT"}
        </span>
        <button
          onClick={view === "main" ? onClose : () => setView("main")}
          className="font-mono text-[14px] text-white cursor-pointer bg-transparent border-none"
          aria-label={view === "main" ? "Close settings" : "Back"}
        >
          {view === "main" ? "✕" : "←"}
        </button>
      </div>

      {/* ═══ MAIN VIEW ═══ */}
      {view === "main" && (
        <div className="flex-1 px-[12px] pb-[64px]">
          {/* Section: Agent */}
          <div
            className="font-mono text-[12px] uppercase text-secondary mt-[36px] mb-[12px]"
            style={letterSp}
          >
            [AGENT]
          </div>

          {/* Agent Name */}
          <label className={`block ${sectionLabel}`} style={letterSp}>
            AGENT NAME
          </label>
          <input
            type="text"
            value={persona.name}
            onChange={(e) => setPersona({ ...persona, name: e.target.value })}
            maxLength={32}
            className="w-full bg-black border border-secondary rounded-[6px] px-[12px] py-[6px]
                       font-mono text-[14px] text-white placeholder:text-secondary
                       outline-none focus:border-white transition-colors duration-250"
            style={{ ...letterSp, height: "40px" }}
          />

          {/* Agent Avatar */}
          <label className={`block ${sectionLabel} mt-[36px]`} style={letterSp}>
            AGENT AVATAR
          </label>
          <div className="flex items-center gap-[12px]">
            <div className="h-[64px] w-[64px] rounded-full border border-white flex-shrink-0 flex items-center justify-center overflow-hidden">
              {persona.avatarUrl ? (
                <img
                  src={persona.avatarUrl}
                  alt="Agent avatar"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="font-mono text-[14px] text-white">
                  {persona.name.charAt(0) || "A"}
                </span>
              )}
            </div>
            <label className={pillBtn} style={letterSp}>
              CHANGE AVATAR
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const img = new Image();
                    img.onload = () => {
                      const size = 128;
                      const canvas = document.createElement("canvas");
                      canvas.width = size;
                      canvas.height = size;
                      const ctx = canvas.getContext("2d")!;
                      ctx.drawImage(img, 0, 0, size, size);
                      const compressed = canvas.toDataURL("image/jpeg", 0.7);
                      setPersona({ ...persona, avatarUrl: compressed });
                      URL.revokeObjectURL(img.src);
                    };
                    img.src = URL.createObjectURL(file);
                  }
                }}
              />
            </label>
          </div>

          {/* System Prompt Section */}
          <div
            className="font-mono text-[12px] uppercase text-secondary mt-[36px] mb-[12px]"
            style={letterSp}
          >
            [SYSTEM PROMPT]
          </div>

          <textarea
            value={persona.systemPrompt}
            onChange={(e) => setPersona({ ...persona, systemPrompt: e.target.value })}
            maxLength={2000}
            rows={6}
            className="w-full bg-black border border-secondary rounded-[6px] px-[12px] py-[8px]
                       font-mono text-[12px] text-white placeholder:text-secondary
                       outline-none focus:border-white transition-colors duration-250 resize-none"
            style={{ ...letterSp, minHeight: "120px", maxHeight: "300px" }}
            placeholder="DEFINE YOUR AGENT'S BEHAVIOR AND TONE"
          />
          <div
            className="font-mono text-[10px] text-secondary text-right mt-[4px]"
            style={{ letterSpacing: "1px" }}
          >
            {persona.systemPrompt.length} / 2000
          </div>

          {/* Prompt action buttons */}
          <div className="flex flex-wrap gap-[8px] mt-[12px]">
            <button
              className={pillBtnSmall}
              style={letterSp}
              onClick={() => setView("templates")}
            >
              BROWSE TEMPLATES
            </button>
            <button
              className={pillBtnSmall}
              style={letterSp}
              onClick={() => setView("generate")}
            >
              AI GENERATE
            </button>
            <button
              className={pillBtnSmall}
              style={letterSp}
              onClick={() =>
                setEditingTemplate({
                  name: "",
                  content: persona.systemPrompt,
                })
              }
              disabled={!persona.systemPrompt.trim()}
            >
              SAVE AS TEMPLATE
            </button>
          </div>

          {/* Inline save-as-template form */}
          {editingTemplate && (
            <div className="mt-[12px] p-[12px] border border-secondary rounded-[6px]">
              <label className={`block ${sectionLabel}`} style={letterSp}>
                TEMPLATE NAME
              </label>
              <input
                type="text"
                value={editingTemplate.name}
                onChange={(e) =>
                  setEditingTemplate({ ...editingTemplate, name: e.target.value })
                }
                maxLength={64}
                placeholder="e.g. FRIENDLY TUTOR"
                className="w-full bg-black border border-secondary rounded-[6px] px-[12px] py-[6px]
                           font-mono text-[12px] text-white placeholder:text-secondary
                           outline-none focus:border-white transition-colors duration-250 mb-[8px]"
                style={letterSp}
              />
              <div className="flex gap-[8px]">
                <button
                  className={pillBtnSmall}
                  style={letterSp}
                  onClick={handleSaveAsTemplate}
                  disabled={templateSaving || !editingTemplate.name.trim()}
                >
                  {templateSaving ? "SAVING..." : "SAVE"}
                </button>
                <button
                  className={pillBtnSmall}
                  style={letterSp}
                  onClick={() => setEditingTemplate(null)}
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ TEMPLATES VIEW ═══ */}
      {view === "templates" && (
        <div className="flex-1 px-[12px] pb-[64px]">
          {templates.length === 0 ? (
            <div className="mt-[48px] text-center">
              <span
                className="font-mono text-[12px] text-secondary uppercase"
                style={letterSp}
              >
                NO TEMPLATES YET
              </span>
            </div>
          ) : (
            <div className="mt-[12px] flex flex-col gap-[8px]">
              {templates.map((t) => (
                <div
                  key={t.id}
                  className="border border-secondary rounded-[6px] p-[12px] transition-colors hover:border-white group"
                >
                  <div className="flex items-center justify-between mb-[6px]">
                    <span
                      className="font-mono text-[12px] uppercase text-white"
                      style={letterSp}
                    >
                      {t.name}
                      {t.isDefault && (
                        <span className="text-secondary ml-[8px] text-[10px] normal-case">
                          (built-in)
                        </span>
                      )}
                    </span>
                  </div>
                  <p
                    className="font-mono text-[11px] text-secondary leading-[1.5] mb-[8px] line-clamp-3"
                    style={{ letterSpacing: "0.5px" }}
                  >
                    {t.content}
                  </p>
                  <div className="flex gap-[8px]">
                    <button
                      className={pillBtnSmall}
                      style={letterSp}
                      onClick={() => applyTemplate(t.content)}
                    >
                      USE
                    </button>
                    {!t.isDefault && (
                      <button
                        className={`${pillBtnSmall} hover:!border-red-500 hover:!text-red-500`}
                        style={letterSp}
                        onClick={() => handleDeleteTemplate(t.id)}
                      >
                        DELETE
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ GENERATE VIEW ═══ */}
      {view === "generate" && (
        <div className="flex-1 px-[12px] pb-[64px]">
          <div
            className="font-mono text-[12px] uppercase text-secondary mt-[24px] mb-[12px]"
            style={letterSp}
          >
            DESCRIBE THE AI YOU WANT
          </div>

          <textarea
            value={generateInput}
            onChange={(e) => setGenerateInput(e.target.value)}
            maxLength={500}
            rows={4}
            placeholder="e.g. A strict but encouraging fitness coach who speaks in short motivational sentences"
            className="w-full bg-black border border-secondary rounded-[6px] px-[12px] py-[8px]
                       font-mono text-[12px] text-white placeholder:text-secondary
                       outline-none focus:border-white transition-colors duration-250 resize-none"
            style={{ ...letterSp, minHeight: "80px" }}
          />

          <div className="mt-[12px]">
            <button
              className={pillBtn}
              style={letterSp}
              onClick={handleGenerate}
              disabled={generating || !generateInput.trim()}
            >
              {generating ? "GENERATING..." : "GENERATE"}
            </button>
          </div>

          {/* Generated result */}
          {generatedPrompt && (
            <div className="mt-[24px]">
              <div className={`${sectionLabel} mb-[8px]`} style={letterSp}>
                GENERATED PROMPT
              </div>
              <div className="border border-secondary rounded-[6px] p-[12px]">
                <p
                  className="font-mono text-[12px] text-white leading-[1.6]"
                  style={{ letterSpacing: "0.5px" }}
                >
                  {generatedPrompt}
                </p>
              </div>
              <div className="flex gap-[8px] mt-[12px]">
                <button
                  className={pillBtnSmall}
                  style={letterSp}
                  onClick={() => {
                    applyTemplate(generatedPrompt);
                    setGeneratedPrompt(null);
                    setGenerateInput("");
                  }}
                >
                  USE THIS
                </button>
                <button
                  className={pillBtnSmall}
                  style={letterSp}
                  onClick={handleGenerate}
                  disabled={generating}
                >
                  REGENERATE
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action buttons (always visible) */}
      <div className="flex-shrink-0 flex items-center justify-center gap-[12px] px-[12px] py-[12px]">
        {view === "main" && (
          <>
            <button
              onClick={handleSave}
              className={`${pillBtn} !px-[24px] !py-[12px] !text-[14px]`}
              style={{ letterSpacing: "1.4px" }}
            >
              {saved ? "SAVED ✓" : "SAVE"}
            </button>
            <button
              onClick={handleDone}
              className={`${pillBtn} !px-[24px] !py-[12px] !text-[14px]`}
              style={{ letterSpacing: "1.4px" }}
            >
              DONE
            </button>
          </>
        )}
      </div>
    </div>
  );
}
