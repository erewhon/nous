import { useEffect, useRef, useCallback } from "react";
import type EditorJS from "@editorjs/editorjs";

/**
 * Hook that enhances the List tool's checklist mode with drag handles
 * for reordering items within a checklist.
 *
 * IMPORTANT: Uses lazy loading — drag handles are only inserted when the
 * mouse hovers over a checklist item. This avoids mass DOM insertions at
 * init time, which causes WebKitGTK rendering pipeline freezes.
 */
export function useChecklistEnhancer(
  _editorRef: React.RefObject<EditorJS | null>,
  holderId: string
) {
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

  // Enhance a single checklist item with drag handle and events
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
  }, [
    createDragHandle,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  ]);

  // Lazy enhance: use event delegation to enhance items on hover
  useEffect(() => {
    const holder = document.getElementById(holderId);
    if (!holder) return;

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const item = target.closest(".cdx-list__item") as HTMLElement | null;
      if (!item) return;

      // Already enhanced
      if (item.querySelector(".cdx-list__drag-handle")) return;

      // Only enhance items with checkboxes (checklist style)
      const checkbox = item.querySelector(".cdx-list__checkbox");
      if (!checkbox) return;

      // Find index within parent list
      const list = getParentList(item);
      if (!list) return;
      const items = getChecklistItems(list);
      const index = items.indexOf(item);

      enhanceChecklistItem(item, index);
    };

    holder.addEventListener("mouseover", handleMouseOver);

    return () => {
      holder.removeEventListener("mouseover", handleMouseOver);
    };
  }, [holderId, enhanceChecklistItem, getParentList, getChecklistItems]);

  return { enhanceAllChecklists: () => {} };
}
