import { useEffect, useId, useCallback, useRef, useState, forwardRef, useImperativeHandle } from "react";
import type { OutputData } from "@editorjs/editorjs";
import { useEditor } from "./useEditor";
import { useVimMode, type VimMode } from "./useVimMode";
import { useEmacsMode } from "./useEmacsMode";
import { useBlockDragHandles } from "./useBlockDragHandles";
import { useChecklistEnhancer } from "./useChecklistEnhancer";
import { useHeaderCollapse } from "./useHeaderCollapse";
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

  // Collapsible header sections
  useHeaderCollapse({
    containerRef: containerRef as React.RefObject<HTMLElement>,
    editorRef: editor,
    enabled: !readOnly,
  });

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

  // Fix Editor.js popover clipping: popovers sit inside containers with
  // overflow:hidden / overflow-y:auto (EditorPaneContent), which clips them.
  // We apply position:fixed with calculated viewport coordinates so the
  // popover escapes clipping while staying in the DOM tree (preserving
  // Editor.js keyboard forwarding, search filtering, and tool insertion).
  // The will-change:auto override on .ce-toolbar (editor-styles.css) prevents
  // WebKitGTK from creating a containing block that would defeat position:fixed.
  //
  // Two popover patterns in Editor.js:
  //   1. Block tunes: created on open, destroyed on close (detected via childList)
  //   2. Toolbox/slash: created once at init, shown/hidden via classes (detected via attribute)
  useEffect(() => {
    if (readOnly) return;
    const editorContainer = containerRef.current;
    if (!editorContainer) return;

    const fixPopover = (popover: HTMLElement) => {
      // Guard: already processing or fixed
      if (popover.dataset.fixedPopover) return;
      popover.dataset.fixedPopover = "pending";

      requestAnimationFrame(() => {
        // Bail if popover was closed before rAF fired
        if (!popover.classList.contains("ce-popover--opened")) {
          delete popover.dataset.fixedPopover;
          return;
        }

        // Force rightward opening
        popover.classList.remove("ce-popover--open-left");

        // The popover sits inside .ce-toolbar__actions which is at right:100%
        // (the left margin, potentially off-screen). We can't use the popover's
        // own rect for horizontal positioning. Instead, anchor to the toolbar
        // (spans editor width) for X, and the settings button for Y.
        const toolbar = editorContainer.querySelector(".ce-toolbar") as HTMLElement;
        if (!toolbar) {
          delete popover.dataset.fixedPopover;
          return;
        }

        const toolbarRect = toolbar.getBoundingClientRect();
        const settingsBtn = toolbar.querySelector(".ce-toolbar__settings-btn");
        const btnRect = settingsBtn?.getBoundingClientRect();

        // Vertical: below the settings button (or toolbar top as fallback)
        const top = (btnRect ? btnRect.bottom + 4 : toolbarRect.top);

        // Horizontal: aligned to the toolbar's left edge (= editor content left)
        const left = toolbarRect.left;

        // Apply fixed positioning to escape overflow clipping
        popover.style.position = "fixed";
        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;
        popover.style.margin = "0";
        popover.dataset.fixedPopover = "true";
      });
    };

    const resetPopover = (popover: HTMLElement) => {
      if (popover.dataset.fixedPopover) {
        popover.style.position = "";
        popover.style.top = "";
        popover.style.left = "";
        popover.style.margin = "";
        delete popover.dataset.fixedPopover;
      }
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          // Pattern 1: Tunes popover — new element added to DOM
          mutation.addedNodes.forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            if (node.classList?.contains("ce-popover")) {
              fixPopover(node);
            } else if (node.querySelectorAll) {
              node.querySelectorAll(".ce-popover").forEach((p) =>
                fixPopover(p as HTMLElement)
              );
            }
          });
        } else if (mutation.type === "attributes") {
          // Pattern 2: Toolbox popover — existing element toggled via class
          const target = mutation.target as HTMLElement;
          if (target.classList?.contains("ce-popover")) {
            if (target.classList.contains("ce-popover--opened")) {
              fixPopover(target);
            } else {
              resetPopover(target);
            }
          }
        }
      }
    });

    observer.observe(editorContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, [readOnly]);

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
