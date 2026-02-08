import { useDailyNotesStore } from "../../stores/dailyNotesStore";
import { useTemplateStore } from "../../stores/templateStore";

export function DailyNotesSettings() {
  const { settings, setUseTemplate, setTemplateId } = useDailyNotesStore();
  const { templates } = useTemplateStore();

  // Get available templates
  const availableTemplates = templates;

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div
        className="flex items-start gap-3 rounded-lg border p-4"
        style={{
          backgroundColor: "rgba(139, 92, 246, 0.1)",
          borderColor: "var(--color-accent)",
        }}
      >
        <IconCalendar style={{ color: "var(--color-accent)", flexShrink: 0, marginTop: 2 }} />
        <div>
          <p
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Daily Notes Configuration
          </p>
          <p
            className="mt-1 text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            Configure how daily notes are created. You can optionally use a template
            like Daily Journal to add structure to your daily notes.
          </p>
        </div>
      </div>

      {/* Use Template Toggle */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <label
              className="text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Use Template
            </label>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Apply a template when creating new daily notes
            </p>
          </div>
          <button
            onClick={() => setUseTemplate(!settings.useTemplate)}
            className="relative h-6 w-11 rounded-full transition-colors"
            style={{
              backgroundColor: settings.useTemplate
                ? "var(--color-accent)"
                : "var(--color-bg-tertiary)",
            }}
          >
            <span
              className="absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
              style={{
                transform: settings.useTemplate
                  ? "translateX(22px)"
                  : "translateX(2px)",
              }}
            />
          </button>
        </div>
      </div>

      {/* Template Selection */}
      {settings.useTemplate && (
        <div>
          <label
            className="mb-2 block text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Template
          </label>
          <select
            value={settings.templateId || ""}
            onChange={(e) => setTemplateId(e.target.value || null)}
            className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[--color-accent] dark-select"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          >
            <option value="">No template (blank page)</option>
            {availableTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
                {template.id === "daily-journal" ? " (Recommended)" : ""}
              </option>
            ))}
          </select>
          <p
            className="mt-1.5 text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            The Daily Journal template includes sections for gratitude, goals, notes, and reflection.
          </p>
        </div>
      )}

      {/* Preview of Daily Journal Template */}
      {settings.useTemplate && settings.templateId === "daily-journal" && (
        <div
          className="rounded-lg border p-4"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          <h4
            className="mb-3 flex items-center gap-2 text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            <IconTemplate />
            Daily Journal Template Preview
          </h4>
          <div
            className="space-y-2 text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            <div className="flex items-center gap-2">
              <span className="font-medium" style={{ color: "var(--color-text-secondary)" }}>
                Title:
              </span>
              <span>Formatted date (e.g., "February 4, 2026")</span>
            </div>
            <div>
              <span className="font-medium" style={{ color: "var(--color-text-secondary)" }}>
                Sections:
              </span>
              <ul className="ml-4 mt-1 list-disc space-y-1">
                <li>Gratitude - What am I grateful for today?</li>
                <li>Today's Goals - Checklist with 3 items</li>
                <li>Notes & Thoughts</li>
                <li>End of Day Reflection - What went well?</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcut Info */}
      <div
        className="rounded-lg border p-4"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <h4
          className="mb-2 text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Quick Access
        </h4>
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Press{" "}
          <kbd
            className="rounded px-1.5 py-0.5"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-primary)",
            }}
          >
            Cmd+Shift+D
          </kbd>{" "}
          to quickly open or create today's daily note.
        </p>
      </div>
    </div>
  );
}

// Icons
function IconCalendar({ style }: { style?: React.CSSProperties }) {
  return (
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
      style={style}
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconTemplate() {
  return (
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
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 21V9" />
    </svg>
  );
}
