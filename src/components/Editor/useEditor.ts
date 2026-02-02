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
import { CodeBlockTool } from "./CodeBlockTool";
import { CalloutTool } from "./CalloutTool";
import { ChecklistTool } from "./ChecklistTool";
import { FlashcardTool } from "./FlashcardTool";
import { HighlighterTool } from "./HighlighterTool";
import { PDFTool } from "./PDFTool";
import { VideoTool } from "./VideoTool";
import { DrawingTool } from "./DrawingTool";
import { EmbedTool } from "./EmbedTool";
import { ColumnsTool } from "./ColumnsTool";
import { createImageUploader } from "./imageUploader";

interface UseEditorOptions {
  holderId: string;
  initialData?: OutputData;
  onChange?: (data: OutputData) => void;
  onReady?: () => void;
  onLinkClick?: (pageTitle: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  notebookId?: string;
  pages?: Array<{ id: string; title: string }>;
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
  pages,
}: UseEditorOptions) {
  const editorRef = useRef<EditorJS | null>(null);
  const isReady = useRef(false);
  // Flag to prevent onChange from firing during render operations
  const isRenderingRef = useRef(false);
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
        onReady?.();
      },
    });

    editorRef.current = editor;

    return () => {
      if (editorRef.current && isReady.current) {
        editorRef.current.destroy();
        editorRef.current = null;
        isReady.current = false;
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

      // Set flag to prevent onChange from firing during render
      isRenderingRef.current = true;
      editorRef.current.render(initialData).finally(() => {
        // Keep the guard up briefly — Editor.js block tools may fire
        // async DOM mutations after the render Promise resolves.
        setTimeout(() => {
          isRenderingRef.current = false;
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

  return {
    editor: editorRef,
    isReady: isReady.current,
    save,
    clear,
    render,
  };
}
