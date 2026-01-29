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

  // Fix Editor.js popover clipping: popovers are appended inside the toolbar
  // wrapper, which sits inside containers with overflow:hidden/auto. Absolutely
  // positioned popovers get clipped. To escape, we portal the popover element
  // to document.body and position it with position:fixed using viewport coords.
  //
  // Two popover patterns in Editor.js:
  //   1. Block tunes: created on open, destroyed on close (detected via childList)
  //   2. Toolbox/slash: created once at init, shown/hidden via classes (detected via attribute)
  useEffect(() => {
    if (readOnly) return;
    const editorContainer = containerRef.current;
    if (!editorContainer) return;

    // Track popovers we've moved to document.body so we can observe
    // them for re-showing (toolbox pattern) and clean up on unmount
    const movedPopovers = new Set<HTMLElement>();
    let movedObserver: MutationObserver | null = null;

    const positionPopover = (popover: HTMLElement) => {
      const popoverContainer = popover.querySelector(".ce-popover__container") as HTMLElement;
      if (!popoverContainer) return;

      // Find the best anchor: the active settings button, the opened toolbar,
      // or the current block. This gives us a position near the trigger.
      const settingsBtn = editorContainer.querySelector(
        ".ce-toolbar__settings-btn--active"
      ) as HTMLElement;
      const toolbar = editorContainer.querySelector(
        ".ce-toolbar--opened"
      ) as HTMLElement;
      const currentBlock = editorContainer.querySelector(
        ".ce-block--selected, .ce-block--focused"
      ) as HTMLElement;
      const anchor = settingsBtn || toolbar || currentBlock;
      if (!anchor) return;
      const anchorRect = anchor.getBoundingClientRect();

      // Remove directional classes — we position it ourselves
      popover.classList.remove("ce-popover--open-left");
      popover.classList.remove("ce-popover--open-top");

      // Position the popover wrapper with fixed positioning
      popover.style.position = "fixed";
      popover.style.zIndex = "10002";

      // Make the container flow normally inside the fixed popover
      // instead of using absolute positioning with CSS variables
      popoverContainer.style.position = "relative";
      popoverContainer.style.left = "0";
      popoverContainer.style.top = "0";

      const width = popoverContainer.offsetWidth || 200;
      const height = popoverContainer.offsetHeight || 270;

      // Position below the anchor
      let left = anchorRect.left;
      let top = anchorRect.bottom + 4;

      // Clamp within viewport
      if (left < 8) left = 8;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8);
      }
      if (top + height > window.innerHeight - 8) {
        // Open upward
        top = anchorRect.top - height - 4;
        if (top < 8) top = 8;
      }

      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    };

    const portalAndPosition = (popover: HTMLElement) => {
      // Move to document.body if not already there
      if (popover.parentElement !== document.body) {
        document.body.appendChild(popover);
      }
      positionPopover(popover);

      // Start observing this popover for re-show events (toolbox pattern:
      // the element stays in document.body and gets --opened toggled)
      if (!movedPopovers.has(popover)) {
        movedPopovers.add(popover);
        movedObserver?.observe(popover, {
          attributes: true,
          attributeFilter: ["class"],
        });
      }
    };

    const scheduleFixPopover = (popover: HTMLElement) => {
      // Wait for Editor.js to finish its positioning
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (popover.classList.contains("ce-popover--opened")) {
            portalAndPosition(popover);
          }
        });
      });
    };

    // Observer for popovers inside the editor (detects newly created popovers
    // for the tunes pattern, and class changes for the toolbox pattern)
    const editorObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          // Pattern 1: Tunes popover — new element added to DOM
          mutation.addedNodes.forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            const popovers: HTMLElement[] = [];
            if (node.classList?.contains("ce-popover")) {
              popovers.push(node);
            } else if (node.querySelectorAll) {
              node.querySelectorAll(".ce-popover").forEach((p) =>
                popovers.push(p as HTMLElement)
              );
            }
            for (const popover of popovers) {
              scheduleFixPopover(popover);
            }
          });
        } else if (mutation.type === "attributes") {
          // Pattern 2: Toolbox popover — existing element gets --opened class
          const target = mutation.target as HTMLElement;
          if (
            target.classList?.contains("ce-popover") &&
            target.classList.contains("ce-popover--opened") &&
            target.parentElement !== document.body
          ) {
            scheduleFixPopover(target);
          }
        }
      }
    });

    editorObserver.observe(editorContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    // Observer for popovers that have been moved to document.body
    // (detects toolbox being re-shown after initial portal)
    movedObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const target = mutation.target as HTMLElement;
        if (
          target.classList?.contains("ce-popover--opened") &&
          movedPopovers.has(target)
        ) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (target.classList.contains("ce-popover--opened")) {
                positionPopover(target);
              }
            });
          });
        }
      }
    });

    return () => {
      editorObserver.disconnect();
      movedObserver?.disconnect();
      // Clean up portaled popovers
      movedPopovers.forEach((p) => {
        if (p.parentElement === document.body) {
          p.remove();
        }
      });
      movedPopovers.clear();
    };
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
