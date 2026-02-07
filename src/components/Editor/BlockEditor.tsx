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
import { BlockRefAutocomplete } from "./BlockRefAutocomplete";
import { BlockRefTool } from "./BlockRefTool";
import { LinkPreview } from "./LinkPreview";
import { AIAssistToolbar } from "./AIAssistToolbar";
import { usePageStore } from "../../stores/pageStore";
import { useThemeStore } from "../../stores/themeStore";
import { useToastStore } from "../../stores/toastStore";

interface BlockEditorProps {
  initialData?: OutputData;
  onChange?: (data: OutputData) => void;
  onSave?: (data: OutputData) => void;
  onExplicitSave?: (data: OutputData) => void; // Called on Ctrl+S - should trigger git commit
  onLinkClick?: (pageTitle: string) => void;
  onBlockRefClick?: (blockId: string, pageId: string) => void;
  readOnly?: boolean;
  className?: string;
  notebookId?: string;
  pageId?: string;
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
  onBlockRefClick,
  readOnly = false,
  className = "",
  notebookId,
  pageId,
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

  // Ref to access the save() function inside the debounce timer.
  // save() comes from useEditor (defined below), so we use a ref to break the
  // circular dependency while always getting fresh editor state at save time.
  const saveRef = useRef<(() => Promise<OutputData | null>) | null>(null);

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

      saveTimeoutRef.current = setTimeout(async () => {
        // Get fresh data from the editor at save time rather than using
        // stale closure data — the editor state may have changed since
        // the debounce was scheduled (e.g., checklist item deletion that
        // didn't trigger Editor.js's onChange).
        const freshData = await saveRef.current?.();
        if (freshData) {
          // onSave updates the store synchronously (setPageContentLocal) before
          // the async backend write, so markClean is safe to call right after.
          onSaveRef.current?.(freshData);
          markClean();
        }
        pendingDataRef.current = null;
      }, 2000); // Auto-save after 2 seconds of inactivity
    },
    [onChange]
  );

  const { editor, save, render, markClean } = useEditor({
    holderId,
    initialData,
    onChange: handleChange,
    onLinkClick,
    readOnly,
    notebookId,
    pageId,
    pages,
    onUnmountSave: (data) => {
      // Called by useEditor just before the editor is destroyed.
      // This captures the true current state, bypassing Editor.js's
      // onChange debounce which may not have fired yet.
      pendingDataRef.current = null;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      onSaveRef.current?.(data);
    },
  });
  saveRef.current = save;

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

  // When initialData changes from outside (e.g., after an action modifies a page),
  // cancel any pending auto-save to prevent stale editor content from overwriting
  // the fresh backend data that the editor is about to render.
  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    pendingDataRef.current = null;
  }, [initialData]);

  // Cleanup: clear pending debounce on unmount.
  // The actual save is handled by useEditor's onUnmountSave callback,
  // which fires before the editor is destroyed and captures the true state.
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      pendingDataRef.current = null;
    };
  }, []);

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
          markClean();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [save, onSave, onExplicitSave, markClean]);

  // Mark broken links/refs and update block-ref previews when pages change or content renders
  useEffect(() => {
    if (!containerRef.current || pages.length === 0) return;

    // Guard to prevent infinite loop: updateBlockRefPreviews changes textContent
    // which triggers characterData mutations, which would re-enter markLinks.
    let isUpdatingPreviews = false;

    // Use MutationObserver to mark broken links/refs after editor renders
    const markLinks = () => {
      if (isUpdatingPreviews) return;
      if (containerRef.current) {
        const pageTitles = pages.map((p) => p.title);
        WikiLinkTool.markBrokenLinks(containerRef.current, pageTitles);
        // Mark broken block refs and refresh preview text using full page data
        const allPages = usePageStore.getState().pages;
        BlockRefTool.markBrokenBlockRefs(containerRef.current, allPages);
        isUpdatingPreviews = true;
        BlockRefTool.updateBlockRefPreviews(containerRef.current, allPages);
        isUpdatingPreviews = false;
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

  // Handle block-ref clicks via event delegation
  useEffect(() => {
    if (!containerRef.current || !onBlockRefClick) return;

    const handleBlockRefClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const blockRef = target.closest("block-ref");

      if (blockRef) {
        e.preventDefault();
        e.stopPropagation();
        const blockId = blockRef.getAttribute("data-block-id");
        const pageId = blockRef.getAttribute("data-page-id");
        if (blockId && pageId) {
          onBlockRefClick(blockId, pageId);
        }
      }
    };

    containerRef.current.addEventListener("click", handleBlockRefClick);

    return () => {
      containerRef.current?.removeEventListener("click", handleBlockRefClick);
    };
  }, [onBlockRefClick]);

  // Checklist structural changes (item deletion, reorder) rebuild the DOM
  // via innerHTML which Editor.js's MutationObserver-based onChange does not
  // reliably detect.  ChecklistTool dispatches a custom event as a backup;
  // we catch it here and feed the current editor state into the save pipeline.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || readOnly) return;

    const handleStructuralChange = async () => {
      const data = await save();
      if (data) {
        handleChange(data);
      }
    };

    container.addEventListener("checklist-structural-change", handleStructuralChange);
    return () => {
      container.removeEventListener("checklist-structural-change", handleStructuralChange);
    };
  }, [save, handleChange, readOnly]);

  // Detect URL paste and offer to clip
  useEffect(() => {
    const container = containerRef.current;
    if (!container || readOnly) return;

    const handlePaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;
      if (/^https?:\/\/\S+$/.test(text)) {
        useToastStore.getState().addToast({
          type: "info",
          message: "URL pasted \u2014 Clip as page?",
          duration: 6000,
          action: {
            label: "Clip",
            onClick: () => {
              window.dispatchEvent(
                new CustomEvent("open-web-clipper", { detail: { url: text } })
              );
            },
          },
        });
      }
    };

    container.addEventListener("paste", handlePaste);
    return () => container.removeEventListener("paste", handlePaste);
  }, [readOnly]);

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

  // Handle autocomplete block ref insertion (trigger save)
  const handleInsertBlockRef = useCallback(() => {
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
      {!readOnly && notebookId && (
        <BlockRefAutocomplete
          containerRef={containerRef}
          notebookId={notebookId}
          onInsertRef={handleInsertBlockRef}
        />
      )}
      {/* Link preview tooltip for external URLs */}
      <LinkPreview containerRef={containerRef} />
      {!readOnly && <AIAssistToolbar containerRef={containerRef as React.RefObject<HTMLElement | null>} />}
      {isVimModeEnabled && (
        <div className="pointer-events-none fixed bottom-4 left-4 z-50">
          <VimModeIndicator mode={vimMode} pendingKeys={pendingKeys} />
        </div>
      )}
    </div>
  );
});
