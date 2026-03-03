import { useEffect, useRef } from "react";
import type { BlockNoteEditor } from "@blocknote/core";

/**
 * Sorts checked checklist items to the bottom of their consecutive run
 * when a checkbox is toggled.
 *
 * BlockNote renders each checklist item as an independent top-level block
 * (no grouping wrapper like Editor.js had). CSS order can't work because
 * the only flex parent would be the root blockGroup (entire document).
 * Instead, this hook listens for checkbox toggle DOM events and uses
 * the BlockNote editor API to reorder blocks.
 */
export function useChecklistSort(editor: BlockNoteEditor<any, any, any>) {
  const sortingRef = useRef(false);

  useEffect(() => {
    const handler = (e: Event) => {
      if (sortingRef.current) return;

      const target = e.target as HTMLInputElement;
      if (target.type !== "checkbox") return;

      // Verify it's inside a checklist item
      const blockContent = target.closest(
        '[data-content-type="checkListItem"]'
      );
      if (!blockContent) return;

      const blockContainer = blockContent.closest(
        '[data-node-type="blockContainer"]'
      );
      if (!blockContainer) return;
      const blockId = blockContainer.getAttribute("data-id");
      if (!blockId) return;

      // Schedule reorder after BlockNote processes the checkbox change
      setTimeout(() => {
        sortChecklistRun(editor, blockId, sortingRef);
      }, 50);
    };

    // Capture phase to see the change before it bubbles
    document.addEventListener("change", handler, true);
    return () => document.removeEventListener("change", handler, true);
  }, [editor]);
}

function sortChecklistRun(
  editor: BlockNoteEditor<any, any, any>,
  blockId: string,
  sortingRef: React.MutableRefObject<boolean>,
) {
  const doc = editor.document;

  // Find the block's index in the top-level document
  const blockIdx = doc.findIndex((b) => b.id === blockId);
  if (blockIdx === -1) return;
  if (doc[blockIdx].type !== "checkListItem") return;

  // Find the consecutive run of checkListItem blocks containing this block
  let start = blockIdx;
  while (start > 0 && doc[start - 1].type === "checkListItem") start--;
  let end = blockIdx;
  while (end < doc.length - 1 && doc[end + 1].type === "checkListItem") end++;

  const run = doc.slice(start, end + 1);
  if (run.length < 2) return;

  // Sort: unchecked first, then checked (stable — preserves relative order)
  const unchecked = run.filter((b) => !b.props.checked);
  const checked = run.filter((b) => b.props.checked);
  const sorted = [...unchecked, ...checked];

  // Skip if already in order
  if (run.every((b, i) => b.id === sorted[i].id)) return;

  // Replace the run with sorted order
  sortingRef.current = true;
  try {
    editor.replaceBlocks(
      run.map((b) => b.id),
      sorted,
    );
  } finally {
    // Clear flag after BlockNote processes the change
    setTimeout(() => {
      sortingRef.current = false;
    }, 100);
  }
}
