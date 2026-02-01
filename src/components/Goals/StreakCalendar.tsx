import { useEffect, useState } from "react";
import type { GoalProgress } from "../../types/goals";

interface StreakCalendarProps {
  goalId: string;
  frequency: "daily" | "weekly" | "monthly";
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

interface WeekData {
  weekStart: string;
  weekEnd: string;
  completed: boolean;
  daysCompleted: number;
  totalDays: number;
}

export function StreakCalendar({
  goalId,
  frequency,
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
        className="flex items-center justify-center py-4"
        style={{ color: "var(--color-text-muted)" }}
      >
        Loading...
      </div>
    );
  }

  // For weekly goals, show a week-based view
  if (frequency === "weekly") {
    return <WeeklyCalendar days={days} />;
  }

  // For daily goals, show the standard GitHub-style calendar
  return <DailyCalendar days={days} />;
}

function DailyCalendar({ days }: { days: DayData[] }) {
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
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Calculate month labels for each week
  const weekMonthLabels: (string | null)[] = weeksData.map((week, weekIndex) => {
    const firstValidDay = week.find((d) => d.date);
    if (!firstValidDay) return null;

    const date = new Date(firstValidDay.date);
    const month = date.getMonth();

    if (weekIndex === 0) {
      return monthNames[month];
    }

    const prevWeek = weeksData[weekIndex - 1];
    const prevValidDay = prevWeek.find((d) => d.date);
    if (!prevValidDay) return monthNames[month];

    const prevMonth = new Date(prevValidDay.date).getMonth();
    return month !== prevMonth ? monthNames[month] : null;
  });

  return (
    <div className="w-full">
      {/* Month labels row */}
      <div className="flex gap-0.5 mb-1">
        <div className="w-4 mr-1" />
        {weekMonthLabels.map((label, i) => (
          <div
            key={i}
            className="w-3 text-[9px] overflow-visible whitespace-nowrap"
            style={{ color: "var(--color-text-muted)" }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Calendar grid with day labels */}
      <div className="flex gap-0.5">
        {/* Day labels (vertical) */}
        <div className="flex flex-col gap-0.5 mr-1">
          {dayLabels.map((label, i) => (
            <div
              key={i}
              className="w-4 h-3 flex items-center justify-center text-[9px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Weeks grid */}
        {weeksData.map((week, weekIndex) => (
          <div key={weekIndex} className="flex flex-col gap-0.5">
            {week.map((day, dayIndex) => (
              <div
                key={dayIndex}
                className="w-3 h-3 rounded-sm"
                style={{
                  backgroundColor: !day.date
                    ? "transparent"
                    : day.completed
                      ? "var(--color-success)"
                      : "var(--color-bg-secondary)",
                  border: day.date && !day.completed ? "1px solid var(--color-border)" : "none",
                }}
                title={
                  day.date
                    ? `${day.date}${day.completed ? " - Completed" : " - No activity"}${
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
        <span>No activity</span>
        <div
          className="w-3 h-3 rounded-sm"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border)",
          }}
        />
        <span className="ml-2">Completed</span>
        <div
          className="w-3 h-3 rounded-sm"
          style={{ backgroundColor: "var(--color-success)" }}
        />
      </div>
    </div>
  );
}

function WeeklyCalendar({ days }: { days: DayData[] }) {
  // Group days into weeks (Sunday to Saturday)
  const weeksData: WeekData[] = [];

  // Find the first Sunday
  let currentIndex = 0;
  const firstDate = new Date(days[0]?.date || new Date());
  const daysUntilSunday = firstDate.getDay();

  // Skip partial first week if it doesn't start on Sunday
  if (daysUntilSunday > 0) {
    currentIndex = 7 - daysUntilSunday;
  }

  while (currentIndex < days.length) {
    const weekDays = days.slice(currentIndex, currentIndex + 7);
    if (weekDays.length === 0) break;

    const completedDays = weekDays.filter((d) => d.completed).length;
    const weekStart = weekDays[0]?.date || "";
    const weekEnd = weekDays[weekDays.length - 1]?.date || "";

    weeksData.push({
      weekStart,
      weekEnd,
      completed: completedDays > 0, // Week is "completed" if any day has activity
      daysCompleted: completedDays,
      totalDays: weekDays.length,
    });

    currentIndex += 7;
  }

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Calculate month labels
  const weekMonthLabels: (string | null)[] = weeksData.map((week, weekIndex) => {
    if (!week.weekStart) return null;

    const date = new Date(week.weekStart);
    const month = date.getMonth();

    if (weekIndex === 0) {
      return monthNames[month];
    }

    const prevWeek = weeksData[weekIndex - 1];
    if (!prevWeek?.weekStart) return monthNames[month];

    const prevMonth = new Date(prevWeek.weekStart).getMonth();
    return month !== prevMonth ? monthNames[month] : null;
  });

  const formatWeekRange = (start: string, end: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const startMonth = monthNames[startDate.getMonth()];
    const endMonth = monthNames[endDate.getMonth()];

    if (startMonth === endMonth) {
      return `${startMonth} ${startDate.getDate()}-${endDate.getDate()}`;
    }
    return `${startMonth} ${startDate.getDate()} - ${endMonth} ${endDate.getDate()}`;
  };

  return (
    <div className="w-full">
      {/* Month labels row */}
      <div className="flex gap-1 mb-1">
        {weekMonthLabels.map((label, i) => (
          <div
            key={i}
            className="w-6 text-[9px] overflow-visible whitespace-nowrap"
            style={{ color: "var(--color-text-muted)" }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Weeks grid - horizontal blocks */}
      <div className="flex gap-1 flex-wrap">
        {weeksData.map((week, weekIndex) => (
          <div
            key={weekIndex}
            className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-medium"
            style={{
              backgroundColor: week.completed
                ? "var(--color-success)"
                : "var(--color-bg-secondary)",
              border: !week.completed ? "1px solid var(--color-border)" : "none",
              color: week.completed ? "white" : "var(--color-text-muted)",
            }}
            title={`${formatWeekRange(week.weekStart, week.weekEnd)}${
              week.completed ? ` - ${week.daysCompleted} day${week.daysCompleted !== 1 ? "s" : ""} active` : " - No activity"
            }`}
          >
            {week.completed ? week.daysCompleted : ""}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div
        className="flex items-center gap-2 mt-2 text-[10px]"
        style={{ color: "var(--color-text-muted)" }}
      >
        <span>No activity</span>
        <div
          className="w-4 h-4 rounded"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border)",
          }}
        />
        <span className="ml-2">Active (# = days)</span>
        <div
          className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-medium"
          style={{ backgroundColor: "var(--color-success)", color: "white" }}
        >
          3
        </div>
      </div>
    </div>
  );
}
