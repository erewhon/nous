/**
 * Dialog for starting/stopping real-time collaboration sessions.
 * Follows the ShareDialog pattern with three states:
 * - configure: select expiry, start session
 * - starting: spinner
 * - active: share URLs (edit + view-only) with copy buttons, stop button
 */

import { useState, useEffect, useCallback } from "react";
import { usePageStore } from "../../stores/pageStore";
import * as api from "../../collab/api";

interface CollabDialogProps {
  isOpen: boolean;
  onClose: () => void;
  pageId?: string;
  notebookId?: string;
}

type ExpiryOption = "1h" | "8h" | "1d" | "never";
type DialogState = "configure" | "starting" | "active";
type ShareMode = "edit" | "view";

const EXPIRY_OPTIONS: { value: ExpiryOption; label: string }[] = [
  { value: "1h", label: "1 hour" },
  { value: "8h", label: "8 hours" },
  { value: "1d", label: "1 day" },
  { value: "never", label: "Never" },
];

export function CollabDialog({
  isOpen,
  onClose,
  pageId,
  notebookId,
}: CollabDialogProps) {
  const [expiry, setExpiry] = useState<ExpiryOption>("8h");
  const [dialogState, setDialogState] = useState<DialogState>("configure");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [readOnlyShareUrl, setReadOnlyShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [shareMode, setShareMode] = useState<ShareMode>("edit");

  const pages = usePageStore((s) => s.pages);
  const selectedPage = pageId ? pages.find((p) => p.id === pageId) : null;

  const activeUrl = shareMode === "edit" ? shareUrl : readOnlyShareUrl;

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      // Check for existing active session
      api.listCollabSessions().then((sessions) => {
        const existing = sessions.find(
          (s) => s.pageId === pageId && s.isActive
        );
        if (existing) {
          setDialogState("active");
          setShareUrl(existing.shareUrl);
          setReadOnlyShareUrl(existing.readOnlyShareUrl ?? null);
          setSessionId(existing.id);
        } else {
          setDialogState("configure");
          setShareUrl(null);
          setReadOnlyShareUrl(null);
          setSessionId(null);
        }
      });
      setError(null);
      setCopied(false);
      setShareMode("edit");
    }
  }, [isOpen, pageId]);

  const handleStart = useCallback(async () => {
    if (!notebookId || !pageId) return;

    setDialogState("starting");
    setError(null);

    try {
      const response = await api.startCollabSession(notebookId, pageId, expiry);
      setShareUrl(response.session.shareUrl);
      setReadOnlyShareUrl(response.session.readOnlyShareUrl ?? null);
      setSessionId(response.session.id);
      setDialogState("active");

      // Dispatch event so EditorPaneContent can pick up the session
      window.dispatchEvent(
        new CustomEvent("collab-session-started", {
          detail: {
            pageId,
            notebookId,
            roomId: response.roomId,
            token: response.token,
            partykitHost: response.partykitHost,
            sessionId: response.session.id,
          },
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDialogState("configure");
    }
  }, [notebookId, pageId, expiry]);

  const handleStop = useCallback(async () => {
    if (sessionId) {
      try {
        await api.stopCollabSession(sessionId);
      } catch (err) {
        console.warn("Failed to stop session:", err);
      }
    }

    // Dispatch event to clean up the provider
    window.dispatchEvent(
      new CustomEvent("collab-session-stopped", {
        detail: { pageId },
      })
    );

    setDialogState("configure");
    setShareUrl(null);
    setReadOnlyShareUrl(null);
    setSessionId(null);
  }, [sessionId, pageId]);

  const handleCopy = useCallback(async () => {
    if (activeUrl) {
      await navigator.clipboard.writeText(activeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [activeUrl]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Dialog */}
      <div
        className="relative w-[440px] rounded-lg shadow-xl"
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
            Real-Time Collaboration
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[--color-bg-elevated] transition-colors"
            style={{ color: "var(--color-text-muted)" }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Page title */}
          {selectedPage && (
            <div
              className="text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Page:{" "}
              <span style={{ color: "var(--color-text-primary)" }}>
                {selectedPage.title}
              </span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-3 py-2 rounded text-sm bg-red-500/10 text-red-400">
              {error}
            </div>
          )}

          {/* Configure state */}
          {dialogState === "configure" && (
            <>
              <div>
                <label
                  className="block text-xs font-medium mb-2"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Session Duration
                </label>
                <div className="flex gap-2">
                  {EXPIRY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setExpiry(opt.value)}
                      className="flex-1 px-3 py-1.5 rounded text-sm transition-colors"
                      style={{
                        backgroundColor:
                          expiry === opt.value
                            ? "var(--color-accent)"
                            : "var(--color-bg-tertiary)",
                        color:
                          expiry === opt.value
                            ? "white"
                            : "var(--color-text-secondary)",
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <p
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                Anyone with the link can view and edit this page in real-time.
                No account required.
              </p>
            </>
          )}

          {/* Starting state */}
          {dialogState === "starting" && (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-3">
                <div
                  className="w-5 h-5 border-2 rounded-full animate-spin"
                  style={{
                    borderColor: "var(--color-border)",
                    borderTopColor: "var(--color-accent)",
                  }}
                />
                <span style={{ color: "var(--color-text-secondary)" }}>
                  Starting session...
                </span>
              </div>
            </div>
          )}

          {/* Active state */}
          {dialogState === "active" && activeUrl && (
            <>
              {/* Permission toggle */}
              <div>
                <label
                  className="block text-xs font-medium mb-2"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Share Link
                </label>
                {readOnlyShareUrl && (
                  <div className="flex gap-1 mb-2">
                    <button
                      onClick={() => { setShareMode("edit"); setCopied(false); }}
                      className="px-3 py-1 rounded text-xs transition-colors"
                      style={{
                        backgroundColor: shareMode === "edit"
                          ? "var(--color-accent)"
                          : "var(--color-bg-tertiary)",
                        color: shareMode === "edit"
                          ? "white"
                          : "var(--color-text-secondary)",
                      }}
                    >
                      Can Edit
                    </button>
                    <button
                      onClick={() => { setShareMode("view"); setCopied(false); }}
                      className="px-3 py-1 rounded text-xs transition-colors"
                      style={{
                        backgroundColor: shareMode === "view"
                          ? "var(--color-accent)"
                          : "var(--color-bg-tertiary)",
                        color: shareMode === "view"
                          ? "white"
                          : "var(--color-text-secondary)",
                      }}
                    >
                      View Only
                    </button>
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={activeUrl}
                    readOnly
                    className="flex-1 px-3 py-2 rounded text-sm"
                    style={{
                      backgroundColor: "var(--color-bg-tertiary)",
                      color: "var(--color-text-primary)",
                      border: "1px solid var(--color-border)",
                    }}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={handleCopy}
                    className="px-3 py-2 rounded text-sm transition-colors"
                    style={{
                      backgroundColor: copied
                        ? "#22c55e"
                        : "var(--color-accent)",
                      color: "white",
                    }}
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>

              <p
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {shareMode === "edit"
                  ? "Anyone with this link can view and edit in real-time."
                  : "Anyone with this link can view but not edit."}
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 px-5 py-3 border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          {dialogState === "configure" && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded text-sm transition-colors"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleStart}
                disabled={!pageId || !notebookId}
                className="px-4 py-2 rounded text-sm transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "white",
                }}
              >
                Start Session
              </button>
            </>
          )}

          {dialogState === "active" && (
            <>
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
              <button
                onClick={handleStop}
                className="px-4 py-2 rounded text-sm transition-colors"
                style={{
                  backgroundColor: "#ef4444",
                  color: "white",
                }}
              >
                Stop Session
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
