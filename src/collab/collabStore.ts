/**
 * Zustand store for collaboration session state.
 *
 * The CollabProvider (Y.Doc, YPartyKitProvider, WebSocket) lives outside of
 * React's lifecycle so it survives component remounts (e.g., sidebar toggle
 * causing Layout to switch render paths).
 *
 * Components read state via selectors; actions mutate the store directly.
 */

import { create } from "zustand";
import type { BlockNoteEditor as BNEditor } from "@blocknote/core";
import { blocksToYXmlFragment } from "@blocknote/core/yjs";
import { CollabProvider, type CollaborationOptions, type ConnectionState } from "./CollabProvider";
import * as api from "./api";
import type { EditorData } from "../types/page";
import { editorJsToBlockNote } from "../utils/blockFormatConverter";

export type CollabStatus = "idle" | "starting" | "connected" | "connecting" | "disconnected" | "error" | "expired";

interface CollabState {
  isActive: boolean;
  isSynced: boolean;
  status: CollabStatus;
  shareUrl: string | null;
  sessionId: string | null;
  participants: number;
  error: string | null;
  collabOptions: CollaborationOptions | null;
  connectionState: ConnectionState | null;
  /** Page ID the active session belongs to */
  pageId: string | null;
}

interface CollabActions {
  startSession: (notebookId: string, pageId: string, expiry?: string) => Promise<void>;
  stopSession: () => Promise<void>;
  reconnect: () => void;
  seedContent: (editor: BNEditor<any, any, any>, initialData: EditorData) => void;
}

type CollabStore = CollabState & CollabActions;

// Module-level CollabProvider — survives React remounts
let _provider: CollabProvider | null = null;

export const useCollabStore = create<CollabStore>((set, get) => ({
  // ── State ──────────────────────────────────────────────────────────
  isActive: false,
  isSynced: false,
  status: "idle",
  shareUrl: null,
  sessionId: null,
  participants: 0,
  error: null,
  collabOptions: null,
  connectionState: null,
  pageId: null,

  // ── Actions ────────────────────────────────────────────────────────

  startSession: async (notebookId, pageId, expiry = "8h") => {
    try {
      set({ status: "starting", error: null });

      const response = await api.startCollabSession(notebookId, pageId, expiry);

      const provider = new CollabProvider({
        host: response.partykitHost,
        roomId: response.roomId,
        token: response.token,
        user: { name: "Owner", color: "#3b82f6" },
        onStatusChange: (state) => {
          set({ connectionState: state });
          if (state.isExpired) {
            set({ status: "expired" });
          } else {
            set({ status: state.status });
          }
        },
        onParticipantsChange: (count) => {
          set({ participants: count });
        },
        onSynced: () => {
          set({ isSynced: true });
        },
      });

      _provider = provider;

      set({
        isActive: true,
        isSynced: false,
        status: "connecting",
        sessionId: response.session.id,
        shareUrl: response.session.shareUrl,
        collabOptions: provider.getCollaborationOptions(),
        pageId,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        status: "error",
      });
    }
  },

  stopSession: async () => {
    const { sessionId } = get();

    // Destroy provider
    if (_provider) {
      _provider.destroy();
      _provider = null;
    }

    // Stop session on backend
    if (sessionId) {
      try {
        await api.stopCollabSession(sessionId);
      } catch (err) {
        console.warn("Failed to stop collab session:", err);
      }
    }

    set({
      isActive: false,
      isSynced: false,
      status: "idle",
      shareUrl: null,
      sessionId: null,
      participants: 0,
      error: null,
      collabOptions: null,
      connectionState: null,
      pageId: null,
    });
  },

  reconnect: () => {
    _provider?.reconnect();
  },

  seedContent: (editor, initialData) => {
    if (!_provider) return;
    if (_provider.fragment.length > 0) return;

    try {
      const bnBlocks = editorJsToBlockNote(initialData);
      blocksToYXmlFragment(editor, bnBlocks as any, _provider.fragment);
    } catch (e) {
      console.error("Failed to seed collab content:", e);
    }
  },
}));
