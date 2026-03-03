/**
 * Tauri invoke wrappers for collab commands.
 */

import { invoke } from "@tauri-apps/api/core";

export interface CollabSession {
  id: string;
  scopeType: string;
  scopeId: string | null;
  notebookId: string;
  title: string | null;
  expiry: string;
  createdAt: string;
  expiresAt: string | null;
  shareUrl: string;
  readOnlyShareUrl: string | null;
  isActive: boolean;
  // Backward compat
  pageId: string | null;
  pageTitle: string | null;
}

export interface StartCollabResponse {
  session: CollabSession;
  token: string;
  roomId: string;
  partykitHost: string;
}

export interface StartScopedCollabResponse {
  session: CollabSession;
  token: string;
  partykitHost: string;
}

export interface CollabConfig {
  partykitHost: string;
}

export interface PageSummary {
  id: string;
  title: string;
  folderId: string | null;
  sectionId: string | null;
}

export async function startCollabSession(
  notebookId: string,
  pageId: string,
  expiry: string = "8h",
): Promise<StartCollabResponse> {
  return invoke<StartCollabResponse>("start_collab_session", {
    request: { notebookId, pageId, expiry },
  });
}

export async function startCollabSessionScoped(
  notebookId: string,
  scopeType: string,
  scopeId: string,
  expiry: string = "8h",
): Promise<StartScopedCollabResponse> {
  return invoke<StartScopedCollabResponse>("start_collab_session_scoped", {
    request: { notebookId, scopeType, scopeId, expiry },
  });
}

export async function listPagesForScope(
  notebookId: string,
  scopeType: string,
  scopeId: string,
): Promise<PageSummary[]> {
  return invoke<PageSummary[]>("list_pages_for_scope", {
    notebookId,
    scopeType,
    scopeId,
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
