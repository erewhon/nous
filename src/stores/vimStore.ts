import { create } from "zustand";
import type { VimMode } from "../components/Editor/vim/vimTypes";
import type { VimCommandLineState } from "../components/Editor/vim/vimExCommands";
import type { VimLeaderState } from "../components/Editor/vim/vimLeader";

interface VimStoreState {
  mode: VimMode;
  pendingKeys: string;
  /** Transient ex-command message (e.g. "written") shown in the indicator. */
  message: string;
  /** The `:` command line, or null when closed. */
  commandLine: VimCommandLineState | null;
  /** The `<leader>` which-key menu, or null when closed. */
  leaderMenu: VimLeaderState | null;
  setMode: (mode: VimMode) => void;
  setPendingKeys: (keys: string) => void;
  setMessage: (message: string) => void;
  setCommandLine: (commandLine: VimCommandLineState | null) => void;
  setLeaderMenu: (leaderMenu: VimLeaderState | null) => void;
}

export const useVimStore = create<VimStoreState>((set) => ({
  mode: "normal",
  pendingKeys: "",
  message: "",
  commandLine: null,
  leaderMenu: null,
  setMode: (mode) => set({ mode }),
  setPendingKeys: (pendingKeys) => set({ pendingKeys }),
  setMessage: (message) => set({ message }),
  setCommandLine: (commandLine) => set({ commandLine }),
  setLeaderMenu: (leaderMenu) => set({ leaderMenu }),
}));
