/**
 * Pure helpers for the document-processor host runtime.
 *
 * Extracted from useDocumentProcessors so they can be unit-tested without
 * React or a DOM: inline extraction (block + text dual view), title
 * resolution, and decoration-CSS building. The hook composes these.
 */
import type { Decoration, InlineRef } from "../../plugin-sdk/document-processor";

/** Loose shape of a BlockNote block as seen at the processing boundary. */
export interface AnyBlock {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: unknown;
}

/** Best-effort plain text for a single inline content item. */
export function inlineText(item: Record<string, unknown>): string {
  if (typeof item.text === "string") return item.text; // styled text
  if (Array.isArray(item.content)) {
    // e.g. link: content is an array of styled text
    return (item.content as Array<Record<string, unknown>>)
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .join("");
  }
  // Custom inline content (e.g. wikiLink): best-effort label from props
  const props = item.props as Record<string, unknown> | undefined;
  if (props && typeof props.pageTitle === "string") return props.pageTitle;
  return "";
}

/** Walk blocks (and children) appending a flat, normalized inline view to `out`. */
export function collectInlines(
  blocks: ReadonlyArray<AnyBlock>,
  out: InlineRef[],
): void {
  for (const block of blocks) {
    const blockId = block.id ?? "";
    if (Array.isArray(block.content)) {
      for (const raw of block.content as Array<Record<string, unknown>>) {
        const type = typeof raw.type === "string" ? raw.type : "text";
        out.push({
          blockId,
          type,
          text: inlineText(raw),
          props: raw.props as Record<string, unknown> | undefined,
        });
      }
    }
    if (Array.isArray(block.children) && block.children.length > 0) {
      collectInlines(block.children as AnyBlock[], out);
    }
  }
}

/** Convenience wrapper around collectInlines returning a fresh array. */
export function extractInlines(blocks: ReadonlyArray<AnyBlock>): InlineRef[] {
  const out: InlineRef[] = [];
  collectInlines(blocks, out);
  return out;
}

/** Whole-document plain text (space-joined inline text). */
export function buildText(inlines: ReadonlyArray<InlineRef>): string {
  return inlines.map((i) => i.text).join(" ");
}

/**
 * Build a case-insensitive title → page resolver from a candidate page list.
 * Trims and lowercases; later entries win on duplicate titles.
 */
export function buildTitleResolver(
  pages: ReadonlyArray<{ id: string; title: string }> | undefined,
): (title: string) => { id: string; title: string } | null {
  const byTitle = new Map<string, { id: string; title: string }>();
  for (const p of pages ?? []) {
    byTitle.set(p.title.trim().toLowerCase(), p);
  }
  return (title) => byTitle.get(title.trim().toLowerCase()) ?? null;
}

/** Escape a value for use inside a CSS attribute selector ([attr="value"]). */
export function cssAttrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Serialize a style record into a CSS declaration body. */
export function styleBody(style: Record<string, string>): string {
  return Object.entries(style)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

/**
 * Build the full CSS text for `inline-attr` decorations, scoped to one editor
 * instance (by its wrapper's data-page-id). `range` decorations are ignored
 * here — they need a ProseMirror applier, which is future work.
 */
export function buildDecorationCss(
  decorations: ReadonlyArray<Decoration>,
  pageId?: string,
): string {
  const scope = pageId
    ? `.bn-editor-wrapper[data-page-id="${cssAttrValue(pageId)}"] `
    : ".bn-editor-wrapper ";
  const rules: string[] = [];
  for (const d of decorations) {
    if (d.kind !== "inline-attr") continue;
    const selector = `${scope}[${d.attr}="${cssAttrValue(d.value)}"]`;
    rules.push(`${selector}{${styleBody(d.style)}}`);
  }
  return rules.join("\n");
}
