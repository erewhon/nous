import { useEffect, useId, useCallback, useRef, useState, useMemo, forwardRef, useImperativeHandle, memo } from "react";
import type { OutputData } from "@editorjs/editorjs";
import { useEditor } from "./useEditor";
import { useVimMode, type VimMode } from "./useVimMode";
import { useEmacsMode } from "./useEmacsMode";
import { useBlockDragHandles } from "./useBlockDragHandles";
import { useChecklistEnhancer } from "./useChecklistEnhancer";
import { useHeaderCollapse } from "./useHeaderCollapse";
import { VimModeIndicator } from "./VimModeIndicator";
import { WikiLinkAutocomplete } from "./WikiLinkAutocomplete";
import { BlockRefAutocomplete } from "./BlockRefAutocomplete";
import { BlockRefTool } from "./BlockRefTool";
import { LinkPreview } from "./LinkPreview";
import { AIAssistToolbar } from "./AIAssistToolbar";
import { usePageStore } from "../../stores/pageStore";
import { useLinkStore } from "../../stores/linkStore";
import { useThemeStore } from "../../stores/themeStore";
import { useToastStore } from "../../stores/toastStore";
import { crumb } from "../../utils/breadcrumbs";

/**
 * Extract data-page-title values from Editor.js block HTML content.
 * Used by the CSS-based broken link marker to determine which wiki-links
 * reference non-existent pages.
 */
function extractPageTitlesFromBlocks(
  blocks: Array<{ type: string; data: Record<string, unknown> }>
): string[] {
  const titles: string[] = [];
  const regex = /data-page-title="([^"]*)"/g;

  const scan = (text: string) => {
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(text)) !== null) {
      if (match[1]) titles.push(match[1]);
    }
  };

  const processBlocks = (
    blockList: Array<{ type: string; data: Record<string, unknown> }>
  ) => {
    for (const block of blockList) {
      if (
        (block.type === "paragraph" || block.type === "header") &&
        typeof block.data.text === "string"
      ) {
        scan(block.data.text);
      }
      if (block.type === "list" && Array.isArray(block.data.items)) {
        for (const item of block.data.items) {
          if (typeof item === "string") scan(item);
        }
      }
      // Recurse into column blocks
      if (block.type === "columns" && Array.isArray(block.data.columnData)) {
        for (const col of block.data.columnData as Array<{
          blocks: Array<{ type: string; data: Record<string, unknown> }>;
        }>) {
          if (col.blocks) processBlocks(col.blocks);
        }
      }
    }
  };

  processBlocks(blocks);
  return [...new Set(titles)];
}

/** Escape a string for use in a CSS attribute selector value (inside double quotes). */
function cssAttrEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Generate CSS rules that style broken wiki-links and block-refs via attribute
 * selectors.  This approach avoids modifying any DOM inside the Editor.js
 * container, preventing MutationObserver → onChange cascades that freeze the
 * WebView.
 */
function generateBrokenLinkCSS(
  holderId: string,
  blocks: Array<{ type: string; data: Record<string, unknown> }>,
  existingPageTitles: string[],
  allPages: Array<{
    id: string;
    content?: { blocks: Array<{ id: string }> };
  }>
): string {
  const brokenStyle =
    "color: var(--color-text-muted); text-decoration-color: rgba(255, 100, 100, 0.5);";
  const escapedId = CSS.escape(holderId);
  const rules: string[] = [];

  // Wiki-links without data-page-title are always broken
  rules.push(
    `#${escapedId} wiki-link:not([data-page-title]) { ${brokenStyle} }`
  );

  // Check which wiki-link titles don't match existing pages
  const titlesSet = new Set(existingPageTitles.map((t) => t.toLowerCase()));
  const referencedTitles = extractPageTitlesFromBlocks(blocks);

  for (const title of referencedTitles) {
    // For path syntax (Parent/Child), check the final segment
    const titleToCheck = title.includes("/")
      ? title.split("/").pop()?.trim() || title
      : title;
    if (!titlesSet.has(titleToCheck.toLowerCase())) {
      rules.push(
        `#${escapedId} wiki-link[data-page-title="${cssAttrEscape(title)}"] { ${brokenStyle} }`
      );
    }
  }

  // Block-refs without data-block-id are always broken
  rules.push(
    `#${escapedId} block-ref:not([data-block-id]) { ${brokenStyle} }`
  );

  // Check which block-ref targets don't exist
  const blockRefs = BlockRefTool.extractBlockRefs(blocks);
  if (blockRefs.length > 0) {
    const existingBlockIds = new Set<string>();
    for (const page of allPages) {
      if (page.content?.blocks) {
        for (const block of page.content.blocks) {
          existingBlockIds.add(block.id);
        }
      }
    }
    for (const ref of blockRefs) {
      if (!existingBlockIds.has(ref.blockId)) {
        rules.push(
          `#${escapedId} block-ref[data-block-id="${CSS.escape(ref.blockId)}"] { ${brokenStyle} }`
        );
      }
    }
  }

  return rules.join("\n");
}

interface BlockEditorProps {
  initialData?: OutputData;
  onChange?: (data?: OutputData) => void;
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

// React.memo prevents unnecessary re-renders from Zustand store cascades.
// When auto-save calls setPageContentLocal or the user toggles a favorite,
// the store's pages array gets a new reference, cascading re-renders through
// EditorArea → EditorPaneContent → BlockEditor.  These re-renders can trigger
// WebKitGTK rendering pipeline freezes near contenteditable elements.
// Only re-render when props that affect the editor content actually change.
// Callback props (onChange, onSave, etc.) are stored in refs inside the
// component, so stale closures are not a problem.
export const BlockEditor = memo(forwardRef<BlockEditorRef, BlockEditorProps>(function BlockEditor({
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

  // Debounced save.  Called either with no data (lightweight signal from
  // useEditor's onChange — avoids expensive per-keystroke editor.save()) or
  // with data (from checklist-structural-change handler which already saved).
  const handleChange = useCallback(
    (data?: OutputData) => {
      crumb(`blockEditor:handleChange:${data ? "withData" : "signal"}`);
      // If data is provided (structural change), forward to parent immediately
      // for undo history capture.  For normal keystrokes, undo capture happens
      // at debounce time — this is standard UX (nobody wants char-level undo).
      if (data) {
        onChange?.(data);
      }

      // Debounce auto-save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        crumb("blockEditor:debounce:fire");
        // Get fresh data from the editor.  This is the ONLY place we call
        // editor.save() for normal edits — NOT per-keystroke.
        // Set isSavingRef to suppress cascading onChange during save().
        isSavingRef.current = true;
        try {
          crumb("blockEditor:editor.save:start");
          const freshData = await saveRef.current?.();
          crumb(`blockEditor:editor.save:done:blocks=${freshData?.blocks?.length ?? 0}`);
          if (freshData) {
            // Capture undo state at save time (if not already captured above)
            if (!data) {
              onChange?.(freshData);
            }
            // onSave calls setPageContentLocal which updates the Zustand store
            // synchronously.  Deferring markClean to the next frame ensures
            // React has already processed the re-render (seeing isDirtyRef=true
            // → skipping render) before we clear the dirty flag.
            crumb("blockEditor:onSave:start");
            onSaveRef.current?.(freshData);
            crumb("blockEditor:onSave:done");
            requestAnimationFrame(() => {
              markClean();
            });
          }
        } finally {
          queueMicrotask(() => {
            isSavingRef.current = false;
          });
        }
      }, 2000); // Auto-save after 2 seconds of inactivity
    },
    [onChange]
  );

  const { editor, save, render, markClean, isSavingRef } = useEditor({
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
      // Flush to local store for race-condition protection when switching pages.
      // The auto-save path intentionally skips setPageContentLocal (to avoid
      // triggering React re-render cascades that freeze WebKitGTK), so we do
      // it here on unmount to ensure the store cache is fresh.
      if (pageId && data) {
        const seenIds = new Set<string>();
        const editorData = {
          time: data.time,
          version: data.version,
          blocks: data.blocks.map((block) => {
            let id = block.id ?? crypto.randomUUID();
            if (seenIds.has(id)) id = crypto.randomUUID();
            seenIds.add(id);
            return { id, type: block.type, data: block.data as Record<string, unknown> };
          }),
        };
        usePageStore.getState().setPageContentLocal(pageId, editorData);

        // Also update page links on unmount (auto-save skips this to avoid re-renders)
        const page = usePageStore.getState().pages.find((p) => p.id === pageId);
        if (page) {
          useLinkStore.getState().updatePageLinks({
            ...page,
            content: editorData,
          });
        }
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
    holderId,
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
          // Defer markClean — same reasoning as the debounced save above
          requestAnimationFrame(() => {
            markClean();
          });
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [save, onSave, onExplicitSave, markClean]);

  // CSS-based broken link/ref marking.  Instead of modifying classList or
  // textContent on elements inside the Editor.js container (which triggers
  // its internal MutationObserver → onChange cascades that freeze the WebView),
  // we generate a <style> tag with CSS attribute selectors that mark broken
  // wiki-links and block-refs purely via CSS.  This completely eliminates DOM
  // mutations from broken-link marking.
  const brokenLinkCSS = useMemo(() => {
    if (!initialData?.blocks || pages.length === 0) return "";
    return generateBrokenLinkCSS(
      holderId,
      initialData.blocks,
      pages.map((p) => p.title),
      usePageStore.getState().pages
    );
  }, [initialData, pages, holderId]);

  // Fix Editor.js popover clipping.
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

    let observer: MutationObserver | null = null;

    // Delay observer setup — during Editor.js initialization, hundreds of
    // childList + class-change mutations fire as blocks render, but no
    // popovers can be open yet. Observing during init wastes CPU processing
    // mutations that can never match a popover element.
    const setupTimeoutId = setTimeout(() => {
      if (!editorContainer.isConnected) return;

      observer = new MutationObserver((mutations) => {
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
    }, 600); // After Editor.js finishes init (500ms isRenderingRef guard)

    return () => {
      clearTimeout(setupTimeoutId);
      observer?.disconnect();
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

  // NOTE: Checkbox toggles do NOT trigger any save pipeline.
  // editor.save() forces a synchronous DOM traversal which causes WebKitGTK
  // to freeze during layout reflow (6+ seconds). Checkbox state changes
  // (stored in ChecklistTool.data.items) are captured by the next regular
  // save: text edit auto-save, Ctrl+S, or page switch (onUnmountSave).

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
      {/* CSS-based broken link/ref styling — outside the editor holder so it
          never triggers Editor.js's internal MutationObserver */}
      {brokenLinkCSS && (
        <style dangerouslySetInnerHTML={{ __html: brokenLinkCSS }} />
      )}
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
}), (prev, next) => {
  // Only re-render when data-bearing props change.
  // Callback props (onChange, onSave, etc.) are captured in refs inside
  // the component and always reflect the latest values on next call.
  return prev.initialData === next.initialData &&
    prev.readOnly === next.readOnly &&
    prev.pageId === next.pageId &&
    prev.notebookId === next.notebookId &&
    prev.className === next.className;
});
