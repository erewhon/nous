import { create } from "zustand";
import type {
  Action,
  ActionCategory,
  ActionExecutionResult,
  ActionUpdate,
  ScheduledActionInfo,
  ActionExecutionProgress,
  StepProgress,
} from "../types/action";
import { STEP_TYPES } from "../types/action";
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
import { usePageStore } from "./pageStore";
import { useTemplateStore } from "./templateStore";
import type { EditorData } from "../types/page";

/**
 * After an action creates pages with a template_id, the backend only stores the
 * template_id as metadata — it can't apply the template content because templates
 * live in the frontend templateStore. This helper merges template blocks with any
 * existing blocks (e.g. carry forward items) for newly created pages.
 */
async function applyTemplatesForCreatedPages(createdPageIds: string[]) {
  if (createdPageIds.length === 0) return;

  const pages = usePageStore.getState().pages;
  const templates = useTemplateStore.getState().templates;

  for (const pageId of createdPageIds) {
    const page = pages.find((p) => p.id === pageId);
    if (!page?.templateId) continue;

    const template = templates.find((t) => t.id === page.templateId);
    if (!template || template.content.blocks.length === 0) continue;

    // Clone template blocks with new IDs
    const templateBlocks = template.content.blocks.map((block) => ({
      ...block,
      id: crypto.randomUUID(),
      data: { ...block.data },
    }));

    // Existing blocks on the page (e.g. carry forward items from the action)
    const existingBlocks = page.content?.blocks ?? [];

    // Merge: template blocks first, then existing blocks appended
    const mergedBlocks =
      existingBlocks.length > 0
        ? [...templateBlocks, ...existingBlocks]
        : templateBlocks;

    const mergedContent: EditorData = {
      time: Date.now(),
      version: template.content.version,
      blocks: mergedBlocks,
    };

    // Persist to backend
    await usePageStore.getState().updatePageContent(page.notebookId, pageId, mergedContent);

    // Update in store
    usePageStore.setState((state) => ({
      pages: state.pages.map((p) =>
        p.id === pageId ? { ...p, content: mergedContent } : p
      ),
      pageDataVersion: state.pageDataVersion + 1,
    }));
  }
}

interface ActionState {
  actions: Action[];
  scheduledActions: ScheduledActionInfo[];
  isLoading: boolean;
  error: string | null;
  selectedAction: Action | null;
  showActionLibrary: boolean;
  showActionEditor: boolean;
  editingActionId: string | null;
  viewOnlyMode: boolean;
  executionProgress: ActionExecutionProgress | null;
  showProgressDialog: boolean;
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

  // Duplicate
  duplicateAction: (actionId: string) => Promise<Action>;

  // UI state
  selectAction: (action: Action | null) => void;
  openActionLibrary: () => void;
  closeActionLibrary: () => void;
  openActionEditor: (actionId?: string, viewOnly?: boolean) => void;
  closeActionEditor: () => void;
  clearError: () => void;

  // Progress dialog
  runActionWithProgress: (
    actionId: string,
    options?: {
      variables?: Record<string, string>;
      currentNotebookId?: string;
    }
  ) => Promise<ActionExecutionResult>;
  closeProgressDialog: () => void;
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
  viewOnlyMode: false,
  executionProgress: null,
  showProgressDialog: false,

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
      // Reload any pages modified or created by the action so the editor
      // picks up backend changes instead of overwriting them on auto-save
      const affectedPages = [
        ...result.modifiedPages,
        ...result.createdPages,
      ];
      if (affectedPages.length > 0) {
        await usePageStore.getState().refreshPages(affectedPages);
      }
      // Apply template content for newly created pages (templates are frontend-only)
      await applyTemplatesForCreatedPages(result.createdPages);
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
      // Reload any pages modified or created by the action
      const affectedPages = [
        ...result.modifiedPages,
        ...result.createdPages,
      ];
      if (affectedPages.length > 0) {
        await usePageStore.getState().refreshPages(affectedPages);
      }
      // Apply template content for newly created pages (templates are frontend-only)
      await applyTemplatesForCreatedPages(result.createdPages);
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

  // Duplicate
  duplicateAction: async (actionId) => {
    const { actions } = get();
    const sourceAction = actions.find((a) => a.id === actionId);
    if (!sourceAction) {
      throw new Error("Action not found");
    }

    set({ isLoading: true, error: null });
    try {
      // Create a new action with copied properties
      const newAction = await createAction(
        `Copy of ${sourceAction.name}`,
        sourceAction.description,
        {
          category: "custom", // Duplicated actions always go to custom category
          triggers: sourceAction.triggers.map((t) => ({ ...t })),
          steps: sourceAction.steps.map((s) => ({ ...s })),
        }
      );
      set((state) => ({
        actions: [...state.actions, newAction],
        isLoading: false,
      }));
      return newAction;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to duplicate action",
        isLoading: false,
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

  openActionEditor: (actionId, viewOnly = false) => {
    set({
      showActionEditor: true,
      editingActionId: actionId || null,
      viewOnlyMode: viewOnly,
    });
  },

  closeActionEditor: () => {
    set({ showActionEditor: false, editingActionId: null, viewOnlyMode: false });
  },

  clearError: () => {
    set({ error: null });
  },

  // Progress dialog actions
  runActionWithProgress: async (actionId, options) => {
    const { actions } = get();
    const action = actions.find((a) => a.id === actionId);
    if (!action) {
      throw new Error("Action not found");
    }

    // Helper to get step display name
    const getStepName = (step: Action["steps"][0]): string => {
      const stepType = STEP_TYPES.find((s) => s.type === step.type);
      return stepType?.name || step.type;
    };

    // Initialize progress with all steps pending
    const steps: StepProgress[] = action.steps.map((step, index) => ({
      index,
      type: step.type,
      name: getStepName(step),
      status: "pending",
    }));

    const progress: ActionExecutionProgress = {
      actionId,
      actionName: action.name,
      steps,
      currentStepIndex: 0,
      isComplete: false,
      overallSuccess: false,
    };

    set({ executionProgress: progress, showProgressDialog: true, error: null });

    // Animate through steps (mark each as "running" briefly before executing)
    // This creates a visual progression effect
    const animateStep = async (stepIndex: number) => {
      set((state) => {
        if (!state.executionProgress) return state;
        const newSteps = [...state.executionProgress.steps];
        newSteps[stepIndex] = { ...newSteps[stepIndex], status: "running" };
        return {
          executionProgress: {
            ...state.executionProgress,
            steps: newSteps,
            currentStepIndex: stepIndex,
          },
        };
      });
      // Brief delay to show "running" state
      await new Promise((resolve) => setTimeout(resolve, 200));
    };

    try {
      // Animate steps as running one by one
      for (let i = 0; i < steps.length; i++) {
        await animateStep(i);
        // Mark previous step as completed
        if (i > 0) {
          set((state) => {
            if (!state.executionProgress) return state;
            const newSteps = [...state.executionProgress.steps];
            newSteps[i - 1] = { ...newSteps[i - 1], status: "completed" };
            return {
              executionProgress: {
                ...state.executionProgress,
                steps: newSteps,
              },
            };
          });
        }
      }

      // Execute the actual action
      const result = await runAction(actionId, options);

      // Update final state based on result
      set((state) => {
        if (!state.executionProgress) return state;
        const newSteps = state.executionProgress.steps.map((step, idx) => ({
          ...step,
          status:
            idx < result.stepsCompleted
              ? ("completed" as const)
              : result.errors.length > 0 && idx === result.stepsCompleted
                ? ("error" as const)
                : ("pending" as const),
          error:
            idx === result.stepsCompleted && result.errors.length > 0
              ? result.errors[0]
              : undefined,
        }));

        return {
          executionProgress: {
            ...state.executionProgress,
            steps: newSteps,
            isComplete: true,
            overallSuccess: result.success,
            result,
          },
        };
      });

      // Refresh actions to update last_run time
      await get().loadActions();

      // Reload any pages modified or created by the action
      const affectedPages = [...result.modifiedPages, ...result.createdPages];
      if (affectedPages.length > 0) {
        await usePageStore.getState().refreshPages(affectedPages);
      }

      // Apply template content for newly created pages (templates are frontend-only)
      await applyTemplatesForCreatedPages(result.createdPages);

      return result;
    } catch (error) {
      // Update progress to show error
      set((state) => {
        if (!state.executionProgress) return state;
        const currentIdx = state.executionProgress.currentStepIndex;
        const newSteps = state.executionProgress.steps.map((step, idx) => ({
          ...step,
          status:
            idx < currentIdx
              ? ("completed" as const)
              : idx === currentIdx
                ? ("error" as const)
                : ("pending" as const),
          error:
            idx === currentIdx
              ? error instanceof Error
                ? error.message
                : "Unknown error"
              : undefined,
        }));

        return {
          executionProgress: {
            ...state.executionProgress,
            steps: newSteps,
            isComplete: true,
            overallSuccess: false,
          },
          error:
            error instanceof Error ? error.message : "Failed to run action",
        };
      });
      throw error;
    }
  },

  closeProgressDialog: () => {
    set({ showProgressDialog: false, executionProgress: null });
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
