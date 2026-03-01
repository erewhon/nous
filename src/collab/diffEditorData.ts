/**
 * Block-level diff algorithm for Editor.js data.
 *
 * Compares two EditorData snapshots by block ID to produce a minimal
 * set of operations (insert, delete, modify, move) for applying to
 * a Yjs YArray of blocks.
 *
 * This is the JS equivalent of the Rust diff_blocks() in
 * src-tauri/src/sync/crdt/converter.rs.
 */

import type { EditorData } from "../types/page";

export interface BlockChange {
  type: "insert" | "delete" | "modify" | "move";
  blockId: string;
  /** For insert: the new block data */
  block?: { id: string; type: string; data: Record<string, unknown> };
  /** For insert/move: the target index in the new array */
  index?: number;
}

/**
 * Diff two EditorData snapshots and return the list of changes.
 * Blocks are identified by their `id` field.
 */
export function diffEditorData(
  oldData: EditorData | null,
  newData: EditorData
): BlockChange[] {
  const changes: BlockChange[] = [];

  const oldBlocks = oldData?.blocks ?? [];
  const newBlocks = newData.blocks ?? [];

  const oldMap = new Map(oldBlocks.map((b, i) => [b.id, { block: b, index: i }]));
  const newMap = new Map(newBlocks.map((b, i) => [b.id, { block: b, index: i }]));

  // Deletions: blocks in old but not in new
  for (const [id] of oldMap) {
    if (!newMap.has(id)) {
      changes.push({ type: "delete", blockId: id });
    }
  }

  // Insertions and modifications
  for (const [id, { block, index }] of newMap) {
    const old = oldMap.get(id);
    if (!old) {
      // New block — insert
      changes.push({
        type: "insert",
        blockId: id,
        block: { id: block.id, type: block.type, data: block.data },
        index,
      });
    } else {
      // Existing block — check for modifications
      if (
        old.block.type !== block.type ||
        !deepEqual(old.block.data, block.data)
      ) {
        changes.push({
          type: "modify",
          blockId: id,
          block: { id: block.id, type: block.type, data: block.data },
        });
      }

      // Check for position change (move)
      if (old.index !== index) {
        // Only emit move if the block wasn't modified (avoid double-ops)
        // Actually, move detection is complex with concurrent inserts/deletes.
        // We handle moves by deleting and re-inserting at the Yjs level.
        changes.push({
          type: "move",
          blockId: id,
          index,
        });
      }
    }
  }

  return changes;
}

/**
 * Simple deep equality check for block data objects.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  if (typeof a === "object") {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((item, i) => deepEqual(item, b[i]));
    }

    if (Array.isArray(a) !== Array.isArray(b)) return false;

    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
  }

  return false;
}
