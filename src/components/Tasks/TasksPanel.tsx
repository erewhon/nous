import { useEffect } from "react";
import { useTasksStore } from "../../stores/tasksStore";
import { TaskRow } from "./TaskRow";
import { TaskFilters } from "./TaskFilters";
import { TaskEditor } from "./TaskEditor";

export function TasksPanel() {
  const {
    currentView,
    summary,
    isPanelOpen,
    isEditorOpen,
    closePanel,
    setView,
    getFilteredTasks,
    getProjects,
    selectedProject,
    setSelectedProject,
    completeTask,
    deleteTask,
    openEditor,
  } = useTasksStore();

  const filteredTasks = isPanelOpen ? getFilteredTasks() : [];
  const projects = isPanelOpen ? getProjects() : [];

  // Escape to close panel
  useEffect(() => {
    if (!isPanelOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isEditorOpen) {
        closePanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPanelOpen, isEditorOpen, closePanel]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isEditorOpen) {
      closePanel();
    }
  };

  if (!isPanelOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={handleBackdropClick}
      >
        <div
          className="flex h-[80vh] w-full max-w-md flex-col rounded-xl border shadow-2xl"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between border-b px-4 py-3 shrink-0"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="flex items-center gap-3">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--color-accent)" }}
              >
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              <div>
                <h2
                  className="font-semibold"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Tasks
                </h2>
                <p
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {summary.totalTasks} active
                  {summary.overdueCount > 0 && ` \u00b7 ${summary.overdueCount} overdue`}
                  {summary.dueTodayCount > 0 && ` \u00b7 ${summary.dueTodayCount} today`}
                </p>
              </div>
            </div>
            <button
              onClick={closePanel}
              className="rounded p-1.5 transition-colors hover:bg-white/10"
              style={{ color: "var(--color-text-muted)" }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
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

          {/* Filters */}
          <TaskFilters
            currentView={currentView}
            onViewChange={setView}
            projects={projects}
            selectedProject={selectedProject}
            onProjectChange={setSelectedProject}
          />

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {filteredTasks.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-12 text-center px-4"
                style={{ color: "var(--color-text-muted)" }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mb-4 opacity-50"
                >
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <p className="text-sm font-medium">No tasks</p>
                <p className="text-xs mt-1">
                  {currentView === "today"
                    ? "Nothing due today"
                    : currentView === "upcoming"
                      ? "No upcoming tasks"
                      : "Add a task to get started"}
                </p>
              </div>
            ) : (
              <div>
                {filteredTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onComplete={() => completeTask(task.id)}
                    onEdit={() => openEditor(task)}
                    onDelete={() => {
                      if (confirm(`Delete "${task.title}"?`)) {
                        deleteTask(task.id);
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-between border-t px-4 py-3 shrink-0"
            style={{ borderColor: "var(--color-border)" }}
          >
            {summary.completedTodayCount > 0 ? (
              <span
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {summary.completedTodayCount} completed today
              </span>
            ) : (
              <div />
            )}
            <button
              onClick={() => openEditor()}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
              }}
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
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Task
            </button>
          </div>
        </div>
      </div>

      {/* Task Editor */}
      <TaskEditor />
    </>
  );
}
