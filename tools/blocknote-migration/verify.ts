/**
 * Text fidelity verification for the migration.
 *
 * Extracts plain text from EditorJS blocks and BlockNote blocks,
 * then compares to ensure no content was lost in conversion.
 */

import type { EditorBlock } from "./types.js";
import type { BNBlock, BNInlineContent } from "./converter.js";

/**
 * Extract plain text from an EditorJS block array.
 * Strips HTML tags, collects text from all known data fields.
 */
export function extractTextFromEditorJS(blocks: EditorBlock[]): string {
  const parts: string[] = [];

  for (const block of blocks) {
    const data = block.data as Record<string, unknown>;

    switch (block.type) {
      case "paragraph":
      case "header":
      case "quote":
        parts.push(stripHtml((data.text as string) ?? ""));
        break;

      case "code":
        parts.push((data.code as string) ?? "");
        break;

      case "callout":
        parts.push(stripHtml((data.content as string) ?? ""));
        break;

      case "list":
        extractListItemsText(data.items as unknown[] ?? [], parts);
        break;

      case "checklist":
        extractChecklistItemsText(data.items as unknown[] ?? [], parts);
        break;

      case "table": {
        const content = (data.content as string[][]) ?? [];
        for (const row of content) {
          for (const cell of row) {
            parts.push(stripHtml(cell));
          }
        }
        break;
      }

      case "image":
        parts.push((data.caption as string) ?? "");
        break;

      case "flashcard":
        parts.push((data.front as string) ?? "");
        parts.push((data.back as string) ?? "");
        break;

      case "embed":
        parts.push((data.pageTitle as string) ?? "");
        parts.push((data.caption as string) ?? "");
        break;

      case "columns": {
        const columnData = (data.columnData as { blocks: EditorBlock[] }[]) ?? [];
        for (const col of columnData) {
          parts.push(extractTextFromEditorJS(col.blocks));
        }
        break;
      }

      case "delimiter":
        // No text content
        break;

      default:
        // Try common text fields
        if (typeof data.text === "string") parts.push(stripHtml(data.text));
        if (typeof data.content === "string") parts.push(stripHtml(data.content));
        break;
    }
  }

  return parts.filter(Boolean).join("\n");
}

function extractListItemsText(items: unknown[], parts: string[]): void {
  for (const item of items) {
    if (typeof item === "string") {
      parts.push(stripHtml(item));
    } else if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      const text = (obj.content as string) ?? (obj.text as string) ?? "";
      parts.push(stripHtml(text));
      const children = (obj.items as unknown[]) ?? [];
      if (children.length > 0) {
        extractListItemsText(children, parts);
      }
    }
  }
}

function extractChecklistItemsText(items: unknown[], parts: string[]): void {
  for (const item of items) {
    if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      const text = (obj.text as string) ?? (obj.content as string) ?? "";
      parts.push(stripHtml(text));
      const children = (obj.items as unknown[]) ?? [];
      if (children.length > 0) {
        extractChecklistItemsText(children, parts);
      }
    }
  }
}

/**
 * Extract plain text from a BlockNote block array.
 * Walks content[] arrays collecting .text fields recursively.
 */
export function extractTextFromBlockNote(blocks: BNBlock[]): string {
  const parts: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "paragraph":
      case "heading":
      case "quote":
      case "callout":
      case "bulletListItem":
      case "numberedListItem":
      case "checkListItem":
        parts.push(extractInlineText(block.content ?? []));
        break;

      case "codeBlock":
        parts.push(extractInlineText(block.content ?? []));
        break;

      case "table":
        if (block.content?.rows) {
          for (const row of block.content.rows) {
            for (const cell of row.cells ?? []) {
              parts.push(extractInlineText(cell));
            }
          }
        }
        break;

      case "image":
        parts.push(block.props?.caption ?? "");
        break;

      case "flashcard":
        parts.push(block.props?.front ?? "");
        parts.push(block.props?.back ?? "");
        break;

      case "embed":
        parts.push(block.props?.pageTitle ?? "");
        parts.push(block.props?.caption ?? "");
        break;

      case "columnList":
        for (const col of block.children ?? []) {
          parts.push(extractTextFromBlockNote(col.children ?? []));
        }
        break;

      case "delimiter":
        break;

      default:
        // Try content array
        if (Array.isArray(block.content)) {
          parts.push(extractInlineText(block.content));
        }
        break;
    }

    // Recurse into children (for list items with nested children)
    if (block.type !== "columnList" && Array.isArray(block.children) && block.children.length > 0) {
      parts.push(extractTextFromBlockNote(block.children));
    }
  }

  return parts.filter(Boolean).join("\n");
}

function extractInlineText(content: BNInlineContent[]): string {
  return content
    .map((node) => {
      if (node.type === "text") return node.text ?? "";
      if (node.type === "link") {
        return (node.content ?? [])
          .map((c: BNInlineContent) => c.text ?? "")
          .join("");
      }
      if (node.type === "wikiLink") return node.props?.pageTitle ?? "";
      if (node.type === "blockRef") return node.props?.text ?? "";
      return "";
    })
    .join("");
}

/**
 * Strip HTML tags from a string, returning plain text.
 */
function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Compare two text extractions and return whether they match.
 * Normalizes whitespace for comparison.
 */
export function compareText(before: string, after: string): boolean {
  const normalize = (s: string) =>
    s.replace(/\s+/g, " ").trim().toLowerCase();
  return normalize(before) === normalize(after);
}
