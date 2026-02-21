import { create } from "zustand";
import type { ChatSession, ChatSessionSummary } from "../types/chatSession";
import {
  chatSessionCreate,
  chatSessionSave,
  chatSessionGet,
  chatSessionList,
  chatSessionDelete,
  chatSessionUpdateTitle,
} from "../utils/api";

interface ChatSessionState {
  /** Cached list of session summaries */
  sessions: ChatSessionSummary[];
  /** Currently active session ID */
  activeSessionId: string | null;
  /** Whether the session list is loading */
  isLoading: boolean;

  /** Fetch session list from backend */
  loadSessions: () => Promise<void>;
  /** Create a new session, returns it */
  createSession: (title?: string) => Promise<ChatSession>;
  /** Load a full session from backend */
  loadSession: (id: string) => Promise<ChatSession>;
  /** Save a full session to backend and update cache */
  saveSession: (session: ChatSession) => Promise<void>;
  /** Delete a session */
  deleteSession: (id: string) => Promise<void>;
  /** Rename a session */
  renameSession: (id: string, title: string) => Promise<void>;
  /** Set the active session ID */
  setActiveSessionId: (id: string | null) => void;
}

export const useChatSessionStore = create<ChatSessionState>()((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isLoading: false,

  loadSessions: async () => {
    set({ isLoading: true });
    try {
      const sessions = await chatSessionList();
      set({ sessions });
    } catch (error) {
      console.error("Failed to load chat sessions:", error);
    } finally {
      set({ isLoading: false });
    }
  },

  createSession: async (title?: string) => {
    const session = await chatSessionCreate(title);
    set({ activeSessionId: session.id });
    // Refresh session list
    get().loadSessions();
    return session;
  },

  loadSession: async (id: string) => {
    const session = await chatSessionGet(id);
    set({ activeSessionId: id });
    return session;
  },

  saveSession: async (session: ChatSession) => {
    await chatSessionSave(session);
    // Update the summary in our cached list
    set((state) => {
      const existing = state.sessions.findIndex((s) => s.id === session.id);
      const summary: ChatSessionSummary = {
        id: session.id,
        title: session.title,
        model: session.model,
        messageCount: session.messages.length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };
      if (existing >= 0) {
        const updated = [...state.sessions];
        updated[existing] = summary;
        // Re-sort by updatedAt desc
        updated.sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        return { sessions: updated };
      }
      return { sessions: [summary, ...state.sessions] };
    });
  },

  deleteSession: async (id: string) => {
    await chatSessionDelete(id);
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
    }));
  },

  renameSession: async (id: string, title: string) => {
    await chatSessionUpdateTitle(id, title);
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, title } : s
      ),
    }));
  },

  setActiveSessionId: (id: string | null) => {
    set({ activeSessionId: id });
  },
}));
