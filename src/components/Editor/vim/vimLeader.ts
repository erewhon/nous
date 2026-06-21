/**
 * Pure leader-key registry for the vim which-key menu.
 *
 * `<leader>` (Space) opens a small popup of bindings; the next key runs one.
 * Kept free of React/ProseMirror so it can be unit-tested and shared between
 * the plugin (which executes) and the menu UI (which renders).
 */

/** The leader key (LazyVim convention). Space is not a normal-mode motion here. */
export const LEADER_KEY = " ";

/** Actions a leader binding can trigger. */
export type LeaderActionId = "commandPalette" | "save";

export interface LeaderBinding {
  /** Key pressed after `<leader>`. */
  key: string;
  /** Label shown in the which-key menu. */
  label: string;
  action: LeaderActionId;
}

/** Leader bindings, in display order. Extend this list to grow the menu. */
export const LEADER_BINDINGS: LeaderBinding[] = [
  { key: " ", label: "Command palette", action: "commandPalette" },
  { key: "w", label: "Write (save)", action: "save" },
];

/** Find the binding for a key pressed after the leader, if any. */
export function leaderBindingFor(key: string): LeaderBinding | undefined {
  return LEADER_BINDINGS.find((b) => b.key === key);
}

/** Human-readable label for a leader key (Space rendered as ␣). */
export function leaderKeyLabel(key: string): string {
  return key === " " ? "␣" : key;
}

/** State the which-key menu renders. `null` when the menu is closed. */
export interface VimLeaderState {
  bindings: LeaderBinding[];
}
