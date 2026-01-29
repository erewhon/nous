import { useEffect, useId, useCallback, useRef, useState, forwardRef, useImperativeHandle } from "react";
import type { OutputData } from "@editorjs/editorjs";
import { useEditor } from "./useEditor";
import { useVimMode, type VimMode } from "./useVimMode";
import { useEmacsMode } from "./useEmacsMode";
import { useBlockDragHandles } from "./useBlockDragHandles";
import { useChecklistEnhancer } from "./useChecklistEnhancer";
import { VimModeIndicator } from "./VimModeIndicator";
import { WikiLinkAutocomplete } from "./WikiLinkAutocomplete";
import { WikiLinkTool } from "./WikiLinkTool";
import { LinkPreview } from "./LinkPreview";
import { useThemeStore } from "../../stores/themeStore";

interface BlockEditorProps {
  initialData?: OutputData;
  onChange?: (data: OutputData) => void;
  onSave?: (data: OutputData) => void;
  onExplicitSave?: (data: OutputData) => void; // Called on Ctrl+S - should trigger git commit
  onLinkClick?: (pageTitle: string) => void;
  readOnly?: boolean;
  className?: string;
  notebookId?: string;
  pages?: Array<{ id: string; title: string }>;
}

export interface BlockEditorRef {
  render: (data: OutputData) => void;
  save: () => Promise<OutputData | null>;
}

export const BlockEditor = forwardRef<BlockEditorRef, BlockEditorProps>(function BlockEditor({
  initialData,
  onChange,
  onSave,
  onExplicitSave,
  onLinkClick,
  readOnly = false,
  className = "",
  notebookId,
  pages = [],
}, ref) {
  const editorId = useId().replace(/:/g, "-");
  const holderId = `editor-${editorId}`;
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Track pending data that needs to be saved on unmount
  const pendingDataRef = useRef<OutputData | null>(null);
  // Keep a ref to onSave so cleanup effect can access latest callback without re-running
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // Get keymap setting from theme store
  const editorKeymap = useThemeStore((state) => state.settings.editorKeymap);
  const isVimModeEnabled = editorKeymap === "vim" && !readOnly;
  const isEmacsModeEnabled = editorKeymap === "emacs" && !readOnly;

  // Track vim mode state for indicator (used by useVimMode callback)
  const [, setCurrentVimMode] = useState<VimMode>("normal");

  // Debounced save
  const handleChange = useCallback(
    (data: OutputData) => {
      onChange?.(data);

      // Track pending data for flush on unmount
      pendingDataRef.current = data;

      // Debounce auto-save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        onSave?.(data);
        pendingDataRef.current = null; // Clear after successful save
      }, 2000); // Auto-save after 2 seconds of inactivity
    },
    [onChange, onSave]
  );

  const { editor, save, render } = useEditor({
    holderId,
    initialData,
    onChange: handleChange,
    onLinkClick,
    readOnly,
    notebookId,
    pages,
  });

  // Expose render and save methods via ref
  useImperativeHandle(ref, () => ({
    render,
    save,
  }), [render, save]);

  // VI keybindings mode
  const { mode: vimMode, pendingKeys } = useVimMode({
    enabled: isVimModeEnabled,
    editorRef: editor,
    containerRef: containerRef as React.RefObject<HTMLElement>,
    onModeChange: setCurrentVimMode,
  });

  // Emacs keybindings mode
  useEmacsMode({
    enabled: isEmacsModeEnabled,
    editorRef: editor,
    containerRef: containerRef as React.RefObject<HTMLElement>,
  });

  // Block drag handles for drag-and-drop into columns
  useBlockDragHandles({
    containerRef: containerRef as React.RefObject<HTMLElement>,
    editorRef: editor,
    enabled: !readOnly,
  });

  // Checklist enhancements (drag handles and auto-sort)
  useChecklistEnhancer(editor, holderId);

  // Cleanup: flush pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      // Flush any pending save immediately before unmounting
      if (pendingDataRef.current && onSaveRef.current) {
        onSaveRef.current(pendingDataRef.current);
        pendingDataRef.current = null;
      }
    };
  }, []); // Empty deps - only runs on unmount, uses refs for latest values

  // Save on Ctrl+S - this is an explicit save that should trigger git commit
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        // Clear pending debounced save since we're saving explicitly now
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        pendingDataRef.current = null;

        const data = await save();
        if (data) {
          // Use explicit save callback if provided, otherwise fall back to regular save
          (onExplicitSave ?? onSave)?.(data);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [save, onSave, onExplicitSave]);

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

  // Fix popover positioning to prevent left-side clipping
  // Editor.js positions popovers near the toolbar which can be off the left edge
  useEffect(() => {
    const repositionPopover = (popover: HTMLElement) => {
      requestAnimationFrame(() => {
        const rect = popover.getBoundingClientRect();
        const minLeft = 16; // Minimum distance from left edge

        if (rect.left < minLeft) {
          // Use getComputedStyle to get the actual current left value,
          // which works whether set via inline style, class, or stylesheet
          const computed = window.getComputedStyle(popover);
          const currentLeft = parseFloat(computed.left) || 0;
          const shiftAmount = minLeft - rect.left;
          popover.style.left = `${currentLeft + shiftAmount}px`;
        }
      });
    };

    const isPopover = (el: HTMLElement) =>
      el.classList.contains("ce-popover") ||
      el.classList.contains("ce-settings") ||
      el.classList.contains("ce-block-tunes");

    const checkAndFix = (el: HTMLElement) => {
      if (isPopover(el)) {
        repositionPopover(el);
      }
      el.querySelectorAll(".ce-popover, .ce-settings, .ce-block-tunes").forEach((p) =>
        repositionPopover(p as HTMLElement)
      );
    };

    // Watch for popovers being added or becoming visible (class/style changes)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // New nodes added (popover created)
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            checkAndFix(node);
          }
        }
        // Attribute changes (popover shown/repositioned via class or style)
        if (mutation.type === "attributes" && mutation.target instanceof HTMLElement) {
          if (isPopover(mutation.target)) {
            repositionPopover(mutation.target);
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    return () => observer.disconnect();
  }, []);

  // Handle wiki-link clicks via event delegation
  // This ensures links loaded from saved content also work
  useEffect(() => {
    if (!containerRef.current || !onLinkClick) return;

    const handleWikiLinkClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const wikiLink = target.closest("wiki-link");

      if (wikiLink) {
        e.preventDefault();
        e.stopPropagation();
        const pageTitle = wikiLink.getAttribute("data-page-title");
        if (pageTitle) {
          onLinkClick(pageTitle);
        }
      }
    };

    containerRef.current.addEventListener("click", handleWikiLinkClick);

    return () => {
      containerRef.current?.removeEventListener("click", handleWikiLinkClick);
    };
  }, [onLinkClick]);

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
      {/* Link preview tooltip for external URLs */}
      <LinkPreview containerRef={containerRef} />
      {isVimModeEnabled && (
        <div className="pointer-events-none fixed bottom-4 left-4 z-50">
          <VimModeIndicator mode={vimMode} pendingKeys={pendingKeys} />
        </div>
      )}
    </div>
  );
});
