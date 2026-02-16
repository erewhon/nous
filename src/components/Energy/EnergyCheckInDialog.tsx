import { useState, useEffect, useCallback } from "react";
import { useEnergyStore } from "../../stores/energyStore";
import type { FocusCapacity, CreateCheckInRequest } from "../../types/energy";

const ENERGY_LEVELS = [
  { value: 1, emoji: "\u{1F629}", label: "Very Low" },
  { value: 2, emoji: "\u{1F614}", label: "Low" },
  { value: 3, emoji: "\u{1F610}", label: "Medium" },
  { value: 4, emoji: "\u{1F60A}", label: "High" },
  { value: 5, emoji: "\u{26A1}", label: "Very High" },
] as const;

const FOCUS_TYPES: { value: FocusCapacity; label: string }[] = [
  { value: "deepWork", label: "Deep Work" },
  { value: "lightWork", label: "Light Work" },
  { value: "physical", label: "Physical" },
  { value: "creative", label: "Creative" },
];

const SLEEP_LEVELS = [
  { value: 1, label: "Poor" },
  { value: 2, label: "Fair" },
  { value: 3, label: "Good" },
  { value: 4, label: "Excellent" },
] as const;

export function EnergyCheckInDialog() {
  const {
    isCheckInOpen,
    editingDate,
    checkIns,
    todayCheckIn,
    isLoading,
    closeCheckIn,
    submitCheckIn,
  } = useEnergyStore();

  const [energyLevel, setEnergyLevel] = useState<number>(3);
  const [focusCapacity, setFocusCapacity] = useState<FocusCapacity[]>([]);
  const [sleepQuality, setSleepQuality] = useState<number | undefined>(undefined);
  const [notes, setNotes] = useState("");
  const [showSleep, setShowSleep] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  // Determine which date we're editing
  const targetDate = editingDate || new Date().toISOString().split("T")[0];
  const existingCheckIn = editingDate
    ? checkIns.get(editingDate)
    : todayCheckIn;

  // Pre-populate fields when editing
  useEffect(() => {
    if (isCheckInOpen && existingCheckIn) {
      setEnergyLevel(existingCheckIn.energyLevel);
      setFocusCapacity([...existingCheckIn.focusCapacity]);
      setSleepQuality(existingCheckIn.sleepQuality ?? undefined);
      setNotes(existingCheckIn.notes ?? "");
      setShowSleep(existingCheckIn.sleepQuality != null);
      setShowNotes(!!existingCheckIn.notes);
    } else if (isCheckInOpen) {
      setEnergyLevel(3);
      setFocusCapacity([]);
      setSleepQuality(undefined);
      setNotes("");
      setShowSleep(false);
      setShowNotes(false);
    }
  }, [isCheckInOpen, existingCheckIn]);

  const toggleFocus = useCallback((focus: FocusCapacity) => {
    setFocusCapacity((prev) =>
      prev.includes(focus)
        ? prev.filter((f) => f !== focus)
        : [...prev, focus]
    );
  }, []);

  const handleSave = useCallback(async () => {
    const request: CreateCheckInRequest = {
      date: targetDate,
      energyLevel,
      focusCapacity,
      sleepQuality: showSleep ? sleepQuality : undefined,
      notes: showNotes && notes.trim() ? notes.trim() : undefined,
    };
    try {
      await submitCheckIn(request);
    } catch {
      // Error is handled in store
    }
  }, [targetDate, energyLevel, focusCapacity, sleepQuality, notes, showSleep, showNotes, submitCheckIn]);

  if (!isCheckInOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeCheckIn();
      }}
    >
      <div
        className="w-full max-w-md rounded-lg border shadow-xl"
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
            {existingCheckIn ? "Edit Check-in" : "Energy Check-in"}
          </h2>
          <span
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            {targetDate}
          </span>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* Energy Level */}
          <div>
            <label
              className="mb-2 block text-sm font-medium"
              style={{ color: "var(--color-text-secondary)" }}
            >
              How's your energy?
            </label>
            <div className="flex gap-2">
              {ENERGY_LEVELS.map((level) => (
                <button
                  key={level.value}
                  onClick={() => setEnergyLevel(level.value)}
                  className="flex flex-1 flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition-colors"
                  style={{
                    borderColor:
                      energyLevel === level.value
                        ? "var(--color-accent)"
                        : "var(--color-border)",
                    backgroundColor:
                      energyLevel === level.value
                        ? "var(--color-accent-muted, rgba(59, 130, 246, 0.1))"
                        : "transparent",
                  }}
                >
                  <span className="text-lg">{level.emoji}</span>
                  <span
                    className="text-[10px]"
                    style={{
                      color:
                        energyLevel === level.value
                          ? "var(--color-accent)"
                          : "var(--color-text-muted)",
                    }}
                  >
                    {level.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Focus Capacity */}
          <div>
            <label
              className="mb-2 block text-sm font-medium"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Focus capacity
            </label>
            <div className="flex flex-wrap gap-2">
              {FOCUS_TYPES.map((type) => (
                <button
                  key={type.value}
                  onClick={() => toggleFocus(type.value)}
                  className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{
                    borderColor: focusCapacity.includes(type.value)
                      ? "var(--color-accent)"
                      : "var(--color-border)",
                    backgroundColor: focusCapacity.includes(type.value)
                      ? "var(--color-accent-muted, rgba(59, 130, 246, 0.1))"
                      : "transparent",
                    color: focusCapacity.includes(type.value)
                      ? "var(--color-accent)"
                      : "var(--color-text-secondary)",
                  }}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sleep Quality (collapsible) */}
          <div>
            <button
              onClick={() => setShowSleep(!showSleep)}
              className="flex items-center gap-1.5 text-xs font-medium transition-colors hover:underline"
              style={{ color: "var(--color-text-muted)" }}
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
                style={{
                  transform: showSleep ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.15s",
                }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              Sleep quality
            </button>
            {showSleep && (
              <div className="mt-2 flex gap-2">
                {SLEEP_LEVELS.map((level) => (
                  <button
                    key={level.value}
                    onClick={() =>
                      setSleepQuality(
                        sleepQuality === level.value ? undefined : level.value
                      )
                    }
                    className="flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      borderColor:
                        sleepQuality === level.value
                          ? "var(--color-accent)"
                          : "var(--color-border)",
                      backgroundColor:
                        sleepQuality === level.value
                          ? "var(--color-accent-muted, rgba(59, 130, 246, 0.1))"
                          : "transparent",
                      color:
                        sleepQuality === level.value
                          ? "var(--color-accent)"
                          : "var(--color-text-secondary)",
                    }}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Notes (collapsible) */}
          <div>
            <button
              onClick={() => setShowNotes(!showNotes)}
              className="flex items-center gap-1.5 text-xs font-medium transition-colors hover:underline"
              style={{ color: "var(--color-text-muted)" }}
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
                style={{
                  transform: showNotes ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.15s",
                }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              Notes
            </button>
            {showNotes && (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="How are you feeling? Any context..."
                className="mt-2 w-full resize-none rounded-md border px-3 py-2 text-sm"
                style={{
                  borderColor: "var(--color-border)",
                  backgroundColor: "var(--color-bg-secondary)",
                  color: "var(--color-text-primary)",
                }}
                rows={3}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 border-t px-5 py-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={closeCheckIn}
            className="rounded-md px-4 py-2 text-sm font-medium transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading}
            className="rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            {isLoading ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
