// Platform wrapper for @tauri-apps/api/core.
//
// All frontend code must import invoke/convertFileSrc from here, not from
// @tauri-apps directly (see "Feature: Web Frontend Parity" in Forge). In the
// Tauri shell these pass straight through; in a browser, invoke rejects with
// a typed PlatformUnavailableError that callers can catch to degrade, and
// convertFileSrc maps paths under a notebook assets/ dir to daemon asset
// URLs (other paths pass through unchanged).

import {
  invoke as tauriInvoke,
  convertFileSrc as tauriConvertFileSrc,
} from "@tauri-apps/api/core";
import { isTauri } from "../utils/platform";
import { resolveAssetUrl } from "../utils/assetUrl";
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
    return resolveAssetUrl(filePath);
  }
  return tauriConvertFileSrc(filePath, protocol);
};
