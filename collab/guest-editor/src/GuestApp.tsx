/**
 * Guest editor SPA for real-time collaboration using BlockNote.
 *
 * Deployed at collab.nous.page/{room_id}?token={token}
 * Connects to PartyKit via Yjs for real-time sync with character-level CRDT.
 */

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./guest.css";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs, type BlockNoteEditorOptions } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";

type CollaborationOptions = NonNullable<BlockNoteEditorOptions<any, any, any>["collaboration"]>;
import { useCreateBlockNote } from "@blocknote/react";
import * as Y from "yjs";
import YPartyKitProvider from "y-partykit/provider";

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

const PARTYKIT_HOST = "party.nous.page";

const guestSchema = BlockNoteSchema.create({
  blockSpecs: defaultBlockSpecs,
  inlineContentSpecs: defaultInlineContentSpecs,
  styleSpecs: defaultStyleSpecs,
});

function decodeTokenPayload(token: string): { permissions?: string } | null {
  try {
    const [payloadB64] = token.split(".");
    if (!payloadB64) return null;
    const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
    const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
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
  const [pageTitle, setPageTitle] = useState("");
  const titleRef = useRef<Y.Text | null>(null);

  const roomId = window.location.pathname.split("/").pop() || "";
  const token = new URLSearchParams(window.location.search).get("token") || "";

  const permissions = useMemo(() => {
    if (!token) return "rw";
    const payload = decodeTokenPayload(token);
    return payload?.permissions ?? "rw";
  }, [token]);

  const isReadOnly = permissions === "r";

  const { doc, provider, collabOptions } = useMemo(() => {
    if (!roomId || !token) {
      return { doc: null, provider: null, collabOptions: null };
    }

    const ydoc = new Y.Doc();
    const frag = ydoc.getXmlFragment("document-store");
    const userColor = randomColor();

    const yProvider = new YPartyKitProvider(
      PARTYKIT_HOST, roomId, ydoc,
      { party: "collab-server", params: { token }, connect: true, maxBackoffTime: 30000 }
    );

    yProvider.awareness.setLocalState({
      user: { name: isReadOnly ? "Viewer" : "Guest", color: userColor },
    });

    const options: CollaborationOptions = {
      fragment: frag,
      user: { name: isReadOnly ? "Viewer" : "Guest", color: userColor },
      provider: { awareness: yProvider.awareness },
      showCursorLabels: "activity",
    };

    return { doc: ydoc, provider: yProvider, collabOptions: options };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, token]);

  // Sync page title via Yjs
  useEffect(() => {
    if (!doc) return;
    const yTitle = doc.getText("page-title");
    titleRef.current = yTitle;
    setPageTitle(yTitle.toString());

    const observer = () => setPageTitle(yTitle.toString());
    yTitle.observe(observer);
    return () => yTitle.unobserve(observer);
  }, [doc]);

  const handleTitleChange = useCallback((newTitle: string) => {
    if (!titleRef.current || isReadOnly) return;
    const yTitle = titleRef.current;
    yTitle.delete(0, yTitle.length);
    yTitle.insert(0, newTitle);
  }, [isReadOnly]);

  useEffect(() => {
    if (!roomId || !token) {
      setError("Missing room ID or token in URL");
      setStatus("error");
    }
  }, [roomId, token]);

  useEffect(() => {
    if (!provider) return;

    const handleStatus = (event: { status: string }) => {
      const s = event.status as ConnectionStatus;
      setStatus(s);
      if (s === "connected") setReconnecting(false);
      if (s === "disconnected") setReconnecting(true);
    };
    const handleAwareness = () => setParticipants(provider.awareness.getStates().size);
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

  const editor = useCreateBlockNote(
    collabOptions
      ? { schema: guestSchema, collaboration: collabOptions }
      : { schema: guestSchema },
    [collabOptions]
  );

  if (error) {
    return (
      <div className="guest-center-screen">
        <div className="guest-error-card">
          <h1>Unable to Join Session</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <StatusBar
        status={status}
        reconnecting={reconnecting}
        participants={participants}
        isReadOnly={isReadOnly}
      />

      <div className="guest-page-title">
        {isReadOnly ? (
          <div className="guest-page-title-readonly">
            {pageTitle || "Untitled"}
          </div>
        ) : (
          <input
            type="text"
            value={pageTitle}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Untitled"
            spellCheck={false}
          />
        )}
      </div>

      <div className="guest-editor-area">
        {editor && (
          <BlockNoteView editor={editor} editable={!isReadOnly} theme="dark" />
        )}
      </div>
    </div>
  );
}

export function StatusBar({
  status,
  reconnecting,
  participants,
  isReadOnly,
  rightContent,
}: {
  status: ConnectionStatus;
  reconnecting: boolean;
  participants: number;
  isReadOnly: boolean;
  rightContent?: React.ReactNode;
}) {
  const statusText = reconnecting
    ? "Reconnecting..."
    : status === "connected" ? "Connected"
    : status === "connecting" ? "Connecting..."
    : "Disconnected";

  const dotClass = status === "connected" ? "connected"
    : status === "connecting" ? "connecting"
    : "disconnected";

  return (
    <div className="guest-header">
      <div className="guest-header-left">
        <span className="guest-logo">Nous</span>
        <div className="guest-status">
          <div className={`guest-status-dot ${dotClass} ${reconnecting ? "pulse" : ""}`} />
          <span>{statusText}</span>
        </div>
        {participants > 1 && (
          <div className="guest-participants">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>{participants}</span>
          </div>
        )}
        {isReadOnly && (
          <span className="guest-badge guest-badge-readonly">View Only</span>
        )}
      </div>
      {rightContent}
    </div>
  );
}
