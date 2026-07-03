// Platform wrapper for @tauri-apps/api/event.
//
// Shell events (ai-stream, menu actions, file watching) never fire in a
// browser; listen() resolves to a no-op unlisten so registration sites work
// unchanged.

import {
  listen as tauriListen,
  type UnlistenFn,
} from "@tauri-apps/api/event";
import { isTauri } from "../utils/platform";

export type { UnlistenFn };

export const listen: typeof tauriListen = async (event, handler, options) => {
  if (!isTauri()) {
    return () => {};
  }
  return tauriListen(event, handler, options);
};
