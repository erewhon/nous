import { useEffect, useRef, useCallback } from "react";
import EditorJS, { type OutputData, type ToolConstructable } from "@editorjs/editorjs";
import Header from "@editorjs/header";
import List from "@editorjs/list";
import Checklist from "@editorjs/checklist";
import Code from "@editorjs/code";
import Quote from "@editorjs/quote";
import Marker from "@editorjs/marker";
import InlineCode from "@editorjs/inline-code";
import Delimiter from "@editorjs/delimiter";
import { WikiLinkTool } from "./WikiLinkTool";

interface UseEditorOptions {
  holderId: string;
  initialData?: OutputData;
  onChange?: (data: OutputData) => void;
  onReady?: () => void;
  onLinkClick?: (pageTitle: string) => void;
  readOnly?: boolean;
  placeholder?: string;
}

export function useEditor({
  holderId,
  initialData,
  onChange,
  onReady,
  onLinkClick,
  readOnly = false,
  placeholder = "Start writing or press '/' for commands...",
}: UseEditorOptions) {
  const editorRef = useRef<EditorJS | null>(null);
  const isReady = useRef(false);

  // Initialize editor
  useEffect(() => {
    if (editorRef.current) {
      return;
    }

    const editor = new EditorJS({
      holder: holderId,
      data: initialData,
      readOnly,
      placeholder,
      autofocus: true,
      tools: {
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
          class: Checklist as unknown as ToolConstructable,
          inlineToolbar: true,
        },
        code: Code as unknown as ToolConstructable,
        quote: {
          class: Quote as unknown as ToolConstructable,
          inlineToolbar: true,
        },
        marker: Marker,
        inlineCode: InlineCode,
        delimiter: Delimiter as unknown as ToolConstructable,
        wikiLink: {
          class: WikiLinkTool,
          config: {
            onLinkClick: onLinkClick,
          },
        },
      },
      onChange: async () => {
        if (onChange && editorRef.current && isReady.current) {
          const data = await editorRef.current.save();
          onChange(data);
        }
      },
      onReady: () => {
        isReady.current = true;
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
      editorRef.current.render(initialData);
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

  return {
    editor: editorRef,
    isReady: isReady.current,
    save,
    clear,
  };
}
