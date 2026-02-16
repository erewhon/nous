import { useState, useEffect, useCallback } from "react";
import { useEnergyStore } from "../../stores/energyStore";
import { useMoodHabitStore } from "../../stores/moodHabitStore";
import type { FocusCapacity, CreateCheckInRequest, HabitEntry } from "../../types/energy";
import { MoodHabitSettings } from "../DailyNotes/MoodHabitSettings";

const MOOD_LEVELS = [
  { value: 1, emoji: "\u{1F614}", label: "Awful" },
  { value: 2, emoji: "\u{1F615}", label: "Bad" },
  { value: 3, emoji: "\u{1F610}", label: "Okay" },
  { value: 4, emoji: "\u{1F642}", label: "Good" },
  { value: 5, emoji: "\u{1F60A}", label: "Great" },
] as const;

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

  const { habitList } = useMoodHabitStore();

  const [mood, setMood] = useState<number | undefined>(undefined);
  const [energyLevel, setEnergyLevel] = useState<number | undefined>(undefined);
  const [focusCapacity, setFocusCapacity] = useState<FocusCapacity[]>([]);
  const [habits, setHabits] = useState<HabitEntry[]>([]);
  const [sleepQuality, setSleepQuality] = useState<number | undefined>(undefined);
  const [notes, setNotes] = useState("");
  const [showSleep, setShowSleep] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showHabitSettings, setShowHabitSettings] = useState(false);

  // Determine which date we're editing
  const targetDate = editingDate || new Date().toISOString().split("T")[0];
  const existingCheckIn = editingDate
    ? checkIns.get(editingDate)
    : todayCheckIn;

  // Pre-populate fields when editing
  useEffect(() => {
    if (isCheckInOpen && existingCheckIn) {
      setMood(existingCheckIn.mood ?? undefined);
      setEnergyLevel(existingCheckIn.energyLevel ?? undefined);
      setFocusCapacity([...existingCheckIn.focusCapacity]);
      setHabits(
        existingCheckIn.habits.length > 0
          ? existingCheckIn.habits.map((h) => ({ ...h }))
          : habitList.map((name) => ({ name, checked: false }))
      );
      setSleepQuality(existingCheckIn.sleepQuality ?? undefined);
      setNotes(existingCheckIn.notes ?? "");
      setShowSleep(existingCheckIn.sleepQuality != null);
      setShowNotes(!!existingCheckIn.notes);
    } else if (isCheckInOpen) {
      setMood(undefined);
      setEnergyLevel(undefined);
      setFocusCapacity([]);
      setHabits(habitList.map((name) => ({ name, checked: false })));
      setSleepQuality(undefined);
      setNotes("");
      setShowSleep(false);
      setShowNotes(false);
    }
  }, [isCheckInOpen, existingCheckIn, habitList]);

  const toggleFocus = useCallback((focus: FocusCapacity) => {
    setFocusCapacity((prev) =>
      prev.includes(focus)
        ? prev.filter((f) => f !== focus)
        : [...prev, focus]
    );
  }, []);

  const toggleHabit = useCallback((name: string) => {
    setHabits((prev) =>
      prev.map((h) =>
        h.name === name ? { ...h, checked: !h.checked } : h
      )
    );
  }, []);

  const handleSave = useCallback(async () => {
    if (!mood && !energyLevel) return;

    const request: CreateCheckInRequest = {
      date: targetDate,
      energyLevel,
      mood,
      focusCapacity,
      habits,
      sleepQuality: showSleep ? sleepQuality : undefined,
      notes: showNotes && notes.trim() ? notes.trim() : undefined,
    };
    try {
      await submitCheckIn(request);
    } catch {
      // Error is handled in store
    }
  }, [targetDate, mood, energyLevel, focusCapacity, habits, sleepQuality, notes, showSleep, showNotes, submitCheckIn]);

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
          maxHeight: "90vh",
          overflowY: "auto",
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
            {existingCheckIn ? "Edit Check-in" : "Daily Check-in"}
          </h2>
          <span
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            {targetDate}
          </span>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* Mood */}
          <div>
            <label
              className="mb-2 block text-sm font-medium"
              style={{ color: "var(--color-text-secondary)" }}
            >
              How's your mood?
            </label>
            <div className="flex gap-2">
              {MOOD_LEVELS.map((level) => (
                <button
                  key={level.value}
                  onClick={() => setMood(mood === level.value ? undefined : level.value)}
                  className="flex flex-1 flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition-colors"
                  style={{
                    borderColor:
                      mood === level.value
                        ? "var(--color-accent)"
                        : "var(--color-border)",
                    backgroundColor:
                      mood === level.value
                        ? "var(--color-accent-muted, rgba(59, 130, 246, 0.1))"
                        : "transparent",
                  }}
                >
                  <span className="text-lg">{level.emoji}</span>
                  <span
                    className="text-[10px]"
                    style={{
                      color:
                        mood === level.value
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
                  onClick={() => setEnergyLevel(energyLevel === level.value ? undefined : level.value)}
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

          {/* Habits */}
          {habits.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label
                  className="text-sm font-medium"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Habits
                </label>
                <button
                  onClick={() => setShowHabitSettings(true)}
                  className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-[--color-bg-tertiary]"
                  style={{ color: "var(--color-text-muted)" }}
                  title="Manage habits"
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
                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                  </svg>
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {habits.map((habit) => (
                  <button
                    key={habit.name}
                    onClick={() => toggleHabit(habit.name)}
                    className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      borderColor: habit.checked
                        ? "var(--color-accent)"
                        : "var(--color-border)",
                      backgroundColor: habit.checked
                        ? "var(--color-accent-muted, rgba(59, 130, 246, 0.1))"
                        : "transparent",
                      color: habit.checked
                        ? "var(--color-accent)"
                        : "var(--color-text-secondary)",
                    }}
                  >
                    {habit.checked ? "\u2713 " : ""}{habit.name}
                  </button>
                ))}
              </div>
            </div>
          )}

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
            disabled={isLoading || (!mood && !energyLevel)}
            className="rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            {isLoading ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Habit Settings sub-dialog */}
      <MoodHabitSettings
        isOpen={showHabitSettings}
        onClose={() => setShowHabitSettings(false)}
      />
    </div>
  );
}
