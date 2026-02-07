import { useWritingGoalsStore } from "../../stores/writingGoalsStore";

interface WritingGoalProgressProps {
  onOpenSettings: () => void;
}

export function WritingGoalProgress({ onOpenSettings }: WritingGoalProgressProps) {
  const { enabled, targetWords, period, todayWords, sessionStartWords, streak } =
    useWritingGoalsStore();

  if (!enabled) return null;

  const wordsWritten =
    period === "session" ? Math.max(0, todayWords - sessionStartWords) : todayWords;
  const progress = Math.min(1, wordsWritten / targetWords);
  const isComplete = progress >= 1;

  return (
    <button
      onClick={onOpenSettings}
      className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-[--color-bg-tertiary]"
      title="Writing goal progress"
    >
      {/* Progress bar */}
      <div
        className="h-1.5 w-16 rounded-full overflow-hidden"
        style={{ backgroundColor: "var(--color-bg-tertiary)" }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${progress * 100}%`,
            backgroundColor: isComplete
              ? "var(--color-success)"
              : "var(--color-accent)",
          }}
        />
      </div>

      {/* Count */}
      <span
        className="text-xs whitespace-nowrap"
        style={{
          color: isComplete
            ? "var(--color-success)"
            : "var(--color-text-muted)",
        }}
      >
        {wordsWritten.toLocaleString()} / {targetWords.toLocaleString()}
      </span>

      {/* Streak badge */}
      {streak > 0 && (
        <span
          className="text-xs whitespace-nowrap rounded-full px-1.5 py-0.5"
          style={{
            backgroundColor: "rgba(245, 158, 11, 0.15)",
            color: "var(--color-warning)",
          }}
        >
          {streak}d streak
        </span>
      )}
    </button>
  );
}
