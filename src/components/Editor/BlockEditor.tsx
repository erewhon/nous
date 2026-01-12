import { useEffect, useId, useCallback, useRef } from "react";
import type { OutputData } from "@editorjs/editorjs";
import { useEditor } from "./useEditor";

interface BlockEditorProps {
  initialData?: OutputData;
  onChange?: (data: OutputData) => void;
  onSave?: (data: OutputData) => void;
  onLinkClick?: (pageTitle: string) => void;
  readOnly?: boolean;
  className?: string;
  notebookId?: string;
}

export function BlockEditor({
  initialData,
  onChange,
  onSave,
  onLinkClick,
  readOnly = false,
  className = "",
  notebookId,
}: BlockEditorProps) {
  const editorId = useId().replace(/:/g, "-");
  const holderId = `editor-${editorId}`;
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced save
  const handleChange = useCallback(
    (data: OutputData) => {
      onChange?.(data);

      // Debounce auto-save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        onSave?.(data);
      }, 1000); // Auto-save after 1 second of inactivity
    },
    [onChange, onSave]
  );

  const { save } = useEditor({
    holderId,
    initialData,
    onChange: handleChange,
    onLinkClick,
    readOnly,
    notebookId,
  });

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Save on Ctrl+S
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        const data = await save();
        if (data) {
          onSave?.(data);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [save, onSave]);

  return (
    <div
      id={holderId}
      className={`block-editor prose prose-invert max-w-none ${className}`}
    />
  );
}
