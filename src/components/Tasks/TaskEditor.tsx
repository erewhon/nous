import { useState, useEffect } from "react";
import { useTasksStore } from "../../stores/tasksStore";
import type { TaskPriority, RecurrencePattern } from "../../types/tasks";
import { RecurrenceEditor } from "./RecurrenceEditor";

const PRIORITY_OPTIONS: { value: TaskPriority; label: string; color: string }[] = [
  { value: "low", label: "Low", color: "#6b7280" },
  { value: "medium", label: "Med", color: "#eab308" },
  { value: "high", label: "High", color: "#f97316" },
  { value: "urgent", label: "Urgent", color: "#ef4444" },
];

export function TaskEditor() {
  const { isEditorOpen, editingTask, closeEditor, createTask, updateTask } = useTasksStore();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [project, setProject] = useState("");
  const [tags, setTags] = useState("");
  const [recurrence, setRecurrence] = useState<RecurrencePattern | undefined>(undefined);

  useEffect(() => {
    if (isEditorOpen) {
      if (editingTask) {
        setTitle(editingTask.title);
        setDescription(editingTask.description ?? "");
        setDueDate(editingTask.dueDate ?? "");
        setDueTime(editingTask.dueTime ?? "");
        setPriority(editingTask.priority);
        setProject(editingTask.project ?? "");
        setTags(editingTask.tags.join(", "));
        setRecurrence(editingTask.recurrence);
      } else {
        setTitle("");
        setDescription("");
        setDueDate("");
        setDueTime("");
        setPriority("medium");
        setProject("");
        setTags("");
        setRecurrence(undefined);
      }
    }
  }, [isEditorOpen, editingTask]);

  // Escape to close editor
  useEffect(() => {
    if (!isEditorOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeEditor();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEditorOpen, closeEditor]);

  if (!isEditorOpen) return null;

  const handleSave = () => {
    if (!title.trim()) return;

    const parsedTags = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    if (editingTask) {
      updateTask(editingTask.id, {
        title: title.trim(),
        description: description.trim() || undefined,
        dueDate: dueDate || undefined,
        dueTime: dueTime || undefined,
        priority,
        project: project.trim() || undefined,
        tags: parsedTags,
        recurrence,
      });
    } else {
      createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        dueDate: dueDate || undefined,
        dueTime: dueTime || undefined,
        priority,
        project: project.trim() || undefined,
        tags: parsedTags,
        recurrence,
      });
    }

    closeEditor();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      closeEditor();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-sm rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h3
            className="font-semibold text-sm"
            style={{ color: "var(--color-text-primary)" }}
          >
            {editingTask ? "Edit Task" : "New Task"}
          </h3>
          <button
            onClick={closeEditor}
            className="rounded p-1 transition-colors hover:bg-white/10"
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
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="space-y-3 p-4">
          {/* Title */}
          <input
            type="text"
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{
              backgroundColor: "var(--color-bg-primary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSave();
              }
            }}
          />

          {/* Description */}
          <textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border px-3 py-2 text-sm resize-none"
            style={{
              backgroundColor: "var(--color-bg-primary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />

          {/* Due date + time */}
          <div className="flex gap-2">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="flex-1 rounded-md border px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--color-bg-primary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
            <input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              className="w-28 rounded-md border px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--color-bg-primary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>

          {/* Priority */}
          <div>
            <label
              className="text-xs font-medium mb-1 block"
              style={{ color: "var(--color-text-muted)" }}
            >
              Priority
            </label>
            <div className="flex gap-1">
              {PRIORITY_OPTIONS.map(({ value, label, color }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPriority(value)}
                  className="rounded-md px-3 py-1 text-xs font-medium transition-colors"
                  style={{
                    backgroundColor: priority === value ? color : "var(--color-bg-primary)",
                    color: priority === value ? "white" : "var(--color-text-muted)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Project */}
          <input
            type="text"
            placeholder="Project (optional)"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{
              backgroundColor: "var(--color-bg-primary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />

          {/* Tags */}
          <input
            type="text"
            placeholder="Tags (comma-separated)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{
              backgroundColor: "var(--color-bg-primary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />

          {/* Recurrence */}
          <RecurrenceEditor value={recurrence} onChange={setRecurrence} />
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 border-t px-4 py-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={closeEditor}
            className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:bg-white/10"
            style={{ color: "var(--color-text-muted)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim()}
            className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "white",
            }}
          >
            {editingTask ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
