// Platform detection for the web-parity build.
//
// The desktop app runs inside the Tauri shell; the web build is the same
// frontend served to a plain browser (see "Feature: Web Frontend Parity" in
// Forge). Code that needs shell services (invoke, dialogs, windowing) must
// check here and degrade gracefully in the browser.

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
