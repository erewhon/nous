/**
 * BlockNote editor for web page editing.
 * Manual save only (Ctrl+S or Save button). No auto-save.
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

interface PageEditorProps {
  notebookId: string;
  pageId: string;
  pageData: Record<string, unknown>;
  onSaved: () => void;
  onCancel: () => void;
}

export function PageEditor({
  notebookId,
  pageId,
  pageData,
  onSaved,
  onCancel,
}: PageEditorProps) {
  const { savePage, updatePageInMeta } = useWebStore();

  const [title, setTitle] = useState(
    (pageData.title as string) ?? "Untitled",
  );
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [saveError, setSaveError] = useState("");

  const originalTitle = useRef((pageData.title as string) ?? "Untitled");

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

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaveError("");

    try {
      const bnDoc = editor.document;
      const editorJsData = blockNoteToEditorJs(bnDoc);

      // Merge with original page data to preserve fields we don't edit
      const updatedPageData = {
        ...pageData,
        title,
        content: editorJsData,
        updatedAt: new Date().toISOString(),
      };

      await savePage(notebookId, pageId, updatedPageData);

      // Update meta if title changed
      if (title !== originalTitle.current) {
        await updatePageInMeta(notebookId, pageId, title);
        originalTitle.current = title;
      }

      setIsDirty(false);
      onSaved();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Save failed",
      );
    } finally {
      setSaving(false);
    }
  }, [
    editor,
    saving,
    title,
    pageData,
    notebookId,
    pageId,
    savePage,
    updatePageInMeta,
    onSaved,
  ]);

  // Ctrl+S handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  // Track dirty state from editor changes
  useEffect(() => {
    const onChange = () => setIsDirty(true);
    editor.onEditorContentChange(onChange);
    return () => {
      editor.onEditorContentChange(() => {});
    };
  }, [editor]);

  // Track dirty state from title changes
  useEffect(() => {
    if (title !== originalTitle.current) {
      setIsDirty(true);
    }
  }, [title]);

  return (
    <div className="page-editor">
      <div className="editor-toolbar">
        <div className="editor-toolbar-left">
          {isDirty && (
            <span className="editor-dirty-indicator">Unsaved changes</span>
          )}
          {saveError && (
            <span className="editor-save-error">{saveError}</span>
          )}
        </div>
        <div className="editor-toolbar-right">
          <button
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary editor-save-btn"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

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
