/**
 * Zustand store for collaboration session state.
 *
 * Supports two modes:
 * 1. Single-page scope: one CollabProvider for one page (existing behavior)
 * 2. Multi-page scope (section/notebook): lazy per-page providers sharing a
 *    single token and scope configuration
 *
 * The CollabProvider (Y.Doc, YPartyKitProvider, WebSocket) lives outside of
 * React's lifecycle so it survives component remounts.
 */

import { create } from "zustand";
import { BlockNoteEditor, type BlockNoteEditor as BNEditor } from "@blocknote/core";
import { blocksToYXmlFragment } from "@blocknote/core/yjs";
import { CollabProvider, type CollaborationOptions, type ConnectionState } from "./CollabProvider";
import { makeRoomId } from "./roomId";
import * as api from "./api";
import type { EditorData } from "../types/page";
import { editorJsToBlockNote } from "../utils/blockFormatConverter";
import { schema } from "../components/Editor/schema";

export type CollabStatus = "idle" | "starting" | "connected" | "connecting" | "disconnected" | "error" | "expired";

export interface CollabScope {
  sessionId: string;
  scopeType: "page" | "section" | "notebook";
  scopeId: string;
  notebookId: string;
  token: string;
  host: string;
  shareUrl: string | null;
  readOnlyShareUrl: string | null;
}

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
  /** Page ID the active provider belongs to (for the currently viewed page) */
  pageId: string | null;
  /** Active scope (null when idle) */
  scope: CollabScope | null;
}

interface CollabActions {
  /** Start a single-page collab session (backward compatible) */
  startSession: (notebookId: string, pageId: string, expiry?: string) => Promise<void>;
  /** Start a scoped (section/notebook) collab session */
  startScopedSession: (notebookId: string, scopeType: string, scopeId: string, expiry?: string) => Promise<void>;
  stopSession: () => Promise<void>;
  /** Activate a page's provider within a multi-page scope */
  activatePage: (pageId: string) => void;
  /** Deactivate a page's provider (with grace period for quick navigation) */
  deactivatePage: (pageId: string) => void;
  /** Check if a page is within the current scope */
  isPageInScope: (pageId: string) => boolean;
  reconnect: () => void;
  seedContent: (editor: BNEditor<any, any, any>, initialData: EditorData) => void;
}

type CollabStore = CollabState & CollabActions;

// Module-level provider management — survives React remounts
let _scope: CollabScope | null = null;
const _providers = new Map<string, CollabProvider>();
const _destroyTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Grace period before destroying a deactivated provider (handles quick page switches) */
const DEACTIVATE_GRACE_MS = 30_000;

function getOrCreateProvider(pageId: string, scope: CollabScope, set: (partial: Partial<CollabState>) => void): CollabProvider {
  // Cancel any pending destroy timer
  const timer = _destroyTimers.get(pageId);
  if (timer) {
    clearTimeout(timer);
    _destroyTimers.delete(pageId);
  }

  const existing = _providers.get(pageId);
  if (existing) return existing;

  const roomId = makeRoomId(scope.notebookId, pageId);

  const provider = new CollabProvider({
    host: scope.host,
    roomId,
    token: scope.token,
    user: { name: "Owner", color: "#3b82f6" },
    onStatusChange: (state) => {
      // Only update store if this is still the active page
      if (_scope?.sessionId === scope.sessionId) {
        set({ connectionState: state });
        if (state.isExpired) {
          set({ status: "expired" });
        } else {
          set({ status: state.status });
        }
      }
    },
    onParticipantsChange: (count) => {
      if (_scope?.sessionId === scope.sessionId) {
        set({ participants: count });
      }
    },
    onSynced: () => {
      if (_scope?.sessionId === scope.sessionId) {
        set({ isSynced: true });
      }
    },
  });

  _providers.set(pageId, provider);
  return provider;
}

function destroyProvider(pageId: string): void {
  const timer = _destroyTimers.get(pageId);
  if (timer) {
    clearTimeout(timer);
    _destroyTimers.delete(pageId);
  }

  const provider = _providers.get(pageId);
  if (provider) {
    provider.destroy();
    _providers.delete(pageId);
  }
}

function destroyAllProviders(): void {
  for (const timer of _destroyTimers.values()) {
    clearTimeout(timer);
  }
  _destroyTimers.clear();

  for (const provider of _providers.values()) {
    provider.destroy();
  }
  _providers.clear();
}

// ── Background page seeding ─────────────────────────────────────────────────
// When a scoped session starts, seed all pages in the scope into their Yjs DO
// rooms so guests see content immediately, even for pages the host hasn't opened.

/** Max concurrent page seeding WebSocket connections */
const SEED_CONCURRENCY = 5;

/**
 * Background-seed all pages in a scoped session into their Yjs DO rooms.
 * Fire-and-forget: errors are logged but don't affect the session.
 */
async function seedScopePages(
  scope: CollabScope,
  pages: api.PageSummary[],
): Promise<void> {
  if (pages.length === 0) return;

  // Create a headless BlockNote editor for block → Yjs conversion.
  // Uses the full custom schema so all block types serialize correctly.
  const headlessEditor = BlockNoteEditor.create({ schema });

  // Process pages with concurrency limit
  const queue = [...pages];
  const active: Promise<void>[] = [];

  while (queue.length > 0 || active.length > 0) {
    // Bail if session was stopped
    if (!_scope || _scope.sessionId !== scope.sessionId) break;

    while (queue.length > 0 && active.length < SEED_CONCURRENCY) {
      const page = queue.shift()!;
      const promise = seedSinglePage(headlessEditor, scope, page)
        .then(() => {
          const idx = active.indexOf(promise);
          if (idx >= 0) active.splice(idx, 1);
        });
      active.push(promise);
    }

    if (active.length > 0) {
      await Promise.race(active);
    }
  }

  console.log(`[collab] Seeded ${pages.length} pages for scope ${scope.scopeId}`);
}

/**
 * Seed a single page's Yjs DO room with its content.
 */
async function seedSinglePage(
  editor: BNEditor<any, any, any>,
  scope: CollabScope,
  page: api.PageSummary,
): Promise<void> {
  // Skip if this page already has an active provider (host is viewing it —
  // BlockNoteEditor.tsx will seed it via its own useEffect)
  if (_providers.has(page.id)) return;
  // Skip if scope was stopped
  if (!_scope || _scope.sessionId !== scope.sessionId) return;

  try {
    // Fetch page content from Tauri backend
    const content = await api.getPageContent(scope.notebookId, page.id);
    if (!content.blocks?.length) return;

    // Bail again if scope changed during the async call
    if (!_scope || _scope.sessionId !== scope.sessionId) return;
    if (_providers.has(page.id)) return;

    const roomId = makeRoomId(scope.notebookId, page.id);

    // Create temp provider
    const tempProvider = new CollabProvider({
      host: scope.host,
      roomId,
      token: scope.token,
      user: { name: "Seeder", color: "#888888" },
    });

    try {
      // Wait for initial sync (with timeout)
      const synced = await new Promise<boolean>((resolve) => {
        if (tempProvider.isSynced) { resolve(true); return; }
        const timeout = setTimeout(() => resolve(false), 15_000);
        // Poll for sync — the provider's internal sync handler sets isSynced
        const interval = setInterval(() => {
          if (tempProvider.isSynced) {
            clearInterval(interval);
            clearTimeout(timeout);
            resolve(true);
          }
        }, 50);
        setTimeout(() => clearInterval(interval), 15_100);
      });

      if (!synced) {
        console.warn(`[collab] Sync timeout for page ${page.id}, skipping seed`);
        return;
      }

      // Only seed if the server's fragment is empty (no prior state)
      if (tempProvider.fragment.length === 0) {
        const editorData: EditorData = { blocks: content.blocks as any };
        const bnBlocks = editorJsToBlockNote(editorData);
        blocksToYXmlFragment(editor, bnBlocks as any, tempProvider.fragment);

        // Brief wait for the Yjs update to propagate to the DO via WebSocket
        await new Promise((r) => setTimeout(r, 500));
      }
    } finally {
      tempProvider.destroy();
    }
  } catch (e) {
    console.warn(`[collab] Failed to seed page ${page.id}:`, e);
  }
}

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
  scope: null,

  // ── Actions ────────────────────────────────────────────────────────

  startSession: async (notebookId, pageId, expiry = "8h") => {
    try {
      set({ status: "starting", error: null });

      const response = await api.startCollabSession(notebookId, pageId, expiry);

      const scope: CollabScope = {
        sessionId: response.session.id,
        scopeType: "page",
        scopeId: pageId,
        notebookId,
        token: response.token,
        host: response.partykitHost,
        shareUrl: response.session.shareUrl,
        readOnlyShareUrl: response.session.readOnlyShareUrl,
      };

      _scope = scope;

      const provider = getOrCreateProvider(pageId, scope, set);

      set({
        isActive: true,
        isSynced: false,
        status: "connecting",
        sessionId: response.session.id,
        shareUrl: response.session.shareUrl,
        collabOptions: provider.getCollaborationOptions(),
        pageId,
        scope,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        status: "error",
      });
    }
  },

  startScopedSession: async (notebookId, scopeType, scopeId, expiry = "8h") => {
    try {
      set({ status: "starting", error: null });

      const response = await api.startCollabSessionScoped(notebookId, scopeType, scopeId, expiry);

      // Push manifest to Worker and get page list for seeding
      let pages: api.PageSummary[] = [];
      try {
        pages = await api.listPagesForScope(notebookId, scopeType, scopeId);
        await pushManifest(response.session.id, response.token, pages);
      } catch (e) {
        console.warn("Failed to push manifest:", e);
      }

      const scope: CollabScope = {
        sessionId: response.session.id,
        scopeType: scopeType as "section" | "notebook",
        scopeId,
        notebookId,
        token: response.token,
        host: response.partykitHost,
        shareUrl: response.session.shareUrl,
        readOnlyShareUrl: response.session.readOnlyShareUrl,
      };

      _scope = scope;

      set({
        isActive: true,
        isSynced: false,
        status: "connecting",
        sessionId: response.session.id,
        shareUrl: response.session.shareUrl,
        collabOptions: null,
        pageId: null,
        scope,
      });

      // Background-seed all pages in the scope so guests see content immediately.
      // Fire-and-forget: doesn't block the UI or affect session status.
      if (pages.length > 0) {
        seedScopePages(scope, pages).catch((e) => {
          console.warn("[collab] Background page seeding failed:", e);
        });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        status: "error",
      });
    }
  },

  stopSession: async () => {
    const { sessionId } = get();

    // Destroy all providers
    destroyAllProviders();
    _scope = null;

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
      scope: null,
    });
  },

  activatePage: (pageId: string) => {
    if (!_scope) return;

    const provider = getOrCreateProvider(pageId, _scope, set);

    set({
      pageId,
      isSynced: provider.isSynced,
      collabOptions: provider.getCollaborationOptions(),
      status: provider.status === "connected" ? "connected" : "connecting",
      connectionState: provider.connectionInfo,
      participants: provider.participantCount,
    });
  },

  deactivatePage: (pageId: string) => {
    if (!_scope) return;
    // For single-page scope, don't destroy on deactivate — stopSession handles that
    if (_scope.scopeType === "page") return;

    // Grace period: schedule destruction
    const timer = setTimeout(() => {
      _destroyTimers.delete(pageId);
      destroyProvider(pageId);
    }, DEACTIVATE_GRACE_MS);

    _destroyTimers.set(pageId, timer);
  },

  isPageInScope: (pageId: string) => {
    if (!_scope) return false;
    if (_scope.scopeType === "page") {
      return _scope.scopeId === pageId;
    }
    // For section/notebook scopes, any page in the notebook could be in scope.
    // The actual membership check is done by the server via token validation.
    return true;
  },

  reconnect: () => {
    const { pageId } = get();
    if (pageId) {
      const provider = _providers.get(pageId);
      provider?.reconnect();
    }
  },

  seedContent: (editor, initialData) => {
    const { pageId } = get();
    if (!pageId) return;
    const provider = _providers.get(pageId);
    if (!provider) return;
    if (provider.fragment.length > 0) return;

    try {
      const bnBlocks = editorJsToBlockNote(initialData);
      blocksToYXmlFragment(editor, bnBlocks as any, provider.fragment);
    } catch (e) {
      console.error("Failed to seed collab content:", e);
    }
  },
}));

/** Get the active CollabProvider for a given page (if any) */
export function getCollabProvider(pageId: string): CollabProvider | null {
  return _providers.get(pageId) ?? null;
}

/** Push page manifest to the Worker API */
async function pushManifest(
  sessionId: string,
  token: string,
  pages: api.PageSummary[],
): Promise<void> {
  const url = `https://party.nous.page/api/manifest/${sessionId}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(pages),
  });
  if (!response.ok) {
    throw new Error(`Manifest push failed: ${response.status}`);
  }
}
