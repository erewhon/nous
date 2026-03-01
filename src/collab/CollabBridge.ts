/**
 * CollabBridge — bridges Editor.js ↔ Yjs ↔ PartyKit for real-time collaboration.
 *
 * The Yjs doc mirrors the page structure:
 *   Root YMap "page" → YArray "blocks" → YMaps with { id, type, data }
 *
 * Local changes: After performSave() in BlockEditor, the caller passes
 * the new EditorData. CollabBridge diffs against the previous snapshot
 * and applies changes as Yjs transactions.
 *
 * Remote changes: The YArray observer detects remote modifications,
 * converts the Yjs doc → EditorData, and calls the onRemoteChange callback.
 *
 * Key constraint: Editor.js is NOT Yjs-aware. CRDT merges at block level
 * (insert/delete/reorder/modify). Within-block content is last-write-wins.
 */

import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";
import { diffEditorData, type BlockChange } from "./diffEditorData";
import type { EditorData } from "../types/page";

export interface CollabBridgeOptions {
  /** PartyKit host (e.g., "party.nous.page") */
  host: string;
  /** Room ID for this collaboration session */
  roomId: string;
  /** Authentication token */
  token: string;
  /** Initial page content to seed the doc */
  initialData: EditorData;
  /** Called when remote changes arrive — should re-render the editor */
  onRemoteChange: (data: EditorData) => void;
  /** Called when connection status changes */
  onStatusChange?: (status: "connecting" | "connected" | "disconnected") => void;
  /** Called when participant count changes */
  onParticipantsChange?: (count: number) => void;
}

export class CollabBridge {
  private doc: Y.Doc;
  private provider: YPartyKitProvider;
  private pageMap: Y.Map<unknown>;
  private blocksArray: Y.Array<Y.Map<unknown>>;
  private suppressRemote = false;
  private lastSnapshot: EditorData;
  private onRemoteChange: (data: EditorData) => void;
  private disposed = false;

  constructor(options: CollabBridgeOptions) {
    this.onRemoteChange = options.onRemoteChange;
    this.lastSnapshot = options.initialData;

    // Create Yjs doc
    this.doc = new Y.Doc();
    this.pageMap = this.doc.getMap("page");
    this.blocksArray = this.pageMap.get("blocks") as Y.Array<Y.Map<unknown>> ??
      (() => {
        const arr = new Y.Array<Y.Map<unknown>>();
        this.pageMap.set("blocks", arr);
        return arr;
      })();

    // Seed the doc with initial data
    this.seedDocument(options.initialData);

    // Connect to PartyKit
    const wsProtocol = options.host.startsWith("localhost") ? "ws" : "wss";
    this.provider = new YPartyKitProvider(
      `${wsProtocol}://${options.host}`,
      options.roomId,
      this.doc,
      {
        params: { token: options.token },
        connect: true,
      }
    );

    // Status events
    this.provider.on("status", (event: { status: string }) => {
      options.onStatusChange?.(
        event.status as "connecting" | "connected" | "disconnected"
      );
    });

    // Awareness (participant tracking)
    this.provider.awareness.on("change", () => {
      const states = this.provider.awareness.getStates();
      options.onParticipantsChange?.(states.size);
    });

    // Set local awareness state
    this.provider.awareness.setLocalState({
      user: {
        name: "Owner",
        color: "#3b82f6",
      },
    });

    // Observe remote changes on the blocks array
    this.blocksArray.observe(this.handleRemoteChange.bind(this));
  }

  /**
   * Seed the Yjs document with initial EditorData.
   * Called once during construction.
   */
  private seedDocument(data: EditorData): void {
    this.doc.transact(() => {
      // Clear existing blocks
      if (this.blocksArray.length > 0) {
        this.blocksArray.delete(0, this.blocksArray.length);
      }

      // Add blocks from initial data
      for (const block of data.blocks) {
        const blockMap = new Y.Map<unknown>();
        blockMap.set("id", block.id);
        blockMap.set("type", block.type);
        blockMap.set("data", block.data);
        this.blocksArray.push([blockMap]);
      }
    }, this.doc.clientID); // Origin = local client ID
  }

  /**
   * Handle remote changes from the YArray observer.
   */
  private handleRemoteChange(_event: Y.YArrayEvent<Y.Map<unknown>>, transaction: Y.Transaction): void {
    if (this.disposed) return;
    // Skip changes from our own transactions
    if (this.suppressRemote || transaction.origin === this.doc.clientID) return;

    // Convert current Yjs state → EditorData
    const data = this.toEditorData();
    this.lastSnapshot = data;
    this.onRemoteChange(data);
  }

  /**
   * Apply a local change (called after performSave produces new EditorData).
   * Diffs against the previous snapshot and applies changes as Yjs transactions.
   */
  applyLocalChange(newData: EditorData): void {
    if (this.disposed) return;

    const changes = diffEditorData(this.lastSnapshot, newData);
    if (changes.length === 0) {
      this.lastSnapshot = newData;
      return;
    }

    this.suppressRemote = true;

    this.doc.transact(() => {
      // Process deletions first (in reverse index order to preserve indices)
      const deletions = changes
        .filter((c): c is BlockChange & { type: "delete" } => c.type === "delete");

      for (const del of deletions) {
        const idx = this.findBlockIndex(del.blockId);
        if (idx >= 0) {
          this.blocksArray.delete(idx, 1);
        }
      }

      // Process modifications
      const modifications = changes
        .filter((c): c is BlockChange & { type: "modify" } => c.type === "modify");

      for (const mod of modifications) {
        const idx = this.findBlockIndex(mod.blockId);
        if (idx >= 0 && mod.block) {
          const existing = this.blocksArray.get(idx);
          existing.set("type", mod.block.type);
          existing.set("data", mod.block.data);
        }
      }

      // Process insertions
      const insertions = changes
        .filter((c): c is BlockChange & { type: "insert" } => c.type === "insert")
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

      for (const ins of insertions) {
        if (ins.block) {
          const blockMap = new Y.Map<unknown>();
          blockMap.set("id", ins.block.id);
          blockMap.set("type", ins.block.type);
          blockMap.set("data", ins.block.data);
          const targetIdx = Math.min(ins.index ?? this.blocksArray.length, this.blocksArray.length);
          this.blocksArray.insert(targetIdx, [blockMap]);
        }
      }

      // Process moves — for simplicity, we handle this as delete + insert
      const moves = changes
        .filter((c): c is BlockChange & { type: "move" } => c.type === "move")
        // Skip blocks that were also modified (already handled)
        .filter((m) => !modifications.some((mod) => mod.blockId === m.blockId))
        // Skip blocks that were just inserted
        .filter((m) => !insertions.some((ins) => ins.blockId === m.blockId));

      for (const move of moves) {
        const currentIdx = this.findBlockIndex(move.blockId);
        if (currentIdx >= 0 && move.index !== undefined && currentIdx !== move.index) {
          // Get current block data
          const block = this.blocksArray.get(currentIdx);
          const id = block.get("id") as string;
          const type = block.get("type") as string;
          const data = block.get("data") as Record<string, unknown>;

          // Delete from old position
          this.blocksArray.delete(currentIdx, 1);

          // Insert at new position
          const newMap = new Y.Map<unknown>();
          newMap.set("id", id);
          newMap.set("type", type);
          newMap.set("data", data);
          const targetIdx = Math.min(move.index, this.blocksArray.length);
          this.blocksArray.insert(targetIdx, [newMap]);
        }
      }
    }, this.doc.clientID);

    this.suppressRemote = false;
    this.lastSnapshot = newData;
  }

  /**
   * Convert the current Yjs document state to EditorData.
   */
  toEditorData(): EditorData {
    const blocks: EditorData["blocks"] = [];

    for (let i = 0; i < this.blocksArray.length; i++) {
      const blockMap = this.blocksArray.get(i);
      blocks.push({
        id: blockMap.get("id") as string,
        type: blockMap.get("type") as string,
        data: blockMap.get("data") as Record<string, unknown>,
      });
    }

    return {
      time: Date.now(),
      version: "2.31.1",
      blocks,
    };
  }

  /**
   * Find the index of a block in the YArray by its ID.
   */
  private findBlockIndex(blockId: string): number {
    for (let i = 0; i < this.blocksArray.length; i++) {
      const block = this.blocksArray.get(i);
      if (block.get("id") === blockId) return i;
    }
    return -1;
  }

  /**
   * Set the user name and color for awareness.
   */
  setUser(name: string, color: string): void {
    this.provider.awareness.setLocalState({
      user: { name, color },
    });
  }

  /**
   * Get current participant count.
   */
  getParticipantCount(): number {
    return this.provider.awareness.getStates().size;
  }

  /**
   * Get the connection status.
   */
  get status(): "connecting" | "connected" | "disconnected" {
    if (this.provider.wsconnected) return "connected";
    if (this.provider.wsconnecting) return "connecting";
    return "disconnected";
  }

  /**
   * Clean up: disconnect provider, destroy doc.
   */
  destroy(): void {
    this.disposed = true;
    this.provider.awareness.setLocalState(null);
    this.provider.disconnect();
    this.provider.destroy();
    this.doc.destroy();
  }
}
