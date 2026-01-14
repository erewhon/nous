import type { EditorBlock } from "../types/page";

export interface PageStats {
  words: number;
  readingTime: number; // minutes
}

/**
 * Calculate page statistics from editor blocks
 * @param blocks Array of Editor.js blocks
 * @returns Word count and estimated reading time
 */
export function calculatePageStats(blocks: EditorBlock[]): PageStats {
  let totalText = "";

  for (const block of blocks) {
    totalText += extractTextFromBlock(block) + " ";
  }

  const words = totalText
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
  const readingTime = Math.max(1, Math.ceil(words / 200)); // 200 wpm average

  return { words, readingTime };
}

/**
 * Extract plain text from an Editor.js block
 */
function extractTextFromBlock(block: EditorBlock): string {
  const data = block.data as Record<string, unknown>;
  let text = "";

  switch (block.type) {
    case "paragraph":
    case "header":
    case "quote":
      text = stripHtml(String(data.text || ""));
      break;

    case "list":
      text = extractListItems(data.items as unknown[]);
      break;

    case "checklist":
      text = extractChecklistItems(data.items as unknown[]);
      break;

    case "code":
      text = String(data.code || "");
      break;

    case "callout":
      text = stripHtml(String(data.message || ""));
      break;

    case "table":
      text = extractTableContent(data.content as unknown[][]);
      break;

    case "flashcard":
      text =
        stripHtml(String(data.front || "")) +
        " " +
        stripHtml(String(data.back || ""));
      break;

    default:
      // Try to extract text from common data fields
      if (data.text) {
        text = stripHtml(String(data.text));
      }
      break;
  }

  return text;
}

/**
 * Strip HTML tags and entities from a string
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract text from list items (handles nested lists)
 */
function extractListItems(items: unknown[]): string {
  if (!Array.isArray(items)) return "";

  let text = "";
  for (const item of items) {
    if (typeof item === "string") {
      text += stripHtml(item) + " ";
    } else if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      // Handle nested list format: { content: string, items: [] }
      if (obj.content) {
        text += stripHtml(String(obj.content)) + " ";
      }
      if (Array.isArray(obj.items)) {
        text += extractListItems(obj.items) + " ";
      }
    }
  }
  return text;
}

/**
 * Extract text from checklist items
 */
function extractChecklistItems(items: unknown[]): string {
  if (!Array.isArray(items)) return "";

  let text = "";
  for (const item of items) {
    if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      if (obj.text) {
        text += stripHtml(String(obj.text)) + " ";
      }
    }
  }
  return text;
}

/**
 * Extract text from table content
 */
function extractTableContent(content: unknown[][]): string {
  if (!Array.isArray(content)) return "";

  let text = "";
  for (const row of content) {
    if (Array.isArray(row)) {
      for (const cell of row) {
        if (typeof cell === "string") {
          text += stripHtml(cell) + " ";
        }
      }
    }
  }
  return text;
}
