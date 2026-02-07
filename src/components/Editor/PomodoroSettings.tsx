import { usePomodoroStore } from "../../stores/pomodoroStore";

interface PomodoroSettingsProps {
  onClose: () => void;
}

export function PomodoroSettings({ onClose }: PomodoroSettingsProps) {
  const { settings, updateSettings } = usePomodoroStore();

  return (
    <div className="px-4 pb-4 space-y-3">
      {/* Work duration */}
      <div>
        <label
          className="block text-xs font-medium mb-1"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Work ({settings.workDuration} min)
        </label>
        <input
          type="range"
          min="5"
          max="60"
          step="5"
          value={settings.workDuration}
          onChange={(e) => updateSettings({ workDuration: parseInt(e.target.value) })}
          className="w-full accent-[--color-accent]"
        />
      </div>

      {/* Short break */}
      <div>
        <label
          className="block text-xs font-medium mb-1"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Short Break ({settings.shortBreakDuration} min)
        </label>
        <input
          type="range"
          min="1"
          max="15"
          step="1"
          value={settings.shortBreakDuration}
          onChange={(e) => updateSettings({ shortBreakDuration: parseInt(e.target.value) })}
          className="w-full accent-[--color-accent]"
        />
      </div>

      {/* Long break */}
      <div>
        <label
          className="block text-xs font-medium mb-1"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Long Break ({settings.longBreakDuration} min)
        </label>
        <input
          type="range"
          min="5"
          max="30"
          step="5"
          value={settings.longBreakDuration}
          onChange={(e) => updateSettings({ longBreakDuration: parseInt(e.target.value) })}
          className="w-full accent-[--color-accent]"
        />
      </div>

      {/* Sessions before long break */}
      <div>
        <label
          className="block text-xs font-medium mb-1"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Sessions before long break: {settings.sessionsBeforeLongBreak}
        </label>
        <input
          type="range"
          min="2"
          max="8"
          step="1"
          value={settings.sessionsBeforeLongBreak}
          onChange={(e) =>
            updateSettings({ sessionsBeforeLongBreak: parseInt(e.target.value) })
          }
          className="w-full accent-[--color-accent]"
        />
      </div>

      {/* Auto-start breaks */}
      <div className="flex items-center justify-between">
        <span
          className="text-xs"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Auto-start breaks
        </span>
        <button
          onClick={() => updateSettings({ autoStartBreaks: !settings.autoStartBreaks })}
          className="relative h-5 w-9 rounded-full transition-colors"
          style={{
            backgroundColor: settings.autoStartBreaks
              ? "var(--color-accent)"
              : "var(--color-bg-tertiary)",
          }}
        >
          <span
            className="absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
            style={{
              transform: settings.autoStartBreaks
                ? "translateX(16px)"
                : "translateX(2px)",
            }}
          />
        </button>
      </div>

      {/* Notifications */}
      <div className="flex items-center justify-between">
        <span
          className="text-xs"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Notifications
        </span>
        <button
          onClick={() => updateSettings({ showNotifications: !settings.showNotifications })}
          className="relative h-5 w-9 rounded-full transition-colors"
          style={{
            backgroundColor: settings.showNotifications
              ? "var(--color-accent)"
              : "var(--color-bg-tertiary)",
          }}
        >
          <span
            className="absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
            style={{
              transform: settings.showNotifications
                ? "translateX(16px)"
                : "translateX(2px)",
            }}
          />
        </button>
      </div>

      <button
        onClick={onClose}
        className="w-full rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
        style={{
          borderColor: "var(--color-border)",
          color: "var(--color-text-secondary)",
        }}
      >
        Done
      </button>
    </div>
  );
}
