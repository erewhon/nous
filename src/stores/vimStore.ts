import { create } from "zustand";
import type { VimMode } from "../components/Editor/vim/vimTypes";

interface VimStoreState {
  mode: VimMode;
  pendingKeys: string;
  setMode: (mode: VimMode) => void;
  setPendingKeys: (keys: string) => void;
}

export const useVimStore = create<VimStoreState>((set) => ({
  mode: "normal",
  pendingKeys: "",
  setMode: (mode) => set({ mode }),
  setPendingKeys: (pendingKeys) => set({ pendingKeys }),
}));
