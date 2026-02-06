import { useState, useEffect, useRef, useId, useCallback } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { useToastStore } from "../../stores/toastStore";
import { clipWebPage, listFolders, updatePage } from "../../utils/api";
import { htmlToEditorBlocks } from "../../utils/htmlToEditorBlocks";
import type { ClippedContent } from "../../utils/api";
import type { EditorBlock, EditorData, Folder } from "../../types/page";

interface WebClipperDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WebClipperDialog({ isOpen, onClose }: WebClipperDialogProps) {
  const titleId = useId();
  const focusTrapRef = useFocusTrap(isOpen);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [url, setUrl] = useState("");
  const [isClipping, setIsClipping] = useState(false);
  const [clippedContent, setClippedContent] = useState<ClippedContent | null>(
    null
  );
  const [previewBlocks, setPreviewBlocks] = useState<EditorBlock[]>([]);
  const [title, setTitle] = useState("");
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(
    null
  );
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notebooks = useNotebookStore((s) => s.notebooks);
  const currentNotebookId = useNotebookStore((s) => s.selectedNotebookId);
  const createPage = usePageStore((s) => s.createPage);
  const selectPage = usePageStore((s) => s.selectPage);
  const toast = useToastStore();

  // Set default notebook when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedNotebookId(currentNotebookId);
      setSelectedFolderId(null);
      setError(null);
    }
  }, [isOpen, currentNotebookId]);

  // Load folders when notebook changes
  useEffect(() => {
    if (!selectedNotebookId) {
      setFolders([]);
      return;
    }
    listFolders(selectedNotebookId)
      .then((f) => setFolders(f.filter((fo) => fo.folderType === "standard")))
      .catch(() => setFolders([]));
  }, [selectedNotebookId]);

  // Auto-focus URL input
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => urlInputRef.current?.focus());
    }
  }, [isOpen]);

  // Reset state on close
  const handleClose = useCallback(() => {
    setUrl("");
    setClippedContent(null);
    setPreviewBlocks([]);
    setTitle("");
    setError(null);
    setIsClipping(false);
    setIsSaving(false);
    onClose();
  }, [onClose]);

  // Keyboard handling
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, handleClose]);

  const handleClip = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    // Normalize URL
    let normalizedUrl = trimmed;
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = "https://" + normalizedUrl;
    }

    setIsClipping(true);
    setError(null);
    setClippedContent(null);
    setPreviewBlocks([]);

    try {
      const content = await clipWebPage(normalizedUrl);
      setClippedContent(content);
      setTitle(content.title);
      const blocks = htmlToEditorBlocks(content.content, content.url);
      setPreviewBlocks(blocks);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      setIsClipping(false);
    }
  };

  const handleSave = async () => {
    if (!selectedNotebookId || !clippedContent || previewBlocks.length === 0)
      return;

    setIsSaving(true);
    try {
      // Build a source callout block at the top
      const sourceBlock: EditorBlock = {
        id: crypto.randomUUID().slice(0, 10),
        type: "paragraph",
        data: {
          text: `<i>Clipped from <a href="${clippedContent.url}">${clippedContent.siteName ?? new URL(clippedContent.url).hostname}</a></i>`,
        },
      };

      const editorData: EditorData = {
        time: Date.now(),
        version: "2.28.0",
        blocks: [sourceBlock, ...previewBlocks],
      };

      // Create new page
      const page = await createPage(
        selectedNotebookId,
        title || "Untitled Clip",
        selectedFolderId ?? undefined
      );

      if (!page) {
        throw new Error("Failed to create page");
      }

      // Save content
      await updatePage(selectedNotebookId, page.id, {
        content: editorData,
      });

      // Navigate to the new page
      selectPage(page.id);
      toast.success("Page saved from web clip");
      handleClose();
    } catch (err) {
      toast.error(
        `Failed to save: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[10vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-2">
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
              style={{ color: "var(--color-accent)" }}
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <h2
              id={titleId}
              className="text-base font-semibold"
              style={{ color: "var(--color-text)" }}
            >
              Clip Web Page
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
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
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* URL input */}
          <div className="flex gap-2">
            <input
              ref={urlInputRef}
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isClipping) {
                  e.preventDefault();
                  handleClip();
                }
              }}
              placeholder="Enter URL to clip..."
              className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-violet-500"
              style={{
                backgroundColor: "var(--color-bg-primary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text)",
              }}
            />
            <button
              onClick={handleClip}
              disabled={!url.trim() || isClipping}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: "var(--color-accent)" }}
            >
              {isClipping ? "Clipping..." : "Clip"}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div
              className="mt-3 rounded-lg border px-3 py-2 text-sm"
              style={{
                borderColor: "var(--color-danger, #ef4444)",
                color: "var(--color-danger, #ef4444)",
                backgroundColor: "var(--color-danger-bg, rgba(239,68,68,0.1))",
              }}
            >
              {error}
            </div>
          )}

          {/* Loading spinner */}
          {isClipping && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <div
                className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent"
                style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }}
              />
              <span
                className="text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                Fetching and extracting article...
              </span>
            </div>
          )}

          {/* Clipped content */}
          {clippedContent && !isClipping && (
            <div className="mt-4 space-y-4">
              {/* Title */}
              <div>
                <label
                  className="mb-1 block text-xs font-medium"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-violet-500"
                  style={{
                    backgroundColor: "var(--color-bg-primary)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-text)",
                  }}
                />
              </div>

              {/* Source info */}
              <div
                className="flex items-center gap-2 text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {clippedContent.favicon && (
                  <img
                    src={clippedContent.favicon}
                    alt=""
                    className="h-4 w-4 rounded"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
                <span>
                  {clippedContent.siteName ??
                    (() => {
                      try {
                        return new URL(clippedContent.url).hostname;
                      } catch {
                        return clippedContent.url;
                      }
                    })()}
                </span>
                <span>&middot;</span>
                <span>{previewBlocks.length} blocks</span>
              </div>

              {/* Preview */}
              <div>
                <label
                  className="mb-1 block text-xs font-medium"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Preview
                </label>
                <div
                  className="max-h-60 overflow-y-auto rounded-lg border p-4 text-sm"
                  style={{
                    backgroundColor: "var(--color-bg-primary)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-text)",
                  }}
                >
                  <BlockPreview blocks={previewBlocks} />
                </div>
              </div>

              {/* Notebook selector */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label
                    className="mb-1 block text-xs font-medium"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Notebook
                  </label>
                  <select
                    value={selectedNotebookId ?? ""}
                    onChange={(e) => {
                      setSelectedNotebookId(e.target.value || null);
                      setSelectedFolderId(null);
                    }}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{
                      backgroundColor: "var(--color-bg-primary)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-text)",
                    }}
                  >
                    <option value="">Select notebook...</option>
                    {notebooks.map((nb) => (
                      <option key={nb.id} value={nb.id}>
                        {nb.name}
                      </option>
                    ))}
                  </select>
                </div>

                {folders.length > 0 && (
                  <div className="flex-1">
                    <label
                      className="mb-1 block text-xs font-medium"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Folder
                    </label>
                    <select
                      value={selectedFolderId ?? ""}
                      onChange={(e) =>
                        setSelectedFolderId(e.target.value || null)
                      }
                      className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                      style={{
                        backgroundColor: "var(--color-bg-primary)",
                        borderColor: "var(--color-border)",
                        color: "var(--color-text)",
                      }}
                    >
                      <option value="">Root (no folder)</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 border-t px-5 py-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={handleClose}
            className="rounded-lg px-4 py-2 text-sm transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            Cancel
          </button>
          {clippedContent && (
            <button
              onClick={handleSave}
              disabled={
                !selectedNotebookId ||
                previewBlocks.length === 0 ||
                isSaving
              }
              className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: "var(--color-accent)" }}
            >
              {isSaving ? "Saving..." : "Save as Page"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Simple read-only block preview renderer.
 */
function BlockPreview({ blocks }: { blocks: EditorBlock[] }) {
  if (blocks.length === 0) {
    return (
      <p style={{ color: "var(--color-text-muted)" }}>No content extracted.</p>
    );
  }

  return (
    <div className="space-y-2">
      {blocks.slice(0, 50).map((block) => (
        <BlockPreviewItem key={block.id} block={block} />
      ))}
      {blocks.length > 50 && (
        <p
          className="text-xs italic"
          style={{ color: "var(--color-text-muted)" }}
        >
          ...and {blocks.length - 50} more blocks
        </p>
      )}
    </div>
  );
}

function BlockPreviewItem({ block }: { block: EditorBlock }) {
  const data = block.data;

  switch (block.type) {
    case "header": {
      const Tag = `h${Math.min(data.level as number, 4)}` as
        | "h1"
        | "h2"
        | "h3"
        | "h4";
      const sizes: Record<string, string> = {
        h1: "text-xl font-bold",
        h2: "text-lg font-bold",
        h3: "text-base font-semibold",
        h4: "text-sm font-semibold",
      };
      return (
        <Tag
          className={sizes[Tag]}
          dangerouslySetInnerHTML={{ __html: data.text as string }}
        />
      );
    }

    case "paragraph":
      return (
        <p
          className="text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: data.text as string }}
        />
      );

    case "list": {
      const ListTag = data.style === "ordered" ? "ol" : "ul";
      const listClass =
        data.style === "ordered"
          ? "list-decimal pl-5 text-sm space-y-0.5"
          : "list-disc pl-5 text-sm space-y-0.5";
      return (
        <ListTag className={listClass}>
          {(data.items as string[]).map((item, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: item }} />
          ))}
        </ListTag>
      );
    }

    case "code":
      return (
        <pre
          className="overflow-x-auto rounded-md p-3 text-xs"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-text)",
          }}
        >
          <code>{data.code as string}</code>
        </pre>
      );

    case "quote":
      return (
        <blockquote
          className="border-l-2 pl-3 text-sm italic"
          style={{
            borderColor: "var(--color-accent)",
            color: "var(--color-text-muted)",
          }}
          dangerouslySetInnerHTML={{ __html: data.text as string }}
        />
      );

    case "image": {
      const file = data.file as { url: string } | undefined;
      if (!file?.url) return null;
      return (
        <figure className="my-1">
          <img
            src={file.url}
            alt={(data.caption as string) ?? ""}
            className="max-h-48 rounded"
            loading="lazy"
          />
          {typeof data.caption === "string" && data.caption && (
            <figcaption
              className="mt-1 text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              {data.caption}
            </figcaption>
          )}
        </figure>
      );
    }

    case "delimiter":
      return (
        <hr
          className="my-2"
          style={{ borderColor: "var(--color-border)" }}
        />
      );

    case "table": {
      const content = data.content as string[][];
      if (!content || content.length === 0) return null;
      return (
        <div className="overflow-x-auto text-xs">
          <table className="w-full border-collapse">
            <tbody>
              {content.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => {
                    const CellTag =
                      data.withHeadings && ri === 0 ? "th" : "td";
                    return (
                      <CellTag
                        key={ci}
                        className="border px-2 py-1 text-left"
                        style={{ borderColor: "var(--color-border)" }}
                        dangerouslySetInnerHTML={{ __html: cell }}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    default:
      if (data.text) {
        return (
          <p
            className="text-sm"
            dangerouslySetInnerHTML={{ __html: data.text as string }}
          />
        );
      }
      return null;
  }
}
