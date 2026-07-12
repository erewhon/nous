/**
 * Wiki-link autocomplete trigger — opens a suggestion menu on "[[".
 *
 * BlockNote's suggestion plugin supports multi-character triggers, but its
 * snippet detection is off by one (it compares `trigger.length` preceding
 * characters plus the typed one against the trigger string), so a "[["
 * trigger registered the normal way only fires at the very start of a
 * block. This extension does the detection itself: when "[" is typed
 * directly after a lone "[", it swallows the keystroke, removes the "["
 * already in the document, and re-opens the menu through the suggestion
 * extension's own state machine (which re-inserts the full "[[") so query
 * tracking, keyboard navigation, and clearQuery behave exactly like the
 * "/" menu.
 *
 * It also guards the open menu against trigger hijacking: while the wiki
 * menu is open, the ":" (emoji picker) and "/" (slash menu) trigger
 * characters are temporarily deregistered so queries like "[[Feature: Web"
 * extend the query instead of switching menus. Typing "]]" closes the menu
 * and leaves the literal text for the broken-wiki-link processor.
 */
import { createExtension } from "@blocknote/core";
import { SuggestionMenu } from "@blocknote/core/extensions";
import { Plugin } from "@tiptap/pm/state";

export const WIKI_LINK_TRIGGER = "[[";

// Both are always registered in our editor: we mount the "/" controller
// ourselves and BlockNote's default UI mounts the ":" emoji picker.
// (removeTriggerCharacter on an unregistered character would splice the
// wrong entry, so keep this list in sync with the mounted controllers.)
const SUPPRESSED_TRIGGERS = [":", "/"];

/**
 * Decide what a typed character does to the wiki-link menu. Pure logic,
 * kept separate from the ProseMirror plumbing for testability.
 *
 * @param typed the single character being inserted
 * @param prevChars up to two characters before the insertion point,
 *   within the same text block
 * @param menuOpen whether the wiki-link menu is currently open
 */
export function wikiTriggerAction(
  typed: string,
  prevChars: string,
  menuOpen: boolean,
): "open" | "close" | "pass" {
  if (menuOpen) {
    // The second "]" of "]]" ends the link as literal text.
    return typed === "]" && prevChars.endsWith("]") ? "close" : "pass";
  }
  if (typed !== "[") return "pass";
  // Trigger only on exactly one preceding "[" — a third "[" must not
  // re-open the menu inside "[[[".
  if (!prevChars.endsWith("[") || prevChars.endsWith("[[")) return "pass";
  return "open";
}

interface SuggestionMenuExt {
  store: {
    state?: { show?: boolean; triggerCharacter?: string };
    subscribe: (cb: () => void) => () => void;
  };
  openSuggestionMenu: (
    triggerCharacter: string,
    pluginState?: { deleteTriggerCharacter?: boolean },
  ) => void;
  closeMenu: () => void;
  addTriggerCharacter: (c: string) => void;
  removeTriggerCharacter: (c: string) => void;
}

export const WikiLinkTriggerExtension = createExtension(({ editor }) => {
  const getSuggestionExt = (): SuggestionMenuExt | undefined =>
    editor.getExtension(SuggestionMenu) as SuggestionMenuExt | undefined;

  const isWikiMenuOpen = () => {
    const state = getSuggestionExt()?.store.state;
    return !!state?.show && state.triggerCharacter === WIKI_LINK_TRIGGER;
  };

  return {
    key: "wikiLinkTrigger" as const,

    prosemirrorPlugins: [
      new Plugin({
        props: {
          handleTextInput(view, from, to, text) {
            // Plain single-character insertions only (no IME composition,
            // no replacements).
            if (from !== to || text.length !== 1) return false;
            const suggestion = getSuggestionExt();
            if (!suggestion) return false;

            const $from = view.state.doc.resolve(from);
            if ($from.parent.type.spec.code) return false;
            const offset = $from.parentOffset;
            const prevChars = $from.parent.textBetween(
              Math.max(0, offset - 2),
              offset,
            );

            const action = wikiTriggerAction(text, prevChars, isWikiMenuOpen());

            if (action === "close") {
              view.dispatch(view.state.tr.insertText(text));
              suggestion.closeMenu();
              return true;
            }
            if (action === "open") {
              // Remove the "[" already in the document and let the
              // suggestion extension insert the full "[[" itself, so its
              // position tracking (and clearQuery on selection) covers the
              // whole trigger.
              view.dispatch(view.state.tr.delete(from - 1, from));
              suggestion.openSuggestionMenu(WIKI_LINK_TRIGGER, {
                deleteTriggerCharacter: true,
              });
              return true;
            }
            return false;
          },
        },
      }),
    ],

    mount: ({ signal }: { signal: AbortSignal }) => {
      const suggestion = getSuggestionExt();
      if (!suggestion) return;

      let suppressed = false;
      const sync = () => {
        const open = isWikiMenuOpen();
        if (open && !suppressed) {
          suppressed = true;
          for (const c of SUPPRESSED_TRIGGERS) {
            suggestion.removeTriggerCharacter(c);
          }
        } else if (!open && suppressed) {
          suppressed = false;
          for (const c of SUPPRESSED_TRIGGERS) {
            suggestion.addTriggerCharacter(c);
          }
        }
      };

      const unsubscribe = suggestion.store.subscribe(sync);
      signal.addEventListener("abort", () => {
        unsubscribe();
        if (suppressed) {
          suppressed = false;
          for (const c of SUPPRESSED_TRIGGERS) {
            suggestion.addTriggerCharacter(c);
          }
        }
      });
    },
  } as const;
});
