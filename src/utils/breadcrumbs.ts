/**
 * Breadcrumb tracer for diagnosing permanent freezes.
 *
 * Writes timestamped markers to localStorage at key code points.
 * After a force-quit, check the last breadcrumb to see exactly
 * where the freeze occurred:
 *
 *   JSON.parse(localStorage.getItem("nous-breadcrumbs"))
 *
 * The trail auto-clears on each page switch start, so the
 * entries always reflect the CURRENT (frozen) operation.
 */

const STORAGE_KEY = "nous-breadcrumbs";
const MAX_CRUMBS = 100;

interface Breadcrumb {
  t: number;    // performance.now() timestamp
  iso: string;  // ISO wall-clock time
  tag: string;  // short label
  ms?: number;  // optional: milliseconds since previous crumb
}

let trail: Breadcrumb[] = [];
let lastTime = 0;

/** Drop a breadcrumb. Call this at the start of suspected-slow code paths. */
export function crumb(tag: string): void {
  const now = performance.now();
  const entry: Breadcrumb = {
    t: Math.round(now),
    iso: new Date().toISOString(),
    tag,
  };
  if (lastTime > 0) {
    entry.ms = Math.round(now - lastTime);
  }
  lastTime = now;
  trail.push(entry);

  // Persist immediately — if the freeze happens AFTER this line,
  // we'll see this crumb in localStorage after force-quit.
  try {
    const trimmed = trail.slice(-MAX_CRUMBS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota — drop silently
  }
}

/** Reset the trail (call at the start of each page switch). */
export function resetCrumbs(): void {
  trail = [];
  lastTime = 0;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Read saved breadcrumbs (for startup dump or manual inspection). */
export function readCrumbs(): Breadcrumb[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
