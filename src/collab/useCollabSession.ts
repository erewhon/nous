/**
 * React hook wrapping the collab session lifecycle.
 *
 * Thin wrapper over collabStore (Zustand) so the CollabProvider and session
 * state survive component remounts (e.g., sidebar toggle causing Layout
 * to switch render paths).
 *
 * Returns the same CollabSessionState interface for backwards compatibility.
 */

import { useCollabStore, type CollabStatus } from "./collabStore";
import type { CollaborationOptions, ConnectionState } from "./CollabProvider";
import type { BlockNoteEditor } from "@blocknote/core";
import type { EditorData } from "../types/page";

export type { CollabStatus };

export interface CollabSessionState {
  isActive: boolean;
  status: CollabStatus;
  /** True after initial Yjs sync with server completes */
  isSynced: boolean;
  shareUrl: string | null;
  sessionId: string | null;
  participants: number;
  error: string | null;
  collabOptions: CollaborationOptions | null;
  connectionState: ConnectionState | null;
  /** Page ID the active session belongs to */
  pageId: string | null;
  startSession: (
    notebookId: string,
    pageId: string,
    expiry?: string,
  ) => Promise<void>;
  stopSession: () => Promise<void>;
  reconnect: () => void;
  seedContent: (editor: BlockNoteEditor<any, any, any>, initialData: EditorData) => void;
}

export function useCollabSession(): CollabSessionState {
  const isActive = useCollabStore((s) => s.isActive);
  const isSynced = useCollabStore((s) => s.isSynced);
  const status = useCollabStore((s) => s.status);
  const shareUrl = useCollabStore((s) => s.shareUrl);
  const sessionId = useCollabStore((s) => s.sessionId);
  const participants = useCollabStore((s) => s.participants);
  const error = useCollabStore((s) => s.error);
  const collabOptions = useCollabStore((s) => s.collabOptions);
  const connectionState = useCollabStore((s) => s.connectionState);
  const pageId = useCollabStore((s) => s.pageId);
  const startSession = useCollabStore((s) => s.startSession);
  const stopSession = useCollabStore((s) => s.stopSession);
  const reconnect = useCollabStore((s) => s.reconnect);
  const seedContent = useCollabStore((s) => s.seedContent);

  return {
    isActive,
    isSynced,
    status,
    shareUrl,
    sessionId,
    participants,
    error,
    collabOptions,
    connectionState,
    pageId,
    startSession,
    stopSession,
    reconnect,
    seedContent,
  };
}
