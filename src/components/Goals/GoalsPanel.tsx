import { useEffect } from "react";
import { useGoalsStore } from "../../stores/goalsStore";
import type { Goal, GoalStats } from "../../types/goals";
import { GoalEditor } from "./GoalEditor";

interface GoalRowProps {
  goal: Goal;
  stats: GoalStats | undefined;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function GoalRow({ goal, stats, onToggle, onEdit, onDelete }: GoalRowProps) {
  const isCompleted = stats?.currentStreak && stats.currentStreak > 0;

  return (
    <div
      className="border-b transition-colors hover:bg-white/5"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div className="flex items-center gap-3 p-3">
        {/* Checkbox for manual goals */}
        {goal.trackingType === "manual" ? (
          <button
            onClick={onToggle}
            className="flex h-5 w-5 items-center justify-center rounded border-2 transition-colors"
            style={{
              borderColor: isCompleted ? "var(--color-success)" : "var(--color-border)",
              backgroundColor: isCompleted ? "var(--color-success)" : "transparent",
            }}
          >
            {isCompleted && (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        ) : (
          <div
            className="flex h-5 w-5 items-center justify-center rounded"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
            title="Auto-detected"
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
              style={{ color: "var(--color-text-muted)" }}
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4
              className="font-medium text-sm truncate"
              style={{ color: "var(--color-text-primary)" }}
            >
              {goal.name}
            </h4>
            {goal.trackingType === "auto" && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px]"
                style={{
                  backgroundColor: "var(--color-info)",
                  color: "white",
                }}
              >
                Auto
              </span>
            )}
          </div>
          {goal.description && (
            <p
              className="text-xs mt-0.5 truncate"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {goal.description}
            </p>
          )}
        </div>

        {/* Streak */}
        <div className="flex items-center gap-1 shrink-0">
          {stats && stats.currentStreak > 0 && (
            <div
              className="flex items-center gap-1 rounded-full px-2 py-0.5"
              style={{ backgroundColor: "rgba(239, 68, 68, 0.15)" }}
            >
              <span style={{ color: "#ef4444" }}>🔥</span>
              <span
                className="text-xs font-medium"
                style={{ color: "#ef4444" }}
              >
                {stats.currentStreak}
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="rounded p-1 transition-colors hover:bg-white/10"
            style={{ color: "var(--color-text-muted)" }}
            title="Edit"
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
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            onClick={onDelete}
            className="rounded p-1 transition-colors hover:bg-red-500/20"
            style={{ color: "var(--color-text-muted)" }}
            title="Delete"
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
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export function GoalsPanel() {
  const {
    goals,
    stats,
    summary,
    isLoading,
    error,
    isPanelOpen,
    isEditorOpen,
    closePanel,
    loadGoals,
    toggleCompletion,
    deleteGoal,
    openEditor,
    openDashboard,
  } = useGoalsStore();

  // Load goals when panel opens
  useEffect(() => {
    if (isPanelOpen) {
      loadGoals();
    }
  }, [isPanelOpen, loadGoals]);

  // Handle keyboard events
  useEffect(() => {
    if (!isPanelOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isEditorOpen) {
        closePanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPanelOpen, isEditorOpen, closePanel]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isEditorOpen) {
      closePanel();
    }
  };

  if (!isPanelOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={handleBackdropClick}
      >
        <div
          className="flex h-[80vh] w-full max-w-md flex-col rounded-xl border shadow-2xl"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between border-b px-4 py-3 shrink-0"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="flex items-center gap-3">
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
                style={{ color: "var(--color-accent)" }}
              >
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="6" />
                <circle cx="12" cy="12" r="2" />
              </svg>
              <div>
                <h2
                  className="font-semibold"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Goals
                </h2>
                {summary && (
                  <p
                    className="text-xs"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {summary.completedToday} of {summary.activeGoals} completed today
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={openDashboard}
                className="rounded p-1.5 transition-colors hover:bg-white/10"
                style={{ color: "var(--color-text-muted)" }}
                title="Dashboard"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
              </button>
              <button
                onClick={closePanel}
                className="rounded p-1.5 transition-colors hover:bg-white/10"
                style={{ color: "var(--color-text-muted)" }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div
              className="mx-4 mt-2 rounded-lg px-3 py-2 text-sm"
              style={{
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                color: "var(--color-error)",
              }}
            >
              {error}
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {isLoading && goals.length === 0 ? (
              <div
                className="flex items-center justify-center py-12"
                style={{ color: "var(--color-text-muted)" }}
              >
                Loading...
              </div>
            ) : goals.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-12 text-center px-4"
                style={{ color: "var(--color-text-muted)" }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mb-4 opacity-50"
                >
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
                <p className="text-sm font-medium">No goals yet</p>
                <p className="text-xs mt-1">
                  Create a goal to start tracking your habits
                </p>
              </div>
            ) : (
              <div>
                {goals.map((goal) => (
                  <GoalRow
                    key={goal.id}
                    goal={goal}
                    stats={stats.get(goal.id)}
                    onToggle={() => toggleCompletion(goal.id)}
                    onEdit={() => openEditor(goal)}
                    onDelete={() => {
                      if (confirm(`Delete "${goal.name}"?`)) {
                        deleteGoal(goal.id);
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-between border-t px-4 py-3 shrink-0"
            style={{ borderColor: "var(--color-border)" }}
          >
            {summary && summary.highestStreak > 0 && (
              <div className="flex items-center gap-1">
                <span style={{ color: "#ef4444" }}>🔥</span>
                <span
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Highest streak: {summary.highestStreak}
                </span>
              </div>
            )}
            {(!summary || summary.highestStreak === 0) && <div />}
            <button
              onClick={() => openEditor()}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
              }}
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
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Goal
            </button>
          </div>
        </div>
      </div>

      {/* Goal Editor */}
      <GoalEditor />
    </>
  );
}
