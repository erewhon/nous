import type { EditorBlock } from "../types/page";

const MAX_BLOCKS = 500;

// Inline tags to preserve in text content
const INLINE_TAGS = new Set([
  "B",
  "STRONG",
  "I",
  "EM",
  "CODE",
  "A",
  "MARK",
  "U",
  "S",
  "DEL",
  "SUB",
  "SUP",
  "SPAN",
  "BR",
]);

/**
 * Convert clean HTML (from readability) into Editor.js blocks.
 */
export function htmlToEditorBlocks(
  html: string,
  baseUrl: string
): EditorBlock[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks: EditorBlock[] = [];

  for (const node of Array.from(doc.body.children)) {
    const result = processElement(node as HTMLElement, baseUrl);
    blocks.push(...result);
    if (blocks.length >= MAX_BLOCKS) break;
  }

  return blocks.slice(0, MAX_BLOCKS);
}

function makeBlock(
  type: string,
  data: Record<string, unknown>
): EditorBlock {
  return { id: crypto.randomUUID().slice(0, 10), type, data };
}

function resolveUrl(href: string, baseUrl: string): string {
  if (
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("data:")
  ) {
    return href;
  }
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

/**
 * Get text content preserving inline HTML tags.
 */
function getTextContent(el: HTMLElement, baseUrl: string): string {
  let result = "";

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += child.textContent ?? "";
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as HTMLElement;
      const tag = childEl.tagName;

      if (INLINE_TAGS.has(tag)) {
        if (tag === "BR") {
          result += "<br>";
        } else if (tag === "A") {
          const href = resolveUrl(
            childEl.getAttribute("href") ?? "",
            baseUrl
          );
          result += `<a href="${href}">${getTextContent(childEl, baseUrl)}</a>`;
        } else {
          // Map tags to standard Editor.js inline markup
          const mapped = mapInlineTag(tag);
          result += `<${mapped}>${getTextContent(childEl, baseUrl)}</${mapped}>`;
        }
      } else {
        // Unknown element — just grab its text content
        result += getTextContent(childEl, baseUrl);
      }
    }
  }

  return result;
}

function mapInlineTag(tag: string): string {
  switch (tag) {
    case "STRONG":
      return "b";
    case "B":
      return "b";
    case "EM":
      return "i";
    case "I":
      return "i";
    case "DEL":
      return "s";
    case "S":
      return "s";
    default:
      return tag.toLowerCase();
  }
}

function processElement(el: HTMLElement, baseUrl: string): EditorBlock[] {
  const tag = el.tagName;

  switch (tag) {
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6": {
      const level = parseInt(tag[1], 10);
      const text = getTextContent(el, baseUrl).trim();
      if (!text) return [];
      return [
        makeBlock("header", { text, level: Math.min(level, 4) }),
      ];
    }

    case "P": {
      const text = getTextContent(el, baseUrl).trim();
      if (!text) return [];
      return [makeBlock("paragraph", { text })];
    }

    case "UL":
      return [processListElement(el, "unordered", baseUrl)];

    case "OL":
      return [processListElement(el, "ordered", baseUrl)];

    case "PRE": {
      const codeEl = el.querySelector("code");
      const code = (codeEl ?? el).textContent ?? "";
      // Try to detect language from class (e.g., "language-js", "highlight-python")
      const langClass =
        codeEl?.className?.match(/(?:language|lang|highlight)-(\w+)/)?.[1] ??
        "";
      return [makeBlock("code", { code, language: langClass })];
    }

    case "BLOCKQUOTE": {
      const text = getTextContent(el, baseUrl).trim();
      if (!text) return [];
      return [makeBlock("quote", { text, caption: "" })];
    }

    case "IMG": {
      const src = el.getAttribute("src");
      if (!src) return [];
      const caption = el.getAttribute("alt") ?? "";
      return [
        makeBlock("image", {
          file: { url: resolveUrl(src, baseUrl) },
          caption,
          withBorder: false,
          stretched: false,
          withBackground: false,
        }),
      ];
    }

    case "FIGURE": {
      return processFigure(el, baseUrl);
    }

    case "TABLE": {
      return processTable(el, baseUrl);
    }

    case "HR": {
      return [makeBlock("delimiter", {})];
    }

    case "DIV":
    case "SECTION":
    case "ARTICLE":
    case "MAIN":
    case "ASIDE": {
      // Unwrap container elements and process children
      const blocks: EditorBlock[] = [];
      for (const child of Array.from(el.children)) {
        blocks.push(...processElement(child as HTMLElement, baseUrl));
      }
      // If div has no element children but has text, treat as paragraph
      if (blocks.length === 0) {
        const text = getTextContent(el, baseUrl).trim();
        if (text) {
          blocks.push(makeBlock("paragraph", { text }));
        }
      }
      return blocks;
    }

    default: {
      // Fallback: if it contains block-level children, process them
      const childBlocks: EditorBlock[] = [];
      for (const child of Array.from(el.children)) {
        childBlocks.push(
          ...processElement(child as HTMLElement, baseUrl)
        );
      }
      if (childBlocks.length > 0) return childBlocks;

      // Otherwise treat as paragraph
      const text = getTextContent(el, baseUrl).trim();
      if (!text) return [];
      return [makeBlock("paragraph", { text })];
    }
  }
}

interface NestedListItem {
  content: string;
  items: NestedListItem[];
}

function processListElement(
  el: HTMLElement,
  style: "ordered" | "unordered",
  baseUrl: string
): EditorBlock {
  function collectItems(listEl: HTMLElement): NestedListItem[] {
    const items: NestedListItem[] = [];
    for (const li of Array.from(listEl.children)) {
      if (li.tagName === "LI") {
        let text = "";
        let nestedItems: NestedListItem[] = [];
        for (const child of Array.from(li.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE) {
            text += child.textContent ?? "";
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            const childEl = child as HTMLElement;
            if (childEl.tagName === "UL" || childEl.tagName === "OL") {
              nestedItems = collectItems(childEl);
            } else {
              text += getTextContent(childEl, baseUrl);
            }
          }
        }
        const trimmed = text.trim();
        if (trimmed || nestedItems.length > 0) {
          items.push({ content: trimmed, items: nestedItems });
        }
      }
    }
    return items;
  }

  const items = collectItems(el);
  return makeBlock("list", { style, items });
}

function processFigure(el: HTMLElement, baseUrl: string): EditorBlock[] {
  const img = el.querySelector("img");
  const figcaption = el.querySelector("figcaption");

  if (img) {
    const src = img.getAttribute("src");
    if (!src) return [];
    const caption =
      figcaption?.textContent?.trim() ?? img.getAttribute("alt") ?? "";
    return [
      makeBlock("image", {
        file: { url: resolveUrl(src, baseUrl) },
        caption,
        withBorder: false,
        stretched: false,
        withBackground: false,
      }),
    ];
  }

  // Figure without img — process children as blocks
  const blocks: EditorBlock[] = [];
  for (const child of Array.from(el.children)) {
    if ((child as HTMLElement).tagName !== "FIGCAPTION") {
      blocks.push(...processElement(child as HTMLElement, baseUrl));
    }
  }
  return blocks;
}

function processTable(
  el: HTMLElement,
  baseUrl: string
): EditorBlock[] {
  const rows: string[][] = [];
  let withHeadings = false;

  const thead = el.querySelector("thead");
  if (thead) {
    withHeadings = true;
    for (const tr of Array.from(thead.querySelectorAll("tr"))) {
      const cells: string[] = [];
      for (const td of Array.from(tr.querySelectorAll("th, td"))) {
        cells.push(getTextContent(td as HTMLElement, baseUrl).trim());
      }
      if (cells.length > 0) rows.push(cells);
    }
  }

  const tbody = el.querySelector("tbody") ?? el;
  for (const tr of Array.from(tbody.querySelectorAll("tr"))) {
    // Skip rows already processed from thead
    if (thead && tr.closest("thead")) continue;
    const cells: string[] = [];
    for (const td of Array.from(tr.querySelectorAll("th, td"))) {
      cells.push(getTextContent(td as HTMLElement, baseUrl).trim());
    }
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return [];

  return [makeBlock("table", { withHeadings, content: rows })];
}
