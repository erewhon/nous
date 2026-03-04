export type VimMode = "normal" | "insert" | "visual";

export interface VimState {
  mode: VimMode;
  pendingKeys: string;
  count: number;
  register: string;
  lastCommand: string;
  lastFindChar: string;
  lastFindDirection: "forward" | "backward";
  lastFindType: "to" | "find";
  visualAnchor: number | null;
}

export const DEFAULT_VIM_STATE: VimState = {
  mode: "normal",
  pendingKeys: "",
  count: 0,
  register: "",
  lastCommand: "",
  lastFindChar: "",
  lastFindDirection: "forward",
  lastFindType: "find",
  visualAnchor: null,
};
