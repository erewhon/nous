// Platform wrapper for @tauri-apps/api/core.
//
// All frontend code must import invoke/convertFileSrc from here, not from
// @tauri-apps directly (see "Feature: Web Frontend Parity" in Forge). In the
// Tauri shell these pass straight through; in a browser, invoke rejects with
// a typed PlatformUnavailableError that callers can catch to degrade, and
// convertFileSrc passes the path through unchanged (daemon-served asset
// mapping is a follow-up task).

import {
  invoke as tauriInvoke,
  convertFileSrc as tauriConvertFileSrc,
} from "@tauri-apps/api/core";
import { isTauri } from "../utils/platform";
import { PlatformUnavailableError } from "./errors";

export { PlatformUnavailableError };

export const invoke: typeof tauriInvoke = async (cmd, args, options) => {
  if (!isTauri()) {
    throw new PlatformUnavailableError(`invoke("${cmd}")`);
  }
  return tauriInvoke(cmd, args, options);
};

export const convertFileSrc: typeof tauriConvertFileSrc = (
  filePath,
  protocol
) => {
  if (!isTauri()) {
    return filePath;
  }
  return tauriConvertFileSrc(filePath, protocol);
};
