// Platform wrapper for @tauri-apps/api/window.
//
// The app uses exactly three things from the current window: setTitle,
// onCloseRequested (flush saves before close), and onDragDropEvent (OS file
// drop). Browser: setTitle drives document.title; the listeners are no-ops
// (tab-close save flushing is handled by the page-editing parity task,
// HTML5 drag-drop by the import/export task).

import { getCurrentWindow as tauriGetCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../utils/platform";

type TauriWindow = ReturnType<typeof tauriGetCurrentWindow>;

export type PlatformWindow = Pick<
  TauriWindow,
  "setTitle" | "onCloseRequested" | "onDragDropEvent" | "destroy"
>;

const browserWindowStub = {
  async setTitle(title: string): Promise<void> {
    document.title = title;
  },
  async onCloseRequested(): Promise<() => void> {
    return () => {};
  },
  async onDragDropEvent(): Promise<() => void> {
    return () => {};
  },
  // Browsers don't let a page close its own tab; the close-requested flow
  // that ends in destroy() never runs in the browser anyway.
  async destroy(): Promise<void> {},
} as unknown as PlatformWindow;

export function getCurrentWindow(): PlatformWindow {
  if (!isTauri()) {
    return browserWindowStub;
  }
  return tauriGetCurrentWindow();
}
