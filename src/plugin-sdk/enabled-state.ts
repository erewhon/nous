/**
 * Shared enabled/disabled persistence for plugin-SDK contribution points.
 *
 * Each contribution kind (custom blocks, custom database views, …) keeps a
 * localStorage-persisted set of user-disabled ids. Reactive without zustand
 * (the guest editor bundles SDK modules) via useSyncExternalStore.
 */
import { useSyncExternalStore } from "react";

export interface DisabledSetStore {
  get(): ReadonlySet<string>;
  setEnabled(id: string, enabled: boolean): void;
  subscribe(cb: () => void): () => void;
  /** React hook: the current disabled set, re-rendering on toggle. */
  useDisabled(): ReadonlySet<string>;
}

export function createDisabledSetStore(storageKey: string): DisabledSetStore {
  function load(): ReadonlySet<string> {
    try {
      const raw =
        typeof localStorage !== "undefined"
          ? localStorage.getItem(storageKey)
          : null;
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  }

  let disabled: ReadonlySet<string> = load();
  const listeners = new Set<() => void>();

  const get = () => disabled;

  const setEnabled = (id: string, enabled: boolean) => {
    const next = new Set(disabled);
    if (enabled) next.delete(id);
    else next.add(id);
    disabled = next;
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      }
    } catch {
      // best-effort; an unavailable/full localStorage just loses persistence
    }
    for (const cb of listeners) cb();
  };

  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => void listeners.delete(cb);
  };

  return {
    get,
    setEnabled,
    subscribe,
    useDisabled: () => useSyncExternalStore(subscribe, get),
  };
}
