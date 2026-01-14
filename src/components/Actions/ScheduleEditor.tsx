import type { Schedule } from "../../types/action";

interface ScheduleEditorProps {
  schedule: Schedule;
  onChange: (schedule: Schedule) => void;
}

const DAYS_OF_WEEK = [
  { id: "monday", label: "Mon" },
  { id: "tuesday", label: "Tue" },
  { id: "wednesday", label: "Wed" },
  { id: "thursday", label: "Thu" },
  { id: "friday", label: "Fri" },
  { id: "saturday", label: "Sat" },
  { id: "sunday", label: "Sun" },
];

export function ScheduleEditor({ schedule, onChange }: ScheduleEditorProps) {
  const handleTypeChange = (type: Schedule["type"]) => {
    if (type === "daily") {
      onChange({
        type: "daily",
        time: schedule.time,
        skipWeekends: false,
      });
    } else if (type === "weekly") {
      onChange({
        type: "weekly",
        time: schedule.time,
        days: ["monday"],
      });
    } else if (type === "monthly") {
      onChange({
        type: "monthly",
        time: schedule.time,
        dayOfMonth: 1,
      });
    }
  };

  const handleTimeChange = (time: string) => {
    onChange({ ...schedule, time });
  };

  const handleSkipWeekendsChange = (skipWeekends: boolean) => {
    if (schedule.type === "daily") {
      onChange({ ...schedule, skipWeekends });
    }
  };

  const handleDaysChange = (day: string) => {
    if (schedule.type === "weekly") {
      const days = schedule.days.includes(day)
        ? schedule.days.filter((d) => d !== day)
        : [...schedule.days, day];
      // Ensure at least one day is selected
      if (days.length > 0) {
        onChange({ ...schedule, days });
      }
    }
  };

  const handleDayOfMonthChange = (dayOfMonth: number) => {
    if (schedule.type === "monthly") {
      onChange({ ...schedule, dayOfMonth });
    }
  };

  return (
    <div className="space-y-4">
      {/* Schedule type selector */}
      <div>
        <label
          className="mb-2 block text-xs font-medium"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Frequency
        </label>
        <div className="flex gap-2">
          {(["daily", "weekly", "monthly"] as const).map((type) => (
            <button
              key={type}
              onClick={() => handleTypeChange(type)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                schedule.type === type ? "text-white" : ""
              }`}
              style={{
                backgroundColor:
                  schedule.type === type
                    ? "var(--color-accent)"
                    : "var(--color-bg-tertiary)",
                color:
                  schedule.type === type
                    ? "white"
                    : "var(--color-text-secondary)",
              }}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Time picker */}
      <div>
        <label
          className="mb-2 block text-xs font-medium"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Time
        </label>
        <input
          type="time"
          value={schedule.time}
          onChange={(e) => handleTimeChange(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
      </div>

      {/* Daily-specific options */}
      {schedule.type === "daily" && (
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={schedule.skipWeekends}
              onChange={(e) => handleSkipWeekendsChange(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 accent-[--color-accent]"
            />
            <span
              className="text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Skip weekends
            </span>
          </label>
        </div>
      )}

      {/* Weekly-specific options */}
      {schedule.type === "weekly" && (
        <div>
          <label
            className="mb-2 block text-xs font-medium"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Days of week
          </label>
          <div className="flex flex-wrap gap-2">
            {DAYS_OF_WEEK.map((day) => (
              <button
                key={day.id}
                onClick={() => handleDaysChange(day.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  schedule.days.includes(day.id) ? "text-white" : ""
                }`}
                style={{
                  backgroundColor: schedule.days.includes(day.id)
                    ? "var(--color-accent)"
                    : "var(--color-bg-tertiary)",
                  color: schedule.days.includes(day.id)
                    ? "white"
                    : "var(--color-text-secondary)",
                }}
              >
                {day.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Monthly-specific options */}
      {schedule.type === "monthly" && (
        <div>
          <label
            className="mb-2 block text-xs font-medium"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Day of month
          </label>
          <select
            value={schedule.dayOfMonth}
            onChange={(e) => handleDayOfMonthChange(parseInt(e.target.value))}
            className="rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
              <option key={day} value={day}>
                {day}
                {getOrdinalSuffix(day)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Preview */}
      <div
        className="rounded-lg p-3 text-sm"
        style={{
          backgroundColor: "var(--color-bg-tertiary)",
          color: "var(--color-text-muted)",
        }}
      >
        <span className="font-medium">Schedule: </span>
        {getScheduleDescription(schedule)}
      </div>
    </div>
  );
}

function getOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function getScheduleDescription(schedule: Schedule): string {
  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const h = parseInt(hours);
    const ampm = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}:${minutes} ${ampm}`;
  };

  if (schedule.type === "daily") {
    if (schedule.skipWeekends) {
      return `Every weekday at ${formatTime(schedule.time)}`;
    }
    return `Every day at ${formatTime(schedule.time)}`;
  }

  if (schedule.type === "weekly") {
    const dayNames = schedule.days
      .map((d) => d.charAt(0).toUpperCase() + d.slice(1))
      .join(", ");
    return `Every ${dayNames} at ${formatTime(schedule.time)}`;
  }

  if (schedule.type === "monthly") {
    return `On the ${schedule.dayOfMonth}${getOrdinalSuffix(schedule.dayOfMonth)} of each month at ${formatTime(schedule.time)}`;
  }

  return "";
}
