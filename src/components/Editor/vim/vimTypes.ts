export type VimMode = "normal" | "insert" | "visual";

export interface EditRecord {
  type: "operator-motion" | "operator-line" | "simple";
  operator?: "d" | "c" | "y";
  motionKey?: string;
  motionArg?: string;
  command?: string; // for simple: "x", "X", "D", "J", "r", etc.
  arg?: string; // for r{char}
  count: number;
}

export interface VimState {
  mode: VimMode;
  pendingKeys: string;
  count: number;
  register: string;
  registerType: "charwise" | "linewise";
  lastCommand: string;
  lastFindChar: string;
  lastFindDirection: "forward" | "backward";
  lastFindType: "to" | "find";
  visualAnchor: number | null;
  lastEditRecord: EditRecord | null;
}

export const DEFAULT_VIM_STATE: VimState = {
  mode: "normal",
  pendingKeys: "",
  count: 0,
  register: "",
  registerType: "linewise",
  lastCommand: "",
  lastFindChar: "",
  lastFindDirection: "forward",
  lastFindType: "find",
  visualAnchor: null,
  lastEditRecord: null,
};
