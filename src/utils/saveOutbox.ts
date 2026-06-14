// Persistent outbox for page-content saves that failed to reach the daemon
// (down/restarting/timeout). Failed saves are queued to localStorage so they
// survive a quit/crash and are replayed on the next startup — the daemon stays
// the single writer; we just don't lose the edit while it's unreachable (DL-22).

import * as api from "./api";
import type { EditorData } from "../types/page";

const STORAGE_KEY = "nous-save-outbox";

export interface OutboxEntry {
  notebookId: string;
  pageId: string;
  content: EditorData;
  commit: boolean;
  paneId?: string;
  queuedAt: number;
}

// Keyed by pageId — one (latest) pending save per page.
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

/** Queue (or replace) a failed content save for a page. */
export function enqueueFailedSave(entry: Omit<OutboxEntry, "queuedAt">): void {
  const map = load();
  map[entry.pageId] = { ...entry, queuedAt: Date.now() };
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

/**
 * Attempt to flush all queued saves to the daemon. Successful entries are
 * removed; failed ones stay queued for the next attempt. Returns the number
 * still pending afterwards.
 */
export async function flushOutbox(): Promise<number> {
  const entries = Object.values(load());
  for (const entry of entries) {
    try {
      await api.updatePage(
        entry.notebookId,
        entry.pageId,
        { content: entry.content },
        entry.commit,
        entry.paneId
      );
      dequeueSave(entry.pageId);
    } catch {
      // Leave queued; a later flush (or startup replay) will retry.
    }
  }
  return outboxSize();
}
