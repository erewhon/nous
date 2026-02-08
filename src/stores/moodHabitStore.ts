import { create } from "zustand";
import { persist } from "zustand/middleware";

interface MoodHabitState {
  habitList: string[];
  showChart: boolean;
  // Actions
  addHabit: (name: string) => void;
  removeHabit: (name: string) => void;
  reorderHabits: (habits: string[]) => void;
  setShowChart: (show: boolean) => void;
}

export const useMoodHabitStore = create<MoodHabitState>()(
  persist(
    (set) => ({
      habitList: ["Exercise", "Reading", "Meditation"],
      showChart: false,

      addHabit: (name) =>
        set((state) => {
          if (state.habitList.includes(name)) return state;
          return { habitList: [...state.habitList, name] };
        }),

      removeHabit: (name) =>
        set((state) => ({
          habitList: state.habitList.filter((h) => h !== name),
        })),

      reorderHabits: (habits) => set({ habitList: habits }),

      setShowChart: (show) => set({ showChart: show }),
    }),
    {
      name: "katt-mood-habits",
      partialize: (state) => ({
        habitList: state.habitList,
      }),
    }
  )
);
