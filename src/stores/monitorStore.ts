import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import type {
  MonitorTarget,
  CaptureEvent,
  WindowInfo,
  CreateTargetRequest,
  UpdateTargetRequest,
} from "../types/monitor";
import {
  monitorListTargets,
  monitorCreateTarget,
  monitorUpdateTarget,
  monitorDeleteTarget,
  monitorCaptureNow,
  monitorListEvents,
  monitorMarkRead,
  monitorDismissEvent,
  monitorStart,
  monitorStop,
  monitorListWindows,
  monitorUnreadCount,
} from "../utils/api";

interface MonitorState {
  targets: MonitorTarget[];
  events: CaptureEvent[];
  isRunning: boolean;
  isLoading: boolean;
  error: string | null;
  showMonitorPanel: boolean;
  selectedTargetId: string | null;
  availableWindows: WindowInfo[];
  unreadCount: number;
}

interface MonitorActions {
  loadTargets: () => Promise<void>;
  createTarget: (request: CreateTargetRequest) => Promise<MonitorTarget>;
  updateTarget: (
    targetId: string,
    request: UpdateTargetRequest
  ) => Promise<void>;
  deleteTarget: (targetId: string) => Promise<void>;
  captureNow: (targetId: string) => Promise<void>;
  loadEvents: (targetId?: string, limit?: number) => Promise<void>;
  markRead: (eventId: string) => Promise<void>;
  dismissEvent: (eventId: string) => Promise<void>;
  startMonitoring: () => Promise<void>;
  stopMonitoring: () => Promise<void>;
  discoverWindows: () => Promise<void>;
  loadUnreadCount: () => Promise<void>;
  openMonitorPanel: () => void;
  closeMonitorPanel: () => void;
  toggleMonitorPanel: () => void;
  setSelectedTargetId: (id: string | null) => void;
  initEventListener: () => () => void;
}

type MonitorStore = MonitorState & MonitorActions;

export const useMonitorStore = create<MonitorStore>()((set, get) => ({
  // State
  targets: [],
  events: [],
  isRunning: false,
  isLoading: false,
  error: null,
  showMonitorPanel: false,
  selectedTargetId: null,
  availableWindows: [],
  unreadCount: 0,

  // Actions
  loadTargets: async () => {
    set({ isLoading: true, error: null });
    try {
      const targets = await monitorListTargets();
      set({ targets, isLoading: false });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  createTarget: async (request) => {
    const target = await monitorCreateTarget(request);
    set((state) => ({ targets: [...state.targets, target] }));
    return target;
  },

  updateTarget: async (targetId, request) => {
    const updated = await monitorUpdateTarget(targetId, request);
    set((state) => ({
      targets: state.targets.map((t) => (t.id === targetId ? updated : t)),
    }));
  },

  deleteTarget: async (targetId) => {
    await monitorDeleteTarget(targetId);
    set((state) => ({
      targets: state.targets.filter((t) => t.id !== targetId),
      events: state.events.filter((e) => e.targetId !== targetId),
    }));
  },

  captureNow: async (targetId) => {
    await monitorCaptureNow(targetId);
  },

  loadEvents: async (targetId, limit) => {
    set({ isLoading: true, error: null });
    try {
      const events = await monitorListEvents(targetId, limit);
      set({ events, isLoading: false });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  markRead: async (eventId) => {
    await monitorMarkRead(eventId);
    set((state) => ({
      events: state.events.map((e) =>
        e.id === eventId ? { ...e, isRead: true } : e
      ),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));
  },

  dismissEvent: async (eventId) => {
    const event = get().events.find((e) => e.id === eventId);
    await monitorDismissEvent(eventId);
    set((state) => ({
      events: state.events.filter((e) => e.id !== eventId),
      unreadCount:
        event && !event.isRead
          ? Math.max(0, state.unreadCount - 1)
          : state.unreadCount,
    }));
  },

  startMonitoring: async () => {
    try {
      await monitorStart();
      set({ isRunning: true });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  stopMonitoring: async () => {
    try {
      await monitorStop();
      set({ isRunning: false });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  discoverWindows: async () => {
    try {
      const windows = await monitorListWindows();
      set({ availableWindows: windows });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  loadUnreadCount: async () => {
    try {
      const count = await monitorUnreadCount();
      set({ unreadCount: count });
    } catch {
      // Silently fail - badge count is non-critical
    }
  },

  openMonitorPanel: () => set({ showMonitorPanel: true }),
  closeMonitorPanel: () => set({ showMonitorPanel: false }),
  toggleMonitorPanel: () =>
    set((state) => ({ showMonitorPanel: !state.showMonitorPanel })),
  setSelectedTargetId: (id) => set({ selectedTargetId: id }),

  // Listen for real-time capture events from the backend
  initEventListener: () => {
    const unlisten = listen<CaptureEvent>("monitor-capture", (event) => {
      set((state) => ({
        events: [event.payload, ...state.events],
        unreadCount: state.unreadCount + 1,
      }));
    });

    // Return cleanup function
    return () => {
      unlisten.then((fn) => fn());
    };
  },
}));
