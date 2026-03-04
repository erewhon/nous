/**
 * Block cursor decoration for vim normal/visual modes.
 *
 * Shows a character-width highlight at the cursor position and hides the
 * native blinking caret. In insert mode, the native caret is restored.
 */
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { VIM_PLUGIN_KEY } from "./vimPlugin";
import type { VimState } from "./vimTypes";

export const VIM_CURSOR_KEY = new PluginKey("vim-cursor");

export function createVimCursorPlugin(): Plugin {
  return new Plugin({
    key: VIM_CURSOR_KEY,

    props: {
      decorations(state) {
        const vimState = VIM_PLUGIN_KEY.getState(state) as
          | VimState
          | undefined;
        if (!vimState || vimState.mode === "insert") {
          return DecorationSet.empty;
        }

        const { from } = state.selection;
        const $pos = state.doc.resolve(from);
        const end = $pos.end();

        // Create a 1-char-wide inline decoration at cursor pos
        const decorationEnd = from < end ? from + 1 : from;
        if (from === decorationEnd) {
          // Empty text node — show a widget decoration instead
          const widget = Decoration.widget(from, () => {
            const span = document.createElement("span");
            span.className = "vim-block-cursor vim-block-cursor-empty";
            span.textContent = "\u00A0"; // nbsp
            return span;
          });
          return DecorationSet.create(state.doc, [widget]);
        }

        const deco = Decoration.inline(from, decorationEnd, {
          class: "vim-block-cursor",
        });
        return DecorationSet.create(state.doc, [deco]);
      },
    },
  });
}

/** CSS for the block cursor. Injected by the extension's mount(). */
export const VIM_CURSOR_CSS = `
.vim-block-cursor {
  background: var(--color-accent, #3b82f6);
  color: var(--bg-primary, #ffffff);
  border-radius: 1px;
}
.vim-block-cursor-empty {
  display: inline-block;
  width: 0.6em;
  background: var(--color-accent, #3b82f6);
  border-radius: 1px;
}
/* Hide native caret when vim is in normal/visual mode */
.vim-normal-mode .ProseMirror {
  caret-color: transparent;
}
`;
