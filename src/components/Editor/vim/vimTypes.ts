export type VimMode = "normal" | "insert" | "visual" | "visual-line";

/** A minimal snapshot of a block for the linewise register (type + content). */
export interface PartialBlockSnapshot {
  type: string;
  props: Record<string, unknown>;
  content: unknown;
  children: unknown[];
}

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
  /**
   * Structured blocks captured by a linewise yank/delete, so a linewise
   * paste can reconstruct the original block types (heading, list, …)
   * instead of flattening to paragraphs. Null for charwise registers.
   */
  registerBlocks: PartialBlockSnapshot[] | null;
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
  registerBlocks: null,
  lastCommand: "",
  lastFindChar: "",
  lastFindDirection: "forward",
  lastFindType: "find",
  visualAnchor: null,
  lastEditRecord: null,
};
