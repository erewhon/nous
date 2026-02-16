import { create } from "zustand";
import type {
  EnergyCheckIn,
  EnergyPattern,
  CreateCheckInRequest,
  UpdateCheckInRequest,
} from "../types/energy";
import {
  logEnergyCheckIn as apiLogCheckIn,
  getEnergyCheckIn,
  getEnergyCheckInsRange,
  updateEnergyCheckIn as apiUpdateCheckIn,
  deleteEnergyCheckIn as apiDeleteCheckIn,
  getEnergyPatterns,
} from "../utils/api";

/** YYYY-MM-DD in local time (NOT UTC). */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface EnergyState {
  checkIns: Map<string, EnergyCheckIn>;
  patterns: EnergyPattern | null;
  todayCheckIn: EnergyCheckIn | null;
  isLoading: boolean;
  error: string | null;
  isCheckInOpen: boolean;
  editingDate: string | null;
  isCalendarOpen: boolean;
}

interface EnergyActions {
  loadTodayCheckIn: () => Promise<void>;
  loadCheckInsRange: (start: string, end: string) => Promise<void>;
  loadPatterns: (start: string, end: string) => Promise<void>;
  submitCheckIn: (request: CreateCheckInRequest) => Promise<EnergyCheckIn>;
  updateCheckIn: (date: string, updates: UpdateCheckInRequest) => Promise<EnergyCheckIn>;
  deleteCheckIn: (date: string) => Promise<void>;
  openCheckIn: (date?: string) => void;
  closeCheckIn: () => void;
  openCalendar: () => void;
  closeCalendar: () => void;
  clearError: () => void;
}

type EnergyStore = EnergyState & EnergyActions;

export const useEnergyStore = create<EnergyStore>()((set) => ({
  // Initial state
  checkIns: new Map(),
  patterns: null,
  todayCheckIn: null,
  isLoading: false,
  error: null,
  isCheckInOpen: false,
  editingDate: null,
  isCalendarOpen: false,

  // Data fetching
  loadTodayCheckIn: async () => {
    try {
      const today = localToday();
      const checkIn = await getEnergyCheckIn(today);
      set({ todayCheckIn: checkIn });
      if (checkIn) {
        set((state) => {
          const newMap = new Map(state.checkIns);
          newMap.set(checkIn.date, checkIn);
          return { checkIns: newMap };
        });
      }
    } catch (err) {
      set({ error: String(err) });
    }
  },

  loadCheckInsRange: async (start: string, end: string) => {
    set({ isLoading: true, error: null });
    try {
      const checkIns = await getEnergyCheckInsRange(start, end);
      set((state) => {
        const newMap = new Map(state.checkIns);
        for (const c of checkIns) {
          newMap.set(c.date, c);
        }
        return { checkIns: newMap, isLoading: false };
      });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  loadPatterns: async (start: string, end: string) => {
    try {
      const patterns = await getEnergyPatterns(start, end);
      set({ patterns });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  submitCheckIn: async (request: CreateCheckInRequest) => {
    set({ isLoading: true, error: null });
    try {
      const checkIn = await apiLogCheckIn(request);
      const today = localToday();
      set((state) => {
        const newMap = new Map(state.checkIns);
        newMap.set(checkIn.date, checkIn);
        return {
          checkIns: newMap,
          todayCheckIn: checkIn.date === today ? checkIn : state.todayCheckIn,
          isLoading: false,
          isCheckInOpen: false,
          editingDate: null,
        };
      });
      return checkIn;
    } catch (err) {
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  updateCheckIn: async (date: string, updates: UpdateCheckInRequest) => {
    set({ isLoading: true, error: null });
    try {
      const checkIn = await apiUpdateCheckIn(date, updates);
      const today = localToday();
      set((state) => {
        const newMap = new Map(state.checkIns);
        newMap.set(checkIn.date, checkIn);
        return {
          checkIns: newMap,
          todayCheckIn: checkIn.date === today ? checkIn : state.todayCheckIn,
          isLoading: false,
          isCheckInOpen: false,
          editingDate: null,
        };
      });
      return checkIn;
    } catch (err) {
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  deleteCheckIn: async (date: string) => {
    set({ isLoading: true, error: null });
    try {
      await apiDeleteCheckIn(date);
      const today = localToday();
      set((state) => {
        const newMap = new Map(state.checkIns);
        newMap.delete(date);
        return {
          checkIns: newMap,
          todayCheckIn: date === today ? null : state.todayCheckIn,
          isLoading: false,
        };
      });
    } catch (err) {
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  // UI state
  openCheckIn: (date?: string) =>
    set({ isCheckInOpen: true, editingDate: date || null }),
  closeCheckIn: () => set({ isCheckInOpen: false, editingDate: null }),
  openCalendar: () => set({ isCalendarOpen: true }),
  closeCalendar: () => set({ isCalendarOpen: false }),
  clearError: () => set({ error: null }),
}));
