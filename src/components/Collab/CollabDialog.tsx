/**
 * Dialog for starting/stopping real-time collaboration sessions.
 * Supports three scope levels:
 * - page: share a single page (default, existing behavior)
 * - section: share all pages in a section
 * - notebook: share all pages in the notebook
 */

import { useState, useEffect, useCallback } from "react";
import { usePageStore } from "../../stores/pageStore";
import { useCollabStore } from "../../collab/collabStore";
import * as api from "../../collab/api";

interface CollabDialogProps {
  isOpen: boolean;
  onClose: () => void;
  pageId?: string;
  notebookId?: string;
  /** Pre-select a scope type when opening from section/notebook context */
  initialScopeType?: "page" | "section" | "notebook";
  /** Section ID for the current page (enables section scope option) */
  sectionId?: string;
  /** Section name for display */
  sectionName?: string;
}

type ExpiryOption = "1h" | "8h" | "1d" | "never";
type DialogState = "configure" | "starting" | "active";
type ShareMode = "edit" | "view";
type ScopeType = "page" | "section" | "notebook";

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
  initialScopeType,
  sectionId,
  sectionName,
}: CollabDialogProps) {
  const [expiry, setExpiry] = useState<ExpiryOption>("8h");
  const [dialogState, setDialogState] = useState<DialogState>("configure");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [readOnlyShareUrl, setReadOnlyShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [_sessionId, setSessionId] = useState<string | null>(null);
  const [shareMode, setShareMode] = useState<ShareMode>("edit");
  const [scopeType, setScopeType] = useState<ScopeType>(initialScopeType || "page");

  const pages = usePageStore((s) => s.pages);
  const selectedPage = pageId ? pages.find((p) => p.id === pageId) : null;

  const activeUrl = shareMode === "edit" ? shareUrl : readOnlyShareUrl;

  // Scope description text
  const scopeDescription = (() => {
    switch (scopeType) {
      case "page":
        return "Anyone with the link can view and edit this page in real-time. No account required.";
      case "section":
        return `Anyone with the link can view and edit all pages in "${sectionName || "this section"}" in real-time.`;
      case "notebook":
        return "Anyone with the link can view and edit all pages in this notebook in real-time.";
    }
  })();

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setScopeType(initialScopeType || "page");
      // Check for existing active session
      api.listCollabSessions().then((sessions) => {
        const existing = sessions.find((s) => {
          if (s.scopeType === "page") {
            return (s.pageId === pageId || s.scopeId === pageId) && s.isActive;
          }
          // Check for existing scoped sessions
          if (s.scopeType === "section" && sectionId) {
            return s.scopeId === sectionId && s.isActive;
          }
          if (s.scopeType === "notebook" && notebookId) {
            return s.scopeId === notebookId && s.isActive;
          }
          return false;
        });
        if (existing) {
          setDialogState("active");
          setShareUrl(existing.shareUrl);
          setReadOnlyShareUrl(existing.readOnlyShareUrl ?? null);
          setSessionId(existing.id);
          setScopeType(existing.scopeType as ScopeType);
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
  }, [isOpen, pageId, sectionId, notebookId, initialScopeType]);

  const handleStart = useCallback(async () => {
    if (!notebookId) return;

    setDialogState("starting");
    setError(null);

    try {
      const store = useCollabStore.getState();

      if (scopeType === "page") {
        if (!pageId) return;
        // Use the store — sets _scope, creates provider, etc.
        await store.startSession(notebookId, pageId, expiry);

        // Read back from store
        const state = useCollabStore.getState();
        if (state.error) {
          setError(state.error);
          setDialogState("configure");
          return;
        }
        setShareUrl(state.scope?.shareUrl ?? null);
        setReadOnlyShareUrl(state.scope?.readOnlyShareUrl ?? null);
        setSessionId(state.sessionId);
        setDialogState("active");

        // Notify EditorPaneContent to pick up collabOptions (re-render with collab)
        window.dispatchEvent(
          new CustomEvent("collab-session-started", {
            detail: { pageId, scopeType: "page" },
          })
        );
      } else {
        // Section or notebook scope — use the store
        const scopeId = scopeType === "section" ? sectionId! : notebookId;
        await store.startScopedSession(notebookId, scopeType, scopeId, expiry);

        const state = useCollabStore.getState();
        if (state.error) {
          setError(state.error);
          setDialogState("configure");
          return;
        }
        setShareUrl(state.scope?.shareUrl ?? null);
        setReadOnlyShareUrl(state.scope?.readOnlyShareUrl ?? null);
        setSessionId(state.sessionId);
        setDialogState("active");

        // Notify all EditorPaneContent instances to activate their page
        window.dispatchEvent(
          new CustomEvent("collab-session-started", {
            detail: { scopeType, scopeId },
          })
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDialogState("configure");
    }
  }, [notebookId, pageId, expiry, scopeType, sectionId]);

  const handleStop = useCallback(async () => {
    // Use the store to stop — handles provider cleanup + backend call
    await useCollabStore.getState().stopSession();

    // Dispatch event so EditorPaneContent re-renders without collab
    window.dispatchEvent(
      new CustomEvent("collab-session-stopped", {
        detail: { pageId },
      })
    );

    setDialogState("configure");
    setShareUrl(null);
    setReadOnlyShareUrl(null);
    setSessionId(null);
  }, [pageId]);

  const handleCopy = useCallback(async () => {
    if (activeUrl) {
      await navigator.clipboard.writeText(activeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [activeUrl]);

  if (!isOpen) return null;

  // Whether we can show scope options (need at least one non-page scope available)
  const showScopeSelector = sectionId || initialScopeType === "notebook";

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
          {/* Page/scope title */}
          {dialogState !== "active" && selectedPage && scopeType === "page" && (
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
              {/* Scope selector */}
              {showScopeSelector && (
                <div>
                  <label
                    className="block text-xs font-medium mb-2"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Share Scope
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setScopeType("page")}
                      className="flex-1 px-3 py-1.5 rounded text-sm transition-colors"
                      style={{
                        backgroundColor:
                          scopeType === "page"
                            ? "var(--color-accent)"
                            : "var(--color-bg-tertiary)",
                        color:
                          scopeType === "page"
                            ? "white"
                            : "var(--color-text-secondary)",
                      }}
                    >
                      This Page
                    </button>
                    {sectionId && (
                      <button
                        onClick={() => setScopeType("section")}
                        className="flex-1 px-3 py-1.5 rounded text-sm transition-colors"
                        style={{
                          backgroundColor:
                            scopeType === "section"
                              ? "var(--color-accent)"
                              : "var(--color-bg-tertiary)",
                          color:
                            scopeType === "section"
                              ? "white"
                              : "var(--color-text-secondary)",
                        }}
                      >
                        Section
                      </button>
                    )}
                    <button
                      onClick={() => setScopeType("notebook")}
                      className="flex-1 px-3 py-1.5 rounded text-sm transition-colors"
                      style={{
                        backgroundColor:
                          scopeType === "notebook"
                            ? "var(--color-accent)"
                            : "var(--color-bg-tertiary)",
                        color:
                          scopeType === "notebook"
                            ? "white"
                            : "var(--color-text-secondary)",
                      }}
                    >
                      Notebook
                    </button>
                  </div>
                </div>
              )}

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
                {scopeDescription}
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
                  ? scopeType === "page"
                    ? "Anyone with this link can view and edit in real-time."
                    : `Anyone with this link can view and edit all pages in this ${scopeType} in real-time.`
                  : scopeType === "page"
                    ? "Anyone with this link can view but not edit."
                    : `Anyone with this link can view but not edit pages in this ${scopeType}.`}
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
                disabled={
                  (scopeType === "page" && (!pageId || !notebookId)) ||
                  (scopeType === "section" && (!sectionId || !notebookId)) ||
                  (scopeType === "notebook" && !notebookId)
                }
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
