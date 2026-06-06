/**
 * Built-in document processor: broken wiki-link marking.
 *
 * Scans the page's inline content for `wikiLink` items and resolves each
 * title against the live page index. Titles with no matching page are
 * decorated as broken and reported as diagnostics, with a "Create page"
 * action. Brokenness is a property of the *title* (if "Foo" doesn't exist,
 * every [[Foo]] on the page is broken), so decorations are keyed by title.
 *
 * This is the first real consumer of the document-processor contract and the
 * BlockNote-side replacement for the Editor.js `generateBrokenLinkCSS` path
 * (which is left untouched until that editor is fully retired).
 */
import type {
  Action,
  Decoration,
  Diagnostic,
  DocumentProcessor,
  ProcessorResult,
} from "../document-processor";

/** Visual treatment for a broken link. Themed via CSS vars where available. */
const BROKEN_STYLE: Record<string, string> = {
  color: "var(--wiki-link-broken-color, var(--bn-colors-editor-text-muted, #999))",
  "text-decoration": "line-through",
  "text-decoration-thickness": "1px",
  "text-decoration-style": "solid",
  cursor: "help",
};

export const wikiLinkProcessor: DocumentProcessor = {
  id: "nous.wiki-link",
  title: "Broken wiki-link marking",
  runtime: "frontend",
  view: "block",
  triggers: ["edit", "index"],
  debounceMs: 350,
  defaultEnabled: true,

  process(ctx): ProcessorResult {
    const brokenTitles = new Set<string>();

    for (const inline of ctx.inlines) {
      if (inline.type !== "wikiLink") continue;
      const title = String(inline.props?.pageTitle ?? "").trim();
      if (!title) continue;
      if (ctx.resolvePageByTitle(title)) continue;
      brokenTitles.add(title);
    }

    const decorations: Decoration[] = [];
    const diagnostics: Diagnostic[] = [];
    const actions: Action[] = [];

    for (const title of brokenTitles) {
      decorations.push({
        kind: "inline-attr",
        attr: "data-page-title",
        value: title,
        style: BROKEN_STYLE,
      });
      diagnostics.push({
        // Title-scoped; a precise block range is a future refinement.
        range: { blockId: "" },
        severity: "info",
        message: `No page titled "${title}"`,
        source: "nous.wiki-link",
      });
      if (ctx.createPage) {
        const create = ctx.createPage;
        actions.push({
          id: `nous.wiki-link/create:${title}`,
          title: `Create page "${title}"`,
          run: () => create(title),
        });
      }
    }

    return { decorations, diagnostics, actions };
  },
};
