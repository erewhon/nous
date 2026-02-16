import { create } from "zustand";
import { persist } from "zustand/middleware";
import { localToday } from "../utils/dateLocal";

export type PomodoroMode = "work" | "shortBreak" | "longBreak";

interface PomodoroSettings {
  workDuration: number; // minutes
  shortBreakDuration: number;
  longBreakDuration: number;
  sessionsBeforeLongBreak: number;
  autoStartBreaks: boolean;
  showNotifications: boolean;
}

interface PomodoroState {
  isRunning: boolean;
  isPaused: boolean;
  mode: PomodoroMode;
  timeRemaining: number; // seconds
  currentSession: number; // 1-based
  settings: PomodoroSettings;
  todaySessions: number;
  todayDate: string;
  // Actions
  start: () => void;
  pause: () => void;
  resume: () => void;
  skip: () => void;
  reset: () => void;
  tick: () => void;
  updateSettings: (settings: Partial<PomodoroSettings>) => void;
}

function getTodayStr(): string {
  return localToday();
}

function getDurationForMode(mode: PomodoroMode, settings: PomodoroSettings): number {
  switch (mode) {
    case "work":
      return settings.workDuration * 60;
    case "shortBreak":
      return settings.shortBreakDuration * 60;
    case "longBreak":
      return settings.longBreakDuration * 60;
  }
}

function sendNotification(title: string, body: string) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

export const usePomodoroStore = create<PomodoroState>()(
  persist(
    (set, get) => ({
      isRunning: false,
      isPaused: false,
      mode: "work" as PomodoroMode,
      timeRemaining: 25 * 60,
      currentSession: 1,
      settings: {
        workDuration: 25,
        shortBreakDuration: 5,
        longBreakDuration: 15,
        sessionsBeforeLongBreak: 4,
        autoStartBreaks: false,
        showNotifications: true,
      },
      todaySessions: 0,
      todayDate: getTodayStr(),

      start: () => {
        const { settings } = get();
        // Request notification permission
        if (settings.showNotifications && "Notification" in window && Notification.permission === "default") {
          Notification.requestPermission();
        }
        set({
          isRunning: true,
          isPaused: false,
          mode: "work",
          timeRemaining: settings.workDuration * 60,
          currentSession: 1,
        });
      },

      pause: () => set({ isPaused: true }),
      resume: () => set({ isPaused: false }),

      skip: () => {
        const { mode, currentSession, settings } = get();
        if (mode === "work") {
          // Move to break
          const isLongBreak = currentSession % settings.sessionsBeforeLongBreak === 0;
          const nextMode: PomodoroMode = isLongBreak ? "longBreak" : "shortBreak";
          set({
            mode: nextMode,
            timeRemaining: getDurationForMode(nextMode, settings),
            isPaused: !settings.autoStartBreaks,
          });
        } else {
          // Move to work
          const nextSession = mode === "longBreak" ? 1 : currentSession + 1;
          set({
            mode: "work",
            timeRemaining: settings.workDuration * 60,
            currentSession: nextSession,
            isPaused: true,
          });
        }
      },

      reset: () => {
        const { settings } = get();
        set({
          isRunning: false,
          isPaused: false,
          mode: "work",
          timeRemaining: settings.workDuration * 60,
          currentSession: 1,
        });
      },

      tick: () => {
        const state = get();
        if (!state.isRunning || state.isPaused) return;

        const newTime = state.timeRemaining - 1;

        if (newTime <= 0) {
          // Session ended
          const today = getTodayStr();
          const todaySessions =
            state.todayDate !== today ? 0 : state.todaySessions;

          if (state.mode === "work") {
            // Work session completed
            const newSessions = todaySessions + 1;
            const isLongBreak =
              state.currentSession % state.settings.sessionsBeforeLongBreak === 0;
            const nextMode: PomodoroMode = isLongBreak ? "longBreak" : "shortBreak";

            if (state.settings.showNotifications) {
              sendNotification(
                "Work session complete!",
                isLongBreak
                  ? "Time for a long break."
                  : "Time for a short break."
              );
            }

            set({
              mode: nextMode,
              timeRemaining: getDurationForMode(nextMode, state.settings),
              todaySessions: newSessions,
              todayDate: today,
              isPaused: !state.settings.autoStartBreaks,
            });
          } else {
            // Break completed
            const nextSession =
              state.mode === "longBreak" ? 1 : state.currentSession + 1;

            if (state.settings.showNotifications) {
              sendNotification("Break over!", "Time to get back to work.");
            }

            set({
              mode: "work",
              timeRemaining: state.settings.workDuration * 60,
              currentSession: nextSession,
              todaySessions: todaySessions,
              todayDate: today,
              isPaused: true,
            });
          }
        } else {
          set({ timeRemaining: newTime });
        }
      },

      updateSettings: (newSettings) => {
        set((state) => {
          const settings = { ...state.settings, ...newSettings };
          // If not running, update time remaining to match new durations
          const timeRemaining = state.isRunning
            ? state.timeRemaining
            : getDurationForMode(state.mode, settings);
          return { settings, timeRemaining };
        });
      },
    }),
    {
      name: "katt-pomodoro",
      partialize: (state) => ({
        settings: state.settings,
        todaySessions: state.todaySessions,
        todayDate: state.todayDate,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Reset running state on load
          state.isRunning = false;
          state.isPaused = false;
          state.mode = "work";
          state.timeRemaining = state.settings.workDuration * 60;
          state.currentSession = 1;
          // Reset today sessions if date changed
          if (state.todayDate !== getTodayStr()) {
            state.todaySessions = 0;
            state.todayDate = getTodayStr();
          }
        }
      },
    }
  )
);
