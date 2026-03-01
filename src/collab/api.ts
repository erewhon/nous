/**
 * Tauri invoke wrappers for collab commands.
 */

import { invoke } from "@tauri-apps/api/core";

export interface CollabSession {
  id: string;
  pageId: string;
  notebookId: string;
  pageTitle: string;
  expiry: string;
  createdAt: string;
  expiresAt: string | null;
  shareUrl: string;
  isActive: boolean;
}

export interface StartCollabResponse {
  session: CollabSession;
  token: string;
  roomId: string;
  partykitHost: string;
}

export interface CollabConfig {
  partykitHost: string;
}

export async function startCollabSession(
  notebookId: string,
  pageId: string,
  expiry: string = "8h"
): Promise<StartCollabResponse> {
  return invoke<StartCollabResponse>("start_collab_session", {
    request: { notebookId, pageId, expiry },
  });
}

export async function stopCollabSession(sessionId: string): Promise<void> {
  return invoke<void>("stop_collab_session", { sessionId });
}

export async function listCollabSessions(): Promise<CollabSession[]> {
  return invoke<CollabSession[]>("list_collab_sessions");
}

export async function getCollabConfig(): Promise<CollabConfig> {
  return invoke<CollabConfig>("get_collab_config");
}
