/**
 * Status bar shown above the editor when a collaboration session is active.
 * Shows connection status, participant count, copy link, reconnection UI, and stop button.
 */

import { useState, useCallback } from "react";
import type { CollabStatus } from "../../collab/useCollabSession";
import type { ConnectionState } from "../../collab/CollabProvider";

interface CollabStatusBarProps {
  status: CollabStatus;
  participants: number;
  shareUrl: string | null;
  connectionState: ConnectionState | null;
  onStop: () => void;
  onReconnect: () => void;
}

const STATUS_COLORS: Record<CollabStatus, string> = {
  idle: "var(--color-text-muted)",
  starting: "#f59e0b",
  connecting: "#f59e0b",
  connected: "#22c55e",
  disconnected: "#ef4444",
  expired: "#ef4444",
  error: "#ef4444",
};

const STATUS_LABELS: Record<CollabStatus, string> = {
  idle: "Idle",
  starting: "Starting...",
  connecting: "Connecting...",
  connected: "Connected",
  disconnected: "Disconnected",
  expired: "Session Expired",
  error: "Error",
};

export function CollabStatusBar({
  status,
  participants,
  shareUrl,
  connectionState,
  onStop,
  onReconnect,
}: CollabStatusBarProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

  const isReconnecting = connectionState?.isReconnecting && status === "disconnected";
  const reconnectAttempts = connectionState?.reconnectAttempts ?? 0;
  const showReconnectButton = isReconnecting && reconnectAttempts >= 5;

  return (
    <div
      className="flex items-center justify-between px-4 py-1.5 text-xs border-b"
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        borderColor: "var(--color-border)",
        color: "var(--color-text-secondary)",
      }}
    >
      <div className="flex items-center gap-3">
        {/* Connection indicator */}
        <div className="flex items-center gap-1.5">
          <div
            className={`w-2 h-2 rounded-full ${isReconnecting ? "animate-pulse" : ""}`}
            style={{ backgroundColor: STATUS_COLORS[status] }}
          />
          <span>
            {isReconnecting
              ? `Reconnecting (attempt ${reconnectAttempts})...`
              : STATUS_LABELS[status]}
          </span>
        </div>

        {/* Reconnect button after many attempts */}
        {showReconnectButton && (
          <button
            onClick={onReconnect}
            className="px-2 py-0.5 rounded text-xs transition-colors"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-primary)",
            }}
          >
            Reconnect
          </button>
        )}

        {/* Participant count */}
        {participants > 0 && status === "connected" && (
          <div className="flex items-center gap-1">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>
              {participants} collaborator{participants !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Disconnected reassurance */}
        {isReconnecting && reconnectAttempts >= 3 && (
          <span style={{ color: "var(--color-text-muted)" }}>
            Changes saved locally
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Copy link button */}
        {shareUrl && status === "connected" && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-xs hover:bg-[--color-bg-elevated] transition-colors"
            style={{ color: copied ? "#22c55e" : "var(--color-text-muted)" }}
            title="Copy share link"
          >
            {copied ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                Copy Link
              </>
            )}
          </button>
        )}

        <button
          onClick={onStop}
          className="px-2 py-0.5 rounded text-xs hover:bg-[--color-bg-elevated] transition-colors"
          style={{ color: "var(--color-text-muted)" }}
        >
          Stop
        </button>
      </div>
    </div>
  );
}
