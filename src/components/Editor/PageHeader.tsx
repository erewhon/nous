import { useState, useRef, useEffect, useCallback } from "react";
import type { Page, EditorData } from "../../types/page";
import { usePageStore } from "../../stores/pageStore";
import { useTemplateStore } from "../../stores/templateStore";
import { useThemeStore } from "../../stores/themeStore";
import {
  exportPageToFile,
  importMarkdownFile,
  getExternalEditors,
  openPageInEditor,
  getExternalEditSession,
  checkExternalChanges,
  syncFromExternalEditor,
  endExternalEditSession,
  markAsDailyNote,
  unmarkDailyNote,
  type EditorConfig,
  type EditSession,
} from "../../utils/api";
import { save, open } from "@tauri-apps/plugin-dialog";
import { TagEditor } from "../Tags";
import { SaveAsTemplateDialog } from "../TemplateDialog";
import { PageSettingsDialog } from "../PageSettings";
import { PageHistoryDialog } from "../PageHistory";
import { WritingAssistancePanel } from "./WritingAssistancePanel";
import { AudioGenerateDialog } from "../Audio";
import { PresentationDialog } from "../Presentation";
import { PrintDialog } from "../Print";
import { useFolderStore } from "../../stores/folderStore";
import { useToastStore } from "../../stores/toastStore";
import { useDrawingStore } from "../../stores/drawingStore";
import { WritingGoalProgress } from "./WritingGoalProgress";
import { WritingGoalSettings } from "./WritingGoalSettings";
import type { PageStats } from "../../utils/pageStats";

interface PageHeaderProps {
  page: Page;
  isSaving: boolean;
  lastSaved: Date | null;
  stats?: PageStats | null;
  pageText?: string; // Plain text content for writing assistance
  zenMode?: boolean;
  onExitZenMode?: () => void;
  onEnterZenMode?: () => void;
  onToggleHistory?: () => void;
  historyCount?: number;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onToggleOutline?: () => void;
  showOutline?: boolean;
}

export function PageHeader({
  page,
  isSaving,
  lastSaved,
  stats,
  pageText = "",
  zenMode = false,
  onExitZenMode,
  onEnterZenMode,
  onToggleHistory,
  historyCount = 0,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onToggleOutline,
  showOutline = false,
}: PageHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(page.title);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);
  const [showPageSettings, setShowPageSettings] = useState(false);
  const [showPageHistory, setShowPageHistory] = useState(false);
  const [showWritingAssistance, setShowWritingAssistance] = useState(false);
  const [showAudioGenerate, setShowAudioGenerate] = useState(false);
  const [showPresentation, setShowPresentation] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [externalEditSession, setExternalEditSession] =
    useState<EditSession | null>(null);
  const [availableEditors, setAvailableEditors] = useState<EditorConfig[]>([]);
  const [showEditorPicker, setShowEditorPicker] = useState(false);
  const [hasExternalChanges, setHasExternalChanges] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showWritingGoalSettings, setShowWritingGoalSettings] = useState(false);
  const [showDailyNoteDialog, setShowDailyNoteDialog] = useState(false);
  const [dailyNoteDate, setDailyNoteDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const {
    updatePage,
    selectPage,
    archivePage,
    unarchivePage,
    createPage,
    updatePageContent,
    toggleFavorite,
  } = usePageStore();
  const { loadFolders } = useFolderStore();
  const { getTemplateForPage } = useTemplateStore();
  const { showPageStats, togglePageStats } = useThemeStore();
  const toast = useToastStore();
  const { openAnnotationOverlay } = useDrawingStore();

  // Check if this page is a template source
  const pageTemplate = getTemplateForPage(page.id);

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

  // Load available editors on mount
  useEffect(() => {
    getExternalEditors().then(setAvailableEditors).catch(console.error);
  }, []);

  // Check for existing external edit session when page changes
  useEffect(() => {
    getExternalEditSession(page.id)
      .then(setExternalEditSession)
      .catch(() => setExternalEditSession(null));
  }, [page.id]);

  // Periodically check for external changes when in an edit session
  useEffect(() => {
    if (!externalEditSession) {
      setHasExternalChanges(false);
      return;
    }

    const checkChanges = async () => {
      try {
        const changes = await checkExternalChanges(page.id);
        setHasExternalChanges(changes !== null);
      } catch {
        // Session may have ended
        setExternalEditSession(null);
      }
    };

    // Check immediately and then every 2 seconds
    checkChanges();
    const interval = setInterval(checkChanges, 2000);
    return () => clearInterval(interval);
  }, [externalEditSession, page.id]);

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

  const handleOpenPageSettings = () => {
    setIsMenuOpen(false);
    setShowPageSettings(true);
  };

  const handleOpenPageHistory = () => {
    setIsMenuOpen(false);
    setShowPageHistory(true);
  };

  const handleArchive = async () => {
    setIsMenuOpen(false);
    await archivePage(page.notebookId, page.id);
    // Reload folders to ensure archive folder is shown
    await loadFolders(page.notebookId);
  };

  const handleUnarchive = async () => {
    setIsMenuOpen(false);
    await unarchivePage(page.notebookId, page.id);
  };

  const handleMarkAsDailyNote = async () => {
    try {
      await markAsDailyNote(page.notebookId, page.id, dailyNoteDate);
      toast.success(`Marked as daily note for ${dailyNoteDate}`);
      setShowDailyNoteDialog(false);
      // Refresh the page to show updated state
      selectPage(page.id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to mark as daily note";
      toast.error(message);
    }
  };

  const handleUnmarkDailyNote = async () => {
    setIsMenuOpen(false);
    try {
      await unmarkDailyNote(page.notebookId, page.id);
      toast.success("Removed daily note marking");
      // Refresh the page to show updated state
      selectPage(page.id);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to unmark as daily note";
      toast.error(message);
    }
  };

  const handleOpenInEditor = async (editor?: EditorConfig) => {
    setIsMenuOpen(false);
    setShowEditorPicker(false);
    try {
      await openPageInEditor(page.notebookId, page.id, editor);
      const session = await getExternalEditSession(page.id);
      setExternalEditSession(session);
      toast.success(`Opened in ${editor?.name || "external editor"}`);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to open in external editor";
      toast.error(message);
    }
  };

  const handleSyncFromEditor = async () => {
    if (!externalEditSession) return;
    setIsSyncing(true);
    try {
      await syncFromExternalEditor(page.notebookId, page.id);
      setHasExternalChanges(false);
      // Reload the page to get updated content
      selectPage(page.id);
      toast.success("Changes synced from external editor");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to sync from external editor";
      toast.error(message);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleEndExternalEdit = async () => {
    try {
      await endExternalEditSession(page.id);
      setExternalEditSession(null);
      setHasExternalChanges(false);
      toast.info("External edit session ended");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to end external edit session";
      toast.error(message);
    }
  };

  // Handle using this page as a template to create a new page
  const handleUseTemplate = useCallback(async () => {
    if (!pageTemplate) return;

    // Generate title based on template name
    let newTitle = pageTemplate.name;
    if (
      pageTemplate.id === "daily-journal" ||
      pageTemplate.name.toLowerCase().includes("journal")
    ) {
      newTitle = new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } else if (pageTemplate.name.toLowerCase().includes("meeting")) {
      newTitle = `Meeting Notes - ${new Date().toLocaleDateString()}`;
    }

    // Create the page
    const newPage = await createPage(page.notebookId, newTitle);
    if (!newPage) return;

    // If template has content, apply it
    if (pageTemplate.content.blocks.length > 0) {
      const contentWithNewIds: EditorData = {
        time: Date.now(),
        version: pageTemplate.content.version,
        blocks: pageTemplate.content.blocks.map((block) => ({
          ...block,
          id: crypto.randomUUID(),
          data: { ...block.data },
        })),
      };
      await updatePageContent(page.notebookId, newPage.id, contentWithNewIds);
    }
  }, [pageTemplate, page.notebookId, createPage, updatePageContent]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Zen Mode: Minimal header with centered title and exit button on hover
  if (zenMode) {
    return (
      <div
        className="zen-header group relative flex items-center justify-center px-8 py-4"
        style={{ borderColor: "var(--color-border)" }}
      >
        <h1
          className="text-xl font-semibold text-center"
          style={{ color: "var(--color-text-primary)" }}
        >
          {page.title || "Untitled"}
        </h1>

        {/* Save indicator - small and unobtrusive */}
        <div
          className="absolute right-16 flex items-center gap-2 text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          {isSaving ? (
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
          ) : lastSaved ? (
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
              style={{ color: "var(--color-success)" }}
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : null}
        </div>

        {/* Exit button - appears on hover */}
        {onExitZenMode && (
          <button
            onClick={onExitZenMode}
            className="zen-exit-btn absolute right-4 rounded-lg p-2 transition-all opacity-0 group-hover:opacity-100"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-muted)",
            }}
            title="Exit Zen Mode (Esc)"
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
        )}
      </div>
    );
  }

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
            <div className="flex items-center gap-3">
              <h1
                onClick={() => setIsEditing(true)}
                className="cursor-text text-2xl font-bold"
                style={{ color: "var(--color-text-primary)" }}
              >
                {page.title || "Untitled"}
              </h1>
              {pageTemplate && (
                <span
                  className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: "rgba(139, 92, 246, 0.15)",
                    color: "var(--color-accent)",
                  }}
                  title={`Template: ${pageTemplate.name}`}
                >
                  Template
                </span>
              )}
              {page.systemPrompt && (
                <span
                  className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: "rgba(59, 130, 246, 0.15)",
                    color: "rgb(59, 130, 246)",
                  }}
                  title="Has custom AI prompt"
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
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  AI Prompt
                </span>
              )}
              {page.isDailyNote && (
                <span
                  className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: "rgba(34, 197, 94, 0.15)",
                    color: "rgb(34, 197, 94)",
                  }}
                  title={`Daily Note: ${page.dailyNoteDate}`}
                >
                  Daily Note
                </span>
              )}
              {page.isArchived && (
                <span
                  className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: "rgba(255, 193, 7, 0.15)",
                    color: "rgb(255, 193, 7)",
                  }}
                >
                  Archived
                </span>
              )}
            </div>
          )}
        </div>

        {/* Use Template button - only shown for template source pages */}
        {pageTemplate && (
          <button
            onClick={handleUseTemplate}
            className="ml-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:opacity-90"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "white",
            }}
            title={`Create new page from "${pageTemplate.name}" template`}
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
              <path d="M12 5v14M5 12h14" />
            </svg>
            Use Template
          </button>
        )}

        {/* Star/Favorite button */}
        <button
          onClick={() => toggleFavorite(page.notebookId, page.id)}
          className="ml-4 rounded-lg p-2 transition-colors hover:opacity-80"
          style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          title={page.isFavorite ? "Unstar page (Ctrl+Shift+S)" : "Star page (Ctrl+Shift+S)"}
        >
          {page.isFavorite ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="rgb(250, 204, 21)"
              stroke="rgb(250, 204, 21)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          ) : (
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
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          )}
        </button>

        {/* Undo/Redo buttons */}
        <div className="ml-4 flex items-center">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="rounded-l-lg p-2 transition-colors hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
            title="Undo (Ctrl+Z)"
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
              style={{ color: "var(--color-text-muted)" }}
            >
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
            </svg>
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="rounded-r-lg border-l p-2 transition-colors hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              borderColor: "var(--color-border)",
            }}
            title="Redo (Ctrl+Shift+Z)"
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
              style={{ color: "var(--color-text-muted)" }}
            >
              <path d="M21 7v6h-6" />
              <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
            </svg>
          </button>
        </div>

        {/* History panel button */}
        {onToggleHistory && (
          <button
            onClick={onToggleHistory}
            className="relative ml-2 rounded-lg p-2 transition-colors hover:opacity-80"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
            title="View edit history"
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
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M12 7v5l4 2" />
            </svg>
            {historyCount > 0 && (
              <span
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-medium"
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "white",
                }}
              >
                {historyCount > 9 ? "9+" : historyCount}
              </span>
            )}
          </button>
        )}

        {/* Outline toggle button */}
        {onToggleOutline && (
          <button
            onClick={onToggleOutline}
            className="ml-2 rounded-lg p-2 transition-colors hover:opacity-80"
            style={{
              backgroundColor: showOutline
                ? "var(--color-selection)"
                : "var(--color-bg-tertiary)",
            }}
            title="Toggle outline"
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
              style={{
                color: showOutline
                  ? "var(--color-accent)"
                  : "var(--color-text-muted)",
              }}
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="7" y1="12" x2="21" y2="12" />
              <line x1="11" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        )}

        {/* Zen Mode button */}
        {onEnterZenMode && (
          <button
            onClick={onEnterZenMode}
            className="ml-2 rounded-lg p-2 transition-colors hover:opacity-80"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
            title="Enter Zen Mode (Ctrl+Shift+.)"
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
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
              <path d="M3 16v3a2 2 0 0 0 2 2h3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
          </button>
        )}

        {/* Annotate button */}
        <button
          onClick={() => openAnnotationOverlay(page.notebookId, page.id)}
          className="ml-4 rounded-lg p-2 transition-colors hover:opacity-80"
          style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          title="Annotate page"
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
            <path d="M12 19l7-7 3 3-7 7-3-3z" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
            <path d="M2 2l7.586 7.586" />
            <circle cx="11" cy="11" r="2" />
          </svg>
        </button>

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
              <div className="relative">
                <button
                  onClick={() => setShowEditorPicker(!showEditorPicker)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors hover:opacity-80"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  <div className="flex items-center gap-3">
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
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Open in External Editor
                  </div>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                {showEditorPicker && (
                  <div
                    className="absolute left-full top-0 ml-1 min-w-44 rounded-lg border py-1 shadow-lg"
                    style={{
                      backgroundColor: "var(--color-bg-secondary)",
                      borderColor: "var(--color-border)",
                    }}
                  >
                    {availableEditors.map((editor) => (
                      <button
                        key={editor.name}
                        onClick={() => handleOpenInEditor(editor)}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:opacity-80"
                        style={{ color: "var(--color-text-secondary)" }}
                      >
                        {editor.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
              <button
                onClick={handleOpenPageSettings}
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
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                AI Settings
              </button>
              <button
                onClick={handleOpenPageHistory}
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
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M12 7v5l4 2" />
                </svg>
                View History
              </button>
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  setShowWritingAssistance(true);
                }}
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
                  <path d="m6 16 6-12 6 12" />
                  <path d="M8 12h8" />
                  <path d="m16 20 2 2 4-4" />
                </svg>
                Check Writing
              </button>
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  setShowAudioGenerate(true);
                }}
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
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
                Generate Audio
              </button>
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  setShowPresentation(true);
                }}
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
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                Present as Slides
              </button>
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  setShowPrint(true);
                }}
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
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
                Print / PDF
              </button>
              <div
                className="my-1 border-t"
                style={{ borderColor: "var(--color-border)" }}
              />
              {page.isArchived ? (
                <button
                  onClick={handleUnarchive}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:opacity-80"
                  style={{ color: "var(--color-accent)" }}
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
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                  Unarchive Page
                </button>
              ) : (
                <button
                  onClick={handleArchive}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:opacity-80"
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
                    <rect x="2" y="4" width="20" height="5" rx="1" />
                    <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
                    <path d="M10 13h4" />
                  </svg>
                  Archive Page
                </button>
              )}
              {/* Daily Note options */}
              {page.isDailyNote ? (
                <button
                  onClick={handleUnmarkDailyNote}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:opacity-80"
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
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                    <line x1="9" y1="16" x2="15" y2="16" />
                  </svg>
                  Unmark as Daily Note
                </button>
              ) : (
                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    setShowDailyNoteDialog(true);
                  }}
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
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  Mark as Daily Note
                </button>
              )}

              {/* Writing Goal */}
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  setShowWritingGoalSettings(true);
                }}
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
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                Writing Goal
              </button>
            </div>
          )}
        </div>

        {/* Page stats */}
        {stats && (
          <div className="ml-4 flex items-center gap-2">
            {showPageStats && (
              <div className="flex items-center gap-3">
                <span
                  className="text-xs whitespace-nowrap"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {stats.words.toLocaleString()} words ·{" "}
                  {stats.characters.toLocaleString()} chars ·{" "}
                  {stats.readingTime} min
                </span>
                {stats.readingLevel && (
                  <span
                    className="text-xs whitespace-nowrap rounded-full px-2 py-0.5"
                    style={{
                      backgroundColor: getReadingLevelColor(
                        stats.readingLevel.score
                      ),
                      color: "white",
                    }}
                    title={`Flesch-Kincaid Grade Level: ${stats.readingLevel.grade}`}
                  >
                    {stats.readingLevel.label}
                  </span>
                )}
              </div>
            )}
            <button
              onClick={togglePageStats}
              className="p-1 rounded hover:bg-[--color-bg-tertiary] transition-colors"
              style={{ color: "var(--color-text-muted)" }}
              title={showPageStats ? "Hide stats" : "Show stats"}
            >
              {showPageStats ? (
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
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              ) : (
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
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              )}
            </button>
          </div>
        )}

        {/* Writing goal progress */}
        <div className="ml-2">
          <WritingGoalProgress onOpenSettings={() => setShowWritingGoalSettings(true)} />
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

      {/* External Editor Session Banner */}
      {externalEditSession && (
        <div
          className="mt-3 flex items-center justify-between rounded-lg px-4 py-3"
          style={{
            backgroundColor: hasExternalChanges
              ? "rgba(245, 158, 11, 0.15)"
              : "rgba(59, 130, 246, 0.1)",
            border: hasExternalChanges
              ? "1px solid rgba(245, 158, 11, 0.3)"
              : "1px solid rgba(59, 130, 246, 0.2)",
          }}
        >
          <div className="flex items-center gap-3">
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
              style={{
                color: hasExternalChanges
                  ? "rgb(245, 158, 11)"
                  : "rgb(59, 130, 246)",
              }}
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            <div>
              <span
                className="text-sm font-medium"
                style={{
                  color: hasExternalChanges
                    ? "rgb(245, 158, 11)"
                    : "rgb(59, 130, 246)",
                }}
              >
                {hasExternalChanges
                  ? "External changes detected"
                  : "Editing in external editor"}
              </span>
              <span
                className="ml-2 text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {externalEditSession.tempPath.split("/").pop()}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasExternalChanges && (
              <button
                onClick={handleSyncFromEditor}
                disabled={isSyncing}
                className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:opacity-90"
                style={{
                  backgroundColor: "rgb(245, 158, 11)",
                  color: "white",
                }}
              >
                {isSyncing ? (
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
                    Syncing...
                  </>
                ) : (
                  <>
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
                      <path d="M21 2v6h-6" />
                      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                      <path d="M3 22v-6h6" />
                      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                    </svg>
                    Sync Changes
                  </>
                )}
              </button>
            )}
            <button
              onClick={handleEndExternalEdit}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors hover:opacity-80"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-secondary)",
              }}
            >
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
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              End Session
            </button>
          </div>
        </div>
      )}

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

      {/* Page Settings Dialog */}
      <PageSettingsDialog
        isOpen={showPageSettings}
        page={page}
        onClose={() => setShowPageSettings(false)}
      />

      {/* Page History Dialog */}
      <PageHistoryDialog
        isOpen={showPageHistory}
        page={page}
        onClose={() => setShowPageHistory(false)}
      />

      {/* Writing Assistance Panel */}
      <WritingAssistancePanel
        isOpen={showWritingAssistance}
        onClose={() => setShowWritingAssistance(false)}
        text={pageText}
      />

      {/* Audio Generate Dialog */}
      <AudioGenerateDialog
        isOpen={showAudioGenerate}
        onClose={() => setShowAudioGenerate(false)}
        notebookId={page.notebookId}
        pageId={page.id}
        pageTitle={page.title || "Untitled"}
      />

      {/* Presentation Dialog */}
      <PresentationDialog
        isOpen={showPresentation}
        onClose={() => setShowPresentation(false)}
        page={page}
      />

      {/* Print Dialog */}
      <PrintDialog
        isOpen={showPrint}
        onClose={() => setShowPrint(false)}
        page={page}
      />

      {/* Writing Goal Settings */}
      <WritingGoalSettings
        isOpen={showWritingGoalSettings}
        onClose={() => setShowWritingGoalSettings(false)}
      />

      {/* Mark as Daily Note Dialog */}
      {showDailyNoteDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setShowDailyNoteDialog(false)}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-sm rounded-xl border p-6 shadow-2xl"
            style={{
              backgroundColor: "var(--color-bg-panel)",
              borderColor: "var(--color-border)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className="mb-4 text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Mark as Daily Note
            </h3>
            <p
              className="mb-4 text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              Select the date for this daily note:
            </p>
            <input
              type="date"
              value={dailyNoteDate}
              onChange={(e) => setDailyNoteDate(e.target.value)}
              className="mb-4 w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
              style={{
                backgroundColor: "var(--color-bg-secondary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDailyNoteDialog(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:opacity-80"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleMarkAsDailyNote}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
                style={{ backgroundColor: "var(--color-accent)" }}
              >
                Mark as Daily Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Get background color for reading level badge based on Flesch score
 */
function getReadingLevelColor(score: number): string {
  if (score >= 80) return "rgb(34, 197, 94)"; // Green - Easy
  if (score >= 60) return "rgb(59, 130, 246)"; // Blue - Standard
  if (score >= 40) return "rgb(245, 158, 11)"; // Amber - Moderate
  return "rgb(239, 68, 68)"; // Red - Difficult
}
