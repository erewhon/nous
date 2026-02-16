import { useState, useEffect, useMemo, useCallback } from "react";
import { useEnergyStore } from "../../stores/energyStore";
import { localDateStr } from "../../utils/dateLocal";

type RangeOption = "30d" | "90d" | "365d";

const RANGE_OPTIONS: { value: RangeOption; label: string }[] = [
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "365d", label: "1y" },
];

const ENERGY_COLORS: Record<number, string> = {
  0: "var(--color-bg-tertiary)", // no data
  1: "#ef4444", // red
  2: "#f97316", // orange
  3: "#eab308", // yellow
  4: "#86efac", // light green
  5: "#22c55e", // green
};

const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

function getDateRange(range: RangeOption): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  switch (range) {
    case "30d":
      start.setDate(start.getDate() - 29);
      break;
    case "90d":
      start.setDate(start.getDate() - 89);
      break;
    case "365d":
      start.setDate(start.getDate() - 364);
      break;
  }
  return {
    start: localDateStr(start),
    end: localDateStr(end),
  };
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

const FOCUS_LABELS: Record<string, string> = {
  deepWork: "Deep Work",
  lightWork: "Light Work",
  physical: "Physical",
  creative: "Creative",
};

export function EnergyCalendar() {
  const {
    isCalendarOpen,
    closeCalendar,
    checkIns,
    patterns,
    loadCheckInsRange,
    loadPatterns,
    openCheckIn,
  } = useEnergyStore();

  const [range, setRange] = useState<RangeOption>("90d");
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  const { start, end } = useMemo(() => getDateRange(range), [range]);

  useEffect(() => {
    if (isCalendarOpen) {
      loadCheckInsRange(start, end);
      loadPatterns(start, end);
    }
  }, [isCalendarOpen, start, end, loadCheckInsRange, loadPatterns]);

  // Build grid data: array of weeks, each containing 7 days
  const weeks = useMemo(() => {
    const startDate = new Date(start + "T12:00:00");
    const endDate = new Date(end + "T12:00:00");

    // Align to Monday
    const dayOfWeek = startDate.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startDate.setDate(startDate.getDate() + mondayOffset);

    const result: { date: string; energy: number; mood: number; habitsDone: number; habitsTotal: number; inRange: boolean }[][] = [];
    let currentDate = new Date(startDate);

    while (currentDate <= endDate || result.length === 0 || result[result.length - 1].length < 7) {
      const weekIndex = result.length === 0 ? 0 : result.length - 1;
      if (!result[weekIndex] || result[weekIndex].length === 7) {
        result.push([]);
      }

      const dateStr = localDateStr(currentDate);
      const checkin = checkIns.get(dateStr);
      const rangeStart = new Date(start + "T12:00:00");

      result[result.length - 1].push({
        date: dateStr,
        energy: checkin?.energyLevel ?? 0,
        mood: checkin?.mood ?? 0,
        habitsDone: checkin?.habits?.filter((h) => h.checked).length ?? 0,
        habitsTotal: checkin?.habits?.length ?? 0,
        inRange: currentDate >= rangeStart && currentDate <= endDate,
      });

      currentDate.setDate(currentDate.getDate() + 1);

      // Safety: stop after filling enough weeks
      if (result.length > 55) break;
    }

    return result;
  }, [start, end, checkIns]);

  // Month labels
  const monthLabels = useMemo(() => {
    const labels: { label: string; weekIndex: number }[] = [];
    let lastMonth = -1;
    for (let wi = 0; wi < weeks.length; wi++) {
      const firstDay = weeks[wi][0];
      if (firstDay) {
        const d = new Date(firstDay.date + "T12:00:00");
        const month = d.getMonth();
        if (month !== lastMonth) {
          labels.push({
            label: d.toLocaleDateString(undefined, { month: "short" }),
            weekIndex: wi,
          });
          lastMonth = month;
        }
      }
    }
    return labels;
  }, [weeks]);

  const handleCellClick = useCallback(
    (date: string) => {
      openCheckIn(date);
    },
    [openCheckIn]
  );

  if (!isCalendarOpen) return null;

  const hoveredCheckIn = hoveredDate ? checkIns.get(hoveredDate) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeCalendar();
      }}
    >
      <div
        className="w-full max-w-2xl rounded-lg border shadow-xl"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2
            className="text-base font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Check-in Heatmap
          </h2>
          <div className="flex items-center gap-3">
            {/* Range selector */}
            <div className="flex gap-1 rounded-md border p-0.5" style={{ borderColor: "var(--color-border)" }}>
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setRange(opt.value)}
                  className="rounded px-2.5 py-1 text-xs font-medium transition-colors"
                  style={{
                    backgroundColor:
                      range === opt.value
                        ? "var(--color-accent)"
                        : "transparent",
                    color:
                      range === opt.value
                        ? "white"
                        : "var(--color-text-muted)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={closeCalendar}
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
        </div>

        {/* Heatmap */}
        <div className="overflow-x-auto px-5 py-4">
          {/* Month labels */}
          <div className="mb-1 flex" style={{ paddingLeft: "28px" }}>
            {monthLabels.map((ml, i) => (
              <span
                key={i}
                className="text-[10px]"
                style={{
                  color: "var(--color-text-muted)",
                  position: "relative",
                  left: `${ml.weekIndex * 14}px`,
                  marginRight: i < monthLabels.length - 1
                    ? `${(monthLabels[i + 1].weekIndex - ml.weekIndex) * 14 - 30}px`
                    : undefined,
                }}
              >
                {ml.label}
              </span>
            ))}
          </div>

          {/* Grid */}
          <div className="flex gap-0">
            {/* Day labels */}
            <div className="mr-1 flex flex-col gap-[2px]">
              {DAY_LABELS.map((label, i) => (
                <div
                  key={i}
                  className="flex h-[12px] items-center text-[9px]"
                  style={{ color: "var(--color-text-muted)", width: "24px" }}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Weeks */}
            <div className="flex gap-[2px]">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[2px]">
                  {week.map((day) => (
                    <div
                      key={day.date}
                      className="cursor-pointer rounded-sm transition-transform hover:scale-125"
                      style={{
                        width: "12px",
                        height: "12px",
                        backgroundColor: day.inRange
                          ? ENERGY_COLORS[day.energy]
                          : "transparent",
                        opacity: day.inRange ? 1 : 0,
                      }}
                      title={
                        day.inRange
                          ? `${formatDate(day.date)}: ${day.energy > 0 ? `Energy ${day.energy}/5` : ""}${day.mood > 0 ? `${day.energy > 0 ? ", " : ""}Mood ${day.mood}/5` : ""}${day.energy === 0 && day.mood === 0 ? "No data" : ""}`
                          : undefined
                      }
                      onMouseEnter={() => setHoveredDate(day.date)}
                      onMouseLeave={() => setHoveredDate(null)}
                      onClick={() => day.inRange && handleCellClick(day.date)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="mt-3 flex items-center gap-2">
            <span
              className="text-[10px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              Less
            </span>
            {[0, 1, 2, 3, 4, 5].map((level) => (
              <div
                key={level}
                className="rounded-sm"
                style={{
                  width: "12px",
                  height: "12px",
                  backgroundColor: ENERGY_COLORS[level],
                }}
              />
            ))}
            <span
              className="text-[10px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              More
            </span>
          </div>
        </div>

        {/* Tooltip / Hovered info */}
        {hoveredCheckIn && (
          <div
            className="border-t px-5 py-3"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className="text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                {formatDate(hoveredCheckIn.date)}
              </span>
              {hoveredCheckIn.mood && (
                <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                  {hoveredCheckIn.mood === 1 ? "\u{1F614}" : hoveredCheckIn.mood === 2 ? "\u{1F615}" : hoveredCheckIn.mood === 3 ? "\u{1F610}" : hoveredCheckIn.mood === 4 ? "\u{1F642}" : "\u{1F60A}"}
                  {" "}Mood {hoveredCheckIn.mood}/5
                </span>
              )}
              {hoveredCheckIn.energyLevel && (
                <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
                  Energy {hoveredCheckIn.energyLevel}/5
                </span>
              )}
              {hoveredCheckIn.focusCapacity.length > 0 && (
                <span
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {hoveredCheckIn.focusCapacity
                    .map((f) => FOCUS_LABELS[f] || f)
                    .join(", ")}
                </span>
              )}
              {hoveredCheckIn.habits && hoveredCheckIn.habits.length > 0 && (
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  Habits {hoveredCheckIn.habits.filter((h) => h.checked).length}/{hoveredCheckIn.habits.length}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Patterns summary */}
        {patterns && (
          <div
            className="border-t px-5 py-3"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="flex flex-wrap items-center gap-4 text-xs">
              {patterns.currentStreak > 0 && (
                <span style={{ color: "var(--color-text-secondary)" }}>
                  Streak: <strong>{patterns.currentStreak}d</strong>
                </span>
              )}
              {patterns.typicalHighDays.length > 0 && (
                <span style={{ color: "var(--color-text-secondary)" }}>
                  High energy:{" "}
                  <strong>
                    {patterns.typicalHighDays
                      .map((d) => d.charAt(0).toUpperCase() + d.slice(1, 3))
                      .join(", ")}
                  </strong>
                </span>
              )}
              {patterns.typicalLowDays.length > 0 && (
                <span style={{ color: "var(--color-text-secondary)" }}>
                  Low energy:{" "}
                  <strong>
                    {patterns.typicalLowDays
                      .map((d) => d.charAt(0).toUpperCase() + d.slice(1, 3))
                      .join(", ")}
                  </strong>
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
