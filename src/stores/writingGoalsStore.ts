import { create } from "zustand";
import { persist } from "zustand/middleware";

export type GoalPeriod = "daily" | "session";

interface DayHistory {
  date: string; // "YYYY-MM-DD"
  words: number;
}

interface WritingGoalsState {
  enabled: boolean;
  targetWords: number;
  period: GoalPeriod;
  todayWords: number;
  todayDate: string; // "YYYY-MM-DD" — reset when date changes
  sessionStartWords: number;
  history: DayHistory[];
  // Computed
  streak: number;
  // Actions
  setEnabled: (enabled: boolean) => void;
  setTargetWords: (target: number) => void;
  setPeriod: (period: GoalPeriod) => void;
  updateProgress: (currentWords: number) => void;
  resetSession: () => void;
}

function getTodayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function computeStreak(history: DayHistory[], targetWords: number): number {
  if (history.length === 0) return 0;

  // Sort by date descending
  const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
  let streak = 0;

  // Start from today or yesterday
  const today = getTodayStr();
  const startIdx = sorted[0].date === today ? 0 : -1;

  if (startIdx === -1) {
    // Today not recorded yet — check if yesterday starts the streak
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];
    if (sorted[0].date !== yesterdayStr) return 0;
  }

  const idx = startIdx === -1 ? 0 : 0;
  let expectedDate = new Date(sorted[idx].date);

  for (let i = idx; i < sorted.length; i++) {
    const entryDate = sorted[i].date;
    const expected = expectedDate.toISOString().split("T")[0];

    if (entryDate !== expected) break;
    if (sorted[i].words >= targetWords) {
      streak++;
      expectedDate.setDate(expectedDate.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

export const useWritingGoalsStore = create<WritingGoalsState>()(
  persist(
    (set, get) => ({
      enabled: false,
      targetWords: 500,
      period: "daily" as GoalPeriod,
      todayWords: 0,
      todayDate: getTodayStr(),
      sessionStartWords: 0,
      history: [] as DayHistory[],
      streak: 0,

      setEnabled: (enabled) => set({ enabled }),

      setTargetWords: (targetWords) => {
        set({ targetWords });
        // Recompute streak
        const { history } = get();
        set({ streak: computeStreak(history, targetWords) });
      },

      setPeriod: (period) => set({ period }),

      updateProgress: (currentWords) => {
        const state = get();
        const today = getTodayStr();

        // Reset if new day
        if (state.todayDate !== today) {
          // Save yesterday's count to history if it was meaningful
          if (state.todayWords > 0) {
            const existingIdx = state.history.findIndex(
              (h) => h.date === state.todayDate
            );
            let newHistory: DayHistory[];
            if (existingIdx >= 0) {
              newHistory = [...state.history];
              newHistory[existingIdx] = {
                date: state.todayDate,
                words: Math.max(
                  state.todayWords,
                  newHistory[existingIdx].words
                ),
              };
            } else {
              newHistory = [
                ...state.history,
                { date: state.todayDate, words: state.todayWords },
              ];
            }
            // Keep last 90 days
            if (newHistory.length > 90) {
              newHistory = newHistory.slice(-90);
            }
            set({
              history: newHistory,
              todayDate: today,
              todayWords: currentWords,
              sessionStartWords: currentWords,
              streak: computeStreak(newHistory, state.targetWords),
            });
          } else {
            set({
              todayDate: today,
              todayWords: currentWords,
              sessionStartWords: currentWords,
            });
          }
          return;
        }

        // Update today's word count (track the max seen)
        const newTodayWords = Math.max(state.todayWords, currentWords);
        set({ todayWords: newTodayWords });
      },

      resetSession: () => {
        set((state) => ({ sessionStartWords: state.todayWords }));
      },
    }),
    {
      name: "katt-writing-goals",
      partialize: (state) => ({
        enabled: state.enabled,
        targetWords: state.targetWords,
        period: state.period,
        todayWords: state.todayWords,
        todayDate: state.todayDate,
        sessionStartWords: state.sessionStartWords,
        history: state.history,
        streak: state.streak,
      }),
    }
  )
);
