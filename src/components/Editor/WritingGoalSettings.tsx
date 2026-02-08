import { useWritingGoalsStore, type GoalPeriod } from "../../stores/writingGoalsStore";

interface WritingGoalSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WritingGoalSettings({ isOpen, onClose }: WritingGoalSettingsProps) {
  const {
    enabled,
    targetWords,
    period,
    todayWords,
    sessionStartWords,
    streak,
    history,
    setEnabled,
    setTargetWords,
    setPeriod,
    resetSession,
  } = useWritingGoalsStore();

  if (!isOpen) return null;

  const wordsWritten =
    period === "session" ? Math.max(0, todayWords - sessionStartWords) : todayWords;
  const progress = Math.min(1, wordsWritten / targetWords);

  // Recent history for display (last 7 days)
  const recent = [...history]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/50" />
      <div
        role="dialog"
        className="relative z-10 w-full max-w-md rounded-xl border p-6 shadow-xl"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2
            className="text-lg font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Writing Goal
          </h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
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

        {/* Enable toggle */}
        <div className="flex items-center justify-between mb-4">
          <span
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Enable Writing Goal
          </span>
          <button
            onClick={() => setEnabled(!enabled)}
            className="relative h-6 w-11 rounded-full transition-colors"
            style={{
              backgroundColor: enabled
                ? "var(--color-accent)"
                : "var(--color-bg-tertiary)",
            }}
          >
            <span
              className="absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
              style={{
                transform: enabled ? "translateX(20px)" : "translateX(2px)",
              }}
            />
          </button>
        </div>

        {enabled && (
          <>
            {/* Target words */}
            <div className="mb-4">
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "var(--color-text-primary)" }}
              >
                Target Words
              </label>
              <input
                type="number"
                min={50}
                max={50000}
                step={50}
                value={targetWords}
                onChange={(e) =>
                  setTargetWords(Math.max(50, parseInt(e.target.value) || 500))
                }
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              />
            </div>

            {/* Period toggle */}
            <div className="mb-4">
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: "var(--color-text-primary)" }}
              >
                Tracking Period
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["daily", "session"] as GoalPeriod[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className="rounded-md border px-3 py-2 text-sm capitalize transition-colors"
                    style={{
                      borderColor:
                        period === p
                          ? "var(--color-accent)"
                          : "var(--color-border)",
                      backgroundColor:
                        period === p
                          ? "rgba(139, 92, 246, 0.1)"
                          : "transparent",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {period === "session" && (
                <button
                  onClick={resetSession}
                  className="mt-2 text-xs transition-colors hover:underline"
                  style={{ color: "var(--color-accent)" }}
                >
                  Reset session counter
                </button>
              )}
            </div>

            {/* Progress */}
            <div
              className="rounded-lg border p-4 mb-4"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg-secondary)",
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className="text-sm font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Today&apos;s Progress
                </span>
                <span
                  className="text-sm"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {Math.round(progress * 100)}%
                </span>
              </div>
              <div
                className="h-2 w-full rounded-full overflow-hidden"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              >
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${progress * 100}%`,
                    backgroundColor:
                      progress >= 1
                        ? "var(--color-success)"
                        : "var(--color-accent)",
                  }}
                />
              </div>
              <div
                className="mt-2 flex items-center justify-between text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                <span>
                  {wordsWritten.toLocaleString()} / {targetWords.toLocaleString()} words
                </span>
                {streak > 0 && <span>{streak} day streak</span>}
              </div>
            </div>

            {/* Recent history */}
            {recent.length > 0 && (
              <div>
                <label
                  className="block text-xs font-medium uppercase tracking-wide mb-2"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Recent Days
                </label>
                <div className="space-y-1">
                  {recent.map((day) => {
                    const dayProgress = Math.min(1, day.words / targetWords);
                    const met = day.words >= targetWords;
                    return (
                      <div
                        key={day.date}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span
                          className="w-20"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          {day.date.slice(5)}
                        </span>
                        <div
                          className="flex-1 h-1 rounded-full overflow-hidden"
                          style={{
                            backgroundColor: "var(--color-bg-tertiary)",
                          }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${dayProgress * 100}%`,
                              backgroundColor: met
                                ? "var(--color-success)"
                                : "var(--color-accent)",
                            }}
                          />
                        </div>
                        <span
                          className="w-12 text-right"
                          style={{
                            color: met
                              ? "var(--color-success)"
                              : "var(--color-text-muted)",
                          }}
                        >
                          {day.words}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
