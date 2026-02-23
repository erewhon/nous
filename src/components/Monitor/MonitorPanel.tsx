import { useEffect, useState } from "react";
import { useMonitorStore } from "../../stores/monitorStore";
import type { CaptureEvent, CapturedItem } from "../../types/monitor";

function CaptureEventRow({
  event,
  onMarkRead,
  onDismiss,
}: {
  event: CaptureEvent;
  onMarkRead: () => void;
  onDismiss: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className="border-b transition-colors"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: !event.isRead ? "rgba(139, 92, 246, 0.05)" : "transparent",
      }}
    >
      <div className="flex items-start gap-3 p-3">
        {/* Unread indicator */}
        <div className="flex-shrink-0 pt-1.5">
          {!event.isRead && (
            <div
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: "var(--color-accent)" }}
            />
          )}
          {event.isRead && <div className="h-2 w-2" />}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              {event.targetName}
            </span>
            <span
              className="text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              {new Date(event.capturedAt).toLocaleTimeString()}
            </span>
            {event.sentToInbox && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px]"
                style={{
                  backgroundColor: "rgba(139, 92, 246, 0.15)",
                  color: "var(--color-accent)",
                }}
              >
                Inbox
              </span>
            )}
          </div>

          <p
            className="mt-0.5 text-xs leading-relaxed"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {event.content.slice(0, 200)}
            {event.content.length > 200 && "..."}
          </p>

          {/* Items preview */}
          {event.items.length > 0 && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="mt-1 text-xs font-medium"
              style={{ color: "var(--color-accent)" }}
            >
              {isExpanded
                ? "Hide details"
                : `${event.items.length} item${event.items.length > 1 ? "s" : ""}`}
            </button>
          )}

          {isExpanded && (
            <div className="mt-2 space-y-1.5">
              {event.items.map((item, i) => (
                <CapturedItemRow key={i} item={item} />
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-shrink-0 items-center gap-1">
          {!event.isRead && (
            <button
              onClick={onMarkRead}
              className="rounded p-1 transition-colors hover:bg-[--color-bg-tertiary]"
              title="Mark as read"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
          )}
          <button
            onClick={onDismiss}
            className="rounded p-1 transition-colors hover:bg-[--color-bg-tertiary]"
            title="Dismiss"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function CapturedItemRow({ item }: { item: CapturedItem }) {
  const urgencyColor =
    item.urgency === "high"
      ? "#ef4444"
      : item.urgency === "medium"
        ? "#f59e0b"
        : "var(--color-text-muted)";

  return (
    <div
      className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs"
      style={{ backgroundColor: "var(--color-bg-tertiary)" }}
    >
      <span
        className="mt-0.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ backgroundColor: urgencyColor }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {item.sender && (
            <span
              className="font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              {item.sender}
            </span>
          )}
          {item.subject && (
            <span style={{ color: "var(--color-text-secondary)" }}>
              {item.subject}
            </span>
          )}
        </div>
        {item.content && (
          <p style={{ color: "var(--color-text-muted)" }}>
            {item.content.slice(0, 150)}
          </p>
        )}
      </div>
      {item.timestamp && (
        <span
          className="flex-shrink-0"
          style={{ color: "var(--color-text-muted)" }}
        >
          {item.timestamp}
        </span>
      )}
    </div>
  );
}

export function MonitorPanel() {
  const {
    events,
    targets,
    isRunning,
    isLoading,
    showMonitorPanel,
    closeMonitorPanel,
    loadTargets,
    loadEvents,
    markRead,
    dismissEvent,
    startMonitoring,
    stopMonitoring,
    captureNow,
  } = useMonitorStore();

  // Load data when panel opens
  useEffect(() => {
    if (showMonitorPanel) {
      loadTargets();
      loadEvents(undefined, 50);
    }
  }, [showMonitorPanel, loadTargets, loadEvents]);

  // Init real-time event listener
  useEffect(() => {
    const cleanup = useMonitorStore.getState().initEventListener();
    return cleanup;
  }, []);

  // Keyboard handling
  useEffect(() => {
    if (!showMonitorPanel) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeMonitorPanel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showMonitorPanel, closeMonitorPanel]);

  if (!showMonitorPanel) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      closeMonitorPanel();
    }
  };

  const enabledTargets = targets.filter((t) => t.enabled);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        className="flex h-[80vh] w-full max-w-2xl flex-col rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-3">
            <h2
              className="text-base font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Monitor
            </h2>
            <span
              className="text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              {enabledTargets.length} target
              {enabledTargets.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Start/Stop toggle */}
            <button
              onClick={isRunning ? stopMonitoring : startMonitoring}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
              style={{
                backgroundColor: isRunning
                  ? "rgba(239, 68, 68, 0.15)"
                  : "rgba(34, 197, 94, 0.15)",
                color: isRunning ? "#ef4444" : "#22c55e",
              }}
            >
              {isRunning ? (
                <>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                  Stop
                </>
              ) : (
                <>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Start
                </>
              )}
            </button>

            {/* Close button */}
            <button
              onClick={closeMonitorPanel}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Target quick-action bar */}
        {enabledTargets.length > 0 && (
          <div
            className="flex items-center gap-2 overflow-x-auto border-b px-4 py-2"
            style={{ borderColor: "var(--color-border)" }}
          >
            {enabledTargets.map((target) => (
              <button
                key={target.id}
                onClick={() => captureNow(target.id)}
                className="flex flex-shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
                style={{ color: "var(--color-text-secondary)" }}
                title={`Capture now: ${target.name}`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                {target.name}
              </button>
            ))}
          </div>
        )}

        {/* Event feed */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && events.length === 0 ? (
            <div
              className="flex h-full items-center justify-center text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              Loading...
            </div>
          ) : events.length === 0 ? (
            <div
              className="flex h-full flex-col items-center justify-center gap-2 text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <p>No capture events yet</p>
              <p className="text-xs">
                {targets.length === 0
                  ? "Add a target in Settings to get started"
                  : isRunning
                    ? "Waiting for next capture..."
                    : "Start monitoring to begin capturing"}
              </p>
            </div>
          ) : (
            events.map((event) => (
              <CaptureEventRow
                key={event.id}
                event={event}
                onMarkRead={() => markRead(event.id)}
                onDismiss={() => dismissEvent(event.id)}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between border-t px-4 py-2"
          style={{ borderColor: "var(--color-border)" }}
        >
          <span
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            {events.length} event{events.length !== 1 ? "s" : ""}
            {events.filter((e) => !e.isRead).length > 0 &&
              ` (${events.filter((e) => !e.isRead).length} unread)`}
          </span>
          {isRunning && (
            <span className="flex items-center gap-1.5 text-xs text-green-500">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
              Monitoring active
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
