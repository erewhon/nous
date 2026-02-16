import { useEffect, useRef, useCallback } from "react";
import EditorJS, { type OutputData, type ToolConstructable } from "@editorjs/editorjs";
import { crumb } from "../../utils/breadcrumbs";
import { setPendingSavePromise } from "../../stores/pageStore";
import Header from "@editorjs/header";
import List from "@editorjs/list";
import Quote from "@editorjs/quote";
import Marker from "@editorjs/marker";
import InlineCode from "@editorjs/inline-code";
import Delimiter from "@editorjs/delimiter";
import Table from "@editorjs/table";
import Image from "@editorjs/image";
import { WikiLinkTool } from "./WikiLinkTool";
import { BlockRefTool } from "./BlockRefTool";
import { CodeBlockTool } from "./CodeBlockTool";
import { CalloutTool } from "./CalloutTool";
import { ChecklistTool } from "./ChecklistTool";
import { FlashcardTool } from "./FlashcardTool";
import { HighlighterTool } from "./HighlighterTool";
import { PDFTool } from "./PDFTool";
import { VideoTool } from "./VideoTool";
import { DatabaseBlockTool } from "./DatabaseBlockTool";
import { LiveQueryBlockTool } from "./LiveQueryBlockTool";
import { BlockEmbedTool } from "./BlockEmbedTool";
import { DrawingTool } from "./DrawingTool";
import { EmbedTool } from "./EmbedTool";
import { ColumnsTool } from "./ColumnsTool";
import { createImageUploader } from "./imageUploader";

// Wrapper that hides the "Checklist" style option from the List tool's settings.
// We use a dedicated ChecklistTool instead, which has instant persistence (no
// WebKitGTK freeze from editor.save()). The List tool's built-in checklist mode
// relies on the standard auto-save debounce, so checked state may not persist
// promptly for sync.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ListBase = List as any;
class ListWithoutChecklist extends ListBase {
  renderSettings() {
    const settings = super.renderSettings();
    if (Array.isArray(settings)) {
      return settings.filter(
        (item: { label?: string }) => item.label !== "Checklist"
      );
    }
    return settings;
  }
}

/** Assign data-block-id attributes to each .ce-block holder for scroll targeting.
 *  Only sets the attribute when it is missing or stale, avoiding unnecessary
 *  DOM mutations that would re-trigger Editor.js's internal MutationObserver. */
function assignBlockIdAttributes(editor: EditorJS | null) {
  if (!editor) return;
  try {
    const blocks = editor.blocks;
    for (let i = 0; i < blocks.getBlocksCount(); i++) {
      const block = blocks.getBlockByIndex(i);
      if (block && block.holder.getAttribute("data-block-id") !== block.id) {
        block.holder.setAttribute("data-block-id", block.id);
      }
    }
  } catch {
    // Editor may not be ready yet
  }
}

interface UseEditorOptions {
  holderId: string;
  initialData?: OutputData;
  /** Called when the editor content changes.  data is only provided when
   *  called explicitly (e.g. from structural changes); normal keystroke
   *  changes call with no data to avoid expensive editor.save() on every
   *  keystroke — the debounce timer handles the actual save. */
  onChange?: (data?: OutputData) => void;
  onReady?: () => void;
  onLinkClick?: (pageTitle: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  notebookId?: string;
  pageId?: string;
  pages?: Array<{ id: string; title: string }>;
  /** Called with the latest editor data just before the editor is destroyed on unmount.
   *  This bypasses Editor.js's onChange debounce and captures the true current state. */
  onUnmountSave?: (data: OutputData) => void;
}

export function useEditor({
  holderId,
  initialData,
  onChange,
  onReady,
  onLinkClick,
  readOnly = false,
  placeholder = "Start writing or press '/' for commands...",
  notebookId,
  pageId,
  pages,
  onUnmountSave,
}: UseEditorOptions) {
  const editorRef = useRef<EditorJS | null>(null);
  const isReady = useRef(false);
  // Flag to prevent onChange from firing during render operations
  const isRenderingRef = useRef(false);
  // Tracks the timeout that clears isRenderingRef — cancelled when a new
  // editor is constructed so the old editor's clear doesn't clobber it.
  const renderingGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Re-entry guard: prevents onChange → save() → mutation → onChange → save()
  // infinite cascade.  editor.save() may trigger DOM mutations (e.g., block
  // tool save methods reading innerHTML causes layout → pending mutation
  // resolution), which fires Editor.js's internal MutationObserver again.
  const isSavingRef = useRef(false);
  // Tracks whether the editor has unsaved changes.  When dirty, the
  // initialData effect skips editor.render() to avoid overwriting the
  // user's live edits with (potentially stale) store data.
  const isDirtyRef = useRef(false);
  // Ref to the onUnmountSave callback so the cleanup can always access the latest
  const onUnmountSaveRef = useRef(onUnmountSave);
  onUnmountSaveRef.current = onUnmountSave;
  // Track the initialData used during editor construction so we can skip
  // the redundant render() call that the render effect would otherwise make.
  const constructedWithDataRef = useRef<OutputData | undefined>(undefined);

  // Initialize editor
  useEffect(() => {
    if (editorRef.current) {
      return;
    }

    // Build base tools config (used by main editor and columns)
    const baseTools: Record<string, unknown> = {
      header: {
        class: Header as unknown as ToolConstructable,
        config: {
          levels: [1, 2, 3, 4],
          defaultLevel: 2,
        },
      },
      list: {
        class: ListWithoutChecklist as unknown as ToolConstructable,
        inlineToolbar: true,
        config: {
          defaultStyle: "unordered",
        },
      },
      checklist: {
        class: ChecklistTool as unknown as ToolConstructable,
        inlineToolbar: true,
        config: {
          placeholder: "Add item",
        },
      },
      code: {
        class: CodeBlockTool as unknown as ToolConstructable,
        config: {
          placeholder: "Enter code here...",
        },
      },
      quote: {
        class: Quote as unknown as ToolConstructable,
        inlineToolbar: true,
      },
      marker: Marker,
      highlighter: HighlighterTool,
      inlineCode: InlineCode,
      delimiter: Delimiter as unknown as ToolConstructable,
      table: {
        class: Table as unknown as ToolConstructable,
        inlineToolbar: true,
        config: {
          rows: 2,
          cols: 3,
          withHeadings: true,
        },
      },
      callout: {
        class: CalloutTool as unknown as ToolConstructable,
        inlineToolbar: true,
        config: {
          titlePlaceholder: "Callout title (optional)",
          contentPlaceholder: "Type callout content...",
        },
      },
      flashcard: {
        class: FlashcardTool as unknown as ToolConstructable,
        config: {
          frontPlaceholder: "Enter question...",
          backPlaceholder: "Enter answer...",
        },
      },
      database: {
        class: DatabaseBlockTool as unknown as ToolConstructable,
      },
      liveQuery: {
        class: LiveQueryBlockTool as unknown as ToolConstructable,
        config: { notebookId },
      },
      blockEmbed: {
        class: BlockEmbedTool as unknown as ToolConstructable,
        config: { notebookId, pageId },
      },
      ...(notebookId
        ? {
            image: {
              class: Image as unknown as ToolConstructable,
              config: {
                uploader: createImageUploader({ notebookId }),
                captionPlaceholder: "Image caption",
              },
            },
            pdf: {
              class: PDFTool as unknown as ToolConstructable,
              config: {
                notebookId,
              },
            },
            video: {
              class: VideoTool as unknown as ToolConstructable,
              config: {
                notebookId,
              },
            },
            drawing: {
              class: DrawingTool as unknown as ToolConstructable,
              config: {
                notebookId,
              },
            },
            embed: {
              class: EmbedTool as unknown as ToolConstructable,
              config: {
                notebookId,
                pages,
                onPageClick: onLinkClick,
              },
            },
          }
        : {}),
      wikiLink: {
        class: WikiLinkTool,
        config: {
          onLinkClick: onLinkClick,
        },
      },
      blockRef: {
        class: BlockRefTool,
      },
    };

    // Full tools config including columns (columns use baseTools for nested editors)
    const tools: Record<string, unknown> = {
      ...baseTools,
      columns: {
        class: ColumnsTool as unknown as ToolConstructable,
        config: {
          placeholder: "Type or drop content here...",
          tools: baseTools, // Pass tools config for nested editors
        },
      },
    };

    // Guard against onChange events fired during initial block rendering.
    // Editor.js fires onChange asynchronously as blocks are set up, even
    // though the user hasn't edited anything.
    isRenderingRef.current = true;
    constructedWithDataRef.current = initialData;

    crumb("editor:constructor-start");
    const editorConstructStart = performance.now();

    // Timestamp-based guard: ignore onChange for 600ms after editor creation.
    // This is immune to timer races that plagued the isRenderingRef approach —
    // old editors' setTimeout callbacks can clobber isRenderingRef via shared
    // refs, but they cannot change this local constant captured in the closure.
    const createdAt = performance.now();

    const editor = new EditorJS({
      holder: holderId,
      data: initialData,
      readOnly,
      placeholder,
      autofocus: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: tools as any,
      onChange: () => {
        const age = Math.round(performance.now() - createdAt);
        // Hard time-based guard for initial construction window.
        // Editor.js fires onChange during block setup, assignBlockIdAttributes,
        // and other init-related DOM mutations.  600ms covers all of these.
        if (age < 600) {
          return;
        }
        // Flag-based guard for ongoing render operations
        if (isRenderingRef.current) {
          crumb(`onChange:blocked-render:age=${age}`);
          return;
        }
        // Re-entry guard: prevents cascading onChange during debounce save
        if (isSavingRef.current) {
          crumb(`onChange:blocked-save:age=${age}`);
          return;
        }
        if (onChange && editorRef.current && isReady.current) {
          crumb(`editor:onChange:age=${age}`);
          isDirtyRef.current = true;
          // Signal that content changed — don't call editor.save() here.
          // editor.save() forces an expensive full DOM traversal of all
          // blocks on every keystroke.  The debounce timer in BlockEditor
          // calls editor.save() when it fires (2s after last change).
          onChange();
        }
      },
      onReady: () => {
        crumb("editor:onReady");
        const readyTime = performance.now() - editorConstructStart;
        if (readyTime > 200) {
          console.warn(
            `[Perf] Editor.js init took ${Math.round(readyTime)}ms ` +
            `(${initialData?.blocks?.length ?? 0} blocks)`
          );
        }
        isReady.current = true;
        // Clear the rendering flag after a brief delay — block tools
        // may still fire async DOM mutations that trigger onChange,
        // but the timestamp guard covers this window regardless.
        setTimeout(() => {
          isRenderingRef.current = false;
        }, 500);
        // Assign data-block-id attributes to block holders for scroll targeting
        setTimeout(() => {
          assignBlockIdAttributes(editorRef.current);
        }, 100);
        onReady?.();
      },
    });

    editorRef.current = editor;

    return () => {
      crumb("editor:cleanup-start");
      if (editorRef.current && isReady.current) {
        const editor = editorRef.current;
        editorRef.current = null;
        isReady.current = false;

        // Save the true current state before destroying. This bypasses
        // Editor.js's onChange debounce, which can leave the last edit
        // (e.g. a checklist item deletion) unreported if the user
        // switches pages quickly.
        const savePromise = editor.save()
          .then((data) => {
            crumb("editor:cleanup-saved");
            if (data) onUnmountSaveRef.current?.(data);
          })
          .catch(() => {})
          .finally(() => {
            crumb("editor:cleanup-destroy");
            editor.destroy();
            setPendingSavePromise(null);
          });

        // Register so selectPage can await before switching pages
        setPendingSavePromise(savePromise);
      }
    };
  }, [holderId]);

  // Update data when initialData changes (for switching between pages)
  useEffect(() => {
    if (editorRef.current && isReady.current && initialData) {
      // Skip if this is the same data the editor was just constructed with —
      // EditorJS already rendered it during initialization.
      if (initialData === constructedWithDataRef.current) {
        constructedWithDataRef.current = undefined;
        crumb("editor:initialData-skip-constructed");
        return;
      }
      constructedWithDataRef.current = undefined;

      // Skip render if the editor has unsaved changes — the user's live edits
      // take priority over (potentially stale) store data.  The pending
      // auto-save will persist the editor's state and update the store.
      if (isDirtyRef.current) {
        crumb("editor:initialData-skip-dirty");
        return;
      }

      // Set flag to prevent onChange from firing during render
      crumb("editor:re-render-start");
      isRenderingRef.current = true;
      const renderStart = performance.now();
      editorRef.current.render(initialData).finally(() => {
        crumb("editor:re-render-done");
        const renderTime = performance.now() - renderStart;
        if (renderTime > 200) {
          console.warn(
            `[Perf] Editor.js re-render took ${Math.round(renderTime)}ms ` +
            `(${initialData?.blocks?.length ?? 0} blocks)`
          );
        }
        // Keep the guard up briefly — Editor.js block tools may fire
        // async DOM mutations after the render Promise resolves.
        renderingGuardTimerRef.current = setTimeout(() => {
          renderingGuardTimerRef.current = null;
          // Assign block IDs WHILE isRenderingRef is still true —
          // the setAttribute calls trigger Editor.js's MutationObserver,
          // and the guard must be up so the resulting onChange is suppressed.
          assignBlockIdAttributes(editorRef.current);
          // Delay clearing the guard until the next frame so that
          // MutationObserver callbacks from assignBlockIdAttributes
          // (delivered as microtasks) still see isRenderingRef = true.
          requestAnimationFrame(() => {
            isRenderingRef.current = false;
          });
        }, 500);
      });
    }
  }, [initialData]);

  // Save method
  const save = useCallback(async (): Promise<OutputData | null> => {
    if (editorRef.current && isReady.current) {
      return editorRef.current.save();
    }
    return null;
  }, []);

  // Clear method
  const clear = useCallback(() => {
    if (editorRef.current && isReady.current) {
      editorRef.current.clear();
    }
  }, []);

  // Render method - for external state updates (like undo/redo)
  const render = useCallback((data: OutputData) => {
    if (editorRef.current && isReady.current) {
      // Set flag to prevent onChange from firing during render
      isRenderingRef.current = true;
      editorRef.current.render(data).finally(() => {
        renderingGuardTimerRef.current = setTimeout(() => {
          renderingGuardTimerRef.current = null;
          isRenderingRef.current = false;
        }, 500);
      });
    }
  }, []);

  // Called after the editor's data has been persisted to the store.
  // Clears the dirty flag so that future initialData changes (e.g. from
  // sync) are allowed to render.
  const markClean = useCallback(() => {
    isDirtyRef.current = false;
  }, []);

  return {
    editor: editorRef,
    isReady: isReady.current,
    save,
    clear,
    render,
    markClean,
    /** Set to true around editor.save() calls to suppress cascading onChange */
    isSavingRef,
  };
}
