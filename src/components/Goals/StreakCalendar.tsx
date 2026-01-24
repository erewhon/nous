import { useEffect, useState } from "react";
import type { GoalProgress } from "../../types/goals";

interface StreakCalendarProps {
  goalId: string;
  loadProgress: (
    goalId: string,
    startDate: string,
    endDate: string
  ) => Promise<GoalProgress[]>;
  weeks?: number;
}

interface DayData {
  date: string;
  completed: boolean;
  value?: number;
}

export function StreakCalendar({
  goalId,
  loadProgress,
  weeks = 12,
}: StreakCalendarProps) {
  const [days, setDays] = useState<DayData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      const today = new Date();
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - weeks * 7);

      const start = startDate.toISOString().split("T")[0];
      const end = today.toISOString().split("T")[0];

      try {
        const progress = await loadProgress(goalId, start, end);
        const progressMap = new Map(progress.map((p) => [p.date, p]));

        const result: DayData[] = [];
        const current = new Date(startDate);
        while (current <= today) {
          const dateStr = current.toISOString().split("T")[0];
          const p = progressMap.get(dateStr);
          result.push({
            date: dateStr,
            completed: p?.completed || false,
            value: p?.value,
          });
          current.setDate(current.getDate() + 1);
        }
        setDays(result);
      } catch (err) {
        console.error("Failed to load progress:", err);
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [goalId, loadProgress, weeks]);

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center py-8"
        style={{ color: "var(--color-text-muted)" }}
      >
        Loading...
      </div>
    );
  }

  // Group days by week
  const weeksData: DayData[][] = [];
  let currentWeek: DayData[] = [];

  // Pad the beginning with empty days if first day isn't Sunday
  const firstDate = new Date(days[0]?.date || new Date());
  const firstDayOfWeek = firstDate.getDay();
  for (let i = 0; i < firstDayOfWeek; i++) {
    currentWeek.push({ date: "", completed: false });
  }

  for (const day of days) {
    currentWeek.push(day);
    if (currentWeek.length === 7) {
      weeksData.push(currentWeek);
      currentWeek = [];
    }
  }

  // Pad the end if needed
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push({ date: "", completed: false });
    }
    weeksData.push(currentWeek);
  }

  const dayLabels = ["S", "M", "T", "W", "T", "F", "S"];

  return (
    <div className="w-full">
      {/* Day labels */}
      <div className="flex gap-0.5 mb-1">
        <div className="w-4" /> {/* Spacer for month labels */}
        {dayLabels.map((label, i) => (
          <div
            key={i}
            className="w-3 h-3 flex items-center justify-center text-[9px]"
            style={{ color: "var(--color-text-muted)" }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex gap-0.5">
        {weeksData.map((week, weekIndex) => (
          <div key={weekIndex} className="flex flex-col gap-0.5">
            {week.map((day, dayIndex) => (
              <div
                key={dayIndex}
                className="w-3 h-3 rounded-sm transition-colors"
                style={{
                  backgroundColor: day.date
                    ? day.completed
                      ? "var(--color-success)"
                      : "var(--color-bg-tertiary)"
                    : "transparent",
                  opacity: day.date ? (day.completed ? 1 : 0.5) : 0,
                }}
                title={
                  day.date
                    ? `${day.date}${day.completed ? " - Completed" : ""}${
                        day.value ? ` (${day.value})` : ""
                      }`
                    : undefined
                }
              />
            ))}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div
        className="flex items-center gap-2 mt-2 text-[10px]"
        style={{ color: "var(--color-text-muted)" }}
      >
        <span>Less</span>
        <div className="flex gap-0.5">
          <div
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          />
          <div
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: "var(--color-success)", opacity: 0.5 }}
          />
          <div
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: "var(--color-success)" }}
          />
        </div>
        <span>More</span>
      </div>
    </div>
  );
}
