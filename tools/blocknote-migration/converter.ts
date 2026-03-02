/**
 * Frozen snapshot of src/utils/blockFormatConverter.ts (editorJsToBlockNote direction only).
 *
 * Adapted for Node.js:
 * - Uses linkedom instead of browser DOMParser
 * - Imports types from local types.ts instead of src/types/page.ts
 * - blockNoteToEditorJs direction removed (not needed for migration)
 *
 * This file is intentionally a standalone copy — immune to future converter changes.
 */

import { parseHTML } from "linkedom";
import type { EditorData, EditorBlock } from "./types.js";

// ─── BlockNote types (simplified for the converter) ─────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
export type BNBlock = Record<string, any>;
export type BNInlineContent = Record<string, any>;
export type BNDocument = BNBlock[];
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Editor.js → BlockNote ──────────────────────────────────────────────────

/**
 * Convert an Editor.js document to BlockNote document format.
 */
export function editorJsToBlockNote(data: EditorData): BNDocument {
  const blocks: BNBlock[] = [];
  for (const block of data.blocks) {
    const converted = convertBlock(block);
    // Some blocks expand to multiple (e.g., lists)
    if (Array.isArray(converted)) {
      blocks.push(...converted);
    } else {
      blocks.push(converted);
    }
  }
  return blocks;
}

function convertBlock(block: EditorBlock): BNBlock | BNBlock[] {
  const data = block.data as Record<string, unknown>;

  switch (block.type) {
    case "paragraph":
      return {
        id: block.id,
        type: "paragraph",
        content: parseHtmlToInlineContent((data.text as string) ?? ""),
      };

    case "header":
      return {
        id: block.id,
        type: "heading",
        props: {
          level: Math.min((data.level as number) ?? 2, 3) as 1 | 2 | 3,
        },
        content: parseHtmlToInlineContent((data.text as string) ?? ""),
      };

    case "list":
      return convertList(block);

    case "checklist":
      return convertChecklist(block);

    case "code":
      return {
        id: block.id,
        type: "codeBlock",
        props: { language: (data.language as string) ?? "plaintext" },
        content: [
          { type: "text", text: (data.code as string) ?? "", styles: {} },
        ],
      };

    case "quote":
      return {
        id: block.id,
        type: "quote",
        content: parseHtmlToInlineContent((data.text as string) ?? ""),
      };

    case "delimiter":
      return { id: block.id, type: "delimiter" };

    case "table":
      return convertTable(block);

    case "image":
      return convertImage(block);

    case "callout":
      return {
        id: block.id,
        type: "callout",
        props: { type: (data.type as string) ?? "info" },
        content: parseHtmlToInlineContent((data.content as string) ?? ""),
      };

    case "flashcard":
      return {
        id: block.id,
        type: "flashcard",
        props: {
          front: (data.front as string) ?? "",
          back: (data.back as string) ?? "",
          cardType: (data.cardType as string) ?? "basic",
          deckId: (data.deckId as string) ?? "",
          cardId: (data.cardId as string) ?? "",
        },
      };

    case "database":
      return {
        id: block.id,
        type: "database",
        props: {
          contentJson: data.content ? JSON.stringify(data.content) : "",
        },
      };

    case "liveQuery":
      return {
        id: block.id,
        type: "liveQuery",
        props: {
          configJson: data.config ? JSON.stringify(data.config) : "",
          notebookId: (data.notebookId as string) ?? "",
        },
      };

    case "blockEmbed":
      return {
        id: block.id,
        type: "blockEmbed",
        props: {
          targetBlockId: (data.targetBlockId as string) ?? "",
          targetPageId: (data.targetPageId as string) ?? "",
          notebookId: (data.notebookId as string) ?? "",
        },
      };

    case "embed":
      return {
        id: block.id,
        type: "embed",
        props: {
          embedType: (data.embedType as string) ?? "page",
          pageTitle: (data.pageTitle as string) ?? "",
          pageId: (data.pageId as string) ?? "",
          url: (data.url as string) ?? "",
          isCollapsed: (data.isCollapsed as boolean) ?? false,
          caption: (data.caption as string) ?? "",
          displayMode: (data.displayMode as string) ?? "embed",
        },
      };

    case "pdf":
      return {
        id: block.id,
        type: "pdf",
        props: {
          filename: (data.filename as string) ?? "",
          url: (data.url as string) ?? "",
          originalName: (data.originalName as string) ?? "",
          caption: (data.caption as string) ?? "",
          currentPage: (data.currentPage as number) ?? 1,
          totalPages: (data.totalPages as number) ?? 0,
          displayMode: (data.displayMode as string) ?? "preview",
        },
      };

    case "video":
      return {
        id: block.id,
        type: "video",
        props: {
          filename: (data.filename as string) ?? "",
          url: (data.url as string) ?? "",
          caption: (data.caption as string) ?? "",
          currentTime: (data.currentTime as number) ?? 0,
          displayMode: (data.displayMode as string) ?? "standard",
          transcription: (data.transcription as string) ?? "",
          transcriptionStatus:
            (data.transcriptionStatus as string) ?? "idle",
          showTranscript: (data.showTranscript as boolean) ?? false,
        },
      };

    case "audio":
      return {
        id: block.id,
        type: "audio",
        props: {
          filename: (data.filename as string) ?? "",
          url: (data.url as string) ?? "",
          caption: (data.caption as string) ?? "",
          transcription: (data.transcription as string) ?? "",
          transcriptionStatus:
            (data.transcriptionStatus as string) ?? "idle",
          showTranscript: (data.showTranscript as boolean) ?? false,
          recordedAt: (data.recordedAt as string) ?? "",
        },
      };

    case "drawing":
      return {
        id: block.id,
        type: "drawing",
        props: {
          canvasDataJson: data.canvasData
            ? JSON.stringify(data.canvasData)
            : "",
          width: (data.width as number) ?? 800,
          height: (data.height as number) ?? 400,
          displayMode: (data.displayMode as string) ?? "standard",
          caption: (data.caption as string) ?? "",
        },
      };

    case "columns":
      return convertColumns(block);

    default:
      // Unknown block type — preserve as paragraph with raw text
      console.warn(`Unknown Editor.js block type: ${block.type}`);
      return {
        id: block.id,
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `[Unsupported block: ${block.type}]`,
            styles: {},
          },
        ],
      };
  }
}

// ─── List conversion ────────────────────────────────────────────────────────

function convertList(block: EditorBlock): BNBlock[] {
  const data = block.data as Record<string, unknown>;
  const style = (data.style as string) ?? "unordered";
  const items = (data.items as unknown[]) ?? [];
  const blockType =
    style === "ordered" ? "numberedListItem" : "bulletListItem";

  return flattenListItems(items, blockType, block.id);
}

function flattenListItems(
  items: unknown[],
  blockType: string,
  baseId: string,
  depth = 0,
): BNBlock[] {
  const result: BNBlock[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Record<string, unknown>;
    // Editor.js list items can be { content: string, items: [...] } or just strings
    const text =
      typeof item === "string"
        ? item
        : (item.content as string) ?? (item.text as string) ?? "";
    const children =
      typeof item === "object" ? (item.items as unknown[]) ?? [] : [];

    result.push({
      id: `${baseId}-${depth}-${i}`,
      type: blockType,
      content: parseHtmlToInlineContent(text),
      // BlockNote uses nested children for indentation
      children:
        children.length > 0
          ? flattenListItems(children, blockType, baseId, depth + 1)
          : [],
    });
  }
  return result;
}

function convertChecklist(block: EditorBlock): BNBlock[] {
  const data = block.data as Record<string, unknown>;
  const items = (data.items as unknown[]) ?? [];
  return flattenChecklistItems(items, block.id);
}

function flattenChecklistItems(
  items: unknown[],
  baseId: string,
  depth = 0,
): BNBlock[] {
  const result: BNBlock[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Record<string, unknown>;
    const text = (item.text as string) ?? (item.content as string) ?? "";
    const checked =
      (item.checked as boolean) ??
      (item.meta as Record<string, unknown>)?.checked ??
      false;
    const children =
      typeof item === "object" ? (item.items as unknown[]) ?? [] : [];

    result.push({
      id: `${baseId}-${depth}-${i}`,
      type: "checkListItem",
      props: { checked: !!checked },
      content: parseHtmlToInlineContent(text),
      children:
        children.length > 0
          ? flattenChecklistItems(children, baseId, depth + 1)
          : [],
    });
  }
  return result;
}

// ─── Table conversion ───────────────────────────────────────────────────────

function convertTable(block: EditorBlock): BNBlock {
  const data = block.data as Record<string, unknown>;
  const content = (data.content as string[][]) ?? [];

  return {
    id: block.id,
    type: "table",
    content: {
      type: "tableContent",
      rows: content.map((row) => ({
        cells: row.map((cell) => parseHtmlToInlineContent(cell)),
      })),
    },
  };
}

// ─── Image conversion ───────────────────────────────────────────────────────

function convertImage(block: EditorBlock): BNBlock {
  const data = block.data as Record<string, unknown>;
  const file = data.file as Record<string, unknown> | undefined;

  return {
    id: block.id,
    type: "image",
    props: {
      url: (file?.url as string) ?? (data.url as string) ?? "",
      caption: (data.caption as string) ?? "",
      previewWidth: (data.width as number) ?? undefined,
    },
  };
}

// ─── Columns conversion ─────────────────────────────────────────────────────

function convertColumns(block: EditorBlock): BNBlock {
  const data = block.data as Record<string, unknown>;
  const columnData = (data.columnData as { blocks: EditorBlock[] }[]) ?? [];

  return {
    id: block.id,
    type: "columnList",
    children: columnData.map((col, i) => ({
      id: `${block.id}-col-${i}`,
      type: "column",
      props: { width: 1 / columnData.length },
      children: col.blocks.flatMap((b) => {
        const converted = convertBlock(b);
        return Array.isArray(converted) ? converted : [converted];
      }),
    })),
  };
}

// ─── HTML → BlockNote inline content parser ─────────────────────────────────

/**
 * Parse Editor.js HTML inline content to BlockNote structured inline nodes.
 *
 * Uses linkedom for DOM parsing (Node.js compatible).
 */
export function parseHtmlToInlineContent(html: string): BNInlineContent[] {
  if (!html) return [];

  // Fast path: plain text with no HTML tags and no entities
  if (!/</.test(html) && !/&/.test(html)) {
    return [{ type: "text", text: html, styles: {} }];
  }

  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
  const body = document.body;

  const result: BNInlineContent[] = [];
  walkDom(body, {}, result);
  return result;
}

interface StyleState {
  bold?: true;
  italic?: true;
  code?: true;
  underline?: true;
  strike?: true;
  link?: string;
  highlight?: string;
}

// linkedom Node constants
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function walkDom(
  node: any,
  styles: StyleState,
  result: BNInlineContent[],
): void {
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]!;

    if (child.nodeType === TEXT_NODE) {
      const text = child.textContent ?? "";
      if (text) {
        // Merge with previous text node if same styles
        const prev = result[result.length - 1];
        if (prev && prev.type === "text" && stylesEqual(prev.styles, styles)) {
          prev.text += text;
        } else {
          result.push({ type: "text", text, styles: { ...styles } });
        }
      }
      continue;
    }

    if (child.nodeType !== ELEMENT_NODE) continue;
    const el = child;
    const tag = el.tagName.toLowerCase();

    // Custom elements
    if (tag === "wiki-link") {
      result.push({
        type: "wikiLink",
        props: {
          pageTitle: el.getAttribute("data-page-title") ?? "",
          pageId: el.getAttribute("data-page-id") ?? "",
        },
        content: undefined,
      });
      continue;
    }

    if (tag === "block-ref") {
      result.push({
        type: "blockRef",
        props: {
          blockId: el.getAttribute("data-block-id") ?? "",
          pageId: el.getAttribute("data-page-id") ?? "",
          text: el.textContent ?? "",
        },
        content: undefined,
      });
      continue;
    }

    // Style-modifying elements
    const newStyles = { ...styles };

    switch (tag) {
      case "b":
      case "strong":
        newStyles.bold = true;
        break;
      case "i":
      case "em":
        newStyles.italic = true;
        break;
      case "code":
        newStyles.code = true;
        break;
      case "u":
        newStyles.underline = true;
        break;
      case "s":
      case "strike":
      case "del":
        newStyles.strike = true;
        break;
      case "a": {
        const href = el.getAttribute("href");
        if (href) {
          // Links in BlockNote are inline content, not styles
          const linkContent: BNInlineContent[] = [];
          walkDom(el, { ...styles }, linkContent);
          // Merge text content for the link
          const linkText = linkContent
            .map((c: BNInlineContent) => (c.type === "text" ? c.text : ""))
            .join("");
          result.push({
            type: "link",
            href,
            content: [{ type: "text", text: linkText, styles: { ...styles } }],
          });
          continue;
        }
        break;
      }
      case "mark": {
        const color =
          el.getAttribute("data-color") ??
          el.style?.backgroundColor ??
          "yellow";
        newStyles.highlight = color;
        break;
      }
      case "br": {
        // Preserve line breaks as newlines
        const prev = result[result.length - 1];
        if (prev && prev.type === "text") {
          prev.text += "\n";
        } else {
          result.push({ type: "text", text: "\n", styles: { ...styles } });
        }
        continue;
      }
    }

    walkDom(el, newStyles, result);
  }
}

function stylesEqual(a: StyleState, b: StyleState): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.code === b.code &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.link === b.link &&
    a.highlight === b.highlight
  );
}
