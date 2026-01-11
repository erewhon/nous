import { useState, useRef, useEffect } from "react";
import type { Page } from "../../types/page";
import { usePageStore } from "../../stores/pageStore";

interface PageHeaderProps {
  page: Page;
  isSaving: boolean;
  lastSaved: Date | null;
}

export function PageHeader({ page, isSaving, lastSaved }: PageHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(page.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const { updatePage } = usePageStore();

  // Update local title when page changes
  useEffect(() => {
    setTitle(page.title);
  }, [page.title]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = async () => {
    if (title.trim() && title !== page.title) {
      await updatePage(page.notebookId, page.id, { title: title.trim() });
    } else {
      setTitle(page.title);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setTitle(page.title);
      setIsEditing(false);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="flex items-center justify-between border-b border-[--color-border] px-8 py-4">
      <div className="flex-1">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-2xl font-bold text-[--color-text-primary] outline-none"
            placeholder="Page title"
          />
        ) : (
          <h1
            onClick={() => setIsEditing(true)}
            className="cursor-text text-2xl font-bold text-[--color-text-primary] hover:text-[--color-accent]"
          >
            {page.title || "Untitled"}
          </h1>
        )}
      </div>

      {/* Save status */}
      <div className="ml-4 flex items-center gap-2 text-sm text-[--color-text-muted]">
        {isSaving ? (
          <>
            <svg
              className="h-4 w-4 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>Saving...</span>
          </>
        ) : lastSaved ? (
          <>
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
              className="text-green-500"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
            <span>Saved at {formatTime(lastSaved)}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
