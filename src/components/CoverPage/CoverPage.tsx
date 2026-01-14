import { useCallback, useMemo, useState } from "react";
import type { OutputData } from "@editorjs/editorjs";
import type { Page } from "../../types/page";
import type { Notebook } from "../../types/notebook";
import { BlockEditor } from "../Editor/BlockEditor";

interface CoverPageProps {
  page: Page;
  notebook: Notebook;
  onSave: (data: OutputData) => Promise<void>;
  onEnterNotebook: () => void;
  pages: { id: string; title: string }[];
}

export function CoverPage({
  page,
  notebook,
  onSave,
  onEnterNotebook,
  pages,
}: CoverPageProps) {
  const [isSaving, setIsSaving] = useState(false);

  // Convert page content to Editor.js format
  const editorData: OutputData | undefined = useMemo(() => {
    if (!page?.content) return undefined;
    return {
      time: page.content.time,
      version: page.content.version,
      blocks: page.content.blocks.map((block) => ({
        id: block.id,
        type: block.type,
        data: block.data as Record<string, unknown>,
      })),
    };
  }, [page?.id, page?.content]);

  const handleSave = useCallback(
    async (data: OutputData) => {
      setIsSaving(true);
      try {
        await onSave(data);
      } finally {
        setIsSaving(false);
      }
    },
    [onSave]
  );

  // Use notebook color or fallback to accent
  const accentColor = notebook.color || "var(--color-accent)";
  const backgroundColor = notebook.color
    ? `${notebook.color}10`
    : "var(--color-bg-primary)";

  return (
    <div
      className="flex h-full flex-col"
      style={{ backgroundColor }}
    >
      {/* Header bar */}
      <div
        className="flex items-center justify-between border-b px-6 py-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{
              backgroundColor: accentColor,
              color: "white",
            }}
          >
            <IconBook />
          </span>
          <div>
            <span
              className="block text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Cover Page
            </span>
            <span
              className="text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              {notebook.name}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isSaving && (
            <span
              className="text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              Saving...
            </span>
          )}
        </div>
      </div>

      {/* Cover content area */}
      <div className="flex-1 overflow-y-auto">
        <div
          className="mx-auto flex min-h-full flex-col items-center px-8 py-16"
          style={{ maxWidth: "720px" }}
        >
          {/* Decorative top element */}
          <div
            className="mb-8 h-1 w-24 rounded-full"
            style={{ backgroundColor: accentColor }}
          />

          {/* Editor area for the cover content */}
          <div className="w-full text-center">
            <BlockEditor
              key={page.id}
              initialData={editorData}
              onSave={handleSave}
              notebookId={notebook.id}
              pages={pages}
              className="min-h-[300px] cover-editor"
            />
          </div>

          {/* Enter button */}
          <div className="mt-12">
            <button
              onClick={onEnterNotebook}
              className="group flex items-center gap-3 rounded-xl px-8 py-4 text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl"
              style={{
                background: `linear-gradient(135deg, ${accentColor}, ${adjustColor(accentColor, -20)})`,
              }}
            >
              <span className="text-lg font-semibold">Enter Notebook</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-transform group-hover:translate-x-1"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Decorative bottom element */}
          <div
            className="mt-12 h-1 w-16 rounded-full opacity-50"
            style={{ backgroundColor: accentColor }}
          />
        </div>
      </div>
    </div>
  );
}

function IconBook() {
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
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}

// Helper to adjust color brightness
function adjustColor(color: string, amount: number): string {
  // If it's a CSS variable, return a slightly modified version
  if (color.startsWith("var(")) {
    return color;
  }

  // Handle hex colors
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const num = parseInt(hex, 16);
    const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + amount));
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
    const b = Math.max(0, Math.min(255, (num & 0xff) + amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  }

  return color;
}
