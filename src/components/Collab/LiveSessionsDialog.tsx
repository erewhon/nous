/**
 * Dialog showing all active collaboration sessions.
 * Allows navigating to session pages, copying links, and stopping sessions.
 */

import { useState, useEffect, useCallback } from "react";
import { usePageStore } from "../../stores/pageStore";
import { useCollabStore } from "../../collab/collabStore";
import * as api from "../../collab/api";
import type { CollabSession } from "../../collab/api";

interface LiveSessionsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

export function LiveSessionsDialog({ isOpen, onClose }: LiveSessionsDialogProps) {
  const [sessions, setSessions] = useState<CollabSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const openPageInPane = usePageStore((s) => s.openPageInPane);
  const panes = usePageStore((s) => s.panes);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.listCollabSessions();
      setSessions(result);
    } catch (err) {
      console.warn("Failed to load collab sessions:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on open and auto-refresh every 30s
  useEffect(() => {
    if (!isOpen) return;
    loadSessions();
    const interval = setInterval(loadSessions, 30000);
    return () => clearInterval(interval);
  }, [isOpen, loadSessions]);

  const handleCopyLink = useCallback(async (session: CollabSession) => {
    await navigator.clipboard.writeText(session.shareUrl);
    setCopiedId(session.id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleGoToPage = useCallback((session: CollabSession) => {
    if (!session.pageId) {
      // Scoped session — just close the dialog (user is already in the notebook)
      onClose();
      return;
    }
    const activePaneId = panes[0]?.id;
    if (activePaneId) {
      openPageInPane(activePaneId, session.pageId);
    }
    onClose();
  }, [panes, openPageInPane, onClose]);

  const handleStopSession = useCallback(async (session: CollabSession) => {
    try {
      const store = useCollabStore.getState();
      if (store.sessionId === session.id) {
        // This is the active session — use the store to clean up providers
        await store.stopSession();
      } else {
        // Different session — just stop it on the backend
        await api.stopCollabSession(session.id);
      }
      // Dispatch event so EditorPaneContent re-renders without collab
      window.dispatchEvent(
        new CustomEvent("collab-session-stopped", {
          detail: { pageId: session.pageId },
        })
      );
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
    } catch (err) {
      console.warn("Failed to stop session:", err);
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative w-[520px] max-h-[70vh] rounded-lg shadow-xl flex flex-col"
        style={{ backgroundColor: "var(--color-bg-primary)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2
            className="text-base font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Live Sessions
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[--color-bg-elevated] transition-colors"
            style={{ color: "var(--color-text-muted)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading && sessions.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <div
                className="w-5 h-5 border-2 rounded-full animate-spin"
                style={{
                  borderColor: "var(--color-border)",
                  borderTopColor: "var(--color-accent)",
                }}
              />
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8">
              <p
                className="text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                No active collaboration sessions.
              </p>
              <p
                className="text-xs mt-1"
                style={{ color: "var(--color-text-muted)" }}
              >
                Start a session from the Share menu on any page.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg"
                  style={{ backgroundColor: "var(--color-bg-secondary)" }}
                >
                  <div className="flex-1 min-w-0 mr-3">
                    <div
                      className="text-sm font-medium truncate flex items-center gap-1.5"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      {session.scopeType !== "page" && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-medium uppercase"
                          style={{
                            backgroundColor: "var(--color-accent)",
                            color: "white",
                            flexShrink: 0,
                          }}
                        >
                          {session.scopeType}
                        </span>
                      )}
                      <span className="truncate">
                        {session.pageTitle || session.title || "Untitled"}
                      </span>
                    </div>
                    <div
                      className="text-xs mt-0.5"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Started {relativeTime(session.createdAt)}
                      {session.expiresAt && (
                        <> &middot; Expires {relativeTime(session.expiresAt)}</>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Copy link */}
                    <button
                      onClick={() => handleCopyLink(session)}
                      className="p-1.5 rounded hover:bg-[--color-bg-elevated] transition-colors"
                      style={{
                        color: copiedId === session.id ? "#22c55e" : "var(--color-text-muted)",
                      }}
                      title="Copy share link"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </button>

                    {/* Go to page (only for single-page sessions) */}
                    {session.pageId && (
                      <button
                        onClick={() => handleGoToPage(session)}
                        className="px-2 py-1 rounded text-xs hover:bg-[--color-bg-elevated] transition-colors"
                        style={{ color: "var(--color-accent)" }}
                        title="Go to page"
                      >
                        Open
                      </button>
                    )}

                    {/* Stop */}
                    <button
                      onClick={() => handleStopSession(session)}
                      className="px-2 py-1 rounded text-xs hover:bg-[--color-bg-elevated] transition-colors"
                      style={{ color: "#ef4444" }}
                      title="Stop session"
                    >
                      Stop
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex justify-end px-5 py-3 border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm transition-colors"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
