/**
 * React hook wrapping the collab session lifecycle.
 *
 * Thin wrapper over collabStore (Zustand) so the CollabProvider and session
 * state survive component remounts (e.g., sidebar toggle causing Layout
 * to switch render paths).
 *
 * Returns the same CollabSessionState interface for backwards compatibility,
 * extended with scope-aware fields.
 */

import { useCollabStore, type CollabStatus, type CollabScope } from "./collabStore";
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
  /** Page ID the active provider belongs to */
  pageId: string | null;
  /** Active scope (null when idle) */
  scope: CollabScope | null;
  startSession: (
    notebookId: string,
    pageId: string,
    expiry?: string,
  ) => Promise<void>;
  startScopedSession: (
    notebookId: string,
    scopeType: string,
    scopeId: string,
    expiry?: string,
  ) => Promise<void>;
  stopSession: () => Promise<void>;
  activatePage: (pageId: string) => void;
  deactivatePage: (pageId: string) => void;
  isPageInScope: (pageId: string) => boolean;
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
  const scope = useCollabStore((s) => s.scope);
  const startSession = useCollabStore((s) => s.startSession);
  const startScopedSession = useCollabStore((s) => s.startScopedSession);
  const stopSession = useCollabStore((s) => s.stopSession);
  const activatePage = useCollabStore((s) => s.activatePage);
  const deactivatePage = useCollabStore((s) => s.deactivatePage);
  const isPageInScope = useCollabStore((s) => s.isPageInScope);
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
    scope,
    startSession,
    startScopedSession,
    stopSession,
    activatePage,
    deactivatePage,
    isPageInScope,
    reconnect,
    seedContent,
  };
}
