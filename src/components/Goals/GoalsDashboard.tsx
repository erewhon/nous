import { useEffect } from "react";
import { useGoalsStore } from "../../stores/goalsStore";
import { StreakCalendar } from "./StreakCalendar";

export function GoalsDashboard() {
  const {
    goals,
    stats,
    summary,
    isDashboardOpen,
    closeDashboard,
    loadGoals,
    loadProgress,
    toggleCompletion,
  } = useGoalsStore();

  useEffect(() => {
    if (isDashboardOpen) {
      loadGoals();
    }
  }, [isDashboardOpen, loadGoals]);

  useEffect(() => {
    if (!isDashboardOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeDashboard();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDashboardOpen, closeDashboard]);

  if (!isDashboardOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeDashboard();
      }}
    >
      <div
        className="flex h-[90vh] w-full max-w-4xl flex-col rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-6 py-4 shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
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
                className="font-semibold text-lg"
                style={{ color: "var(--color-text-primary)" }}
              >
                Goals Dashboard
              </h2>
              <p
                className="text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                Track your progress and streaks
              </p>
            </div>
          </div>
          <button
            onClick={closeDashboard}
            className="rounded p-1.5 transition-colors hover:bg-white/10"
            style={{ color: "var(--color-text-muted)" }}
          >
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
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Summary Stats */}
        {summary && (
          <div
            className="grid grid-cols-4 gap-4 border-b px-6 py-4 shrink-0"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div
              className="rounded-lg p-4"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
            >
              <p
                className="text-2xl font-bold"
                style={{ color: "var(--color-text-primary)" }}
              >
                {summary.activeGoals}
              </p>
              <p
                className="text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                Active Goals
              </p>
            </div>
            <div
              className="rounded-lg p-4"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
            >
              <p
                className="text-2xl font-bold"
                style={{ color: "var(--color-success)" }}
              >
                {summary.completedToday}
              </p>
              <p
                className="text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                Completed Today
              </p>
            </div>
            <div
              className="rounded-lg p-4"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
            >
              <p
                className="text-2xl font-bold flex items-center gap-1"
                style={{ color: "#ef4444" }}
              >
                <span>🔥</span>
                {summary.highestStreak}
              </p>
              <p
                className="text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                Best Streak
              </p>
            </div>
            <div
              className="rounded-lg p-4"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
            >
              <p
                className="text-2xl font-bold"
                style={{ color: "var(--color-accent)" }}
              >
                {summary.totalStreaks}
              </p>
              <p
                className="text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                Total Streaks
              </p>
            </div>
          </div>
        )}

        {/* Goals List with Calendars */}
        <div className="flex-1 overflow-y-auto p-6">
          {goals.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-12 text-center"
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
            <div className="space-y-6">
              {goals.map((goal) => {
                const goalStats = stats.get(goal.id);
                return (
                  <div
                    key={goal.id}
                    className="rounded-lg border p-4"
                    style={{
                      borderColor: "var(--color-border)",
                      backgroundColor: "var(--color-bg-tertiary)",
                    }}
                  >
                    {/* Goal Header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        {goal.trackingType === "manual" ? (
                          <button
                            onClick={() => toggleCompletion(goal.id)}
                            className="flex h-6 w-6 items-center justify-center rounded border-2 transition-colors"
                            style={{
                              borderColor:
                                goalStats?.currentStreak && goalStats.currentStreak > 0
                                  ? "var(--color-success)"
                                  : "var(--color-border)",
                              backgroundColor:
                                goalStats?.currentStreak && goalStats.currentStreak > 0
                                  ? "var(--color-success)"
                                  : "transparent",
                            }}
                          >
                            {goalStats?.currentStreak && goalStats.currentStreak > 0 && (
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="14"
                                height="14"
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
                            className="flex h-6 w-6 items-center justify-center rounded"
                            style={{ backgroundColor: "var(--color-bg-secondary)" }}
                            title="Auto-detected"
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
                              style={{ color: "var(--color-text-muted)" }}
                            >
                              <circle cx="12" cy="12" r="10" />
                              <polyline points="12 6 12 12 16 14" />
                            </svg>
                          </div>
                        )}
                        <div>
                          <h3
                            className="font-medium"
                            style={{ color: "var(--color-text-primary)" }}
                          >
                            {goal.name}
                          </h3>
                          {goal.description && (
                            <p
                              className="text-sm"
                              style={{ color: "var(--color-text-muted)" }}
                            >
                              {goal.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {goalStats && (
                          <>
                            <div className="text-center">
                              <p
                                className="text-xl font-bold flex items-center gap-1"
                                style={{ color: "#ef4444" }}
                              >
                                <span>🔥</span>
                                {goalStats.currentStreak}
                              </p>
                              <p
                                className="text-xs"
                                style={{ color: "var(--color-text-muted)" }}
                              >
                                Current
                              </p>
                            </div>
                            <div className="text-center">
                              <p
                                className="text-xl font-bold"
                                style={{ color: "var(--color-text-secondary)" }}
                              >
                                {goalStats.longestStreak}
                              </p>
                              <p
                                className="text-xs"
                                style={{ color: "var(--color-text-muted)" }}
                              >
                                Best
                              </p>
                            </div>
                            <div className="text-center">
                              <p
                                className="text-xl font-bold"
                                style={{ color: "var(--color-text-secondary)" }}
                              >
                                {Math.round(goalStats.completionRate * 100)}%
                              </p>
                              <p
                                className="text-xs"
                                style={{ color: "var(--color-text-muted)" }}
                              >
                                30d Rate
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Calendar */}
                    <div className="mt-4">
                      <StreakCalendar goalId={goal.id} loadProgress={loadProgress} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end border-t px-6 py-4 shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={closeDashboard}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
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
