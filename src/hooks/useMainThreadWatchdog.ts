import { useEffect, useRef } from "react";

const STORAGE_KEY = "nous-watchdog-log";
const MAX_LOG_ENTRIES = 50;

interface WatchdogEntry {
  time: string;
  type: "heartbeat" | "longtask" | "worker-ping";
  durationMs: number;
  context?: string;
}

/** Read the persisted watchdog log from localStorage */
export function getWatchdogLog(): WatchdogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Clear the watchdog log */
export function clearWatchdogLog(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Append an entry to the persisted log */
function persistEntry(entry: WatchdogEntry): void {
  try {
    const log = getWatchdogLog();
    log.push(entry);
    // Keep only the most recent entries
    const trimmed = log.slice(-MAX_LOG_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota or other error — silently drop
  }
}

/**
 * Detects main-thread lockups by monitoring event loop responsiveness.
 *
 * Findings are persisted to localStorage so they survive force-quit.
 * Read them with: getWatchdogLog()  (also exposed on window.__watchdogLog)
 *
 * Three detection layers:
 * 1. setInterval heartbeat — detects RECOVERED lockups (thread blocked then resumed)
 * 2. PerformanceObserver Long Tasks API — precise timing of long tasks (where supported)
 * 3. Web Worker ping — detects PERMANENT hangs (main thread never responds)
 */
export function useMainThreadWatchdog({
  enabled = true,
  thresholdMs = 500,
  intervalMs = 2000,
}: {
  enabled?: boolean;
  thresholdMs?: number;
  intervalMs?: number;
} = {}) {
  const lastTickRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    // Expose log reader on window for easy console access
    const win = window as unknown as Record<string, unknown>;
    win.__watchdogLog = getWatchdogLog;
    win.__watchdogClear = clearWatchdogLog;

    // --- 1. Heartbeat detector (recoverable lockups) ---
    lastTickRef.current = performance.now();

    const intervalId = setInterval(() => {
      const now = performance.now();
      const elapsed = now - lastTickRef.current;
      const expected = intervalMs;

      if (elapsed > expected + thresholdMs) {
        const lockupMs = Math.round(elapsed - expected);
        const msg =
          `[Watchdog] Main thread was blocked for ~${lockupMs}ms ` +
          `(heartbeat gap ${Math.round(elapsed)}ms)`;
        console.warn(msg);
        persistEntry({
          time: new Date().toISOString(),
          type: "heartbeat",
          durationMs: lockupMs,
        });
      }
      lastTickRef.current = now;
    }, intervalMs);

    // --- 2. Long Tasks API (more precise, browser-dependent) ---
    let longTaskObserver: PerformanceObserver | null = null;

    if (typeof PerformanceObserver !== "undefined") {
      try {
        longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > thresholdMs) {
              const msg =
                `[Watchdog] Long task: ${Math.round(entry.duration)}ms ` +
                `(at ${Math.round(entry.startTime)}ms)`;
              console.warn(msg);
              persistEntry({
                time: new Date().toISOString(),
                type: "longtask",
                durationMs: Math.round(entry.duration),
              });
            }
          }
        });
        longTaskObserver.observe({ entryTypes: ["longtask"] });
      } catch {
        // Not supported in this WebView
      }
    }

    // --- 3. Web Worker ping (detects permanent hangs) ---
    let worker: Worker | null = null;
    let pingReplyTimeout: ReturnType<typeof setTimeout> | null = null;

    try {
      const workerCode = `
        let expecting = false;
        setInterval(() => {
          if (expecting) {
            // Main thread didn't reply to last ping — it's hung
            postMessage({ type: "hung" });
          }
          postMessage({ type: "ping" });
          expecting = true;
        }, 3000);

        self.onmessage = () => {
          expecting = false;
        };
      `;
      const blob = new Blob([workerCode], { type: "application/javascript" });
      worker = new Worker(URL.createObjectURL(blob));

      worker.onmessage = (e: MessageEvent) => {
        if (e.data.type === "ping") {
          // Reply immediately — if main thread is blocked, this never runs
          worker?.postMessage("pong");
        } else if (e.data.type === "hung") {
          // Worker detected that we didn't reply — log it.
          // (This message only arrives when the thread unblocks.)
          const msg = "[Watchdog] Worker detected main thread was unresponsive for >3s";
          console.error(msg);
          persistEntry({
            time: new Date().toISOString(),
            type: "worker-ping",
            durationMs: 3000,
            context: "Main thread did not respond to worker ping within 3s",
          });
        }
      };
    } catch {
      // Web Workers not available
    }

    return () => {
      clearInterval(intervalId);
      if (pingReplyTimeout) clearTimeout(pingReplyTimeout);
      longTaskObserver?.disconnect();
      worker?.terminate();
      delete win.__watchdogLog;
      delete win.__watchdogClear;
    };
  }, [enabled, thresholdMs, intervalMs]);
}
