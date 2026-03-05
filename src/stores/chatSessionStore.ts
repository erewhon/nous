import { create } from "zustand";
import type { ChatSession, ChatSessionSummary } from "../types/chatSession";
import * as api from "../utils/api";

const AI_CONVERSATIONS_FOLDER_NAME = "AI Conversations";

interface ChatSessionState {
  /** Cached list of session summaries */
  sessions: ChatSessionSummary[];
  /** Currently active session ID */
  activeSessionId: string | null;
  /** Whether the session list is loading */
  isLoading: boolean;
  /** Notebook ID where sessions are stored */
  sessionNotebookId: string | null;
  /** Folder ID for "AI Conversations" folder */
  sessionFolderId: string | null;

  /** Initialize the session folder in a notebook (find or create) */
  initSessionFolder: (notebookId: string) => Promise<void>;
  /** Fetch session list from pages */
  loadSessions: () => Promise<void>;
  /** Create a new session as a chat page */
  createSession: (title?: string) => Promise<ChatSession>;
  /** Load a full session from file content */
  loadSession: (id: string) => Promise<ChatSession>;
  /** Save a full session to file content and update cache */
  saveSession: (session: ChatSession) => Promise<void>;
  /** Delete a session (page) */
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
  sessionNotebookId: null,
  sessionFolderId: null,

  initSessionFolder: async (notebookId: string) => {
    const state = get();
    // Already initialized for this notebook
    if (state.sessionNotebookId === notebookId && state.sessionFolderId) {
      return;
    }

    // Look for existing "AI Conversations" folder
    const folders = await api.listFolders(notebookId);
    let folder = folders.find((f) => f.name === AI_CONVERSATIONS_FOLDER_NAME);

    if (!folder) {
      folder = await api.createFolder(notebookId, AI_CONVERSATIONS_FOLDER_NAME);
    }

    set({ sessionNotebookId: notebookId, sessionFolderId: folder.id });
  },

  loadSessions: async () => {
    const { sessionNotebookId, sessionFolderId } = get();
    if (!sessionNotebookId || !sessionFolderId) return;

    set({ isLoading: true });
    try {
      const pages = await api.listPages(sessionNotebookId);
      const chatPages = pages.filter(
        (p) => p.pageType === "chat" && p.folderId === sessionFolderId
      );

      // Build summaries from page metadata
      const sessions: ChatSessionSummary[] = chatPages.map((p) => ({
        id: p.id,
        title: p.title,
        model: null,
        messageCount: 0, // Will be filled when session is loaded
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));

      // Sort by updatedAt desc
      sessions.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      set({ sessions });
    } catch (error) {
      console.error("Failed to load chat sessions:", error);
    } finally {
      set({ isLoading: false });
    }
  },

  createSession: async (title?: string) => {
    const { sessionNotebookId, sessionFolderId } = get();
    if (!sessionNotebookId || !sessionFolderId) {
      throw new Error("Session folder not initialized. Call initSessionFolder first.");
    }

    // Create page
    const page = await api.createPage(
      sessionNotebookId,
      title || "New conversation",
      sessionFolderId
    );

    // Set page type and file extension
    await api.updatePage(sessionNotebookId, page.id, {
      pageType: "chat",
      fileExtension: "chat",
    });

    // Create initial session data
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: page.id,
      title: title || "New conversation",
      messages: [],
      model: null,
      notebookContext: null,
      createdAt: now,
      updatedAt: now,
    };

    // Write session JSON as file content
    await api.updateFileContent(
      sessionNotebookId,
      page.id,
      JSON.stringify(session, null, 2)
    );

    set({ activeSessionId: page.id });
    // Refresh session list
    get().loadSessions();
    return session;
  },

  loadSession: async (id: string) => {
    const { sessionNotebookId } = get();
    if (!sessionNotebookId) {
      throw new Error("Session folder not initialized.");
    }

    const result = await api.getFileContent(sessionNotebookId, id);
    if (!result.content) {
      throw new Error("Session file is empty.");
    }

    const session: ChatSession = JSON.parse(result.content);
    // Ensure the ID matches the page ID
    session.id = id;
    set({ activeSessionId: id });
    return session;
  },

  saveSession: async (session: ChatSession) => {
    const { sessionNotebookId } = get();
    if (!sessionNotebookId) return;

    session.updatedAt = new Date().toISOString();

    // Write session content
    await api.updateFileContent(
      sessionNotebookId,
      session.id,
      JSON.stringify(session, null, 2)
    );

    // Update page title if it changed
    await api.updatePage(sessionNotebookId, session.id, {
      title: session.title,
    });

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
    const { sessionNotebookId } = get();
    if (!sessionNotebookId) return;

    await api.deletePage(sessionNotebookId, id);
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
    }));
  },

  renameSession: async (id: string, title: string) => {
    const { sessionNotebookId } = get();
    if (!sessionNotebookId) return;

    await api.updatePage(sessionNotebookId, id, { title });
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
