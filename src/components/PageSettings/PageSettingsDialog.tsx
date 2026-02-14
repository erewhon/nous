import { useState, useEffect, useRef } from "react";
import type { Page, SystemPromptMode } from "../../types/page";
import { usePageStore } from "../../stores/pageStore";
import { useAIStore } from "../../stores/aiStore";
import { InlineColorPicker } from "../ColorPicker/ColorPicker";

interface PageSettingsDialogProps {
  isOpen: boolean;
  page: Page | null;
  onClose: () => void;
}

export function PageSettingsDialog({
  isOpen,
  page,
  onClose,
}: PageSettingsDialogProps) {
  const { updatePage } = usePageStore();
  const { getEnabledModels, settings: aiSettings } = useAIStore();
  const [systemPrompt, setSystemPrompt] = useState("");
  const [systemPromptMode, setSystemPromptMode] = useState<SystemPromptMode>("override");
  const [aiModel, setAiModel] = useState<string | undefined>(undefined);
  const [color, setColor] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Get enabled models for the dropdown
  const enabledModels = getEnabledModels();

  // Reset form when page changes
  useEffect(() => {
    if (page) {
      setSystemPrompt(page.systemPrompt || "");
      setSystemPromptMode(page.systemPromptMode || "override");
      setAiModel(page.aiModel);
      setColor(page.color);
    }
  }, [page]);

  // Focus textarea when dialog opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  // Handle keyboard events
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleSave = async () => {
    if (!page) return;

    setIsSaving(true);
    try {
      await updatePage(page.notebookId, page.id, {
        systemPrompt: systemPrompt.trim() || undefined,
        systemPromptMode,
        aiModel: aiModel || undefined,
        color,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  // Close when clicking backdrop
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen || !page) return null;

  const hasChanges =
    (systemPrompt || "") !== (page.systemPrompt || "") ||
    systemPromptMode !== (page.systemPromptMode || "override") ||
    (aiModel || undefined) !== (page.aiModel || undefined) ||
    (color || undefined) !== (page.color || undefined);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-lg rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Page AI Settings
            </h2>
            <p
              className="mt-0.5 text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              {page.title || "Untitled"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            <IconClose />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-5 p-6">
          {/* System Prompt */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label
                className="text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                Custom AI System Prompt
              </label>
              {systemPrompt && (
                <button
                  onClick={() => setSystemPrompt("")}
                  className="text-xs transition-colors hover:underline"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Clear
                </button>
              )}
            </div>
            <textarea
              ref={textareaRef}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Custom AI system prompt for this page (optional). Leave empty to use the notebook or app default."
              rows={6}
              className="w-full resize-none rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[--color-accent]"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
            {/* Mode toggle - only show if there's a prompt */}
            {systemPrompt && (
              <label className="mt-3 flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={systemPromptMode === "concatenate"}
                  onChange={(e) => setSystemPromptMode(e.target.checked ? "concatenate" : "override")}
                  className="rounded"
                  style={{ accentColor: "var(--color-accent)" }}
                />
                <span
                  className="text-sm"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Append to higher-level prompts (instead of replacing)
                </span>
              </label>
            )}
            <p
              className="mt-1.5 text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              {systemPromptMode === "concatenate"
                ? "This prompt will be appended to notebook and app prompts."
                : "This prompt has the highest priority and overrides both notebook and app defaults when chatting with AI on this page."}
            </p>
          </div>

          {/* Model Override */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label
                className="text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                AI Model Override
              </label>
              {aiModel && (
                <button
                  onClick={() => setAiModel(undefined)}
                  className="text-xs transition-colors hover:underline"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Use default
                </button>
              )}
            </div>
            <select
              value={aiModel || ""}
              onChange={(e) => setAiModel(e.target.value || undefined)}
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[--color-accent] dark-select"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            >
              <option value="">Use default ({aiSettings.defaultModel})</option>
              {enabledModels.map(({ provider, model }) => (
                <option key={`${provider}:${model.id}`} value={model.id}>
                  {model.name} ({provider})
                </option>
              ))}
            </select>
            <p
              className="mt-1.5 text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              Override the AI model for chats on this page.
            </p>
          </div>

          {/* Color */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label
                className="text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                Page Color
              </label>
              {color && (
                <button
                  onClick={() => setColor(undefined)}
                  className="text-xs transition-colors hover:underline"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Clear
                </button>
              )}
            </div>
            <InlineColorPicker value={color} onChange={setColor} showClear />
            <p
              className="mt-1.5 text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              Color-code this page in the sidebar and page list.
            </p>
          </div>

          {/* Info */}
          <div
            className="flex items-start gap-2 rounded-lg border p-3"
            style={{
              backgroundColor: "rgba(139, 92, 246, 0.05)",
              borderColor: "rgba(139, 92, 246, 0.2)",
            }}
          >
            <IconInfo />
            <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              <p className="font-medium" style={{ color: "var(--color-text-secondary)" }}>
                Settings Inheritance
              </p>
              <p className="mt-1">
                When you chat with AI, settings are resolved in this order:
              </p>
              <ol className="mt-1 list-inside list-decimal space-y-0.5">
                <li><strong>Page settings</strong> (this page) - highest priority</li>
                <li><strong>Section settings</strong> - if no page setting is set</li>
                <li><strong>Notebook settings</strong> - if no section setting is set</li>
                <li><strong>App default</strong> - fallback if none are set</li>
              </ol>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-3 border-t px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{
              background: "linear-gradient(to bottom right, var(--color-accent), var(--color-accent-secondary))",
            }}
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function IconClose() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
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
  );
}

function IconInfo() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-accent)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, marginTop: 1 }}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
