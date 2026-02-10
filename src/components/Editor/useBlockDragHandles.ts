import { useEffect, useRef, type RefObject } from "react";
import type EditorJS from "@editorjs/editorjs";

interface UseBlockDragHandlesOptions {
  containerRef: RefObject<HTMLElement | null>;
  editorRef: RefObject<EditorJS | null>;
  enabled?: boolean;
}

/**
 * Adds custom drag handles to Editor.js blocks for drag-and-drop into columns.
 *
 * IMPORTANT: Uses lazy loading — drag handles are only inserted when the mouse
 * hovers over a block. This avoids inserting N elements at init time, which
 * causes WebKitGTK's rendering pipeline to freeze for 10-20 seconds on pages
 * with many blocks.
 */
export function useBlockDragHandles({
  containerRef,
  editorRef,
  enabled = true,
}: UseBlockDragHandlesOptions) {
  const dragDataRef = useRef<{
    blockIndex: number;
    blockType: string;
    blockData: Record<string, unknown>;
  } | null>(null);

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const container = containerRef.current;

    // Track which block currently has a drag handle to avoid duplicate insertion
    let activeHandleBlock: HTMLElement | null = null;
    let activeHandle: HTMLElement | null = null;

    // Create drag handle element
    const createDragHandle = (): HTMLElement => {
      const handle = document.createElement("div");
      handle.className = "ce-block-drag-handle";
      handle.draggable = true;
      handle.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="5" r="2"/>
          <circle cx="9" cy="12" r="2"/>
          <circle cx="9" cy="19" r="2"/>
          <circle cx="15" cy="5" r="2"/>
          <circle cx="15" cy="12" r="2"/>
          <circle cx="15" cy="19" r="2"/>
        </svg>
      `;
      handle.title = "Drag to move block";

      // Drag start
      handle.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        const block = handle.parentElement;
        if (!block) return;

        // Find block index
        const blocks = container.querySelectorAll(
          ".ce-block:not(.columns-editor-holder .ce-block)"
        );
        let blockIndex = -1;
        blocks.forEach((b, i) => {
          if (b === block) blockIndex = i;
        });

        // Extract block data
        const blockData = extractBlockData(block);

        dragDataRef.current = {
          blockIndex,
          blockType: blockData.type,
          blockData: blockData.data,
        };

        // Set drag data
        const blockDataJson = JSON.stringify(dragDataRef.current);
        e.dataTransfer?.setData("text/plain", `__EDITOR_BLOCK__${blockDataJson}`);
        e.dataTransfer?.setData("application/x-editor-block", blockDataJson);

        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
        }

        // Add visual feedback
        block.classList.add("ce-block--dragging");

        // Create drag image
        const dragImage = block.cloneNode(true) as HTMLElement;
        dragImage.style.position = "absolute";
        dragImage.style.top = "-1000px";
        dragImage.style.opacity = "0.8";
        dragImage.style.width = `${block.offsetWidth}px`;
        document.body.appendChild(dragImage);
        e.dataTransfer?.setDragImage(dragImage, 20, 20);

        setTimeout(() => {
          document.body.removeChild(dragImage);
        }, 0);
      });

      // Drag end
      handle.addEventListener("dragend", () => {
        const block = handle.parentElement;
        if (block) block.classList.remove("ce-block--dragging");
        dragDataRef.current = null;
      });

      return handle;
    };

    // Lazy: add drag handle to block on hover via event delegation
    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Find the nearest .ce-block ancestor (skip blocks inside columns)
      const block = target.closest(
        ".ce-block:not(.columns-editor-holder .ce-block)"
      ) as HTMLElement | null;
      if (!block) return;

      // Already has a handle for this block
      if (block === activeHandleBlock) return;

      // Remove handle from previous block
      if (activeHandle && activeHandleBlock) {
        activeHandle.remove();
        activeHandle = null;
        activeHandleBlock = null;
      }

      // Skip if block already has a handle (shouldn't happen, but guard)
      if (block.querySelector(".ce-block-drag-handle")) return;

      // Insert handle (position:relative is set via CSS on .block-editor .ce-block)
      const handle = createDragHandle();
      block.insertBefore(handle, block.firstChild);
      activeHandle = handle;
      activeHandleBlock = block;
    };

    // Remove handle when mouse leaves the container entirely
    const handleMouseLeave = () => {
      if (activeHandle && activeHandleBlock) {
        activeHandle.remove();
        activeHandle = null;
        activeHandleBlock = null;
      }
    };

    container.addEventListener("mouseover", handleMouseOver);
    container.addEventListener("mouseleave", handleMouseLeave);

    // Expose drag data for columns to access
    (window as unknown as Record<string, unknown>).__editorDragData = dragDataRef;

    return () => {
      container.removeEventListener("mouseover", handleMouseOver);
      container.removeEventListener("mouseleave", handleMouseLeave);

      // Clean up any remaining handle
      if (activeHandle) {
        activeHandle.remove();
      }

      delete (window as unknown as Record<string, unknown>).__editorDragData;
    };
  }, [containerRef, editorRef, enabled]);

  return { dragDataRef };
}

// Extract block data from DOM
function extractBlockData(
  block: HTMLElement
): { type: string; data: Record<string, unknown> } {
  const content = block.querySelector(".ce-block__content");
  if (!content) {
    return { type: "paragraph", data: { text: "" } };
  }

  // Paragraph
  const paragraph = content.querySelector(".ce-paragraph");
  if (paragraph) {
    return { type: "paragraph", data: { text: paragraph.innerHTML } };
  }

  // Header
  const header = content.querySelector("[class*='ce-header']");
  if (header) {
    const level = parseInt(header.tagName.replace("H", "")) || 2;
    return { type: "header", data: { text: header.innerHTML, level } };
  }

  // List
  const list = content.querySelector(".cdx-list");
  if (list) {
    const items = Array.from(list.querySelectorAll(".cdx-list__item")).map(
      (item) => item.innerHTML
    );
    const style = list.classList.contains("cdx-list--ordered")
      ? "ordered"
      : "unordered";
    return { type: "list", data: { items, style } };
  }

  // Checklist
  const checklist = content.querySelector(".cdx-checklist");
  if (checklist) {
    // Checked state is stored in a <style> tag in <head> (CSS-only approach),
    // not in DOM classes.  Read checked state from the style tag by matching
    // nth-child selectors.
    const checklistId = (checklist as HTMLElement).id;
    const styleEl = checklistId
      ? document.getElementById(`style-${checklistId}`)
      : null;
    const checkedCss = styleEl?.textContent || "";

    const items = Array.from(
      checklist.querySelectorAll(".cdx-checklist__item")
    ).map((item, idx) => {
      const nth = idx + 1;
      const isChecked = checkedCss.includes(`:nth-child(${nth})`);
      const text =
        item.querySelector(".cdx-checklist__item-text")?.innerHTML || "";
      return { text, checked: isChecked };
    });
    return { type: "checklist", data: { items } };
  }

  // Quote
  const quote = content.querySelector(".cdx-quote");
  if (quote) {
    const text = quote.querySelector(".cdx-quote__text")?.innerHTML || "";
    const caption =
      quote.querySelector(".cdx-quote__caption")?.innerHTML || "";
    return { type: "quote", data: { text, caption } };
  }

  // Code
  const codeBlock = content.querySelector(".code-block") as HTMLElement | null;
  if (codeBlock) {
    const code = codeBlock.querySelector("code")?.textContent || "";
    const lang = codeBlock.dataset?.language || "";
    return { type: "code", data: { code, language: lang } };
  }

  // Image
  const imageBlock = content.querySelector(".image-tool");
  if (imageBlock) {
    const img = imageBlock.querySelector("img");
    const caption = imageBlock.querySelector(".image-tool__caption")?.textContent || "";
    return {
      type: "image",
      data: {
        file: { url: img?.src || "" },
        caption,
        withBorder: imageBlock.classList.contains("image-tool--withBorder"),
        withBackground: imageBlock.classList.contains("image-tool--withBackground"),
        stretched: imageBlock.classList.contains("image-tool--stretched"),
      },
    };
  }

  // Delimiter
  const delimiter = content.querySelector(".ce-delimiter");
  if (delimiter) {
    return { type: "delimiter", data: {} };
  }

  // Table
  const table = content.querySelector(".tc-table");
  if (table) {
    const rows = Array.from(table.querySelectorAll(".tc-row")).map((row) =>
      Array.from(row.querySelectorAll(".tc-cell")).map(
        (cell) => cell.innerHTML
      )
    );
    return { type: "table", data: { content: rows } };
  }

  // Callout
  const callout = content.querySelector(".callout-block") as HTMLElement | null;
  if (callout) {
    const type = callout.dataset?.type || "info";
    const title = callout.querySelector(".callout-title")?.innerHTML || "";
    const calloutContent = callout.querySelector(".callout-content")?.innerHTML || "";
    return { type: "callout", data: { type, title, content: calloutContent } };
  }

  // Embed
  const embed = content.querySelector(".embed-block");
  if (embed) {
    const embedType = embed.classList.contains("embed-block--link") ? "url" : "page";
    const title = embed.querySelector(".embed-title")?.textContent || "";
    return {
      type: "embed",
      data: {
        embedType,
        pageTitle: embedType === "page" ? title : undefined,
        url: embedType === "url" ? title : undefined,
        isCollapsed: embed.classList.contains("embed-block--collapsed"),
      },
    };
  }

  // Fallback: get text content
  const text = content.textContent?.trim() || "";
  return { type: "paragraph", data: { text } };
}
