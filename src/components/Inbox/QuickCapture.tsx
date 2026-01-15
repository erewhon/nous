import { useState, useRef, useEffect, useCallback, useId } from "react";
import { useInboxStore } from "../../stores/inboxStore";
import { useToastStore } from "../../stores/toastStore";
import { useFocusTrap } from "../../hooks/useFocusTrap";

interface QuickCaptureProps {
  onClose?: () => void;
}

export function QuickCapture({ onClose }: QuickCaptureProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const { quickCapture, showQuickCapture, closeQuickCapture } = useInboxStore();
  const toast = useToastStore();
  const focusTrapRef = useFocusTrap(showQuickCapture);
  const titleId = useId();

  const isOpen = showQuickCapture;
  const handleClose = onClose || closeQuickCapture;

  // Focus title input when dialog opens
  useEffect(() => {
    if (isOpen && titleRef.current) {
      titleRef.current.focus();
    }
  }, [isOpen]);

  // Handle keyboard events
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose, title, content, tags]);

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) return;

    setIsSubmitting(true);
    try {
      await quickCapture(title.trim(), content.trim(), tags);
      // Reset form
      setTitle("");
      setContent("");
      setTags([]);
      setTagInput("");
      handleClose();
      toast.success("Item captured to inbox");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to capture";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [title, content, tags, quickCapture, handleClose, toast]);

  const handleAddTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    if (tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return;
    setTags([...tags, trimmed]);
    setTagInput("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      handleAddTag(tagInput);
    } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      handleRemoveTag(tags[tags.length - 1]);
    }
  };

  // Close when clicking backdrop
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-4 py-3"
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
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
            <h2
              id={titleId}
              className="text-sm font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Quick Capture
            </h2>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close dialog"
            className="rounded p-1 transition-colors hover:bg-white/10"
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

        {/* Form */}
        <div className="p-4 space-y-4">
          {/* Title */}
          <div>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's on your mind?"
              className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-violet-500"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>

          {/* Content */}
          <div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Add details (optional)..."
              rows={4}
              className="w-full resize-none rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-violet-500"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>

          {/* Tags */}
          <div
            className="flex flex-wrap items-center gap-2 rounded-lg border p-2"
            style={{ borderColor: "var(--color-border)" }}
          >
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs"
                style={{
                  backgroundColor: "rgba(139, 92, 246, 0.15)",
                  color: "var(--color-accent)",
                }}
              >
                {tag}
                <button
                  onClick={() => handleRemoveTag(tag)}
                  aria-label={`Remove tag ${tag}`}
                  className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-white/20"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="10"
                    height="10"
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
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder={tags.length === 0 ? "Add tags..." : ""}
              className="flex-1 min-w-20 bg-transparent text-xs outline-none"
              style={{ color: "var(--color-text-primary)" }}
            />
          </div>

          {/* Hint */}
          <p
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            Press <kbd className="rounded border px-1" style={{ borderColor: "var(--color-border)" }}>Cmd+Enter</kbd> to save
          </p>
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 border-t px-4 py-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={handleClose}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || isSubmitting}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "white",
            }}
          >
            {isSubmitting ? "Saving..." : "Capture"}
          </button>
        </div>
      </div>
    </div>
  );
}
