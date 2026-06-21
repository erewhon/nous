/**
 * BlockNote extension that wraps the vim ProseMirror plugins.
 *
 * Always registered in the editor but checks `enabled()` callback on every
 * keydown so the keymap setting can be toggled without recreating the editor.
 */
import { createExtension } from "@blocknote/core";
import { createVimPlugin } from "./vimPlugin";
import { createVimCursorPlugin, VIM_CURSOR_CSS } from "./vimCursor";
import type { VimMode } from "./vimTypes";
import type { VimCommandLineState } from "./vimExCommands";
import type { VimLeaderState } from "./vimLeader";

interface VimExtensionOptions {
  enabled: () => boolean;
  onModeChange: (mode: VimMode) => void;
  onPendingKeysChange: (keys: string) => void;
  /** Persist the buffer (invoked by `:w`/`:wq`/`:x`). Resolves on success. */
  requestSave: () => Promise<void> | void;
  /** Show a transient ex-command message (e.g. "written"). */
  setMessage: (msg: string) => void;
  /** Update the `:` command-line UI state (null = closed). */
  onCommandLineChange: (state: VimCommandLineState | null) => void;
  /** Update the `<leader>` which-key menu state (null = closed). */
  onLeaderChange: (state: VimLeaderState | null) => void;
  /** Open the app command palette (invoked by `<leader><leader>`). */
  onOpenCommandPalette: () => void;
}

export const VimExtension = createExtension(
  ({
    editor,
    options,
  }: {
    editor: any;
    options: VimExtensionOptions;
  }) => ({
    key: "vim" as const,

    prosemirrorPlugins: [
      createVimPlugin({
        bnEditor: editor,
        enabled: options.enabled,
        onModeChange: options.onModeChange,
        onPendingKeysChange: options.onPendingKeysChange,
        requestSave: options.requestSave,
        setMessage: options.setMessage,
        onCommandLineChange: options.onCommandLineChange,
        onLeaderChange: options.onLeaderChange,
        onOpenCommandPalette: options.onOpenCommandPalette,
      }),
      createVimCursorPlugin(),
    ],

    mount: ({ signal }: { signal: AbortSignal }) => {
      // Inject block cursor CSS
      const style = document.createElement("style");
      style.textContent = VIM_CURSOR_CSS;
      document.head.appendChild(style);

      signal.addEventListener("abort", () => {
        style.remove();
      });
    },
  }),
);
