import { useGoalsStore } from "../../stores/goalsStore";

export function StreakWidget() {
  const { summary, togglePanel } = useGoalsStore();

  const highestStreak = summary?.highestStreak || 0;
  const completedToday = summary?.completedToday || 0;
  const activeGoals = summary?.activeGoals || 0;

  return (
    <button
      onClick={togglePanel}
      className="flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-white/10"
      title="Goals & Streaks"
    >
      {highestStreak > 0 ? (
        <>
          <span className="text-sm">🔥</span>
          <span
            className="text-xs font-medium"
            style={{ color: "#ef4444" }}
          >
            {highestStreak}
          </span>
        </>
      ) : (
        <>
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
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="12" r="2" />
          </svg>
          {activeGoals > 0 && (
            <span
              className="text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              {completedToday}/{activeGoals}
            </span>
          )}
        </>
      )}
    </button>
  );
}
