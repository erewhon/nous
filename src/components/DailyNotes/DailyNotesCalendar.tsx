import { useMemo } from "react";

interface DailyNotesCalendarProps {
  selectedDate: string; // "YYYY-MM-DD"
  datesWithNotes: Set<string>;
  onSelectDate: (date: string) => void;
  onMonthChange?: (month: string) => void;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface DayCell {
  date: string;
  dayNum: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  hasNote: boolean;
}

export function DailyNotesCalendar({
  selectedDate,
  datesWithNotes,
  onSelectDate,
  onMonthChange,
}: DailyNotesCalendarProps) {
  const today = new Date().toISOString().split("T")[0];

  // Parse selected date to get year and month
  const [year, month] = useMemo(() => {
    const d = new Date(selectedDate);
    return [d.getFullYear(), d.getMonth()];
  }, [selectedDate]);

  // Generate calendar grid
  const days = useMemo(() => {
    const result: DayCell[] = [];

    // First day of the month
    const firstDay = new Date(year, month, 1);
    const firstDayOfWeek = firstDay.getDay();

    // Last day of the month
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();

    // Days from previous month
    const prevMonth = new Date(year, month, 0);
    const prevMonthDays = prevMonth.getDate();
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const dayNum = prevMonthDays - i;
      const date = new Date(year, month - 1, dayNum).toISOString().split("T")[0];
      result.push({
        date,
        dayNum,
        isCurrentMonth: false,
        isToday: date === today,
        isSelected: date === selectedDate,
        hasNote: datesWithNotes.has(date),
      });
    }

    // Days of current month
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const date = new Date(year, month, dayNum).toISOString().split("T")[0];
      result.push({
        date,
        dayNum,
        isCurrentMonth: true,
        isToday: date === today,
        isSelected: date === selectedDate,
        hasNote: datesWithNotes.has(date),
      });
    }

    // Days from next month to fill the grid (6 rows * 7 days = 42 cells)
    const remaining = 42 - result.length;
    for (let dayNum = 1; dayNum <= remaining; dayNum++) {
      const date = new Date(year, month + 1, dayNum).toISOString().split("T")[0];
      result.push({
        date,
        dayNum,
        isCurrentMonth: false,
        isToday: date === today,
        isSelected: date === selectedDate,
        hasNote: datesWithNotes.has(date),
      });
    }

    return result;
  }, [year, month, selectedDate, datesWithNotes, today]);

  const goToPrevMonth = () => {
    const newDate = new Date(year, month - 1, 1).toISOString().split("T")[0];
    onMonthChange?.(newDate);
  };

  const goToNextMonth = () => {
    const newDate = new Date(year, month + 1, 1).toISOString().split("T")[0];
    onMonthChange?.(newDate);
  };

  return (
    <div className="select-none">
      {/* Month navigation */}
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={goToPrevMonth}
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
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span
          className="text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          {MONTH_NAMES[month]} {year}
        </span>
        <button
          onClick={goToNextMonth}
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
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Day labels */}
      <div className="mb-1 grid grid-cols-7 gap-0.5">
        {DAY_LABELS.map((label) => (
          <div
            key={label}
            className="flex h-7 items-center justify-center text-xs font-medium"
            style={{ color: "var(--color-text-muted)" }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((day) => (
          <button
            key={day.date}
            onClick={() => onSelectDate(day.date)}
            className="relative flex h-8 items-center justify-center rounded-md text-sm transition-colors hover:bg-[--color-bg-tertiary]"
            style={{
              color: day.isCurrentMonth
                ? day.isSelected
                  ? "white"
                  : day.isToday
                    ? "var(--color-accent)"
                    : "var(--color-text-primary)"
                : "var(--color-text-muted)",
              backgroundColor: day.isSelected ? "var(--color-accent)" : undefined,
              fontWeight: day.isToday ? 600 : undefined,
            }}
          >
            {day.dayNum}
            {/* Dot indicator for days with notes */}
            {day.hasNote && !day.isSelected && (
              <span
                className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full"
                style={{ backgroundColor: "var(--color-accent)" }}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
