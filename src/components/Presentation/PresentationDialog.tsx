import { useState, useEffect, useCallback } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useToastStore } from "../../stores/toastStore";
import type { Page } from "../../types/page";
import { generatePresentation } from "./api";

interface PresentationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  page: Page;
}

const THEMES = [
  { id: "white", label: "White", bg: "#fff", fg: "#222" },
  { id: "black", label: "Black", bg: "#111", fg: "#eee" },
  { id: "moon", label: "Moon", bg: "#002b36", fg: "#93a1a1" },
  { id: "solarized", label: "Solarized", bg: "#fdf6e3", fg: "#657b83" },
  { id: "dracula", label: "Dracula", bg: "#282a36", fg: "#f8f8f2" },
] as const;

const TRANSITIONS = ["slide", "fade", "convex", "none"] as const;

export function PresentationDialog({
  isOpen,
  onClose,
  page,
}: PresentationDialogProps) {
  const [theme, setTheme] = useState("white");
  const [transition, setTransition] = useState("slide");
  const [presentationHtml, setPresentationHtml] = useState<string | null>(null);
  const [isPresenting, setIsPresenting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const toast = useToastStore();

  useEffect(() => {
    if (isOpen) {
      setPresentationHtml(null);
      setIsPresenting(false);
    }
  }, [isOpen]);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    try {
      const html = await generatePresentation(page.notebookId, page.id, {
        theme,
        transition,
      });
      setPresentationHtml(html);
      return html;
    } catch (err) {
      toast.error("Failed to generate presentation: " + String(err));
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, [page.notebookId, page.id, theme, transition, toast]);

  const handlePresent = async () => {
    const html = await handleGenerate();
    if (html) {
      setPresentationHtml(html);
      setIsPresenting(true);
    }
  };

  const handleExport = async () => {
    const html = presentationHtml ?? (await handleGenerate());
    if (!html) return;

    const path = await save({
      defaultPath: `${page.title || "presentation"}.html`,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (path) {
      try {
        await writeTextFile(path, html);
        toast.success("Presentation exported successfully");
      } catch (err) {
        toast.error("Failed to export: " + String(err));
      }
    }
  };

  const handleExitPresentation = useCallback(() => {
    setIsPresenting(false);
  }, []);

  useEffect(() => {
    if (!isPresenting) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleExitPresentation();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPresenting, handleExitPresentation]);

  if (!isOpen) return null;

  if (isPresenting && presentationHtml) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "#000",
        }}
      >
        <iframe
          srcDoc={presentationHtml}
          style={{ width: "100%", height: "100%", border: "none" }}
          title="Presentation"
        />
        <button
          onClick={handleExitPresentation}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            zIndex: 10000,
            background: "rgba(0,0,0,0.5)",
            color: "#fff",
            border: "none",
            borderRadius: "50%",
            width: 36,
            height: 36,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
          }}
          title="Exit presentation (Esc)"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-xl border p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-panel)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3
            className="text-lg font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Present as Slides
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 transition-colors hover:opacity-80"
            style={{ color: "var(--color-text-muted)" }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Theme selection */}
        <label
          className="block text-sm font-medium mb-2"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Theme
        </label>
        <div className="grid grid-cols-5 gap-2 mb-4">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className="flex flex-col items-center gap-1 rounded-lg p-2 transition-colors"
              style={{
                border:
                  theme === t.id
                    ? "2px solid var(--color-accent)"
                    : "2px solid var(--color-border)",
                backgroundColor: "var(--color-bg-secondary)",
              }}
            >
              <div
                className="w-8 h-8 rounded"
                style={{
                  backgroundColor: t.bg,
                  border: "1px solid var(--color-border)",
                }}
              >
                <span
                  style={{
                    color: t.fg,
                    fontSize: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                  }}
                >
                  Aa
                </span>
              </div>
              <span
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {t.label}
              </span>
            </button>
          ))}
        </div>

        {/* Transition selection */}
        <label
          className="block text-sm font-medium mb-2"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Transition
        </label>
        <select
          value={transition}
          onChange={(e) => setTransition(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm mb-5 outline-none transition-colors focus:border-[--color-accent]"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        >
          {TRANSITIONS.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>

        <p
          className="text-xs mb-4"
          style={{ color: "var(--color-text-muted)" }}
        >
          H1 and H2 headers split content into separate slides. Use arrow keys
          or space to navigate.
        </p>

        {/* Action buttons */}
        <div className="flex justify-end gap-2">
          <button
            onClick={handleExport}
            disabled={isGenerating}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:opacity-80"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            Export HTML
          </button>
          <button
            onClick={handlePresent}
            disabled={isGenerating}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            {isGenerating ? "Generating..." : "Present"}
          </button>
        </div>
      </div>
    </div>
  );
}
