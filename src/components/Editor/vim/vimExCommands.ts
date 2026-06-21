/**
 * Pure ex-command registry, parser, and completion for the vim command line.
 *
 * Kept free of React/ProseMirror so it can be unit-tested directly and shared
 * between the plugin (which executes) and the UI (which renders completions).
 */

export interface ExCommandDef {
  /** The text typed after `:` (e.g. "wq"). */
  name: string;
  /** Short description shown in the completion dropdown. */
  description: string;
}

/** Named ex commands offered in completion. Numeric / `$` jumps aren't listed. */
export const EX_COMMANDS: ExCommandDef[] = [
  { name: "w", description: "Write (save)" },
  { name: "wq", description: "Write and quit" },
  { name: "x", description: "Write if changed and quit" },
  { name: "q", description: "Quit" },
  { name: "q!", description: "Quit without saving" },
];

/** The parsed intent of a command-line entry. Side-effect-free. */
export type ExAction =
  | { kind: "noop" } // empty input
  | { kind: "save" } // w / wq / x
  | { kind: "quit" } // q / q!
  | { kind: "goto"; line: number } // :{n} — 1-based block index
  | { kind: "gotoLast" } // :$
  | { kind: "unknown"; input: string };

/** Parse a command-line buffer (text after `:`) into an action. */
export function parseExCommand(raw: string): ExAction {
  const cmd = raw.trim();
  if (cmd === "") return { kind: "noop" };
  if (cmd === "w" || cmd === "wq" || cmd === "x") return { kind: "save" };
  if (cmd === "q" || cmd === "q!") return { kind: "quit" };
  if (cmd === "$") return { kind: "gotoLast" };
  if (/^\d+$/.test(cmd)) return { kind: "goto", line: parseInt(cmd, 10) };
  return { kind: "unknown", input: cmd };
}

/**
 * Commands whose names start with the typed buffer, for the completion list.
 * Empty buffer → all commands; a numeric/`$` jump → none (nothing to complete).
 */
export function completionsFor(buffer: string): ExCommandDef[] {
  const b = buffer.trim();
  if (b === "") return EX_COMMANDS;
  if (b === "$" || /^\d+$/.test(b)) return [];
  return EX_COMMANDS.filter((c) => c.name.startsWith(b));
}

/** State the command-line UI renders. `null` when the command line is closed. */
export interface VimCommandLineState {
  /** Text typed after the `:` prompt. */
  buffer: string;
  /** Completions matching the current input (or frozen stem while cycling). */
  completions: ExCommandDef[];
  /** Index of the highlighted completion, or -1 when none is selected. */
  completionIndex: number;
}
