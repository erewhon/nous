import { useEffect, useRef, useState, useCallback } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { useThemeStore } from "../../stores/themeStore";
import { useLinkedFileSync } from "../../hooks/useLinkedFileSync";
import { LinkedFileChangedBanner } from "../LinkedFile";
import type { Page } from "../../types/page";
import * as api from "../../utils/api";

interface MarkdownEditorProps {
  page: Page;
  notebookId: string;
  onSave?: (content: string) => void;
  className?: string;
}

export function MarkdownEditor({ page, notebookId, onSave, className = "" }: MarkdownEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [content, setContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const resolvedMode = useThemeStore((state) => state.resolvedMode);
  const isDark = resolvedMode === "dark";
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Linked file sync detection
  const { isModified, dismiss, markSynced } = useLinkedFileSync(page, notebookId);

  // Reload the markdown file
  const handleReload = useCallback(async () => {
    setIsReloading(true);
    try {
      // Mark the file as synced
      await api.markLinkedFileSynced(notebookId, page.id);
      markSynced();
      // Force reload
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("Failed to reload markdown:", err);
    } finally {
      setIsReloading(false);
    }
  }, [notebookId, page.id, markSynced]);

  // Load markdown content
  useEffect(() => {
    const loadContent = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await api.getFileContent(notebookId, page.id);
        setContent(result.content);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load content");
        console.error("Failed to load markdown content:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadContent();
  }, [notebookId, page.id, reloadKey]);

  // Handle auto-save
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);

      // Debounced auto-save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        setIsSaving(true);
        try {
          await api.updateFileContent(notebookId, page.id, newContent);
          setLastSaved(new Date());
          onSave?.(newContent);
        } catch (err) {
          console.error("Failed to save markdown:", err);
        } finally {
          setIsSaving(false);
        }
      }, 2000);
    },
    [notebookId, page.id, onSave]
  );

  // Handle explicit save (Ctrl+S)
  const handleExplicitSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    setIsSaving(true);
    try {
      const currentContent = viewRef.current?.state.doc.toString() || content;
      await api.updateFileContent(notebookId, page.id, currentContent);
      setLastSaved(new Date());
      onSave?.(currentContent);
    } catch (err) {
      console.error("Failed to save markdown:", err);
    } finally {
      setIsSaving(false);
    }
  }, [notebookId, page.id, content, onSave]);

  // Initialize CodeMirror
  useEffect(() => {
    if (!editorRef.current || isLoading) return;

    // Clean up existing view
    if (viewRef.current) {
      viewRef.current.destroy();
    }

    const extensions = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
        {
          key: "Mod-s",
          run: () => {
            handleExplicitSave();
            return true;
          },
        },
      ]),
      markdown({ base: markdownLanguage }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newContent = update.state.doc.toString();
          handleContentChange(newContent);
        }
      }),
      EditorView.lineWrapping,
      // Theme
      ...(isDark ? [oneDark] : []),
      // Custom styling
      EditorView.theme({
        "&": {
          height: "100%",
          fontSize: "16px",
          fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
        },
        ".cm-content": {
          padding: "16px 0",
        },
        ".cm-line": {
          padding: "0 16px",
        },
        ".cm-gutters": {
          backgroundColor: isDark ? "#1e1e1e" : "#f5f5f5",
          borderRight: "1px solid var(--color-border)",
        },
        ".cm-activeLineGutter": {
          backgroundColor: isDark ? "#2a2a2a" : "#e8e8e8",
        },
        "&.cm-focused .cm-cursor": {
          borderLeftColor: "var(--color-primary)",
        },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
          backgroundColor: isDark ? "#264f78" : "#add6ff",
        },
      }),
    ];

    const state = EditorState.create({
      doc: content,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
    };
  }, [isLoading, isDark, content, handleContentChange, handleExplicitSave]);

  // Cleanup save timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-64 ${className}`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-gray-100 mx-auto mb-2"></div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading markdown...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-64 ${className}`}>
        <div className="text-center text-red-500">
          <p className="font-medium">Failed to load content</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Linked file changed banner */}
      {isModified && (
        <LinkedFileChangedBanner
          onReload={handleReload}
          onDismiss={dismiss}
          isReloading={isReloading}
          fileName={page.title}
        />
      )}

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center space-x-4">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Markdown
          </span>
          {page.fileExtension && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              .{page.fileExtension}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400">
          {isSaving && (
            <span className="flex items-center">
              <span className="animate-pulse mr-1">Saving...</span>
            </span>
          )}
          {lastSaved && !isSaving && (
            <span>Saved at {lastSaved.toLocaleTimeString()}</span>
          )}
          <span className="text-gray-400 dark:text-gray-500">
            Ctrl+S to save
          </span>
        </div>
      </div>

      {/* Editor */}
      <div
        ref={editorRef}
        className="flex-1 overflow-auto bg-white dark:bg-gray-900"
      />
    </div>
  );
}
