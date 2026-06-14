// Coordinates flushing all open editors' pending saves before the app/window
// closes (DL-26). Each editor registers a flush callback on mount; the close
// handler calls flushAllSaves() and awaits them (bounded by a timeout) so an
// edit within the auto-save debounce window isn't lost on quit.

type FlushFn = () => Promise<void>;

const flushers = new Set<FlushFn>();

/** Register an editor's flush callback. Returns an unregister function. */
export function registerSaveFlusher(fn: FlushFn): () => void {
  flushers.add(fn);
  return () => {
    flushers.delete(fn);
  };
}

/**
 * Flush every registered editor's pending save, bounded by `timeoutMs` so a
 * hung/unreachable daemon can't block the window close indefinitely. Resolves
 * when all flushes settle or the timeout elapses, whichever comes first.
 */
export async function flushAllSaves(timeoutMs = 4000): Promise<void> {
  if (flushers.size === 0) return;
  const all = Promise.allSettled([...flushers].map((f) => f()));
  await Promise.race([
    all,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
