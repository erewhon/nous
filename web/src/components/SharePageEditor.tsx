/**
 * BlockNote editor for shared notebook page editing.
 * Uses ShareAPI (unauthenticated) instead of CloudAPI.
 * Auto-saves 3s after last change. Ctrl+S for immediate save.
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
import { ShareAPI, ETagConflictError } from "../api";
import { encryptJSON, decryptJSON } from "../crypto";
import type { NotebookMeta } from "../store";

const AUTO_SAVE_DELAY = 3000;

type SaveStatus = "clean" | "dirty" | "saving" | "saved" | "conflict" | "error";

interface SharePageEditorProps {
  shareId: string;
  pageId: string;
  pageData: Record<string, unknown>;
  notebookKey: CryptoKey;
  onDone: () => void;
}

const shareApi = new ShareAPI();

// ETag caches for share editing
const sharePageEtagCache = new Map<string, string>();
const shareMetaEtagCache = new Map<string, string>();

export function SharePageEditor({
  shareId,
  pageId,
  pageData,
  notebookKey,
  onDone,
}: SharePageEditorProps) {
  const [title, setTitle] = useState(
    (pageData.title as string) ?? "Untitled",
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("clean");
  const [saveError, setSaveError] = useState("");
  const [conflictMessage, setConflictMessage] = useState("");

  const originalTitle = useRef((pageData.title as string) ?? "Untitled");
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

  const performSave = useCallback(async (force = false): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaveStatus("saving");
    setSaveError("");
    setConflictMessage("");

    try {
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

      if (force) {
        // Re-fetch page to get fresh ETag
        const result = await shareApi.downloadPage(shareId, pageId);
        if (result?.etag) {
          sharePageEtagCache.set(`${shareId}:${pageId}`, result.etag);
        }
      }

      // Encrypt and upload via share API
      const encrypted = await encryptJSON(notebookKey, updatedPageData);
      const ifMatch = sharePageEtagCache.get(`${shareId}:${pageId}`);
      const newEtag = await shareApi.uploadPage(shareId, pageId, encrypted, ifMatch);
      if (newEtag) {
        sharePageEtagCache.set(`${shareId}:${pageId}`, newEtag);
      }

      // Always update meta timestamp
      await updateMetaTimestamp(shareId, pageId, currentTitle, notebookKey);
      originalTitle.current = currentTitle;

      setSaveStatus("saved");
      return true;
    } catch (err) {
      if (err instanceof ETagConflictError) {
        setSaveStatus("conflict");
        setConflictMessage(
          "This page was modified by another client. Save anyway?",
        );
        return false;
      }
      setSaveStatus("error");
      setSaveError(err instanceof Error ? err.message : "Save failed");
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [editor, pageData, shareId, pageId, notebookKey]);

  const handleForceOverwrite = useCallback(async () => {
    await performSave(true);
  }, [performSave]);

  const dismissConflict = useCallback(() => {
    setSaveStatus("dirty");
    setConflictMessage("");
  }, []);

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      performSave();
    }, AUTO_SAVE_DELAY);
  }, [performSave]);

  const markDirty = useCallback(() => {
    setSaveStatus("dirty");
    setSaveError("");
    setConflictMessage("");
    scheduleAutoSave();
  }, [scheduleAutoSave]);

  // Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        performSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [performSave]);

  useEffect(() => {
    editor.onEditorContentChange(markDirty);
    return () => { editor.onEditorContentChange(() => {}); };
  }, [editor, markDirty]);

  useEffect(() => {
    if (title !== originalTitle.current) markDirty();
  }, [title, markDirty]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  const handleDone = useCallback(async () => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    if (saveStatus === "dirty" || saveStatus === "error") {
      const ok = await performSave();
      if (ok) onDone();
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

/** Update the page's updatedAt in the shared notebook meta. */
async function updateMetaTimestamp(
  shareId: string,
  pageId: string,
  title: string,
  notebookKey: CryptoKey,
) {
  try {
    const result = await shareApi.downloadMeta(shareId);
    if (!result) return;

    if (result.etag) {
      shareMetaEtagCache.set(shareId, result.etag);
    }

    const meta = await decryptJSON<NotebookMeta>(notebookKey, result.data);
    const page = meta.pageSummaries?.find((p) => p.id === pageId);
    if (page) {
      page.title = title;
      page.updatedAt = new Date().toISOString();
    }

    const reEncrypted = await encryptJSON(notebookKey, meta);
    const ifMatch = shareMetaEtagCache.get(shareId);
    const newEtag = await shareApi.uploadMeta(shareId, reEncrypted, ifMatch);
    if (newEtag) {
      shareMetaEtagCache.set(shareId, newEtag);
    }
  } catch {
    // Meta update failure is non-fatal for page save
  }
}
