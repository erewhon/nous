import type { RecurrencePattern, RecurrenceType } from "../../types/tasks";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TYPE_LABELS: { value: RecurrenceType; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

interface RecurrenceEditorProps {
  value: RecurrencePattern | undefined;
  onChange: (value: RecurrencePattern | undefined) => void;
}

export function RecurrenceEditor({ value, onChange }: RecurrenceEditorProps) {
  const enabled = !!value;

  const handleToggle = () => {
    if (enabled) {
      onChange(undefined);
    } else {
      onChange({ type: "daily", interval: 1 });
    }
  };

  const handleTypeChange = (type: RecurrenceType) => {
    if (!value) return;
    onChange({ ...value, type, daysOfWeek: undefined, dayOfMonth: undefined });
  };

  const handleIntervalChange = (interval: number) => {
    if (!value) return;
    onChange({ ...value, interval: Math.max(1, interval) });
  };

  const handleDayToggle = (day: number) => {
    if (!value) return;
    const days = value.daysOfWeek ?? [];
    const newDays = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
    onChange({ ...value, daysOfWeek: newDays.length > 0 ? newDays : undefined });
  };

  return (
    <div>
      {/* Toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={handleToggle}
          className="rounded"
        />
        <span
          className="text-xs font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Recurring
        </span>
      </label>

      {enabled && value && (
        <div className="mt-2 space-y-2 pl-6">
          {/* Type selector */}
          <div className="flex gap-1">
            {TYPE_LABELS.map(({ value: type, label }) => (
              <button
                key={type}
                type="button"
                onClick={() => handleTypeChange(type)}
                className="rounded px-2 py-0.5 text-[10px] font-medium transition-colors"
                style={{
                  backgroundColor: value.type === type ? "var(--color-accent)" : "var(--color-bg-primary)",
                  color: value.type === type ? "white" : "var(--color-text-muted)",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Interval */}
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Every
            </span>
            <input
              type="number"
              min={1}
              value={value.interval}
              onChange={(e) => handleIntervalChange(parseInt(e.target.value) || 1)}
              className="w-14 rounded border px-2 py-0.5 text-xs"
              style={{
                backgroundColor: "var(--color-bg-primary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {value.type === "daily" ? "day(s)" : value.type === "weekly" ? "week(s)" : value.type === "monthly" ? "month(s)" : "year(s)"}
            </span>
          </div>

          {/* Days of week for weekly */}
          {value.type === "weekly" && (
            <div className="flex gap-1">
              {DAY_LABELS.map((label, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleDayToggle(i)}
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors"
                  style={{
                    backgroundColor: value.daysOfWeek?.includes(i) ? "var(--color-accent)" : "var(--color-bg-primary)",
                    color: value.daysOfWeek?.includes(i) ? "white" : "var(--color-text-muted)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* End date */}
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Until
            </span>
            <input
              type="date"
              value={value.endDate ?? ""}
              onChange={(e) => onChange({ ...value, endDate: e.target.value || undefined })}
              className="rounded border px-2 py-0.5 text-xs"
              style={{
                backgroundColor: "var(--color-bg-primary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
