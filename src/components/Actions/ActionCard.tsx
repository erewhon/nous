import type { ReactElement } from "react";
import { useState, memo, useCallback } from "react";
import type { Action, ActionTrigger } from "../../types/action";
import { ACTION_CATEGORY_LABELS } from "../../stores/actionStore";

interface ActionCardProps {
  action: Action;
  onRun: (actionId: string) => void;
  onEdit: (actionId: string) => void;
  onDelete: (actionId: string) => void;
  onToggleEnabled: (actionId: string, enabled: boolean) => void;
  onViewDetails?: (actionId: string) => void;
  onDuplicate?: (actionId: string) => void;
  isRunning?: boolean;
}

export const ActionCard = memo(function ActionCard({
  action,
  onRun,
  onEdit,
  onDelete,
  onToggleEnabled,
  onViewDetails,
  onDuplicate,
  isRunning = false,
}: ActionCardProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleRun = useCallback(() => {
    if (!isRunning) {
      onRun(action.id);
    }
  }, [isRunning, onRun, action.id]);

  const handleDeleteClick = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    onDelete(action.id);
    setShowDeleteConfirm(false);
  }, [onDelete, action.id]);

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false);
  }, []);

  const handleToggleEnabled = useCallback(() => {
    onToggleEnabled(action.id, !action.enabled);
  }, [onToggleEnabled, action.id, action.enabled]);

  const handleEdit = useCallback(() => {
    onEdit(action.id);
  }, [onEdit, action.id]);

  const handleViewDetails = useCallback(() => {
    onViewDetails?.(action.id);
  }, [onViewDetails, action.id]);

  const handleDuplicate = useCallback(() => {
    onDuplicate?.(action.id);
  }, [onDuplicate, action.id]);

  const getTriggerBadges = () => {
    const badges: { label: string; icon: ReactElement }[] = [];

    for (const trigger of action.triggers) {
      if (trigger.type === "manual") {
        badges.push({ label: "Manual", icon: <IconClick /> });
      } else if (trigger.type === "aiChat") {
        badges.push({ label: "AI Chat", icon: <IconMessage /> });
      } else if (trigger.type === "scheduled") {
        const scheduleLabel = getScheduleLabel(trigger);
        badges.push({ label: scheduleLabel, icon: <IconClock /> });
      }
    }

    return badges;
  };

  const getScheduleLabel = (trigger: ActionTrigger): string => {
    if (trigger.type !== "scheduled") return "";
    const schedule = trigger.schedule;

    if (schedule.type === "daily") {
      return `Daily at ${schedule.time}`;
    } else if (schedule.type === "weekly") {
      const days = schedule.days.map((d) => d.slice(0, 3)).join(", ");
      return `${days} at ${schedule.time}`;
    } else if (schedule.type === "monthly") {
      return `Day ${schedule.dayOfMonth} at ${schedule.time}`;
    }
    return "Scheduled";
  };

  const formatDateTime = (dateStr: string | undefined): string => {
    if (!dateStr) return "";
    try {
      const date = new Date(dateStr);
      return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  const triggerBadges = getTriggerBadges();

  // Delete confirmation dialog
  if (showDeleteConfirm) {
    return (
      <div
        className="rounded-lg border p-4"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
            <IconTrash className="text-red-400" />
          </div>
          <div>
            <h4
              className="font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Delete Action?
            </h4>
            <p
              className="text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              "{action.name}" will be permanently deleted
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={handleCancelDelete}
            className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:opacity-80"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmDelete}
            className="rounded-lg bg-red-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-600"
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border p-4 transition-all ${
        !action.enabled ? "opacity-60" : ""
      }`}
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Header row: icon, title, toggle */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          >
            <span style={{ color: "var(--color-accent)" }}>
              {getIconForCategory(action.category)}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <h4
              className="font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              {action.name}
            </h4>
            <p
              className="mt-0.5 text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              {action.description}
            </p>
          </div>
        </div>

        {/* Enable/disable toggle */}
        <button
          onClick={handleToggleEnabled}
          className="flex-shrink-0 rounded-full p-1 transition-colors"
          style={{
            backgroundColor: action.enabled
              ? "var(--color-accent)"
              : "var(--color-bg-tertiary)",
          }}
          title={action.enabled ? "Disable action" : "Enable action"}
        >
          <div
            className={`h-4 w-4 rounded-full transition-transform ${
              action.enabled ? "translate-x-4" : "translate-x-0"
            }`}
            style={{
              backgroundColor: action.enabled
                ? "white"
                : "var(--color-text-muted)",
            }}
          />
        </button>
      </div>

      {/* Category and triggers */}
      <div className="mb-3 flex flex-wrap gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-text-secondary)",
          }}
        >
          {ACTION_CATEGORY_LABELS[action.category]}
        </span>
        {triggerBadges.map((badge, i) => (
          <span
            key={i}
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-muted)",
            }}
          >
            <span className="h-3 w-3">{badge.icon}</span>
            {badge.label}
          </span>
        ))}
      </div>

      {/* Last run / next run info */}
      {(action.lastRun || action.nextRun) && (
        <div
          className="mb-3 flex flex-wrap gap-4 text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          {action.lastRun && (
            <span>Last run: {formatDateTime(action.lastRun)}</span>
          )}
          {action.nextRun && (
            <span>Next run: {formatDateTime(action.nextRun)}</span>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleRun}
          disabled={isRunning || !action.enabled}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          {isRunning ? (
            <>
              <IconSpinner className="h-4 w-4 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <IconPlay className="h-4 w-4" />
              Run
            </>
          )}
        </button>

        {action.isBuiltIn ? (
          <>
            <button
              onClick={handleViewDetails}
              className="rounded-lg p-2 transition-colors hover:opacity-80"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              title="View details"
            >
              <IconEye className="h-4 w-4" />
            </button>
            <button
              onClick={handleDuplicate}
              className="rounded-lg p-2 transition-colors hover:opacity-80"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              title="Duplicate as custom action"
            >
              <IconCopy className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleEdit}
              className="rounded-lg p-2 transition-colors hover:opacity-80"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              title="Edit action"
            >
              <IconEdit className="h-4 w-4" />
            </button>
            <button
              onClick={handleDeleteClick}
              className="rounded-lg p-2 transition-colors hover:bg-red-500/10"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              title="Delete action"
            >
              <IconTrash className="h-4 w-4 text-red-400" />
            </button>
          </>
        )}
      </div>
    </div>
  );
});

// Helper to get category icon
function getIconForCategory(category: string): ReactElement {
  switch (category) {
    case "agileResults":
      return <IconTarget />;
    case "dailyRoutines":
      return <IconSun />;
    case "weeklyReviews":
      return <IconCalendar />;
    case "organization":
      return <IconFolder />;
    case "custom":
    default:
      return <IconCog />;
  }
}

// Icons
function IconTarget() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function IconSun() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="M4.93 4.93l1.41 1.41" />
      <path d="M17.66 17.66l1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="M6.34 17.66l-1.41 1.41" />
      <path d="M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconCog() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconClick() {
  return (
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
      <path d="M9 9h.01" />
      <path d="M15 9h.01" />
      <path d="M9 15h.01" />
      <path d="M15 15h.01" />
      <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z" />
    </svg>
  );
}

function IconMessage() {
  return (
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
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconClock() {
  return (
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
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconPlay({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      className={className}
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function IconSpinner({ className = "" }: { className?: string }) {
  return (
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
      className={className}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function IconEdit({ className = "" }: { className?: string }) {
  return (
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
      className={className}
      style={{ color: "var(--color-text-muted)" }}
    >
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

function IconTrash({ className = "" }: { className?: string }) {
  return (
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
      className={className}
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

function IconEye({ className = "" }: { className?: string }) {
  return (
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
      className={className}
      style={{ color: "var(--color-text-muted)" }}
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconCopy({ className = "" }: { className?: string }) {
  return (
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
      className={className}
      style={{ color: "var(--color-text-muted)" }}
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
