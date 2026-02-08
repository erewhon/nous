/**
 * Main-thread freeze detector.
 *
 * Two layers:
 *
 * 1. **JS-side** — rAF loop + setInterval watchdog that detects when frames
 *    stop being delivered.  Dumps breadcrumbs to console.error.
 *
 * 2. **Rust-side** — The Rust backend emits "freeze-ping" events every 2s.
 *    This module listens and responds via invoke("freeze_pong") with the
 *    current breadcrumb trail.  If the frontend is frozen, the pong never
 *    arrives and the Rust watchdog logs thread stacks from /proc/self/task.
 *
 * On startup, checks for leftover breadcrumbs from a previous session
 * (indicating a freeze → force-quit) and dumps them.
 */

import { readCrumbs } from "./breadcrumbs";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

const FREEZE_THRESHOLD_MS = 3000; // 3 seconds without a frame = frozen

let lastFrameTime = 0;
let rafId: number | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let pingUnlisten: UnlistenFn | null = null;

/**
 * Dump breadcrumbs from localStorage to console for debugging.
 * Call on startup to see what happened before a crash.
 */
export function dumpPreviousCrumbs(): void {
  const crumbs = readCrumbs();
  if (crumbs.length > 0) {
    console.warn(
      `[FreezeDetector] Found ${crumbs.length} breadcrumbs from previous session:`
    );
    console.table(crumbs);
  }
}

/**
 * Start monitoring the main thread for freezes.
 *
 * Two detection mechanisms run in parallel:
 *
 * 1. **rAF loop** — records `performance.now()` each frame.  If a frame
 *    callback fires and the gap since the last frame exceeds the threshold,
 *    the main thread was blocked for that duration.  This detects freezes
 *    that eventually UNFREEZE.
 *
 * 2. **setInterval watchdog** — `setInterval` callbacks are delivered even
 *    when rAF is not (e.g., when the tab is in the background or the
 *    rendering pipeline is stalled but the event loop still runs).  If the
 *    watchdog fires and notices rAF hasn't advanced, it dumps breadcrumbs.
 *    This catches rendering-pipeline freezes where JS still runs.
 */
export function startFreezeDetector(): void {
  lastFrameTime = performance.now();

  // rAF loop
  const tick = () => {
    const now = performance.now();
    const gap = now - lastFrameTime;

    if (gap > FREEZE_THRESHOLD_MS) {
      console.error(
        `[FreezeDetector] Main thread was blocked for ${Math.round(gap)}ms!`
      );
      const crumbs = readCrumbs();
      if (crumbs.length > 0) {
        console.error("[FreezeDetector] Breadcrumb trail:");
        console.table(crumbs);
      }
    }

    lastFrameTime = now;
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  // setInterval watchdog — fires every 2s.  If rAF hasn't advanced in
  // FREEZE_THRESHOLD_MS, the rendering pipeline is stalled.
  watchdogTimer = setInterval(() => {
    const now = performance.now();
    const gap = now - lastFrameTime;

    if (gap > FREEZE_THRESHOLD_MS) {
      console.error(
        `[FreezeDetector/watchdog] rAF stalled for ${Math.round(gap)}ms — rendering pipeline frozen`
      );
      const crumbs = readCrumbs();
      if (crumbs.length > 0) {
        console.error("[FreezeDetector/watchdog] Breadcrumb trail:");
        console.table(crumbs);
      }
    }
  }, 2000);

  // Listen for Rust-side ping events and respond with breadcrumbs.
  // The Rust watchdog detects when pongs stop arriving (frontend frozen).
  listen("freeze-ping", () => {
    const crumbs = readCrumbs();
    invoke("freeze_pong", {
      breadcrumbs: JSON.stringify(crumbs),
    }).catch(() => {
      // Ignore — invoke may fail during shutdown
    });
  }).then((unlisten) => {
    pingUnlisten = unlisten;
  });
}

/** Stop the freeze detector (cleanup). */
export function stopFreezeDetector(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (watchdogTimer !== null) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  if (pingUnlisten) {
    pingUnlisten();
    pingUnlisten = null;
  }
}
