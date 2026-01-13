import { create } from "zustand";
import type {
  Action,
  ActionCategory,
  ActionExecutionResult,
  ActionUpdate,
  ScheduledActionInfo,
} from "../types/action";
import {
  listActions,
  createAction,
  updateAction,
  deleteAction,
  runAction,
  runActionByName,
  findActionsByKeywords,
  getActionsByCategory,
  getScheduledActions,
  setActionEnabled,
} from "../utils/api";

interface ActionState {
  actions: Action[];
  scheduledActions: ScheduledActionInfo[];
  isLoading: boolean;
  error: string | null;
  selectedAction: Action | null;
  showActionLibrary: boolean;
  showActionEditor: boolean;
  editingActionId: string | null;
}

interface ActionActions {
  // Data fetching
  loadActions: () => Promise<void>;
  loadScheduledActions: () => Promise<void>;
  refreshActions: () => Promise<void>;

  // CRUD operations
  createAction: (
    name: string,
    description: string,
    options?: {
      category?: ActionCategory;
      triggers?: Action["triggers"];
      steps?: Action["steps"];
    }
  ) => Promise<Action>;
  updateAction: (actionId: string, updates: ActionUpdate) => Promise<Action>;
  deleteAction: (actionId: string) => Promise<void>;

  // Execution
  runAction: (
    actionId: string,
    options?: {
      variables?: Record<string, string>;
      currentNotebookId?: string;
    }
  ) => Promise<ActionExecutionResult>;
  runActionByName: (
    actionName: string,
    options?: {
      variables?: Record<string, string>;
      currentNotebookId?: string;
    }
  ) => Promise<ActionExecutionResult>;

  // Search and filter
  findByKeywords: (input: string) => Promise<Action[]>;
  getByCategory: (category: ActionCategory) => Promise<Action[]>;

  // Enable/disable
  setEnabled: (actionId: string, enabled: boolean) => Promise<Action>;

  // UI state
  selectAction: (action: Action | null) => void;
  openActionLibrary: () => void;
  closeActionLibrary: () => void;
  openActionEditor: (actionId?: string) => void;
  closeActionEditor: () => void;
  clearError: () => void;
}

type ActionStore = ActionState & ActionActions;

export const useActionStore = create<ActionStore>()((set, get) => ({
  // Initial state
  actions: [],
  scheduledActions: [],
  isLoading: false,
  error: null,
  selectedAction: null,
  showActionLibrary: false,
  showActionEditor: false,
  editingActionId: null,

  // Data fetching
  loadActions: async () => {
    set({ isLoading: true, error: null });
    try {
      const actions = await listActions();
      set({ actions, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to load actions",
        isLoading: false,
      });
    }
  },

  loadScheduledActions: async () => {
    try {
      const scheduledActions = await getScheduledActions();
      set({ scheduledActions });
    } catch (error) {
      console.error("Failed to load scheduled actions:", error);
    }
  },

  refreshActions: async () => {
    await get().loadActions();
    await get().loadScheduledActions();
  },

  // CRUD operations
  createAction: async (name, description, options) => {
    set({ isLoading: true, error: null });
    try {
      const action = await createAction(name, description, options);
      set((state) => ({
        actions: [...state.actions, action],
        isLoading: false,
      }));
      return action;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to create action",
        isLoading: false,
      });
      throw error;
    }
  },

  updateAction: async (actionId, updates) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await updateAction(actionId, updates);
      set((state) => ({
        actions: state.actions.map((a) => (a.id === actionId ? updated : a)),
        selectedAction:
          state.selectedAction?.id === actionId ? updated : state.selectedAction,
        isLoading: false,
      }));
      return updated;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to update action",
        isLoading: false,
      });
      throw error;
    }
  },

  deleteAction: async (actionId) => {
    set({ isLoading: true, error: null });
    try {
      await deleteAction(actionId);
      set((state) => ({
        actions: state.actions.filter((a) => a.id !== actionId),
        selectedAction:
          state.selectedAction?.id === actionId ? null : state.selectedAction,
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to delete action",
        isLoading: false,
      });
      throw error;
    }
  },

  // Execution
  runAction: async (actionId, options) => {
    set({ isLoading: true, error: null });
    try {
      const result = await runAction(actionId, options);
      // Refresh actions to update last_run time
      await get().loadActions();
      set({ isLoading: false });
      return result;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to run action",
        isLoading: false,
      });
      throw error;
    }
  },

  runActionByName: async (actionName, options) => {
    set({ isLoading: true, error: null });
    try {
      const result = await runActionByName(actionName, options);
      // Refresh actions to update last_run time
      await get().loadActions();
      set({ isLoading: false });
      return result;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to run action",
        isLoading: false,
      });
      throw error;
    }
  },

  // Search and filter
  findByKeywords: async (input) => {
    try {
      return await findActionsByKeywords(input);
    } catch (error) {
      console.error("Failed to find actions by keywords:", error);
      return [];
    }
  },

  getByCategory: async (category) => {
    try {
      return await getActionsByCategory(category);
    } catch (error) {
      console.error("Failed to get actions by category:", error);
      return [];
    }
  },

  // Enable/disable
  setEnabled: async (actionId, enabled) => {
    try {
      const updated = await setActionEnabled(actionId, enabled);
      set((state) => ({
        actions: state.actions.map((a) => (a.id === actionId ? updated : a)),
        selectedAction:
          state.selectedAction?.id === actionId ? updated : state.selectedAction,
      }));
      // Refresh scheduled actions since enable/disable affects scheduling
      await get().loadScheduledActions();
      return updated;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to update action",
      });
      throw error;
    }
  },

  // UI state
  selectAction: (action) => {
    set({ selectedAction: action });
  },

  openActionLibrary: () => {
    set({ showActionLibrary: true });
  },

  closeActionLibrary: () => {
    set({ showActionLibrary: false, selectedAction: null });
  },

  openActionEditor: (actionId) => {
    set({
      showActionEditor: true,
      editingActionId: actionId || null,
    });
  },

  closeActionEditor: () => {
    set({ showActionEditor: false, editingActionId: null });
  },

  clearError: () => {
    set({ error: null });
  },
}));

// Helper function to get actions by category from current state
export function getActionsByLocalCategory(
  actions: Action[],
  category: ActionCategory
): Action[] {
  return actions.filter((a) => a.category === category);
}

// Category display names
export const ACTION_CATEGORY_LABELS: Record<ActionCategory, string> = {
  agileResults: "Agile Results",
  dailyRoutines: "Daily Routines",
  weeklyReviews: "Weekly Reviews",
  organization: "Organization",
  custom: "Custom",
};

// Category icons
export const ACTION_CATEGORY_ICONS: Record<ActionCategory, string> = {
  agileResults: "target",
  dailyRoutines: "sun",
  weeklyReviews: "calendar",
  organization: "folder",
  custom: "settings",
};
