import { useState, useEffect } from "react";
import { useMonitorStore } from "../../stores/monitorStore";
import type {
  AppCategory,
  CaptureMethod,
  MonitorTarget,
  CreateTargetRequest,
} from "../../types/monitor";

const CATEGORIES: { value: AppCategory; label: string }[] = [
  { value: "chat", label: "Chat" },
  { value: "email", label: "Email" },
  { value: "notifications", label: "Notifications" },
  { value: "browser", label: "Browser" },
  { value: "custom", label: "Custom" },
];

const CAPTURE_METHODS: { value: CaptureMethod; label: string; desc: string }[] =
  [
    { value: "aiVision", label: "AI Vision", desc: "Screenshot + AI analysis" },
    {
      value: "accessibility",
      label: "Accessibility",
      desc: "AT-SPI2 tree scraping",
    },
    { value: "both", label: "Both", desc: "Vision + accessibility combined" },
  ];

function TargetRow({
  target,
  onToggle,
  onEdit,
  onDelete,
}: {
  target: MonitorTarget;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
      style={{
        borderColor: "var(--color-border)",
        opacity: target.enabled ? 1 : 0.6,
      }}
    >
      <label className="flex cursor-pointer items-center">
        <input
          type="checkbox"
          checked={target.enabled}
          onChange={onToggle}
          className="h-4 w-4 rounded accent-violet-500"
        />
      </label>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            {target.name}
          </span>
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] uppercase"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-muted)",
            }}
          >
            {target.category}
          </span>
        </div>
        <p
          className="mt-0.5 text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          Window: "{target.windowMatch}" &middot; Every {target.intervalSecs}s
          &middot;{" "}
          {target.captureMethod === "aiVision"
            ? "AI Vision"
            : target.captureMethod === "accessibility"
              ? "A11y"
              : "Both"}
          {target.sendToInbox && " \u2192 Inbox"}
        </p>
      </div>
      <button
        onClick={onEdit}
        className="rounded p-1.5 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
        style={{ color: "var(--color-text-secondary)" }}
      >
        Edit
      </button>
      <button
        onClick={onDelete}
        className="rounded p-1.5 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
        style={{ color: "#ef4444" }}
      >
        Delete
      </button>
    </div>
  );
}

export function MonitorSettings() {
  const {
    targets,
    availableWindows,
    loadTargets,
    createTarget,
    updateTarget,
    deleteTarget,
    discoverWindows,
  } = useMonitorStore();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateTargetRequest>({
    name: "",
    windowMatch: "",
    category: "custom",
    captureMethod: "aiVision",
    intervalSecs: 60,
    sendToInbox: false,
  });
  const [watchInstructions, setWatchInstructions] = useState("");

  useEffect(() => {
    loadTargets();
  }, [loadTargets]);

  const resetForm = () => {
    setFormData({
      name: "",
      windowMatch: "",
      category: "custom",
      captureMethod: "aiVision",
      intervalSecs: 60,
      sendToInbox: false,
    });
    setWatchInstructions("");
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    const request: CreateTargetRequest = {
      ...formData,
      watchInstructions: watchInstructions || undefined,
    };

    if (editingId) {
      await updateTarget(editingId, request);
    } else {
      await createTarget(request);
    }
    resetForm();
  };

  const handleEdit = (target: MonitorTarget) => {
    setEditingId(target.id);
    setFormData({
      name: target.name,
      windowMatch: target.windowMatch,
      category: target.category,
      captureMethod: target.captureMethod,
      intervalSecs: target.intervalSecs,
      sendToInbox: target.sendToInbox,
    });
    setWatchInstructions(target.watchInstructions || "");
    setShowForm(true);
  };

  const handleToggle = async (target: MonitorTarget) => {
    await updateTarget(target.id, { enabled: !target.enabled });
  };

  const handleDelete = async (target: MonitorTarget) => {
    await deleteTarget(target.id);
  };

  const handleDiscoverWindows = async () => {
    await discoverWindows();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3
            className="text-sm font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Monitor Targets
          </h3>
          <p
            className="mt-0.5 text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            Configure which applications to monitor for new messages and
            notifications.
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          Add Target
        </button>
      </div>

      {/* Target list */}
      <div className="space-y-2">
        {targets.length === 0 ? (
          <p
            className="py-8 text-center text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            No monitor targets configured yet.
          </p>
        ) : (
          targets.map((target) => (
            <TargetRow
              key={target.id}
              target={target}
              onToggle={() => handleToggle(target)}
              onEdit={() => handleEdit(target)}
              onDelete={() => handleDelete(target)}
            />
          ))
        )}
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div
          className="space-y-3 rounded-lg border p-4"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-tertiary)",
          }}
        >
          <h4
            className="text-sm font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            {editingId ? "Edit Target" : "Add Target"}
          </h4>

          {/* Name */}
          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder="e.g., Slack, Gmail, Thunderbird"
              className="w-full rounded-md border px-3 py-1.5 text-sm"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>

          {/* Window match */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label
                className="text-xs font-medium"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Window Match
              </label>
              <button
                onClick={handleDiscoverWindows}
                className="text-xs"
                style={{ color: "var(--color-accent)" }}
              >
                Discover Windows
              </button>
            </div>
            <input
              type="text"
              value={formData.windowMatch}
              onChange={(e) =>
                setFormData({ ...formData, windowMatch: e.target.value })
              }
              placeholder="Window title substring to match"
              className="w-full rounded-md border px-3 py-1.5 text-sm"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
              }}
            />
            {availableWindows.length > 0 && (
              <div
                className="mt-1 max-h-32 overflow-y-auto rounded border"
                style={{
                  borderColor: "var(--color-border)",
                  backgroundColor: "var(--color-bg-primary)",
                }}
              >
                {availableWindows.map((w) => (
                  <button
                    key={w.windowId}
                    onClick={() =>
                      setFormData({ ...formData, windowMatch: w.title })
                    }
                    className="block w-full px-2 py-1 text-left text-xs transition-colors hover:bg-[--color-bg-tertiary]"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    {w.title}
                    {w.className && (
                      <span
                        className="ml-1"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        ({w.className})
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Category + Capture method row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label
                className="mb-1 block text-xs font-medium"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Category
              </label>
              <select
                value={formData.category}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    category: e.target.value as AppCategory,
                  })
                }
                className="w-full rounded-md border px-3 py-1.5 text-sm"
                style={{
                  borderColor: "var(--color-border)",
                  backgroundColor: "var(--color-bg-primary)",
                  color: "var(--color-text-primary)",
                }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label
                className="mb-1 block text-xs font-medium"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Capture Method
              </label>
              <select
                value={formData.captureMethod}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    captureMethod: e.target.value as CaptureMethod,
                  })
                }
                className="w-full rounded-md border px-3 py-1.5 text-sm"
                style={{
                  borderColor: "var(--color-border)",
                  backgroundColor: "var(--color-bg-primary)",
                  color: "var(--color-text-primary)",
                }}
              >
                {CAPTURE_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Interval */}
          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Capture Interval (seconds)
            </label>
            <input
              type="number"
              min={10}
              value={formData.intervalSecs}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  intervalSecs: parseInt(e.target.value) || 60,
                })
              }
              className="w-32 rounded-md border px-3 py-1.5 text-sm"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>

          {/* Watch instructions */}
          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Watch Instructions (optional)
            </label>
            <textarea
              value={watchInstructions}
              onChange={(e) => setWatchInstructions(e.target.value)}
              placeholder="Custom AI instructions, e.g., 'Focus on unread messages from team channels'"
              rows={2}
              className="w-full rounded-md border px-3 py-1.5 text-sm"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>

          {/* Send to inbox */}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.sendToInbox}
              onChange={(e) =>
                setFormData({ ...formData, sendToInbox: e.target.checked })
              }
              className="h-4 w-4 rounded accent-violet-500"
            />
            <span
              className="text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Send captures to Inbox
            </span>
          </label>

          {/* Form buttons */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={resetForm}
              className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[--color-bg-primary]"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!formData.name || !formData.windowMatch}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: "var(--color-accent)" }}
            >
              {editingId ? "Save" : "Add Target"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
