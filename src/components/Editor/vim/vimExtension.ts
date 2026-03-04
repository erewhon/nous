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

interface VimExtensionOptions {
  enabled: () => boolean;
  onModeChange: (mode: VimMode) => void;
  onPendingKeysChange: (keys: string) => void;
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
