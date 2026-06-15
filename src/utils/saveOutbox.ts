// Persistent outbox for content saves that failed to reach the daemon
// (down/restarting/timeout). Failed saves are queued to localStorage so they
// survive a quit/crash and are replayed on the next startup — the daemon stays
// the single writer; we just don't lose the edit while it's unreachable
// (DL-22, and DL-04: file-based page writes route through the daemon too).
//
// Replays go straight to the daemon (no import of ./api) so this module has no
// import cycle with api.ts, which enqueues file-content failures here.

import { daemonPut } from "./daemon";
import type { EditorData } from "../types/page";

const STORAGE_KEY = "nous-save-outbox";

/**
 * A queued content save:
 * - `page`: standard-page CRDT blocks (EditorData)
 * - `file`: file-based page raw string body
 * - `database`: structured database content (object) with the editor's loaded
 *   row-id baseline for the server-side row merge (DL-04)
 */
export interface OutboxEntry {
  kind: "page" | "file" | "database";
  notebookId: string;
  pageId: string;
  content: EditorData | string | Record<string, unknown>;
  commit?: boolean;
  paneId?: string;
  baselineRowIds?: string[];
  queuedAt: number;
}

// Keyed by pageId — one (latest) pending save per page (a page is either
// standard or file-based, never both, so the key never collides across kinds).
type OutboxMap = Record<string, OutboxEntry>;

function load(): OutboxMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OutboxMap) : {};
  } catch {
    return {};
  }
}

function persist(map: OutboxMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage unavailable/full — best effort.
  }
}

/** Queue (or replace) a failed standard-page content save. */
export function enqueueFailedSave(entry: {
  notebookId: string;
  pageId: string;
  content: EditorData;
  commit?: boolean;
  paneId?: string;
}): void {
  const map = load();
  map[entry.pageId] = { kind: "page", ...entry, queuedAt: Date.now() };
  persist(map);
}

/** Queue (or replace) a failed file-based page content save (DL-04). */
export function enqueueFailedFileSave(entry: {
  notebookId: string;
  pageId: string;
  content: string;
}): void {
  const map = load();
  map[entry.pageId] = { kind: "file", ...entry, queuedAt: Date.now() };
  persist(map);
}

/** Queue (or replace) a failed database content save, with the loaded row-id
 *  baseline so the replay still does the server-side row merge (DL-04). */
export function enqueueFailedDatabaseSave(entry: {
  notebookId: string;
  pageId: string;
  content: Record<string, unknown>;
  baselineRowIds: string[];
}): void {
  const map = load();
  map[entry.pageId] = { kind: "database", ...entry, queuedAt: Date.now() };
  persist(map);
}

/** Drop a page's queued save (e.g. once a later save for it succeeded). */
export function dequeueSave(pageId: string): void {
  const map = load();
  if (map[pageId]) {
    delete map[pageId];
    persist(map);
  }
}

export function outboxSize(): number {
  return Object.keys(load()).length;
}

async function replay(entry: OutboxEntry): Promise<void> {
  const base = `/api/notebooks/${entry.notebookId}/pages/${entry.pageId}`;
  if (entry.kind === "database") {
    await daemonPut(
      `/api/notebooks/${entry.notebookId}/databases/${entry.pageId}`,
      { database: entry.content, baselineRowIds: entry.baselineRowIds ?? [] }
    );
    return;
  }
  if (entry.kind === "file") {
    await daemonPut(`${base}/file-content`, { content: entry.content });
    return;
  }
  // Standard page: mirror api.updatePage's content-save body (snake_case).
  const data = entry.content as EditorData;
  const body: Record<string, unknown> = { blocks: data.blocks };
  if (entry.commit !== undefined) body.commit = entry.commit;
  if (entry.paneId !== undefined) body.pane_id = entry.paneId;
  await daemonPut(base, body);
}

/**
 * Attempt to flush all queued saves to the daemon. Successful entries are
 * removed; failed ones stay queued for the next attempt. Returns the number
 * still pending afterwards.
 */
export async function flushOutbox(): Promise<number> {
  const entries = Object.values(load());
  for (const entry of entries) {
    try {
      await replay(entry);
      dequeueSave(entry.pageId);
    } catch {
      // Leave queued; a later flush (or startup replay) will retry.
    }
  }
  return outboxSize();
}
