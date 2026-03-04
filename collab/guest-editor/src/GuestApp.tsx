/**
 * Guest editor SPA for real-time collaboration using BlockNote.
 *
 * Deployed to Cloudflare Pages at collab.nous.page/{room_id}?token={token}
 * Connects to PartyKit via Yjs for real-time sync with character-level CRDT.
 *
 * BlockNote's native collaboration handles everything:
 * - Character-level editing sync via y-prosemirror
 * - Cursor awareness with colored labels
 * - Yjs-aware undo/redo
 */

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { useEffect, useMemo, useState } from "react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs, type BlockNoteEditorOptions } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";

type CollaborationOptions = NonNullable<BlockNoteEditorOptions<any, any, any>["collaboration"]>;
import { useCreateBlockNote } from "@blocknote/react";
import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

const PARTYKIT_HOST = "party.nous.page";

// Guest-safe schema: only standard blocks (no Tauri-dependent custom blocks)
const guestSchema = BlockNoteSchema.create({
  blockSpecs: defaultBlockSpecs,
  inlineContentSpecs: defaultInlineContentSpecs,
  styleSpecs: defaultStyleSpecs,
});

/** Decode a JWT-like token payload (base64url) without verification */
function decodeTokenPayload(token: string): { permissions?: string } | null {
  try {
    const [payloadB64] = token.split(".");
    if (!payloadB64) return null;
    const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
    const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function randomColor(): string {
  const colors = [
    "#f44336", "#e91e63", "#9c27b0", "#673ab7", "#3f51b5",
    "#2196f3", "#03a9f4", "#00bcd4", "#009688", "#4caf50",
    "#8bc34a", "#ff9800", "#ff5722", "#795548",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

export function GuestApp() {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [participants, setParticipants] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  // Parse URL params
  const roomId = window.location.pathname.split("/").pop() || "";
  const token = new URLSearchParams(window.location.search).get("token") || "";

  // Decode permissions from token
  const permissions = useMemo(() => {
    if (!token) return "rw";
    const payload = decodeTokenPayload(token);
    return payload?.permissions ?? "rw";
  }, [token]);

  const isReadOnly = permissions === "r";

  // Create Yjs doc and provider (stable refs via useMemo)
  const { doc, provider, fragment, collabOptions } = useMemo(() => {
    if (!roomId || !token) {
      return { doc: null, provider: null, fragment: null, collabOptions: null };
    }

    const ydoc = new Y.Doc();
    const frag = ydoc.getXmlFragment("document-store");
    const userColor = randomColor();

    const yProvider = new YPartyKitProvider(
      PARTYKIT_HOST,
      roomId,
      ydoc,
      {
        party: "collab-server",
        params: { token },
        connect: true,
        maxBackoffTime: 30000,
      }
    );

    yProvider.awareness.setLocalState({
      user: {
        name: isReadOnly ? "Viewer" : "Guest",
        color: userColor,
      },
    });

    const options: CollaborationOptions = {
      fragment: frag,
      user: { name: isReadOnly ? "Viewer" : "Guest", color: userColor },
      provider: { awareness: yProvider.awareness },
      showCursorLabels: "activity",
    };

    return { doc: ydoc, provider: yProvider, fragment: frag, collabOptions: options };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, token]);

  // Error check
  useEffect(() => {
    if (!roomId || !token) {
      setError("Missing room ID or token in URL");
      setStatus("error");
    }
  }, [roomId, token]);

  // Provider event listeners
  useEffect(() => {
    if (!provider) return;

    const handleStatus = (event: { status: string }) => {
      const s = event.status as ConnectionStatus;
      setStatus(s);
      if (s === "connected") setReconnecting(false);
      if (s === "disconnected") setReconnecting(true);
    };

    const handleAwareness = () => {
      setParticipants(provider.awareness.getStates().size);
    };

    const handleClose = (event: CloseEvent) => {
      if (event.code === 4003) {
        setError("Session expired or invalid token");
        setStatus("error");
        provider.disconnect();
      }
    };

    provider.on("status", handleStatus);
    provider.awareness.on("change", handleAwareness);
    provider.on("connection-close", handleClose);

    return () => {
      provider.off("status", handleStatus);
      provider.awareness.off("change", handleAwareness);
      provider.off("connection-close", handleClose);
      provider.awareness.setLocalState(null);
      provider.disconnect();
      provider.destroy();
      doc?.destroy();
    };
  }, [provider, doc]);

  // Create BlockNote editor with collaboration
  const editor = useCreateBlockNote(
    collabOptions
      ? {
          schema: guestSchema,
          collaboration: collabOptions,
        }
      : {
          schema: guestSchema,
        },
    [collabOptions]
  );

  if (error) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "2rem",
      }}>
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
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: status === "connected" ? "#22c55e"
                : status === "connecting" ? "#f59e0b"
                : "#ef4444",
              animation: reconnecting ? "pulse 1.5s infinite" : undefined,
            }} />
            <span>
              {reconnecting
                ? "Reconnecting..."
                : status === "connected"
                  ? "Connected"
                  : status === "connecting"
                    ? "Connecting..."
                    : "Disconnected"}
            </span>
          </div>
          {participants > 0 && (
            <span>{participants} collaborator{participants !== 1 ? "s" : ""}</span>
          )}
          {isReadOnly && (
            <span style={{
              padding: "0.125rem 0.5rem",
              borderRadius: "4px",
              backgroundColor: "rgba(245, 158, 11, 0.2)",
              color: "#f59e0b",
              fontSize: "0.7rem",
              fontWeight: 600,
            }}>
              VIEW ONLY
            </span>
          )}
        </div>
        <span>Room: {roomId}</span>
      </div>

      {/* Editor */}
      <div style={{
        flex: 1,
        maxWidth: 720,
        margin: "0 auto",
        width: "100%",
        padding: "2rem 1rem",
      }}>
        {editor && (
          <BlockNoteView
            editor={editor}
            editable={!isReadOnly}
            theme="dark"
          />
        )}
      </div>

      {/* CSS animation for reconnecting pulse */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
