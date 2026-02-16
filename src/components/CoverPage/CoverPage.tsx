import { useCallback, useMemo, useState, useRef } from "react";
import type { OutputData } from "@editorjs/editorjs";
import type { Page } from "../../types/page";
import type { Notebook } from "../../types/notebook";
import { BlockEditor } from "../Editor/BlockEditor";
import { adjustColor } from "../../utils/colorUtils";
import { uploadCoverImage } from "../../utils/coverImageUpload";
import { updateNotebook } from "../../utils/api";
import { useNotebookStore } from "../../stores/notebookStore";

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
  const [isUploadingBg, setIsUploadingBg] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadNotebooks = useNotebookStore((s) => s.loadNotebooks);

  // Convert page content to Editor.js format
  // Only depend on page ID - content changes during saves shouldn't re-render the editor
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id]);

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

  const handleSetBackground = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingBg(true);
    try {
      const url = await uploadCoverImage(notebook.id, file);
      await updateNotebook(notebook.id, { coverImage: url });
      await loadNotebooks();
    } catch (err) {
      console.error("Failed to upload cover image:", err);
    } finally {
      setIsUploadingBg(false);
      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [notebook.id, loadNotebooks]);

  const handleRemoveBackground = useCallback(async () => {
    try {
      await updateNotebook(notebook.id, { coverImage: "" });
      await loadNotebooks();
    } catch (err) {
      console.error("Failed to remove cover image:", err);
    }
  }, [notebook.id, loadNotebooks]);

  // Use notebook color or fallback to accent
  const accentColor = notebook.color || "var(--color-accent)";
  const backgroundColor = notebook.color
    ? `${notebook.color}10`
    : "var(--color-bg-primary)";
  const hasCoverImage = !!notebook.coverImage;

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
          {/* Background image controls */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleSetBackground}
          />
          {hasCoverImage && (
            <button
              onClick={handleRemoveBackground}
              className="rounded-md px-2 py-1 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-text-muted)" }}
            >
              Remove Background
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadingBg}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <IconImage />
            {isUploadingBg ? "Uploading..." : hasCoverImage ? "Change Background" : "Set Background"}
          </button>
        </div>
      </div>

      {/* Cover content area */}
      <div className="relative flex-1 overflow-y-auto">
        {/* Background image layer */}
        {hasCoverImage && (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${notebook.coverImage})` }}
            />
            {/* Semi-transparent overlay for text readability */}
            <div
              className="absolute inset-0"
              style={{ backgroundColor: `${notebook.color || "#000000"}80` }}
            />
          </>
        )}

        <div
          className="relative mx-auto flex min-h-full flex-col items-center px-8 py-16"
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

function IconImage() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}
