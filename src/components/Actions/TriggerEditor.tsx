import { useState } from "react";
import type { ActionTrigger, Schedule } from "../../types/action";
import { ScheduleEditor } from "./ScheduleEditor";

interface TriggerEditorProps {
  triggers: ActionTrigger[];
  onChange: (triggers: ActionTrigger[]) => void;
}

export function TriggerEditor({ triggers, onChange }: TriggerEditorProps) {
  const hasManual = triggers.some((t) => t.type === "manual");
  const hasAiChat = triggers.some((t) => t.type === "aiChat");
  const hasScheduled = triggers.some((t) => t.type === "scheduled");

  const addTrigger = (type: ActionTrigger["type"]) => {
    if (type === "manual" && !hasManual) {
      onChange([...triggers, { type: "manual" }]);
    } else if (type === "aiChat" && !hasAiChat) {
      onChange([...triggers, { type: "aiChat", keywords: [] }]);
    } else if (type === "scheduled" && !hasScheduled) {
      onChange([
        ...triggers,
        {
          type: "scheduled",
          schedule: { type: "daily", time: "09:00", skipWeekends: false },
        },
      ]);
    }
  };

  const removeTrigger = (index: number) => {
    onChange(triggers.filter((_, i) => i !== index));
  };

  const updateTrigger = (index: number, updated: ActionTrigger) => {
    onChange(triggers.map((t, i) => (i === index ? updated : t)));
  };

  return (
    <div className="space-y-4">
      <p
        className="text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        Choose when this action should be triggered. You can add multiple triggers.
      </p>

      {/* Current triggers */}
      <div className="space-y-3">
        {triggers.map((trigger, index) => (
          <TriggerCard
            key={index}
            trigger={trigger}
            onRemove={() => removeTrigger(index)}
            onUpdate={(updated) => updateTrigger(index, updated)}
          />
        ))}
      </div>

      {/* Add trigger buttons */}
      <div className="flex flex-wrap gap-2">
        {!hasManual && (
          <button
            onClick={() => addTrigger("manual")}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors hover:opacity-80"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            <IconPlus />
            <IconClick />
            Manual
          </button>
        )}
        {!hasAiChat && (
          <button
            onClick={() => addTrigger("aiChat")}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors hover:opacity-80"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            <IconPlus />
            <IconMessage />
            AI Chat
          </button>
        )}
        {!hasScheduled && (
          <button
            onClick={() => addTrigger("scheduled")}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors hover:opacity-80"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            <IconPlus />
            <IconClock />
            Scheduled
          </button>
        )}
      </div>

      {triggers.length === 0 && (
        <div
          className="rounded-lg border border-dashed p-4 text-center text-sm"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          Add at least one trigger to specify when this action runs
        </div>
      )}
    </div>
  );
}

interface TriggerCardProps {
  trigger: ActionTrigger;
  onRemove: () => void;
  onUpdate: (trigger: ActionTrigger) => void;
}

function TriggerCard({ trigger, onRemove, onUpdate }: TriggerCardProps) {
  const [keywordsInput, setKeywordsInput] = useState(
    trigger.type === "aiChat" ? trigger.keywords.join(", ") : ""
  );

  const handleKeywordsBlur = () => {
    if (trigger.type === "aiChat") {
      const keywords = keywordsInput
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
      onUpdate({ ...trigger, keywords });
    }
  };

  const handleScheduleChange = (schedule: Schedule) => {
    if (trigger.type === "scheduled") {
      onUpdate({ ...trigger, schedule });
    }
  };

  return (
    <div
      className="rounded-lg border p-4"
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {trigger.type === "manual" && (
            <>
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              >
                <IconClick />
              </div>
              <div>
                <div
                  className="font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Manual Trigger
                </div>
                <div
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Run via button or command palette
                </div>
              </div>
            </>
          )}
          {trigger.type === "aiChat" && (
            <>
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              >
                <IconMessage />
              </div>
              <div>
                <div
                  className="font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  AI Chat Trigger
                </div>
                <div
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Run when keywords are mentioned in AI chat
                </div>
              </div>
            </>
          )}
          {trigger.type === "scheduled" && (
            <>
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              >
                <IconClock />
              </div>
              <div>
                <div
                  className="font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Scheduled Trigger
                </div>
                <div
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Run automatically at specified times
                </div>
              </div>
            </>
          )}
        </div>
        <button
          onClick={onRemove}
          className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-500/10"
          title="Remove trigger"
        >
          <IconClose />
        </button>
      </div>

      {/* Trigger-specific content */}
      {trigger.type === "aiChat" && (
        <div className="space-y-2">
          <label
            className="block text-xs font-medium"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Keywords (comma separated)
          </label>
          <input
            type="text"
            value={keywordsInput}
            onChange={(e) => setKeywordsInput(e.target.value)}
            onBlur={handleKeywordsBlur}
            placeholder="e.g., daily goals, start my day, morning routine"
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
          <p
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            The AI will suggest running this action when these phrases are mentioned
          </p>
        </div>
      )}

      {trigger.type === "scheduled" && (
        <ScheduleEditor
          schedule={trigger.schedule}
          onChange={handleScheduleChange}
        />
      )}
    </div>
  );
}

// Icons
function IconPlus() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconClick() {
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
      style={{ color: "var(--color-text-muted)" }}
    >
      <path d="M9 9h.01" />
      <path d="M15 9h.01" />
      <path d="M9 15h.01" />
      <path d="M15 15h.01" />
      <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z" />
    </svg>
  );
}

function IconMessage() {
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
      style={{ color: "var(--color-text-muted)" }}
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconClock() {
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
      style={{ color: "var(--color-text-muted)" }}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconClose() {
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
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
