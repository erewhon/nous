/**
 * Guest editor SPA for real-time collaboration.
 *
 * Deployed to Cloudflare Pages at collab.nous.page/{room_id}?token={token}
 * Connects to PartyKit via Yjs for real-time sync.
 *
 * Uses a safe subset of Editor.js tools (no Tauri-dependent tools):
 * header, paragraph, list, code, quote, delimiter, table
 */

import { useEffect, useRef, useState, useCallback } from "react";
import EditorJS from "@editorjs/editorjs";
import Header from "@editorjs/header";
import List from "@editorjs/list";
import Code from "@editorjs/code";
import Quote from "@editorjs/quote";
import Delimiter from "@editorjs/delimiter";
import Table from "@editorjs/table";
import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

interface EditorBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

const PARTYKIT_HOST = "party.nous.page";

export function GuestApp() {
  const editorRef = useRef<EditorJS | null>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<YPartyKitProvider | null>(null);
  const blocksArrayRef = useRef<Y.Array<Y.Map<unknown>> | null>(null);
  const suppressRemoteRef = useRef(false);
  const lastSnapshotRef = useRef<EditorBlock[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [participants, setParticipants] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Parse URL params
  const roomId = window.location.pathname.split("/").pop() || "";
  const token = new URLSearchParams(window.location.search).get("token") || "";

  // Convert Yjs state to EditorJS format
  const yjsToBlocks = useCallback((blocksArray: Y.Array<Y.Map<unknown>>): EditorBlock[] => {
    const blocks: EditorBlock[] = [];
    for (let i = 0; i < blocksArray.length; i++) {
      const blockMap = blocksArray.get(i);
      blocks.push({
        id: blockMap.get("id") as string,
        type: blockMap.get("type") as string,
        data: blockMap.get("data") as Record<string, unknown>,
      });
    }
    return blocks;
  }, []);

  // Initialize editor + Yjs
  useEffect(() => {
    if (!roomId || !token) {
      setError("Missing room ID or token in URL");
      setStatus("error");
      return;
    }

    // Create Yjs doc — do NOT create shared types yet.
    // Wait for sync so the server's state populates the doc first.
    const doc = new Y.Doc();
    docRef.current = doc;

    // Connect to PartyKit
    // YPartyKitProvider adds the protocol (ws/wss) automatically based on host
    const provider = new YPartyKitProvider(
      PARTYKIT_HOST,
      roomId,
      doc,
      {
        party: "collab-server",
        params: { token },
        connect: true,
      }
    );
    providerRef.current = provider;

    provider.on("status", (event: { status: string }) => {
      setStatus(event.status as ConnectionStatus);
    });

    provider.awareness.on("change", () => {
      setParticipants(provider.awareness.getStates().size);
    });

    provider.awareness.setLocalState({
      user: {
        name: "Guest",
        color: "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0"),
      },
    });

    // Wait for initial sync, then read the doc and initialize editor
    provider.on("synced", () => {
      // Now the doc has the server's state. Read the shared types.
      const pageMap = doc.getMap("page");
      let blocksArray = pageMap.get("blocks") as Y.Array<Y.Map<unknown>> | undefined;
      if (!blocksArray) {
        // Server had no blocks yet — create the array now
        blocksArray = new Y.Array<Y.Map<unknown>>();
        pageMap.set("blocks", blocksArray);
      }
      blocksArrayRef.current = blocksArray;

      const initialBlocks = yjsToBlocks(blocksArray);
      lastSnapshotRef.current = initialBlocks;

      console.log("[GuestApp] synced, got", initialBlocks.length, "blocks from server");

      const editor = new EditorJS({
        holder: "editor",
        tools: {
          header: { class: Header as unknown as EditorJS.BlockToolConstructable, inlineToolbar: true },
          list: { class: List as unknown as EditorJS.BlockToolConstructable, inlineToolbar: true },
          code: Code as unknown as EditorJS.BlockToolConstructable,
          quote: { class: Quote as unknown as EditorJS.BlockToolConstructable, inlineToolbar: true },
          delimiter: Delimiter as unknown as EditorJS.BlockToolConstructable,
          table: { class: Table as unknown as EditorJS.BlockToolConstructable, inlineToolbar: true },
        },
        data: {
          time: Date.now(),
          version: "2.31.1",
          blocks: initialBlocks.length > 0
            ? initialBlocks
            : [{ id: crypto.randomUUID(), type: "paragraph", data: { text: "" } }],
        },
        onChange: async () => {
          if (suppressRemoteRef.current) return;

          try {
            const saved = await editor.save();
            const newBlocks = saved.blocks.map((b) => ({
              id: b.id ?? crypto.randomUUID(),
              type: b.type,
              data: b.data as Record<string, unknown>,
            }));

            // Apply diff to Yjs
            suppressRemoteRef.current = true;
            doc.transact(() => {
              applyDiffToYjs(lastSnapshotRef.current, newBlocks, blocksArrayRef.current!);
            }, doc.clientID);
            suppressRemoteRef.current = false;

            lastSnapshotRef.current = newBlocks;
          } catch (err) {
            console.warn("Failed to save editor state:", err);
            suppressRemoteRef.current = false;
          }
        },
        placeholder: "Start writing...",
      });

      editorRef.current = editor;

      // Observe remote changes
      blocksArray.observe((event, transaction) => {
        if (suppressRemoteRef.current || transaction.origin === doc.clientID) return;

        const remoteBlocks = yjsToBlocks(blocksArrayRef.current!);
        lastSnapshotRef.current = remoteBlocks;

        suppressRemoteRef.current = true;
        editor.render({
          time: Date.now(),
          version: "2.31.1",
          blocks: remoteBlocks,
        }).then(() => {
          suppressRemoteRef.current = false;
        }).catch(() => {
          suppressRemoteRef.current = false;
        });
      });
    });

    return () => {
      editorRef.current?.destroy();
      provider.awareness.setLocalState(null);
      provider.disconnect();
      provider.destroy();
      doc.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, token]);

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "2rem" }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>Unable to Join Session</h1>
          <p style={{ color: "#999" }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {/* Status bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.5rem 1rem",
        borderBottom: "1px solid #333",
        backgroundColor: "#16213e",
        fontSize: "0.75rem",
        color: "#999",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={{ fontWeight: 600, color: "#e0e0e0" }}>Nous</span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              backgroundColor: status === "connected" ? "#22c55e" : status === "connecting" ? "#f59e0b" : "#ef4444",
            }} />
            <span>{status === "connected" ? "Connected" : status === "connecting" ? "Connecting..." : "Disconnected"}</span>
          </div>
          {participants > 0 && (
            <span>{participants} collaborator{participants !== 1 ? "s" : ""}</span>
          )}
        </div>
        <span>Room: {roomId}</span>
      </div>

      {/* Editor */}
      <div style={{ flex: 1, maxWidth: 720, margin: "0 auto", width: "100%", padding: "2rem 1rem" }}>
        <div id="editor" />
      </div>
    </div>
  );
}

/**
 * Apply a diff between old and new block arrays to a Yjs YArray.
 */
function applyDiffToYjs(
  oldBlocks: EditorBlock[],
  newBlocks: EditorBlock[],
  blocksArray: Y.Array<Y.Map<unknown>>
) {
  const oldMap = new Map(oldBlocks.map((b, i) => [b.id, { block: b, index: i }]));
  const newMap = new Map(newBlocks.map((b, i) => [b.id, { block: b, index: i }]));

  // Deletions (reverse order to preserve indices)
  const toDelete: number[] = [];
  for (const [id] of oldMap) {
    if (!newMap.has(id)) {
      const idx = findBlockIndex(blocksArray, id);
      if (idx >= 0) toDelete.push(idx);
    }
  }
  toDelete.sort((a, b) => b - a);
  for (const idx of toDelete) {
    blocksArray.delete(idx, 1);
  }

  // Modifications
  for (const [id, { block }] of newMap) {
    const old = oldMap.get(id);
    if (old) {
      if (old.block.type !== block.type || JSON.stringify(old.block.data) !== JSON.stringify(block.data)) {
        const idx = findBlockIndex(blocksArray, id);
        if (idx >= 0) {
          const existing = blocksArray.get(idx);
          existing.set("type", block.type);
          existing.set("data", block.data);
        }
      }
    }
  }

  // Insertions
  for (const [id, { block, index }] of newMap) {
    if (!oldMap.has(id)) {
      const blockMap = new Y.Map<unknown>();
      blockMap.set("id", block.id);
      blockMap.set("type", block.type);
      blockMap.set("data", block.data);
      const targetIdx = Math.min(index, blocksArray.length);
      blocksArray.insert(targetIdx, [blockMap]);
    }
  }
}

function findBlockIndex(blocksArray: Y.Array<Y.Map<unknown>>, blockId: string): number {
  for (let i = 0; i < blocksArray.length; i++) {
    if (blocksArray.get(i).get("id") === blockId) return i;
  }
  return -1;
}
