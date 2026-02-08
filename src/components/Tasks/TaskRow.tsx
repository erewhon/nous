import type { Task } from "../../types/tasks";

function getTodayStr(): string {
  return new Date().toISOString().split("T")[0];
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#6b7280",
};

interface TaskRowProps {
  task: Task;
  onComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function TaskRow({ task, onComplete, onEdit, onDelete }: TaskRowProps) {
  const today = getTodayStr();
  const isCompleted = task.status === "completed";
  const isOverdue = !isCompleted && task.dueDate && task.dueDate < today;
  const isDueToday = !isCompleted && task.dueDate === today;

  return (
    <div
      className="border-b transition-colors hover:bg-white/5"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div className="flex items-center gap-3 p-3">
        {/* Checkbox */}
        <button
          onClick={onComplete}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors"
          style={{
            borderColor: isCompleted ? "var(--color-success)" : "var(--color-border)",
            backgroundColor: isCompleted ? "var(--color-success)" : "transparent",
          }}
          disabled={isCompleted}
        >
          {isCompleted && (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </button>

        {/* Priority dot */}
        <div
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: PRIORITY_COLORS[task.priority] }}
          title={task.priority}
        />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-sm truncate"
              style={{
                color: isCompleted ? "var(--color-text-muted)" : "var(--color-text-primary)",
                textDecoration: isCompleted ? "line-through" : "none",
              }}
            >
              {task.title}
            </span>
            {task.recurrence && (
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
                style={{ color: "var(--color-text-muted)", flexShrink: 0 }}
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            )}
          </div>
          {task.project && (
            <span
              className="text-[10px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              {task.project}
            </span>
          )}
        </div>

        {/* Due date badge */}
        {task.dueDate && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{
              backgroundColor: isOverdue
                ? "rgba(239, 68, 68, 0.15)"
                : isDueToday
                  ? "rgba(249, 115, 22, 0.15)"
                  : "rgba(59, 130, 246, 0.15)",
              color: isOverdue ? "#ef4444" : isDueToday ? "#f97316" : "#3b82f6",
            }}
          >
            {isOverdue
              ? "Overdue"
              : isDueToday
                ? "Today"
                : task.dueDate}
          </span>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="rounded p-1 transition-colors hover:bg-white/10"
            style={{ color: "var(--color-text-muted)" }}
            title="Edit"
          >
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
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            onClick={onDelete}
            className="rounded p-1 transition-colors hover:bg-red-500/20"
            style={{ color: "var(--color-text-muted)" }}
            title="Delete"
          >
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
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
