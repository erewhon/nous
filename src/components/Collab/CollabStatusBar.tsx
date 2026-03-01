/**
 * Status bar shown above the editor when a collaboration session is active.
 * Shows connection status, participant count, and a stop button.
 */

import type { CollabStatus } from "../../collab/useCollabSession";

interface CollabStatusBarProps {
  status: CollabStatus;
  participants: number;
  onStop: () => void;
}

const STATUS_COLORS: Record<CollabStatus, string> = {
  idle: "var(--color-text-muted)",
  starting: "#f59e0b",
  connecting: "#f59e0b",
  connected: "#22c55e",
  disconnected: "#ef4444",
  error: "#ef4444",
};

const STATUS_LABELS: Record<CollabStatus, string> = {
  idle: "Idle",
  starting: "Starting...",
  connecting: "Connecting...",
  connected: "Connected",
  disconnected: "Disconnected",
  error: "Error",
};

export function CollabStatusBar({
  status,
  participants,
  onStop,
}: CollabStatusBarProps) {
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
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: STATUS_COLORS[status] }}
          />
          <span>{STATUS_LABELS[status]}</span>
        </div>

        {/* Participant count */}
        {participants > 0 && (
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
      </div>

      <button
        onClick={onStop}
        className="px-2 py-0.5 rounded text-xs hover:bg-[--color-bg-elevated] transition-colors"
        style={{ color: "var(--color-text-muted)" }}
      >
        Stop
      </button>
    </div>
  );
}
