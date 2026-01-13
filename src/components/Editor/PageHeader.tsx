import { useState, useRef, useEffect } from "react";
import type { Page } from "../../types/page";
import { usePageStore } from "../../stores/pageStore";
import { exportPageToFile, importMarkdownFile } from "../../utils/api";
import { save, open } from "@tauri-apps/plugin-dialog";
import { TagEditor } from "../Tags";
import { SaveAsTemplateDialog } from "../TemplateDialog";

interface PageHeaderProps {
  page: Page;
  isSaving: boolean;
  lastSaved: Date | null;
}

export function PageHeader({ page, isSaving, lastSaved }: PageHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(page.title);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { updatePage, selectPage } = usePageStore();

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

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    if (isMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isMenuOpen]);

  const handleExport = async () => {
    const suggestedName = page.title?.replace(/[/\\?%*:|"<>]/g, "-") || "page";
    const path = await save({
      defaultPath: `${suggestedName}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (path) {
      await exportPageToFile(page.notebookId, page.id, path);
    }
    setIsMenuOpen(false);
  };

  const handleImport = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });
    if (selected) {
      const newPage = await importMarkdownFile(page.notebookId, selected);
      selectPage(newPage.id);
    }
    setIsMenuOpen(false);
  };

  const handleSaveAsTemplate = () => {
    setIsMenuOpen(false);
    setShowSaveAsTemplate(true);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div
      className="border-b px-16 py-5"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className="w-full bg-transparent text-2xl font-bold outline-none"
              style={{ color: "var(--color-text-primary)" }}
              placeholder="Page title"
            />
          ) : (
            <h1
              onClick={() => setIsEditing(true)}
              className="cursor-text text-2xl font-bold"
              style={{ color: "var(--color-text-primary)" }}
            >
              {page.title || "Untitled"}
            </h1>
          )}
        </div>

      {/* Menu button */}
      <div ref={menuRef} className="relative ml-4">
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="rounded-lg p-2 transition-colors hover:opacity-80"
          style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          title="Page options"
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
            style={{ color: "var(--color-text-muted)" }}
          >
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="19" r="1" />
          </svg>
        </button>

        {isMenuOpen && (
          <div
            className="absolute right-0 top-full z-50 mt-1 min-w-48 rounded-lg border py-1 shadow-lg"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              borderColor: "var(--color-border)",
            }}
          >
            <button
              onClick={handleExport}
              className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:opacity-80"
              style={{ color: "var(--color-text-secondary)" }}
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
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Export to Markdown
            </button>
            <button
              onClick={handleImport}
              className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:opacity-80"
              style={{ color: "var(--color-text-secondary)" }}
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
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Import Markdown
            </button>
            <div
              className="my-1 border-t"
              style={{ borderColor: "var(--color-border)" }}
            />
            <button
              onClick={handleSaveAsTemplate}
              className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:opacity-80"
              style={{ color: "var(--color-text-secondary)" }}
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
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              Save as Template
            </button>
          </div>
        )}
      </div>

        {/* Save status */}
        <div
          className="ml-4 flex items-center gap-2 text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
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
                style={{ color: "var(--color-success)" }}
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <span>Saved at {formatTime(lastSaved)}</span>
            </>
          ) : null}
        </div>
      </div>

      {/* Tag Editor */}
      <div className="relative mt-3">
        <TagEditor page={page} />
      </div>

      {/* Save as Template Dialog */}
      <SaveAsTemplateDialog
        isOpen={showSaveAsTemplate}
        onClose={() => setShowSaveAsTemplate(false)}
        page={page}
      />
    </div>
  );
}
