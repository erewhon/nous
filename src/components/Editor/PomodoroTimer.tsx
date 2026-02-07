import { useState, useEffect, useRef } from "react";
import { usePomodoroStore, type PomodoroMode } from "../../stores/pomodoroStore";
import { PomodoroSettings } from "./PomodoroSettings";

const MODE_COLORS: Record<PomodoroMode, string> = {
  work: "var(--color-accent)",
  shortBreak: "var(--color-success)",
  longBreak: "var(--color-info)",
};

const MODE_LABELS: Record<PomodoroMode, string> = {
  work: "Work",
  shortBreak: "Break",
  longBreak: "Long Break",
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function PomodoroTimer() {
  const {
    isRunning,
    isPaused,
    mode,
    timeRemaining,
    currentSession,
    settings,
    todaySessions,
    start,
    pause,
    resume,
    skip,
    reset,
    tick,
  } = usePomodoroStore();

  const [isExpanded, setIsExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const intervalRef = useRef<number | null>(null);

  // Timer interval
  useEffect(() => {
    if (isRunning && !isPaused) {
      intervalRef.current = window.setInterval(tick, 1000);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRunning, isPaused, tick]);

  // Calculate progress for arc
  const totalDuration =
    mode === "work"
      ? settings.workDuration * 60
      : mode === "shortBreak"
        ? settings.shortBreakDuration * 60
        : settings.longBreakDuration * 60;
  const progress = 1 - timeRemaining / totalDuration;

  const modeColor = MODE_COLORS[mode];

  if (!isRunning && !isExpanded) {
    // Show start button only
    return (
      <div className="fixed bottom-4 right-4 z-30">
        <button
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-lg transition-colors hover:bg-[--color-bg-tertiary]"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
          }}
          title="Pomodoro Timer"
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
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          Pomodoro
        </button>
      </div>
    );
  }

  if (isRunning && !isExpanded) {
    // Minimized pill
    return (
      <div className="fixed bottom-4 right-4 z-30">
        <button
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-mono shadow-lg transition-colors hover:bg-[--color-bg-tertiary]"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        >
          <div
            className="h-2 w-2 rounded-full"
            style={{
              backgroundColor: modeColor,
              animation: isPaused ? "none" : "pulse 2s infinite",
            }}
          />
          {formatTime(timeRemaining)}
        </button>
      </div>
    );
  }

  // Expanded view
  return (
    <div className="fixed bottom-4 right-4 z-30">
      <div
        className="w-64 rounded-xl border shadow-xl"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <span
            className="text-xs font-medium uppercase tracking-wide"
            style={{ color: modeColor }}
          >
            {MODE_LABELS[mode]}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-text-muted)" }}
              title="Settings"
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
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
              </svg>
            </button>
            <button
              onClick={() => setIsExpanded(false)}
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-text-muted)" }}
              title="Minimize"
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
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
          </div>
        </div>

        {showSettings ? (
          <PomodoroSettings onClose={() => setShowSettings(false)} />
        ) : (
          <>
            {/* Timer display with progress arc */}
            <div className="flex flex-col items-center py-4">
              <div className="relative flex h-28 w-28 items-center justify-center">
                {/* Background arc */}
                <svg
                  className="absolute inset-0"
                  viewBox="0 0 100 100"
                  style={{ transform: "rotate(-90deg)" }}
                >
                  <circle
                    cx="50"
                    cy="50"
                    r="44"
                    fill="none"
                    stroke="var(--color-bg-tertiary)"
                    strokeWidth="4"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="44"
                    fill="none"
                    stroke={modeColor}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 44}`}
                    strokeDashoffset={`${2 * Math.PI * 44 * (1 - progress)}`}
                    style={{ transition: "stroke-dashoffset 0.5s ease" }}
                  />
                </svg>
                <span
                  className="text-2xl font-mono font-semibold"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {formatTime(timeRemaining)}
                </span>
              </div>

              {/* Session indicator */}
              <div className="mt-2 flex items-center gap-1">
                {Array.from(
                  { length: settings.sessionsBeforeLongBreak },
                  (_, i) => (
                    <div
                      key={i}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{
                        backgroundColor:
                          i < currentSession
                            ? modeColor
                            : "var(--color-bg-tertiary)",
                      }}
                    />
                  )
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-2 pb-3">
              {!isRunning ? (
                <button
                  onClick={start}
                  className="rounded-full px-4 py-1.5 text-sm font-medium text-white transition-colors"
                  style={{ backgroundColor: "var(--color-accent)" }}
                >
                  Start
                </button>
              ) : isPaused ? (
                <>
                  <button
                    onClick={resume}
                    className="rounded-full px-4 py-1.5 text-sm font-medium text-white transition-colors"
                    style={{ backgroundColor: "var(--color-accent)" }}
                  >
                    Resume
                  </button>
                  <button
                    onClick={reset}
                    className="rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    Reset
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={pause}
                    className="rounded-full border px-4 py-1.5 text-sm font-medium transition-colors hover:bg-[--color-bg-tertiary]"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    Pause
                  </button>
                  <button
                    onClick={skip}
                    className="rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    Skip
                  </button>
                </>
              )}
            </div>

            {/* Today's sessions */}
            {todaySessions > 0 && (
              <div
                className="border-t px-4 py-2 text-center text-xs"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-muted)",
                }}
              >
                {todaySessions} session{todaySessions !== 1 ? "s" : ""} today
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
