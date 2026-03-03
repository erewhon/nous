/**
 * Multi-page guest editor for scoped collaboration sessions.
 *
 * Fetches the page manifest from the Worker API, renders a sidebar
 * for navigation, and lazily creates per-page Yjs providers.
 *
 * URL: /s/{session_id}?token={token}
 * Deep link: /s/{session_id}/{page_id}?token={token}
 */

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { useEffect, useMemo, useState, useCallback } from "react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs, type BlockNoteEditorOptions } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";

import { GuestSidebar } from "./GuestSidebar";
import { getOrCreateProvider, destroyAll, destroyProvider } from "./providerManager";

type CollaborationOptions = NonNullable<BlockNoteEditorOptions<any, any, any>["collaboration"]>;
type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

const PARTYKIT_HOST = "party.nous.page";

interface ManifestPage {
  id: string;
  title: string;
  folderId?: string | null;
  sectionId?: string | null;
}

// Guest-safe schema: only standard blocks (no Tauri-dependent custom blocks)
const guestSchema = BlockNoteSchema.create({
  blockSpecs: defaultBlockSpecs,
  inlineContentSpecs: defaultInlineContentSpecs,
  styleSpecs: defaultStyleSpecs,
});

/** Decode a JWT-like token payload (base64url) without verification */
function decodeTokenPayload(token: string): {
  permissions?: string;
  scope_type?: string;
  scope_id?: string;
  notebook_id?: string;
} | null {
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

interface GuestMultiPageAppProps {
  sessionId: string;
  token: string;
  /** Initial page ID from deep link URL */
  initialPageId?: string;
}

export function GuestMultiPageApp({ sessionId, token, initialPageId }: GuestMultiPageAppProps) {
  const [pages, setPages] = useState<ManifestPage[]>([]);
  const [currentPageId, setCurrentPageId] = useState<string | null>(initialPageId ?? null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [participants, setParticipants] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [loadingManifest, setLoadingManifest] = useState(true);

  const userColor = useMemo(() => randomColor(), []);

  // Decode token for permissions and notebook_id
  const tokenPayload = useMemo(() => decodeTokenPayload(token), [token]);
  const permissions = tokenPayload?.permissions ?? "rw";
  const isReadOnly = permissions === "r";
  const notebookId = tokenPayload?.notebook_id ?? "";

  // Fetch manifest
  useEffect(() => {
    if (!sessionId || !token) {
      setError("Missing session ID or token");
      setLoadingManifest(false);
      return;
    }

    const fetchManifest = async () => {
      try {
        const url = `https://${PARTYKIT_HOST}/api/manifest/${sessionId}?token=${token}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Failed to load page list (${res.status})`);
        }
        const data: ManifestPage[] = await res.json();
        setPages(data);

        // Auto-select first page if none specified
        if (!currentPageId && data.length > 0) {
          setCurrentPageId(data[0].id);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingManifest(false);
      }
    };

    fetchManifest();
  }, [sessionId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up all providers on unmount
  useEffect(() => {
    return () => destroyAll();
  }, []);

  // Get or create provider for current page
  const collabOptions: CollaborationOptions | null = useMemo(() => {
    if (!currentPageId || !notebookId || !token) return null;

    const entry = getOrCreateProvider(
      currentPageId,
      notebookId,
      token,
      { name: isReadOnly ? "Viewer" : "Guest", color: userColor },
      isReadOnly,
    );

    return entry.collabOptions;
  }, [currentPageId, notebookId, token, userColor, isReadOnly]);

  // Provider event listeners for current page
  useEffect(() => {
    if (!currentPageId || !notebookId || !token) return;

    const entry = getOrCreateProvider(
      currentPageId,
      notebookId,
      token,
      { name: isReadOnly ? "Viewer" : "Guest", color: userColor },
      isReadOnly,
    );

    const { provider } = entry;

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

    // Set initial state
    if (provider.wsconnected) {
      setStatus("connected");
      setReconnecting(false);
    }
    setParticipants(provider.awareness.getStates().size);

    return () => {
      provider.off("status", handleStatus);
      provider.awareness.off("change", handleAwareness);
      provider.off("connection-close", handleClose);
    };
  }, [currentPageId, notebookId, token, userColor, isReadOnly]);

  // Page navigation
  const handleSelectPage = useCallback((pageId: string) => {
    setCurrentPageId(pageId);
    // Update URL for deep linking
    const url = new URL(window.location.href);
    url.pathname = `/s/${sessionId}/${pageId}`;
    window.history.replaceState(null, "", url.toString());
  }, [sessionId]);

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

  if (loadingManifest) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
      }}>
        <span style={{ color: "#999" }}>Loading pages...</span>
      </div>
    );
  }

  const currentPage = pages.find((p) => p.id === currentPageId);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <GuestSidebar
        pages={pages}
        currentPageId={currentPageId}
        onSelectPage={handleSelectPage}
      />

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
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
          {currentPage && (
            <span style={{ color: "#ccc" }}>{currentPage.title}</span>
          )}
        </div>

        {/* Editor */}
        <div style={{
          flex: 1,
          maxWidth: 720,
          margin: "0 auto",
          width: "100%",
          padding: "2rem 1rem",
        }}>
          {editor && currentPageId && (
            <BlockNoteView
              editor={editor}
              editable={!isReadOnly}
              theme="dark"
            />
          )}
          {!currentPageId && (
            <div style={{ textAlign: "center", color: "#666", padding: "4rem" }}>
              Select a page from the sidebar
            </div>
          )}
        </div>
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
