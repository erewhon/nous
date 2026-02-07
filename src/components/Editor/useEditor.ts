import { useEffect, useRef, useCallback } from "react";
import EditorJS, { type OutputData, type ToolConstructable } from "@editorjs/editorjs";
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
import { MoodHabitTool } from "./MoodHabitTool";
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

/** Assign data-block-id attributes to each .ce-block holder for scroll targeting */
function assignBlockIdAttributes(editor: EditorJS | null) {
  if (!editor) return;
  try {
    const blocks = editor.blocks;
    for (let i = 0; i < blocks.getBlocksCount(); i++) {
      const block = blocks.getBlockByIndex(i);
      if (block) {
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
  onChange?: (data: OutputData) => void;
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
        class: List as unknown as ToolConstructable,
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
      moodHabit: {
        class: MoodHabitTool as unknown as ToolConstructable,
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

    const editor = new EditorJS({
      holder: holderId,
      data: initialData,
      readOnly,
      placeholder,
      autofocus: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: tools as any,
      onChange: async () => {
        // Don't save during render operations - this can capture partial/corrupted data
        if (onChange && editorRef.current && isReady.current && !isRenderingRef.current) {
          isDirtyRef.current = true;
          // Sync data-block-id attributes for any newly added blocks
          assignBlockIdAttributes(editorRef.current);
          const data = await editorRef.current.save();
          onChange(data);
        }
      },
      onReady: () => {
        isReady.current = true;
        // Keep the rendering guard up briefly after ready — block tools
        // may still fire async DOM mutations that trigger onChange.
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
      if (editorRef.current && isReady.current) {
        const editor = editorRef.current;
        editorRef.current = null;
        isReady.current = false;

        // Save the true current state before destroying. This bypasses
        // Editor.js's onChange debounce, which can leave the last edit
        // (e.g. a checklist item deletion) unreported if the user
        // switches pages quickly.
        editor.save()
          .then((data) => {
            if (data) onUnmountSaveRef.current?.(data);
          })
          .catch(() => {})
          .finally(() => {
            editor.destroy();
          });
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
        return;
      }
      constructedWithDataRef.current = undefined;

      // Skip render if the editor has unsaved changes — the user's live edits
      // take priority over (potentially stale) store data.  The pending
      // auto-save will persist the editor's state and update the store.
      if (isDirtyRef.current) {
        return;
      }

      // Set flag to prevent onChange from firing during render
      isRenderingRef.current = true;
      editorRef.current.render(initialData).finally(() => {
        // Keep the guard up briefly — Editor.js block tools may fire
        // async DOM mutations after the render Promise resolves.
        setTimeout(() => {
          isRenderingRef.current = false;
          assignBlockIdAttributes(editorRef.current);
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
        setTimeout(() => {
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
  };
}
