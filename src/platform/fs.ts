// Platform wrapper for @tauri-apps/plugin-fs.
//
// Browser: writes reject with PlatformUnavailableError (callers surface the
// error or sit behind dialog.save/open, which return null in browsers and
// short-circuit these paths); exists() reports false.

import {
  writeTextFile as tauriWriteTextFile,
  writeFile as tauriWriteFile,
  mkdir as tauriMkdir,
  exists as tauriExists,
  copyFile as tauriCopyFile,
} from "@tauri-apps/plugin-fs";
import { isTauri } from "../utils/platform";
import { PlatformUnavailableError } from "./errors";

export const writeTextFile: typeof tauriWriteTextFile = async (...args) => {
  if (!isTauri()) throw new PlatformUnavailableError("fs.writeTextFile");
  return tauriWriteTextFile(...args);
};

export const writeFile: typeof tauriWriteFile = async (...args) => {
  if (!isTauri()) throw new PlatformUnavailableError("fs.writeFile");
  return tauriWriteFile(...args);
};

export const mkdir: typeof tauriMkdir = async (...args) => {
  if (!isTauri()) throw new PlatformUnavailableError("fs.mkdir");
  return tauriMkdir(...args);
};

export const exists: typeof tauriExists = async (...args) => {
  if (!isTauri()) return false;
  return tauriExists(...args);
};

export const copyFile: typeof tauriCopyFile = async (...args) => {
  if (!isTauri()) throw new PlatformUnavailableError("fs.copyFile");
  return tauriCopyFile(...args);
};
