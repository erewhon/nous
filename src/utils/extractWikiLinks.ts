// Shared wiki-link extraction over stored Editor.js block JSON.
//
// Both editors serialize links as <wiki-link data-page-title="..."> elements
// in block text (Editor.js WikiLinkTool.surround and the BlockNote
// blockFormatConverter) — but the old WikiLinkTool.extractLinks only matched
// the raw [[Title]] typing syntax, so the frontend backlink index missed
// every saved link. This util handles both forms and is what linkStore
// builds the index from.

const RAW_RE = /\[\[([^\]]+)\]\]/g;
const ELEMENT_RE = /<wiki-link\b[^>]*?data-page-title="([^"]*)"[^>]*>/g;

function decodeAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function collectFrom(text: string, out: string[]): void {
  let m: RegExpExecArray | null;
  const raw = new RegExp(RAW_RE.source, "g");
  while ((m = raw.exec(text)) !== null) out.push(m[1]!);
  const el = new RegExp(ELEMENT_RE.source, "g");
  while ((m = el.exec(text)) !== null) {
    const title = decodeAttr(m[1]!).trim();
    if (title) out.push(title);
  }
}

interface ExtractableBlock {
  type: string;
  data: Record<string, unknown>;
}

/** Extract linked page titles from stored blocks (deduplicated, in order). */
export function extractWikiLinks(blocks: ExtractableBlock[]): string[] {
  const links: string[] = [];

  for (const block of blocks) {
    const { data } = block;
    if (typeof data.text === "string") collectFrom(data.text, links);
    if (typeof data.content === "string") collectFrom(data.content, links);
    if (Array.isArray(data.items)) {
      for (const item of data.items) {
        if (typeof item === "string") {
          collectFrom(item, links);
        } else if (item && typeof item === "object") {
          const rec = item as Record<string, unknown>;
          if (typeof rec.text === "string") collectFrom(rec.text, links);
          if (typeof rec.content === "string") collectFrom(rec.content, links);
        }
      }
    }
  }

  return [...new Set(links)];
}
