import { useEffect, useRef, useCallback } from "react";
import type EditorJS from "@editorjs/editorjs";

/**
 * Hook that enhances the List tool's checklist mode with:
 * 1. Drag handles for reordering items within a checklist
 * 2. Auto-sorting checked items to the bottom
 */
export function useChecklistEnhancer(
  _editorRef: React.RefObject<EditorJS | null>,
  holderId: string
) {
  const observerRef = useRef<MutationObserver | null>(null);
  const draggedItemRef = useRef<HTMLElement | null>(null);
  const draggedIndexRef = useRef<number>(-1);

  // Create drag handle element
  const createDragHandle = useCallback(() => {
    const handle = document.createElement("div");
    handle.className = "cdx-list__drag-handle";
    handle.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <circle cx="3" cy="2" r="1.5"/>
      <circle cx="9" cy="2" r="1.5"/>
      <circle cx="3" cy="6" r="1.5"/>
      <circle cx="9" cy="6" r="1.5"/>
      <circle cx="3" cy="10" r="1.5"/>
      <circle cx="9" cy="10" r="1.5"/>
    </svg>`;
    handle.draggable = true;
    return handle;
  }, []);

  // Get the parent list element from an item
  const getParentList = useCallback((item: HTMLElement): HTMLElement | null => {
    return item.closest(".cdx-list") as HTMLElement | null;
  }, []);

  // Get all checklist items in a list
  const getChecklistItems = useCallback((list: HTMLElement): HTMLElement[] => {
    return Array.from(list.querySelectorAll(":scope > .cdx-list__item")) as HTMLElement[];
  }, []);

  // Check if item is checked
  const isItemChecked = useCallback((item: HTMLElement): boolean => {
    const checkbox = item.querySelector(".cdx-list__checkbox");
    return checkbox?.classList.contains("cdx-list__checkbox--checked") ?? false;
  }, []);

  // Sort checked items to bottom
  const sortCheckedToBottom = useCallback((list: HTMLElement) => {
    const items = getChecklistItems(list);
    const unchecked: HTMLElement[] = [];
    const checked: HTMLElement[] = [];

    items.forEach((item) => {
      if (isItemChecked(item)) {
        checked.push(item);
      } else {
        unchecked.push(item);
      }
    });

    // Only reorder if there are both checked and unchecked items
    if (unchecked.length > 0 && checked.length > 0) {
      // Reorder by appending in correct order
      [...unchecked, ...checked].forEach((item) => {
        list.appendChild(item);
      });
    }
  }, [getChecklistItems, isItemChecked]);

  // Handle drag start
  const handleDragStart = useCallback((e: DragEvent, item: HTMLElement, index: number) => {
    draggedItemRef.current = item;
    draggedIndexRef.current = index;
    item.classList.add("cdx-list__item--dragging");

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    }
  }, []);

  // Handle drag end
  const handleDragEnd = useCallback((_e: DragEvent, item: HTMLElement) => {
    item.classList.remove("cdx-list__item--dragging");
    draggedItemRef.current = null;
    draggedIndexRef.current = -1;

    // Remove drag-over class from all items
    const list = getParentList(item);
    if (list) {
      list.querySelectorAll(".cdx-list__item--drag-over").forEach((el) => {
        el.classList.remove("cdx-list__item--drag-over");
      });
    }
  }, [getParentList]);

  // Handle drag over
  const handleDragOver = useCallback((e: DragEvent, item: HTMLElement) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }

    if (item === draggedItemRef.current) return;
    item.classList.add("cdx-list__item--drag-over");
  }, []);

  // Handle drag leave
  const handleDragLeave = useCallback((_e: DragEvent, item: HTMLElement) => {
    item.classList.remove("cdx-list__item--drag-over");
  }, []);

  // Handle drop
  const handleDrop = useCallback((e: DragEvent, targetItem: HTMLElement) => {
    e.preventDefault();
    targetItem.classList.remove("cdx-list__item--drag-over");

    const draggedItem = draggedItemRef.current;
    if (!draggedItem || draggedItem === targetItem) return;

    const list = getParentList(targetItem);
    if (!list) return;

    const items = getChecklistItems(list);
    const draggedIndex = items.indexOf(draggedItem);
    const targetIndex = items.indexOf(targetItem);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Move the dragged item
    if (draggedIndex < targetIndex) {
      targetItem.after(draggedItem);
    } else {
      targetItem.before(draggedItem);
    }
  }, [getParentList, getChecklistItems]);

  // Enhance a checklist item with drag handle and events
  const enhanceChecklistItem = useCallback((item: HTMLElement, index: number) => {
    // Skip if already enhanced
    if (item.querySelector(".cdx-list__drag-handle")) return;

    // Only enhance items with checkboxes (checklist style)
    const checkbox = item.querySelector(".cdx-list__checkbox");
    if (!checkbox) return;

    // Add drag handle
    const handle = createDragHandle();
    item.insertBefore(handle, item.firstChild);

    // Make item draggable when handle is grabbed
    handle.addEventListener("mousedown", () => {
      item.draggable = true;
    });

    item.addEventListener("mouseup", () => {
      item.draggable = false;
    });

    // Drag events
    item.addEventListener("dragstart", (e) => handleDragStart(e, item, index));
    item.addEventListener("dragend", (e) => handleDragEnd(e, item));
    item.addEventListener("dragover", (e) => handleDragOver(e, item));
    item.addEventListener("dragleave", (e) => handleDragLeave(e, item));
    item.addEventListener("drop", (e) => handleDrop(e, item));

    // Add click listener to checkbox for auto-sort
    checkbox.addEventListener("click", () => {
      const list = getParentList(item);
      if (list) {
        // Small delay to let the checkbox state update
        setTimeout(() => {
          if (isItemChecked(item)) {
            sortCheckedToBottom(list);
          }
        }, 150);
      }
    });
  }, [
    createDragHandle,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    getParentList,
    isItemChecked,
    sortCheckedToBottom,
  ]);

  // Enhance all checklist items in the editor
  const enhanceAllChecklists = useCallback(() => {
    const holder = document.getElementById(holderId);
    if (!holder) return;

    // Find all checklist items (items with checkboxes)
    const checklistItems = holder.querySelectorAll(
      ".cdx-list__item"
    ) as NodeListOf<HTMLElement>;

    checklistItems.forEach((item, index) => {
      enhanceChecklistItem(item, index);
    });
  }, [holderId, enhanceChecklistItem]);

  // Set up mutation observer to enhance new checklist items
  useEffect(() => {
    const holder = document.getElementById(holderId);
    if (!holder) return;

    // Initial enhancement (with delay for Editor.js to render)
    let debounceId: ReturnType<typeof setTimeout> | null = null;
    const timeoutId = setTimeout(enhanceAllChecklists, 200);

    // Observe for new checklist items
    observerRef.current = new MutationObserver((mutations) => {
      let shouldEnhance = false;

      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          // Check if any added nodes are or contain checklist items
          mutation.addedNodes.forEach((node) => {
            if (node instanceof HTMLElement) {
              if (
                node.classList?.contains("cdx-list__item") ||
                node.querySelector?.(".cdx-list__item")
              ) {
                shouldEnhance = true;
              }
            }
          });
        }
      }

      if (shouldEnhance) {
        // Properly debounce — clear any pending callback before scheduling
        if (debounceId) clearTimeout(debounceId);
        debounceId = setTimeout(enhanceAllChecklists, 150);
      }
    });

    observerRef.current.observe(holder, {
      childList: true,
      subtree: true,
    });

    return () => {
      clearTimeout(timeoutId);
      if (debounceId) clearTimeout(debounceId);
      observerRef.current?.disconnect();
    };
  }, [holderId, enhanceAllChecklists]);

  return { enhanceAllChecklists };
}
