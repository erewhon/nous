import type { TaskView } from "../../types/tasks";

const VIEW_LABELS: { value: TaskView; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "by_project", label: "Projects" },
  { value: "by_priority", label: "Priority" },
  { value: "all", label: "All" },
];

interface TaskFiltersProps {
  currentView: TaskView;
  onViewChange: (view: TaskView) => void;
  projects: string[];
  selectedProject: string | null;
  onProjectChange: (project: string | null) => void;
}

export function TaskFilters({
  currentView,
  onViewChange,
  projects,
  selectedProject,
  onProjectChange,
}: TaskFiltersProps) {
  return (
    <div
      className="border-b px-4 py-2"
      style={{ borderColor: "var(--color-border)" }}
    >
      {/* View tabs */}
      <div className="flex gap-1">
        {VIEW_LABELS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onViewChange(value)}
            className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
            style={{
              backgroundColor: currentView === value ? "var(--color-accent)" : "transparent",
              color: currentView === value ? "white" : "var(--color-text-muted)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Project dropdown for project view */}
      {currentView === "by_project" && projects.length > 0 && (
        <div className="mt-2">
          <select
            value={selectedProject ?? ""}
            onChange={(e) => onProjectChange(e.target.value || null)}
            className="w-full rounded-md border px-2 py-1 text-xs"
            style={{
              backgroundColor: "var(--color-bg-primary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          >
            <option value="">All Projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
