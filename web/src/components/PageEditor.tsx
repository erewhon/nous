/**
 * BlockNote editor for web page editing.
 * Auto-saves 3s after last change. Ctrl+S for immediate save.
 * Conflict detection: checks server version before saving.
 */
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";

import { schema } from "../editor/schema";
import {
  editorJsToBlockNote,
  blockNoteToEditorJs,
  type EditorData,
} from "../utils/blockFormatConverter";
import { useWebStore } from "../store";

const AUTO_SAVE_DELAY = 3000;

type SaveStatus = "clean" | "dirty" | "saving" | "saved" | "conflict" | "error";

interface PageEditorProps {
  notebookId: string;
  pageId: string;
  pageData: Record<string, unknown>;
  onDone: () => void;
}

export function PageEditor({
  notebookId,
  pageId,
  pageData,
  onDone,
}: PageEditorProps) {
  const { savePage, updatePageInMeta, loadPage } = useWebStore();

  const [title, setTitle] = useState(
    (pageData.title as string) ?? "Untitled",
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("clean");
  const [saveError, setSaveError] = useState("");
  const [conflictMessage, setConflictMessage] = useState("");

  const originalTitle = useRef((pageData.title as string) ?? "Untitled");
  const loadedUpdatedAt = useRef((pageData.updatedAt as string) ?? "");
  const savingRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const titleRef = useRef(title);
  titleRef.current = title;

  const initialContent = useMemo(() => {
    const content = pageData.content as EditorData | undefined;
    if (content?.blocks) {
      return editorJsToBlockNote(content);
    }
    return undefined;
  }, [pageData]);

  const editor = useCreateBlockNote({
    schema,
    initialContent,
  });

  // Core save logic — used by auto-save, Ctrl+S, and Done button
  const performSave = useCallback(async (force = false): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaveStatus("saving");
    setSaveError("");
    setConflictMessage("");

    try {
      // Conflict detection: check server version before saving
      if (!force) {
        const serverData = await loadPage(notebookId, pageId) as Record<string, unknown> | null;
        if (serverData) {
          const serverUpdatedAt = (serverData.updatedAt as string) ?? "";
          if (
            serverUpdatedAt &&
            loadedUpdatedAt.current &&
            serverUpdatedAt > loadedUpdatedAt.current
          ) {
            setSaveStatus("conflict");
            setConflictMessage(
              `This page was modified elsewhere at ${new Date(serverUpdatedAt).toLocaleTimeString()}. Save anyway?`,
            );
            savingRef.current = false;
            return false;
          }
        }
      }

      const currentTitle = titleRef.current;
      const bnDoc = editor.document;
      const editorJsData = blockNoteToEditorJs(bnDoc);
      const now = new Date().toISOString();

      const updatedPageData = {
        ...pageData,
        title: currentTitle,
        content: editorJsData,
        updatedAt: now,
      };

      await savePage(notebookId, pageId, updatedPageData);

      // Update our loaded timestamp so future conflict checks are correct
      loadedUpdatedAt.current = now;

      // Update meta if title changed
      if (currentTitle !== originalTitle.current) {
        await updatePageInMeta(notebookId, pageId, currentTitle);
        originalTitle.current = currentTitle;
      }

      setSaveStatus("saved");
      return true;
    } catch (err) {
      setSaveStatus("error");
      setSaveError(err instanceof Error ? err.message : "Save failed");
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [editor, pageData, notebookId, pageId, savePage, updatePageInMeta, loadPage]);

  // Force save (overwrite conflict)
  const handleForceOverwrite = useCallback(async () => {
    await performSave(true);
  }, [performSave]);

  const dismissConflict = useCallback(() => {
    setSaveStatus("dirty");
    setConflictMessage("");
  }, []);

  // Schedule auto-save
  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      performSave();
    }, AUTO_SAVE_DELAY);
  }, [performSave]);

  // Mark dirty and schedule auto-save
  const markDirty = useCallback(() => {
    setSaveStatus("dirty");
    setSaveError("");
    setConflictMessage("");
    scheduleAutoSave();
  }, [scheduleAutoSave]);

  // Ctrl+S handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
        }
        performSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [performSave]);

  // Track editor content changes
  useEffect(() => {
    editor.onEditorContentChange(markDirty);
    return () => {
      editor.onEditorContentChange(() => {});
    };
  }, [editor, markDirty]);

  // Track title changes
  useEffect(() => {
    if (title !== originalTitle.current) {
      markDirty();
    }
  }, [title, markDirty]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // Done = save immediately then exit
  const handleDone = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    if (saveStatus === "dirty" || saveStatus === "error") {
      const ok = await performSave();
      if (ok) onDone();
      // If conflict/error, stay in editor
    } else {
      onDone();
    }
  }, [saveStatus, performSave, onDone]);

  const statusLabel = (() => {
    switch (saveStatus) {
      case "saving": return "Saving...";
      case "saved": return "Saved";
      case "dirty": return "Unsaved changes";
      case "conflict": return "Conflict";
      case "error": return saveError || "Save failed";
      default: return "";
    }
  })();

  const statusClass = (() => {
    switch (saveStatus) {
      case "saved": return "editor-status-saved";
      case "saving": return "editor-status-saving";
      case "error": return "editor-status-error";
      case "conflict": return "editor-status-error";
      default: return "editor-status-dirty";
    }
  })();

  return (
    <div className="page-editor">
      <div className="editor-toolbar">
        <div className="editor-toolbar-left">
          {statusLabel && (
            <span className={`editor-status ${statusClass}`}>
              {statusLabel}
            </span>
          )}
        </div>
        <div className="editor-toolbar-right">
          <button
            className="btn btn-primary editor-save-btn"
            onClick={handleDone}
            disabled={saveStatus === "saving"}
          >
            Done
          </button>
        </div>
      </div>

      {saveStatus === "conflict" && conflictMessage && (
        <div className="editor-conflict-bar">
          <span>{conflictMessage}</span>
          <div className="editor-conflict-actions">
            <button className="btn btn-ghost" onClick={dismissConflict}>
              Cancel
            </button>
            <button
              className="btn btn-primary editor-save-btn"
              onClick={handleForceOverwrite}
            >
              Overwrite
            </button>
          </div>
        </div>
      )}

      <div className="page-viewer">
        <input
          className="editor-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
        />

        <div className="editor-container">
          <BlockNoteView editor={editor} theme="dark" />
        </div>
      </div>
    </div>
  );
}
