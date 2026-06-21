import { create } from "zustand";
import type { VimMode } from "../components/Editor/vim/vimTypes";

interface VimStoreState {
  mode: VimMode;
  pendingKeys: string;
  /** Transient ex-command message (e.g. "written") shown in the indicator. */
  message: string;
  setMode: (mode: VimMode) => void;
  setPendingKeys: (keys: string) => void;
  setMessage: (message: string) => void;
}

export const useVimStore = create<VimStoreState>((set) => ({
  mode: "normal",
  pendingKeys: "",
  message: "",
  setMode: (mode) => set({ mode }),
  setPendingKeys: (pendingKeys) => set({ pendingKeys }),
  setMessage: (message) => set({ message }),
}));
