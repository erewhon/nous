/**
 * Item provider for the "[[" wiki-link suggestion menu.
 *
 * Pure functions — the editor wiring (insertion, page creation) is passed
 * in as callbacks so this can be unit-tested without a BlockNote instance.
 */
import type { DefaultReactSuggestionItem } from "@blocknote/react";

export interface WikiLinkTarget {
  id: string;
  title: string;
}

export interface WikiLinkMenuActions {
  /** Insert a wikiLink inline for an existing page. */
  insertLink: (title: string, id: string) => void;
  /** Insert a wikiLink inline for a new page and create it. */
  createPage: (title: string) => void;
}

export const WIKI_LINK_MENU_LIMIT = 10;

/**
 * Strip closing brackets the user has already typed ("[[Page]]" leaves
 * "Page]]" as the tracked query) so they don't break filtering.
 */
export function cleanWikiLinkQuery(query: string): string {
  return query.replace(/\]+$/, "");
}

export function buildWikiLinkMenuItems(
  targets: WikiLinkTarget[],
  query: string,
  actions: WikiLinkMenuActions,
): DefaultReactSuggestionItem[] {
  const cleaned = cleanWikiLinkQuery(query);
  const q = cleaned.toLowerCase();

  const matches = targets.filter((t) => t.title.toLowerCase().includes(q));
  // Prefix matches first, then alphabetical within each group.
  matches.sort((a, b) => {
    const aPrefix = a.title.toLowerCase().startsWith(q);
    const bPrefix = b.title.toLowerCase().startsWith(q);
    if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  const items: DefaultReactSuggestionItem[] = matches
    .slice(0, WIKI_LINK_MENU_LIMIT)
    .map((t) => ({
      title: t.title,
      onItemClick: () => actions.insertLink(t.title, t.id),
      group: "Link to page",
    }));

  const hasExact = matches.some((t) => t.title.toLowerCase() === q);
  if (cleaned && !hasExact) {
    items.push({
      title: `Create page "${cleaned}"`,
      onItemClick: () => actions.createPage(cleaned),
      group: "New",
    });
  }

  return items;
}
