import { useState, useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  getBackupSettings,
  updateBackupSettings,
  runScheduledBackup,
  type BackupSettings,
  type BackupFrequency,
} from "../../utils/api";
import { useNotebookStore } from "../../stores/notebookStore";
import { useToastStore } from "../../stores/toastStore";

export function BackupScheduleSettings() {
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [backupProgress, setBackupProgress] = useState<{
    current: number;
    total: number;
    message: string;
  } | null>(null);

  const { notebooks } = useNotebookStore();
  const toast = useToastStore();

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  // Listen for backup progress events
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen<{ current: number; total: number; message: string }>(
        "backup-progress",
        (event) => {
          setBackupProgress(event.payload);
        }
      );
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
      setBackupProgress(null);
    };
  }, []);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      const s = await getBackupSettings();
      setSettings(s);
    } catch (err) {
      console.error("Failed to load backup settings:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (updated: BackupSettings) => {
    try {
      setIsLoading(true);
      const result = await updateBackupSettings(updated);
      setSettings(result);
      toast.success("Backup schedule saved");
    } catch (err) {
      toast.error(`Failed to save backup settings: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunNow = async () => {
    try {
      setIsLoading(true);
      const results = await runScheduledBackup();
      if (results.length === 0) {
        toast.info("No notebooks to backup");
      } else {
        toast.success(`Backed up ${results.length} notebook${results.length > 1 ? "s" : ""}`);
      }
    } catch (err) {
      toast.error(`Backup failed: ${err}`);
    } finally {
      setIsLoading(false);
      setBackupProgress(null);
    }
  };

  return (
    <ScheduleContent
      settings={settings}
      notebooks={notebooks}
      isLoading={isLoading}
      onSave={handleSave}
      onRunNow={handleRunNow}
      backupProgress={backupProgress}
    />
  );
}

function ScheduleContent({
  settings,
  notebooks,
  isLoading,
  onSave,
  onRunNow,
  backupProgress,
}: {
  settings: BackupSettings | null;
  notebooks: { id: string; name: string; icon?: string }[];
  isLoading: boolean;
  onSave: (settings: BackupSettings) => void;
  onRunNow: () => void;
  backupProgress: { current: number; total: number; message: string } | null;
}) {
  const [localSettings, setLocalSettings] = useState<BackupSettings>({
    enabled: false,
    frequency: "daily",
    time: "02:00",
    maxBackupsPerNotebook: 5,
    notebookIds: [],
  });
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
      setHasChanges(false);
    }
  }, [settings]);

  const handleChange = <K extends keyof BackupSettings>(key: K, value: BackupSettings[K]) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleNotebookToggle = (notebookId: string) => {
    setLocalSettings((prev) => {
      const newIds = prev.notebookIds.includes(notebookId)
        ? prev.notebookIds.filter((id) => id !== notebookId)
        : [...prev.notebookIds, notebookId];
      return { ...prev, notebookIds: newIds };
    });
    setHasChanges(true);
  };

  const handleSave = () => {
    onSave(localSettings);
    setHasChanges(false);
  };

  const dayOfWeekOptions = [
    { value: 0, label: "Sunday" },
    { value: 1, label: "Monday" },
    { value: 2, label: "Tuesday" },
    { value: 3, label: "Wednesday" },
    { value: 4, label: "Thursday" },
    { value: 5, label: "Friday" },
    { value: 6, label: "Saturday" },
  ];

  return (
    <div className="space-y-6">
      <p
        className="text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        Configure automatic backups to run on a schedule.
      </p>

      {/* Enable/Disable Toggle */}
      <div
        className="flex items-center justify-between rounded-lg border p-4"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
        }}
      >
        <div>
          <div
            className="font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Enable Scheduled Backups
          </div>
          <div
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            Automatically backup notebooks at the configured time
          </div>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={localSettings.enabled}
            onChange={(e) => handleChange("enabled", e.target.checked)}
            className="peer sr-only"
          />
          <div
            className="h-6 w-11 rounded-full"
            style={{
              backgroundColor: localSettings.enabled ? "var(--color-accent)" : "var(--color-bg-tertiary)",
            }}
          >
            <span
              className="absolute left-[2px] top-[2px] h-5 w-5 rounded-full transition-transform"
              style={{
                backgroundColor: "white",
                transform: localSettings.enabled ? "translateX(20px)" : "translateX(0)",
              }}
            />
          </div>
        </label>
      </div>

      {/* Schedule Settings */}
      <div
        className="space-y-4 rounded-lg border p-4"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
          opacity: localSettings.enabled ? 1 : 0.5,
        }}
      >
        <h4
          className="font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Schedule
        </h4>

        {/* Frequency */}
        <div className="flex items-center gap-4">
          <label
            className="w-24 text-sm"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Frequency
          </label>
          <select
            value={localSettings.frequency}
            onChange={(e) => handleChange("frequency", e.target.value as BackupFrequency)}
            disabled={!localSettings.enabled}
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "var(--color-bg-primary)",
              color: "var(--color-text-primary)",
            }}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        {/* Day of Week (for weekly) */}
        {localSettings.frequency === "weekly" && (
          <div className="flex items-center gap-4">
            <label
              className="w-24 text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Day
            </label>
            <select
              value={localSettings.dayOfWeek ?? 0}
              onChange={(e) => handleChange("dayOfWeek", parseInt(e.target.value))}
              disabled={!localSettings.enabled}
              className="flex-1 rounded-lg border px-3 py-2 text-sm"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
              }}
            >
              {dayOfWeekOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Day of Month (for monthly) */}
        {localSettings.frequency === "monthly" && (
          <div className="flex items-center gap-4">
            <label
              className="w-24 text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Day
            </label>
            <select
              value={localSettings.dayOfMonth ?? 1}
              onChange={(e) => handleChange("dayOfMonth", parseInt(e.target.value))}
              disabled={!localSettings.enabled}
              className="flex-1 rounded-lg border px-3 py-2 text-sm"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
              }}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Time */}
        <div className="flex items-center gap-4">
          <label
            className="w-24 text-sm"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Time
          </label>
          <input
            type="time"
            value={localSettings.time}
            onChange={(e) => handleChange("time", e.target.value)}
            disabled={!localSettings.enabled}
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "var(--color-bg-primary)",
              color: "var(--color-text-primary)",
            }}
          />
        </div>

        {/* Max Backups */}
        <div className="flex items-center gap-4">
          <label
            className="w-24 text-sm"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Keep
          </label>
          <select
            value={localSettings.maxBackupsPerNotebook}
            onChange={(e) => handleChange("maxBackupsPerNotebook", parseInt(e.target.value))}
            disabled={!localSettings.enabled}
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "var(--color-bg-primary)",
              color: "var(--color-text-primary)",
            }}
          >
            <option value={3}>Last 3 backups</option>
            <option value={5}>Last 5 backups</option>
            <option value={10}>Last 10 backups</option>
            <option value={20}>Last 20 backups</option>
          </select>
        </div>
      </div>

      {/* Notebook Selection */}
      <div
        className="space-y-4 rounded-lg border p-4"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
          opacity: localSettings.enabled ? 1 : 0.5,
        }}
      >
        <div className="flex items-center justify-between">
          <h4
            className="font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Notebooks
          </h4>
          <span
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            {localSettings.notebookIds.length === 0
              ? "All notebooks"
              : `${localSettings.notebookIds.length} selected`}
          </span>
        </div>

        <p
          className="text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          Select specific notebooks to backup, or leave all unchecked to backup everything.
        </p>

        <div className="space-y-2 max-h-40 overflow-y-auto">
          {notebooks.map((notebook) => (
            <label
              key={notebook.id}
              className="flex items-center gap-3 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={localSettings.notebookIds.includes(notebook.id)}
                onChange={() => handleNotebookToggle(notebook.id)}
                disabled={!localSettings.enabled}
                className="rounded"
              />
              <span className="text-lg">{notebook.icon || ""}</span>
              <span
                className="text-sm"
                style={{ color: "var(--color-text-primary)" }}
              >
                {notebook.name}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Status */}
      {settings && (
        <div
          className="rounded-lg border p-4"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-secondary)",
          }}
        >
          <h4
            className="font-medium mb-2"
            style={{ color: "var(--color-text-primary)" }}
          >
            Status
          </h4>
          <div className="space-y-1 text-sm">
            <div style={{ color: "var(--color-text-secondary)" }}>
              Last backup:{" "}
              <span style={{ color: "var(--color-text-primary)" }}>
                {settings.lastBackup
                  ? new Date(settings.lastBackup).toLocaleString()
                  : "Never"}
              </span>
            </div>
            {settings.enabled && settings.nextBackup && (
              <div style={{ color: "var(--color-text-secondary)" }}>
                Next backup:{" "}
                <span style={{ color: "var(--color-text-primary)" }}>
                  {new Date(settings.nextBackup).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Backup Progress */}
      {backupProgress && (
        <div className="rounded-lg p-3" style={{ backgroundColor: "var(--color-bg-secondary)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
              {backupProgress.message}
            </span>
            <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
              {backupProgress.current} / {backupProgress.total}
            </span>
          </div>
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-150"
              style={{
                backgroundColor: "var(--color-accent)",
                width: `${backupProgress.total > 0 ? (backupProgress.current / backupProgress.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={isLoading || !hasChanges}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
          style={{
            backgroundColor: hasChanges ? "var(--color-accent)" : "var(--color-bg-tertiary)",
            color: hasChanges ? "white" : "var(--color-text-muted)",
          }}
        >
          {isLoading ? (
            <>
              <svg
                className="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Saving...
            </>
          ) : (
            "Save Settings"
          )}
        </button>
        <button
          onClick={onRunNow}
          disabled={isLoading}
          className="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-text-secondary)",
          }}
        >
          {isLoading ? (
            <>
              <svg
                className="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Backing up...
            </>
          ) : (
            "Backup Now"
          )}
        </button>
      </div>
    </div>
  );
}
