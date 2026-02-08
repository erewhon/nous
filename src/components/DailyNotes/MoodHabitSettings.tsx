import { useState } from "react";
import { useMoodHabitStore } from "../../stores/moodHabitStore";

interface MoodHabitSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MoodHabitSettings({ isOpen, onClose }: MoodHabitSettingsProps) {
  const { habitList, addHabit, removeHabit } = useMoodHabitStore();
  const [newHabit, setNewHabit] = useState("");

  if (!isOpen) return null;

  const handleAdd = () => {
    const trimmed = newHabit.trim();
    if (trimmed && !habitList.includes(trimmed)) {
      addHabit(trimmed);
      setNewHabit("");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/50" />
      <div
        role="dialog"
        className="relative z-10 w-full max-w-sm rounded-xl border p-6 shadow-xl"
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
            Habit Settings
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

        {/* Current habits */}
        <div className="space-y-2 mb-4">
          {habitList.map((habit) => (
            <div
              key={habit}
              className="flex items-center justify-between rounded-md border px-3 py-2"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg-secondary)",
              }}
            >
              <span
                className="text-sm"
                style={{ color: "var(--color-text-primary)" }}
              >
                {habit}
              </span>
              <button
                onClick={() => removeHabit(habit)}
                className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-[--color-bg-tertiary]"
                style={{ color: "var(--color-text-muted)" }}
                title="Remove habit"
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
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        {/* Add new habit */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="New habit..."
            value={newHabit}
            onChange={(e) => setNewHabit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            className="flex-1 rounded-md border px-3 py-1.5 text-sm"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
          <button
            onClick={handleAdd}
            disabled={!newHabit.trim()}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
