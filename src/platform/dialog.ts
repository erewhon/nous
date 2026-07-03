// Platform wrapper for @tauri-apps/plugin-dialog.
//
// In a browser there are no native file dialogs; save/open resolve to null,
// which every call site already treats as "user cancelled". Download/file-
// input fallbacks are the "Browser: import/export and file dialog fallbacks"
// task.

import {
  save as tauriSave,
  open as tauriOpen,
} from "@tauri-apps/plugin-dialog";
import { isTauri } from "../utils/platform";

export const save: typeof tauriSave = async (options) => {
  if (!isTauri()) return null;
  return tauriSave(options);
};

export const open = (async (options?: Parameters<typeof tauriOpen>[0]) => {
  if (!isTauri()) return null;
  return tauriOpen(options);
}) as typeof tauriOpen;
