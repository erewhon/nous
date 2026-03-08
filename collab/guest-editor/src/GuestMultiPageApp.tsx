/**
 * Multi-page guest editor for scoped collaboration sessions.
 *
 * URL: /s/{session_id}?token={token}
 * Deep link: /s/{session_id}/{page_id}?token={token}
 */

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./guest.css";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs, type BlockNoteEditorOptions } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";

import { GuestSidebar } from "./GuestSidebar";
import { StatusBar } from "./GuestApp";
import { getOrCreateProvider, destroyAll } from "./providerManager";

type CollaborationOptions = NonNullable<BlockNoteEditorOptions<any, any, any>["collaboration"]>;
type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

const PARTYKIT_HOST = "party.nous.page";

interface ManifestPage {
  id: string;
  title: string;
  folderId?: string | null;
  sectionId?: string | null;
}

const guestSchema = BlockNoteSchema.create({
  blockSpecs: defaultBlockSpecs,
  inlineContentSpecs: defaultInlineContentSpecs,
  styleSpecs: defaultStyleSpecs,
});

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

interface GuestMultiPageAppProps {
  sessionId: string;
  token: string;
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
  const [pageTitle, setPageTitle] = useState("");
  const titleRef = useRef<{ yText: any; observer: any } | null>(null);

  const userColor = useMemo(() => randomColor(), []);

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
        if (!res.ok) throw new Error(`Failed to load page list (${res.status})`);
        const data: ManifestPage[] = await res.json();
        setPages(data);
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

  useEffect(() => () => destroyAll(), []);

  // Get or create provider for current page
  const collabOptions: CollaborationOptions | null = useMemo(() => {
    if (!currentPageId || !notebookId || !token) return null;
    const entry = getOrCreateProvider(
      currentPageId, notebookId, token,
      { name: isReadOnly ? "Viewer" : "Guest", color: userColor },
      isReadOnly,
    );
    return entry.collabOptions;
  }, [currentPageId, notebookId, token, userColor, isReadOnly]);

  // Sync page title via Yjs for current page
  useEffect(() => {
    // Clean up previous observer
    if (titleRef.current) {
      titleRef.current.yText.unobserve(titleRef.current.observer);
      titleRef.current = null;
    }

    if (!currentPageId || !notebookId || !token) return;

    const entry = getOrCreateProvider(
      currentPageId, notebookId, token,
      { name: isReadOnly ? "Viewer" : "Guest", color: userColor },
      isReadOnly,
    );

    const yTitle = entry.doc.getText("page-title");
    setPageTitle(yTitle.toString());

    const observer = () => setPageTitle(yTitle.toString());
    yTitle.observe(observer);
    titleRef.current = { yText: yTitle, observer };

    return () => {
      yTitle.unobserve(observer);
      titleRef.current = null;
    };
  }, [currentPageId, notebookId, token, userColor, isReadOnly]);

  const handleTitleChange = useCallback((newTitle: string) => {
    if (!titleRef.current || isReadOnly) return;
    const yTitle = titleRef.current.yText;
    yTitle.delete(0, yTitle.length);
    yTitle.insert(0, newTitle);
  }, [isReadOnly]);

  // Provider event listeners
  useEffect(() => {
    if (!currentPageId || !notebookId || !token) return;

    const entry = getOrCreateProvider(
      currentPageId, notebookId, token,
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

  const handleSelectPage = useCallback((pageId: string) => {
    setCurrentPageId(pageId);
    const url = new URL(window.location.href);
    url.pathname = `/s/${sessionId}/${pageId}`;
    window.history.replaceState(null, "", url.toString());
  }, [sessionId]);

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

  if (loadingManifest) {
    return (
      <div className="guest-center-screen">
        <span className="guest-loading">Loading pages...</span>
      </div>
    );
  }

  const currentPage = pages.find((p) => p.id === currentPageId);
  // Use Yjs title if available, fall back to manifest title
  const displayTitle = pageTitle || currentPage?.title || "";

  return (
    <div className="guest-layout">
      <GuestSidebar
        pages={pages}
        currentPageId={currentPageId}
        onSelectPage={handleSelectPage}
      />

      <div className="guest-main">
        <StatusBar
          status={status}
          reconnecting={reconnecting}
          participants={participants}
          isReadOnly={isReadOnly}
        />

        {currentPageId ? (
          <>
            <div className="guest-page-title">
              {isReadOnly ? (
                <div className="guest-page-title-readonly">
                  {displayTitle || "Untitled"}
                </div>
              ) : (
                <input
                  type="text"
                  value={displayTitle}
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
          </>
        ) : (
          <div className="guest-empty-state">
            Select a page from the sidebar
          </div>
        )}
      </div>
    </div>
  );
}
