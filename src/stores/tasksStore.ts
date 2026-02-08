import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Task, TaskView, TaskSummary, CreateTaskRequest, UpdateTaskRequest, RecurrencePattern } from "../types/tasks";

function getTodayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function getNextRecurrence(dueDate: string, recurrence: RecurrencePattern): string | null {
  const date = new Date(dueDate + "T00:00:00");

  switch (recurrence.type) {
    case "daily":
      date.setDate(date.getDate() + recurrence.interval);
      break;
    case "weekly":
      date.setDate(date.getDate() + 7 * recurrence.interval);
      break;
    case "monthly":
      date.setMonth(date.getMonth() + recurrence.interval);
      break;
    case "yearly":
      date.setFullYear(date.getFullYear() + recurrence.interval);
      break;
  }

  const nextDate = date.toISOString().split("T")[0];

  if (recurrence.endDate && nextDate > recurrence.endDate) {
    return null;
  }

  return nextDate;
}

const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };

function computeSummary(tasks: Task[]): TaskSummary {
  const today = getTodayStr();
  const activeTasks = tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled");

  return {
    totalTasks: activeTasks.length,
    dueTodayCount: activeTasks.filter((t) => t.dueDate === today).length,
    overdueCount: activeTasks.filter((t) => t.dueDate && t.dueDate < today).length,
    completedTodayCount: tasks.filter((t) => t.status === "completed" && t.completedAt?.startsWith(today)).length,
  };
}

interface TasksState {
  tasks: Task[];
  currentView: TaskView;
  selectedProject: string | null;
  summary: TaskSummary;
  isPanelOpen: boolean;
  isEditorOpen: boolean;
  editingTask: Task | null;
  notificationsEnabled: boolean;
  lastReminderCheck: string;

  // CRUD
  createTask: (req: CreateTaskRequest) => void;
  updateTask: (id: string, req: UpdateTaskRequest) => void;
  deleteTask: (id: string) => void;
  completeTask: (id: string) => void;

  // Views
  setView: (view: TaskView) => void;
  setSelectedProject: (project: string | null) => void;
  getFilteredTasks: () => Task[];
  getProjects: () => string[];

  // Panel
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  openEditor: (task?: Task) => void;
  closeEditor: () => void;

  // Reminders
  checkReminders: () => void;
  setNotificationsEnabled: (enabled: boolean) => void;
}

export const useTasksStore = create<TasksState>()(
  persist(
    (set, get) => ({
      tasks: [],
      currentView: "today",
      selectedProject: null,
      summary: { totalTasks: 0, dueTodayCount: 0, overdueCount: 0, completedTodayCount: 0 },
      isPanelOpen: false,
      isEditorOpen: false,
      editingTask: null,
      notificationsEnabled: false,
      lastReminderCheck: "",

      createTask: (req) => {
        const now = new Date().toISOString();
        const task: Task = {
          id: crypto.randomUUID(),
          title: req.title,
          description: req.description,
          status: "todo",
          priority: req.priority ?? "medium",
          dueDate: req.dueDate,
          dueTime: req.dueTime,
          project: req.project,
          tags: req.tags ?? [],
          recurrence: req.recurrence,
          createdAt: now,
          updatedAt: now,
        };
        const tasks = [...get().tasks, task];
        set({ tasks, summary: computeSummary(tasks) });
      },

      updateTask: (id, req) => {
        const tasks = get().tasks.map((t) => {
          if (t.id !== id) return t;
          return { ...t, ...req, updatedAt: new Date().toISOString() };
        });
        set({ tasks, summary: computeSummary(tasks) });
      },

      deleteTask: (id) => {
        const tasks = get().tasks.filter((t) => t.id !== id);
        set({ tasks, summary: computeSummary(tasks) });
      },

      completeTask: (id) => {
        const state = get();
        const task = state.tasks.find((t) => t.id === id);
        if (!task) return;

        const now = new Date().toISOString();
        let tasks = state.tasks.map((t) => {
          if (t.id !== id) return t;
          return { ...t, status: "completed" as const, completedAt: now, updatedAt: now };
        });

        // Handle recurrence
        if (task.recurrence && task.dueDate) {
          const nextDate = getNextRecurrence(task.dueDate, task.recurrence);
          if (nextDate) {
            const nextTask: Task = {
              id: crypto.randomUUID(),
              title: task.title,
              description: task.description,
              status: "todo",
              priority: task.priority,
              dueDate: nextDate,
              dueTime: task.dueTime,
              project: task.project,
              tags: [...task.tags],
              recurrence: task.recurrence,
              parentTaskId: task.id,
              createdAt: now,
              updatedAt: now,
            };
            tasks = [...tasks, nextTask];
          }
        }

        set({ tasks, summary: computeSummary(tasks) });
      },

      setView: (currentView) => set({ currentView }),
      setSelectedProject: (selectedProject) => set({ selectedProject }),

      getFilteredTasks: () => {
        const { tasks, currentView, selectedProject } = get();
        const today = getTodayStr();
        const active = tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled");

        let filtered: Task[];
        switch (currentView) {
          case "today":
            filtered = active.filter((t) => t.dueDate === today || (t.dueDate && t.dueDate < today));
            break;
          case "upcoming":
            filtered = active.filter((t) => t.dueDate && t.dueDate >= today);
            break;
          case "by_project":
            filtered = selectedProject ? active.filter((t) => t.project === selectedProject) : active;
            break;
          case "by_priority":
            filtered = [...active].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
            return filtered;
          case "all":
          default:
            filtered = active;
            break;
        }

        // Sort by dueDate (nulls last), then by priority
        return filtered.sort((a, b) => {
          if (a.dueDate && b.dueDate) {
            const dateCompare = a.dueDate.localeCompare(b.dueDate);
            if (dateCompare !== 0) return dateCompare;
          } else if (a.dueDate) return -1;
          else if (b.dueDate) return 1;
          return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        });
      },

      getProjects: () => {
        const projects = new Set<string>();
        for (const t of get().tasks) {
          if (t.project) projects.add(t.project);
        }
        return Array.from(projects).sort();
      },

      openPanel: () => {
        set({ isPanelOpen: true, summary: computeSummary(get().tasks) });
      },
      closePanel: () => set({ isPanelOpen: false, isEditorOpen: false, editingTask: null }),
      togglePanel: () => {
        const state = get();
        if (state.isPanelOpen) {
          state.closePanel();
        } else {
          state.openPanel();
        }
      },
      openEditor: (task) => set({ isEditorOpen: true, editingTask: task ?? null }),
      closeEditor: () => set({ isEditorOpen: false, editingTask: null }),

      checkReminders: () => {
        const state = get();
        if (!state.notificationsEnabled) return;

        const today = getTodayStr();
        if (state.lastReminderCheck === today) return;

        const active = state.tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled");
        const overdue = active.filter((t) => t.dueDate && t.dueDate < today);
        const dueToday = active.filter((t) => t.dueDate === today);

        if (overdue.length > 0 || dueToday.length > 0) {
          if ("Notification" in window && Notification.permission === "granted") {
            const parts: string[] = [];
            if (overdue.length > 0) parts.push(`${overdue.length} overdue`);
            if (dueToday.length > 0) parts.push(`${dueToday.length} due today`);
            new Notification("Tasks", { body: parts.join(", ") });
          }
        }

        set({ lastReminderCheck: today });
      },

      setNotificationsEnabled: (enabled) => {
        if (enabled && "Notification" in window && Notification.permission === "default") {
          Notification.requestPermission();
        }
        set({ notificationsEnabled: enabled });
      },
    }),
    {
      name: "katt-tasks",
      partialize: (state) => ({
        tasks: state.tasks,
        currentView: state.currentView,
        notificationsEnabled: state.notificationsEnabled,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.summary = computeSummary(state.tasks);
        }
      },
    }
  )
);
