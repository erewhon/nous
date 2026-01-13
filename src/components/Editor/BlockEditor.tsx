import { useEffect, useId, useCallback, useRef } from "react";
import type { OutputData } from "@editorjs/editorjs";
import { useEditor } from "./useEditor";
import { WikiLinkAutocomplete } from "./WikiLinkAutocomplete";
import { WikiLinkTool } from "./WikiLinkTool";

interface BlockEditorProps {
  initialData?: OutputData;
  onChange?: (data: OutputData) => void;
  onSave?: (data: OutputData) => void;
  onLinkClick?: (pageTitle: string) => void;
  readOnly?: boolean;
  className?: string;
  notebookId?: string;
  pages?: Array<{ id: string; title: string }>;
}

export function BlockEditor({
  initialData,
  onChange,
  onSave,
  onLinkClick,
  readOnly = false,
  className = "",
  notebookId,
  pages = [],
}: BlockEditorProps) {
  const editorId = useId().replace(/:/g, "-");
  const holderId = `editor-${editorId}`;
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Mark broken links when pages change or content renders
  useEffect(() => {
    if (!containerRef.current || pages.length === 0) return;

    // Use MutationObserver to mark broken links after editor renders
    const markLinks = () => {
      if (containerRef.current) {
        const pageTitles = pages.map((p) => p.title);
        WikiLinkTool.markBrokenLinks(containerRef.current, pageTitles);
      }
    };

    // Initial mark
    const timeoutId = setTimeout(markLinks, 100);

    // Mark on mutations (new content added)
    const observer = new MutationObserver(markLinks);
    observer.observe(containerRef.current, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, [pages]);

  // Handle autocomplete link insertion (trigger save)
  const handleInsertLink = useCallback(() => {
    // Trigger a save after link insertion
    setTimeout(async () => {
      const data = await save();
      if (data) {
        onChange?.(data);
      }
    }, 50);
  }, [save, onChange]);

  return (
    <div ref={containerRef} className="relative">
      <div
        id={holderId}
        className={`block-editor prose prose-invert max-w-none ${className}`}
      />
      {!readOnly && pages.length > 0 && (
        <WikiLinkAutocomplete
          containerRef={containerRef}
          pages={pages}
          onInsertLink={handleInsertLink}
        />
      )}
    </div>
  );
}
