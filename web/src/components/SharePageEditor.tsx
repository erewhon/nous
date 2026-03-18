/**
 * BlockNote editor for shared notebook page editing.
 * Uses ShareAPI (unauthenticated) instead of CloudAPI.
 * Supports REST auto-save and live Yjs collaboration.
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
import { blocksToYXmlFragment } from "@blocknote/core/yjs";
import type { NotebookMeta } from "../store";
import {
  WebCollabProvider,
  type CollaborationOptions,
  type ConnectionStatus,
} from "../collab/WebCollabProvider";

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

  // Collab state
  const [collabProvider, setCollabProvider] = useState<WebCollabProvider | null>(null);
  const [collabOptions, setCollabOptions] = useState<CollaborationOptions | null>(null);
  const [collabStatus, setCollabStatus] = useState<ConnectionStatus>("disconnected");
  const [participantCount, setParticipantCount] = useState(0);
  const [collabStarting, setCollabStarting] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  const isCollab = collabProvider !== null;

  const originalTitle = useRef((pageData.title as string) ?? "Untitled");
  const savingRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const titleRef = useRef(title);
  titleRef.current = title;
  const collabProviderRef = useRef<WebCollabProvider | null>(null);
  collabProviderRef.current = collabProvider;

  const initialContent = useMemo(() => {
    if (collabOptions) return undefined;
    const content = pageData.content as EditorData | undefined;
    if (content?.blocks) {
      return editorJsToBlockNote(content);
    }
    return undefined;
  }, [pageData, collabOptions]);

  const editor = useCreateBlockNote(
    {
      schema,
      initialContent,
      collaboration: collabOptions ?? undefined,
    },
    [editorKey],
  );

  // ─── REST save logic ──────────────────────────────────────────────────

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
        const result = await shareApi.downloadPage(shareId, pageId);
        if (result?.etag) {
          sharePageEtagCache.set(`${shareId}:${pageId}`, result.etag);
        }
      }

      const encrypted = await encryptJSON(notebookKey, updatedPageData);
      const ifMatch = sharePageEtagCache.get(`${shareId}:${pageId}`);
      const newEtag = await shareApi.uploadPage(shareId, pageId, encrypted, ifMatch);
      if (newEtag) {
        sharePageEtagCache.set(`${shareId}:${pageId}`, newEtag);
      }

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
    if (isCollab) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      performSave();
    }, AUTO_SAVE_DELAY);
  }, [performSave, isCollab]);

  const markDirty = useCallback(() => {
    if (isCollab) return;
    setSaveStatus("dirty");
    setSaveError("");
    setConflictMessage("");
    scheduleAutoSave();
  }, [scheduleAutoSave, isCollab]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (!isCollab) {
          if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
          performSave();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [performSave, isCollab]);

  useEffect(() => {
    if (isCollab) return;
    editor.onEditorContentChange(markDirty);
    return () => { editor.onEditorContentChange(() => {}); };
  }, [editor, markDirty, isCollab]);

  useEffect(() => {
    if (!isCollab && title !== originalTitle.current) markDirty();
  }, [title, markDirty, isCollab]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  // ─── Collab session management ────────────────────────────────────────

  const startCollab = useCallback(async () => {
    setCollabStarting(true);
    try {
      const session = await shareApi.startCollabSession(shareId, pageId);

      const provider = new WebCollabProvider({
        host: session.partykitHost,
        roomId: session.roomId,
        token: session.token,
        party: session.party,
        user: { name: "Guest", color: "#f59e0b" },
        onStatusChange: (state) => setCollabStatus(state.status),
        onParticipantsChange: (count) => setParticipantCount(count),
        onSynced: () => {
          if (provider.fragment.length === 0) {
            try {
              const content = pageData.content as EditorData | undefined;
              if (content?.blocks) {
                (provider as any)._pendingSeed = editorJsToBlockNote(content);
              }
            } catch (e) {
              console.error("Failed to prepare collab seed:", e);
            }
          }
        },
      });

      setCollabProvider(provider);
      setCollabOptions(provider.getCollaborationOptions());
      setCollabStatus("connecting");
      setSaveStatus("clean");
      setEditorKey((k) => k + 1);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to start live session");
      setSaveStatus("error");
    } finally {
      setCollabStarting(false);
    }
  }, [shareId, pageId, pageData]);

  // Seed content after editor re-creation
  useEffect(() => {
    if (!isCollab || !collabProvider) return;
    const pendingSeed = (collabProvider as any)._pendingSeed;
    if (pendingSeed && collabProvider.fragment.length === 0) {
      try {
        blocksToYXmlFragment(editor, pendingSeed, collabProvider.fragment);
      } catch (e) {
        console.error("Failed to seed collab content:", e);
      }
      delete (collabProvider as any)._pendingSeed;
    }
  }, [editor, isCollab, collabProvider]);

  const stopCollab = useCallback(async () => {
    if (!collabProvider) return;

    try {
      const bnDoc = editor.document;
      const editorJsData = blockNoteToEditorJs(bnDoc);
      const currentTitle = titleRef.current;
      const now = new Date().toISOString();

      const updatedPageData = {
        ...pageData,
        title: currentTitle,
        content: editorJsData,
        updatedAt: now,
      };

      const encrypted = await encryptJSON(notebookKey, updatedPageData);
      const ifMatch = sharePageEtagCache.get(`${shareId}:${pageId}`);
      const newEtag = await shareApi.uploadPage(shareId, pageId, encrypted, ifMatch);
      if (newEtag) {
        sharePageEtagCache.set(`${shareId}:${pageId}`, newEtag);
      }
      await updateMetaTimestamp(shareId, pageId, currentTitle, notebookKey);
    } catch (err) {
      console.error("Failed to save on collab stop:", err);
    }

    collabProvider.destroy();
    setCollabProvider(null);
    setCollabOptions(null);
    setCollabStatus("disconnected");
    setParticipantCount(0);
    setSaveStatus("saved");
    setEditorKey((k) => k + 1);
  }, [collabProvider, editor, pageData, shareId, pageId, notebookKey]);

  useEffect(() => {
    return () => {
      const provider = collabProviderRef.current;
      if (provider) provider.destroy();
    };
  }, []);

  // ─── Done handler ─────────────────────────────────────────────────────

  const handleDone = useCallback(async () => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    if (isCollab) {
      await stopCollab();
      onDone();
    } else if (saveStatus === "dirty" || saveStatus === "error") {
      const ok = await performSave();
      if (ok) onDone();
    } else {
      onDone();
    }
  }, [saveStatus, performSave, onDone, isCollab, stopCollab]);

  // ─── Render ───────────────────────────────────────────────────────────

  const statusLabel = (() => {
    if (isCollab) {
      if (collabStatus === "connected") {
        return participantCount > 1
          ? `Live (${participantCount} users)`
          : "Live";
      }
      if (collabStatus === "connecting") return "Connecting...";
      return "Disconnected";
    }
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
    if (isCollab) {
      return collabStatus === "connected"
        ? "editor-status-live"
        : "editor-status-saving";
    }
    switch (saveStatus) {
      case "saved": return "editor-status-saved";
      case "saving": return "editor-status-saving";
      case "error": case "conflict": return "editor-status-error";
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
          {!isCollab && (
            <button
              className="btn btn-ghost editor-collab-btn"
              onClick={startCollab}
              disabled={collabStarting}
              title="Start live collaboration session"
            >
              {collabStarting ? "Starting..." : "Live Edit"}
            </button>
          )}
          {isCollab && (
            <button
              className="btn btn-ghost editor-collab-btn"
              onClick={stopCollab}
              title="Stop live session and save"
            >
              Stop Live
            </button>
          )}
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
    // Meta update failure is non-fatal
  }
}
