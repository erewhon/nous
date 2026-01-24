import { create } from "zustand";
import type {
  Goal,
  GoalProgress,
  GoalStats,
  GoalsSummary,
  CreateGoalRequest,
  UpdateGoalRequest,
} from "../types/goals";
import {
  listActiveGoals,
  createGoal as apiCreateGoal,
  updateGoal as apiUpdateGoal,
  deleteGoal as apiDeleteGoal,
  archiveGoal as apiArchiveGoal,
  getGoalStats,
  getGoalProgress,
  toggleGoalToday as apiToggleGoalToday,
  checkAutoGoals as apiCheckAutoGoals,
  getGoalsSummary,
} from "../utils/api";

interface GoalsState {
  goals: Goal[];
  stats: Map<string, GoalStats>;
  todayProgress: Map<string, GoalProgress>;
  summary: GoalsSummary | null;
  isLoading: boolean;
  error: string | null;
  isPanelOpen: boolean;
  isDashboardOpen: boolean;
  editingGoal: Goal | null;
  isEditorOpen: boolean;
}

interface GoalsActions {
  // Data fetching
  loadGoals: () => Promise<void>;
  loadStats: (goalId: string) => Promise<GoalStats>;
  loadAllStats: () => Promise<void>;
  loadSummary: () => Promise<void>;
  loadProgress: (goalId: string, startDate: string, endDate: string) => Promise<GoalProgress[]>;

  // CRUD operations
  createGoal: (request: CreateGoalRequest) => Promise<Goal>;
  updateGoal: (id: string, updates: UpdateGoalRequest) => Promise<Goal>;
  deleteGoal: (id: string) => Promise<void>;
  archiveGoal: (id: string) => Promise<void>;

  // Progress tracking
  toggleCompletion: (goalId: string) => Promise<void>;
  checkAutoGoals: () => Promise<void>;

  // UI state
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  openDashboard: () => void;
  closeDashboard: () => void;
  openEditor: (goal?: Goal) => void;
  closeEditor: () => void;
  clearError: () => void;
}

type GoalsStore = GoalsState & GoalsActions;

export const useGoalsStore = create<GoalsStore>()((set, get) => ({
  // Initial state
  goals: [],
  stats: new Map(),
  todayProgress: new Map(),
  summary: null,
  isLoading: false,
  error: null,
  isPanelOpen: false,
  isDashboardOpen: false,
  editingGoal: null,
  isEditorOpen: false,

  // Data fetching
  loadGoals: async () => {
    set({ isLoading: true, error: null });
    try {
      const goals = await listActiveGoals();
      set({ goals, isLoading: false });
      // Also load stats for all goals
      get().loadAllStats();
      get().loadSummary();
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  loadStats: async (goalId: string) => {
    try {
      const stats = await getGoalStats(goalId);
      set((state) => {
        const newStats = new Map(state.stats);
        newStats.set(goalId, stats);
        return { stats: newStats };
      });
      return stats;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  loadAllStats: async () => {
    const { goals } = get();
    try {
      await Promise.all(goals.map((goal) => get().loadStats(goal.id)));
    } catch (err) {
      // Individual errors are handled in loadStats
    }
  },

  loadSummary: async () => {
    try {
      const summary = await getGoalsSummary();
      set({ summary });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  loadProgress: async (goalId: string, startDate: string, endDate: string) => {
    try {
      const progress = await getGoalProgress(goalId, startDate, endDate);
      return progress;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  // CRUD operations
  createGoal: async (request: CreateGoalRequest) => {
    set({ isLoading: true, error: null });
    try {
      const goal = await apiCreateGoal(request);
      set((state) => ({
        goals: [...state.goals, goal],
        isLoading: false,
        isEditorOpen: false,
        editingGoal: null,
      }));
      get().loadStats(goal.id);
      get().loadSummary();
      return goal;
    } catch (err) {
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  updateGoal: async (id: string, updates: UpdateGoalRequest) => {
    set({ isLoading: true, error: null });
    try {
      const goal = await apiUpdateGoal(id, updates);
      set((state) => ({
        goals: state.goals.map((g) => (g.id === id ? goal : g)),
        isLoading: false,
        isEditorOpen: false,
        editingGoal: null,
      }));
      get().loadStats(id);
      return goal;
    } catch (err) {
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  deleteGoal: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await apiDeleteGoal(id);
      set((state) => ({
        goals: state.goals.filter((g) => g.id !== id),
        isLoading: false,
      }));
      get().loadSummary();
    } catch (err) {
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  archiveGoal: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await apiArchiveGoal(id);
      set((state) => ({
        goals: state.goals.filter((g) => g.id !== id),
        isLoading: false,
      }));
      get().loadSummary();
    } catch (err) {
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  // Progress tracking
  toggleCompletion: async (goalId: string) => {
    try {
      const progress = await apiToggleGoalToday(goalId);
      set((state) => {
        const newProgress = new Map(state.todayProgress);
        newProgress.set(goalId, progress);
        return { todayProgress: newProgress };
      });
      // Refresh stats after toggling
      get().loadStats(goalId);
      get().loadSummary();
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  checkAutoGoals: async () => {
    try {
      const progress = await apiCheckAutoGoals();
      set((state) => {
        const newProgress = new Map(state.todayProgress);
        for (const p of progress) {
          newProgress.set(p.goalId, p);
        }
        return { todayProgress: newProgress };
      });
      // Refresh stats after checking auto goals
      get().loadAllStats();
      get().loadSummary();
    } catch (err) {
      set({ error: String(err) });
    }
  },

  // UI state
  openPanel: () => set({ isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false }),
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
  openDashboard: () => set({ isDashboardOpen: true }),
  closeDashboard: () => set({ isDashboardOpen: false }),
  openEditor: (goal?: Goal) => set({ isEditorOpen: true, editingGoal: goal || null }),
  closeEditor: () => set({ isEditorOpen: false, editingGoal: null }),
  clearError: () => set({ error: null }),
}));
