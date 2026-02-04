import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Page } from "../types/page";
import {
  getDailyNote,
  createDailyNote,
  listDailyNotes,
  getOrCreateTodayDailyNote,
} from "../utils/api";

// Settings for Daily Notes feature
interface DailyNotesSettings {
  useTemplate: boolean; // Whether to use a template when creating daily notes
  templateId: string | null; // Which template to use (null = no template)
}

const DEFAULT_SETTINGS: DailyNotesSettings = {
  useTemplate: false,
  templateId: "daily-journal", // Default to daily-journal when enabled
};

interface DailyNotesState {
  isPanelOpen: boolean;
  isLoading: boolean;
  error: string | null;
  selectedDate: string; // "YYYY-MM-DD" format
  dailyNotes: Page[]; // List of daily notes for current month
  currentDailyNote: Page | null; // The note for selected date
  datesWithNotes: Set<string>; // Quick lookup for calendar dots
  settings: DailyNotesSettings;
}

interface DailyNotesActions {
  // Panel state
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;

  // Date navigation
  selectDate: (date: string) => void;
  goToToday: () => void;
  goToPreviousDay: () => void;
  goToNextDay: () => void;

  // Data loading
  loadDailyNotes: (notebookId: string, month?: string) => Promise<void>;
  loadDailyNoteForDate: (notebookId: string, date: string) => Promise<Page | null>;

  // Note operations
  openOrCreateDailyNote: (notebookId: string, date?: string) => Promise<Page>;
  openTodayNote: (notebookId: string) => Promise<Page>;

  // Settings
  setUseTemplate: (useTemplate: boolean) => void;
  setTemplateId: (templateId: string | null) => void;

  // Error handling
  clearError: () => void;
}

type DailyNotesStore = DailyNotesState & DailyNotesActions;

// Helper to get today's date in YYYY-MM-DD format
function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

// Helper to get month range
function getMonthRange(date: string): { startDate: string; endDate: string } {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth();
  const startDate = new Date(year, month, 1).toISOString().split("T")[0];
  const endDate = new Date(year, month + 1, 0).toISOString().split("T")[0];
  return { startDate, endDate };
}

// Helper to add days to a date
function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

export const useDailyNotesStore = create<DailyNotesStore>()(
  persist(
    (set, get) => ({
      // Initial state
      isPanelOpen: false,
      isLoading: false,
      error: null,
      selectedDate: getTodayDate(),
      dailyNotes: [],
      currentDailyNote: null,
      datesWithNotes: new Set(),
      settings: DEFAULT_SETTINGS,

  // Panel state
  openPanel: () => set({ isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false }),
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),

  // Date navigation
  selectDate: (date: string) => set({ selectedDate: date }),

  goToToday: () => set({ selectedDate: getTodayDate() }),

  goToPreviousDay: () => {
    const { selectedDate } = get();
    set({ selectedDate: addDays(selectedDate, -1) });
  },

  goToNextDay: () => {
    const { selectedDate } = get();
    set({ selectedDate: addDays(selectedDate, 1) });
  },

  // Data loading
  loadDailyNotes: async (notebookId: string, month?: string) => {
    set({ isLoading: true, error: null });
    try {
      const targetDate = month || get().selectedDate;
      const { startDate, endDate } = getMonthRange(targetDate);
      const notes = await listDailyNotes(notebookId, startDate, endDate);

      // Build set of dates that have notes
      const datesWithNotes = new Set<string>();
      for (const note of notes) {
        if (note.dailyNoteDate) {
          datesWithNotes.add(note.dailyNoteDate);
        }
      }

      set({
        dailyNotes: notes,
        datesWithNotes,
        isLoading: false,
      });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  loadDailyNoteForDate: async (notebookId: string, date: string) => {
    try {
      const note = await getDailyNote(notebookId, date);
      set({ currentDailyNote: note });
      return note;
    } catch (err) {
      set({ error: String(err) });
      return null;
    }
  },

      // Note operations
      openOrCreateDailyNote: async (notebookId: string, date?: string) => {
        const targetDate = date || get().selectedDate;
        const { settings } = get();
        set({ isLoading: true, error: null });

        try {
          // First check if note exists
          let note = await getDailyNote(notebookId, targetDate);

          if (!note) {
            // Create new daily note, optionally with template
            const templateId = settings.useTemplate && settings.templateId ? settings.templateId : undefined;
            note = await createDailyNote(notebookId, targetDate, templateId);

            // Update datesWithNotes set
            set((state) => {
              const newDatesWithNotes = new Set(state.datesWithNotes);
              newDatesWithNotes.add(targetDate);
              return {
                datesWithNotes: newDatesWithNotes,
                dailyNotes: [...state.dailyNotes, note!].sort((a, b) =>
                  (b.dailyNoteDate || "").localeCompare(a.dailyNoteDate || "")
                ),
              };
            });
          }

          set({
            currentDailyNote: note,
            selectedDate: targetDate,
            isLoading: false,
          });

          return note;
        } catch (err) {
          set({ error: String(err), isLoading: false });
          throw err;
        }
      },

      openTodayNote: async (notebookId: string) => {
        const { settings } = get();
        set({ isLoading: true, error: null });

        try {
          const templateId = settings.useTemplate && settings.templateId ? settings.templateId : undefined;
          const note = await getOrCreateTodayDailyNote(notebookId, templateId);
          const today = getTodayDate();

          // Update datesWithNotes set
          set((state) => {
            const newDatesWithNotes = new Set(state.datesWithNotes);
            newDatesWithNotes.add(today);
            return { datesWithNotes: newDatesWithNotes };
          });

          set({
            currentDailyNote: note,
            selectedDate: today,
            isLoading: false,
          });

          return note;
        } catch (err) {
          set({ error: String(err), isLoading: false });
          throw err;
        }
      },

      // Settings
      setUseTemplate: (useTemplate: boolean) =>
        set((state) => ({
          settings: { ...state.settings, useTemplate },
        })),

      setTemplateId: (templateId: string | null) =>
        set((state) => ({
          settings: { ...state.settings, templateId },
        })),

      // Error handling
      clearError: () => set({ error: null }),
    }),
    {
      name: "daily-notes-settings",
      partialize: (state) => ({
        settings: state.settings,
      }),
    }
  )
);
