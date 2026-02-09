import type { EditorBlock } from "../types/page";

export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  text: string;
}

export interface BlockDiff {
  type: "added" | "removed" | "modified" | "unchanged";
  blockId: string;
  blockType: string;
  oldBlock?: EditorBlock;
  newBlock?: EditorBlock;
}

export interface WordDiff {
  type: "added" | "removed" | "unchanged";
  text: string;
}

/**
 * Strip HTML tags and decode entities from a string.
 */
export function stripHtml(html: string): string {
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
 * Extract one text line per logical content unit from EditorData blocks.
 */
export function blocksToLines(blocks: EditorBlock[]): string[] {
  const lines: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "paragraph":
      case "header":
      case "quote": {
        const text = stripHtml((block.data.text as string) || "");
        if (text) lines.push(text);
        break;
      }

      case "list": {
        const items = (block.data.items as Array<string | { content?: string; items?: unknown[] }>) || [];
        function collectListLines(
          listItems: Array<string | { content?: string; items?: unknown[] }>,
          indent: number
        ) {
          for (const item of listItems) {
            const text = typeof item === "string" ? item : item.content || "";
            lines.push(`${"  ".repeat(indent)}- ${stripHtml(text)}`);
            if (typeof item === "object" && Array.isArray(item.items) && item.items.length > 0) {
              collectListLines(
                item.items as Array<string | { content?: string; items?: unknown[] }>,
                indent + 1
              );
            }
          }
        }
        collectListLines(items, 0);
        break;
      }

      case "checklist": {
        const items =
          (block.data.items as Array<{ text?: string; checked?: boolean }>) || [];
        for (const item of items) {
          const prefix = item.checked ? "[x]" : "[ ]";
          lines.push(`${prefix} ${stripHtml(item.text || "")}`);
        }
        break;
      }

      case "code": {
        const code = (block.data.code as string) || "";
        for (const codeLine of code.split("\n")) {
          lines.push(`  ${codeLine}`);
        }
        break;
      }

      case "table": {
        const content = (block.data.content as string[][]) || [];
        for (const row of content) {
          lines.push(`| ${row.join(" | ")} |`);
        }
        break;
      }

      case "delimiter": {
        lines.push("---");
        break;
      }

      default: {
        const text = block.data.text as string | undefined;
        if (text) {
          const stripped = stripHtml(text);
          if (stripped) lines.push(stripped);
        }
        break;
      }
    }
  }

  return lines;
}

/**
 * Compute a line-level diff using the LCS (Longest Common Subsequence) algorithm.
 * O(m*n) which is fine for page content (tens to hundreds of lines).
 */
export function computeLineDiff(
  oldLines: string[],
  newLines: string[]
): DiffLine[] {
  const m = oldLines.length;
  const n = newLines.length;

  // Build DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: "unchanged", text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: "added", text: newLines[j - 1] });
      j--;
    } else {
      result.push({ type: "removed", text: oldLines[i - 1] });
      i--;
    }
  }

  return result.reverse();
}

/**
 * Extract a text fingerprint from a block for comparison.
 * Returns a string that represents the meaningful content of a block.
 */
function blockContentKey(block: EditorBlock): string {
  const d = block.data;
  switch (block.type) {
    case "paragraph":
    case "header":
    case "quote":
      return `${block.type}:${(d.text as string) || ""}`;
    case "list": {
      const items = (d.items as Array<string | { content?: string }>) || [];
      const flat = items
        .map((it) => (typeof it === "string" ? it : it.content || ""))
        .join("|");
      return `list:${d.style || ""}:${flat}`;
    }
    case "checklist": {
      const items = (d.items as Array<{ text?: string; checked?: boolean }>) || [];
      return `checklist:${items.map((it) => `${it.checked ? "x" : "o"}:${it.text || ""}`).join("|")}`;
    }
    case "code":
      return `code:${(d.code as string) || ""}`;
    case "table":
      return `table:${JSON.stringify(d.content || [])}`;
    case "delimiter":
      return "delimiter";
    case "image":
      return `image:${(d.url as string) || (d.file as Record<string, unknown>)?.url || ""}`;
    default:
      return `${block.type}:${JSON.stringify(d)}`;
  }
}

/**
 * Compute block-level diff between two versions of a page.
 * Matches blocks by ID, detects added/removed/modified/unchanged.
 * Returns blocks in display order: new blocks order with removed blocks
 * inserted at approximately their original position.
 */
export function computeBlockDiff(
  oldBlocks: EditorBlock[],
  newBlocks: EditorBlock[]
): BlockDiff[] {
  const oldMap = new Map<string, EditorBlock>();
  for (const b of oldBlocks) oldMap.set(b.id, b);

  const newMap = new Map<string, EditorBlock>();
  for (const b of newBlocks) newMap.set(b.id, b);

  const result: BlockDiff[] = [];
  const processedOldIds = new Set<string>();

  // Walk new blocks in order
  for (const newBlock of newBlocks) {
    const oldBlock = oldMap.get(newBlock.id);
    if (oldBlock) {
      processedOldIds.add(newBlock.id);
      const oldKey = blockContentKey(oldBlock);
      const newKey = blockContentKey(newBlock);
      if (oldKey === newKey) {
        result.push({
          type: "unchanged",
          blockId: newBlock.id,
          blockType: newBlock.type,
          oldBlock,
          newBlock,
        });
      } else {
        result.push({
          type: "modified",
          blockId: newBlock.id,
          blockType: newBlock.type,
          oldBlock,
          newBlock,
        });
      }
    } else {
      result.push({
        type: "added",
        blockId: newBlock.id,
        blockType: newBlock.type,
        newBlock,
      });
    }
  }

  // Collect removed blocks (in old order) and insert near their original position
  const removedBlocks: BlockDiff[] = [];
  for (const oldBlock of oldBlocks) {
    if (!processedOldIds.has(oldBlock.id)) {
      removedBlocks.push({
        type: "removed",
        blockId: oldBlock.id,
        blockType: oldBlock.type,
        oldBlock,
      });
    }
  }

  // Insert removed blocks at the end grouped together
  // (inserting at exact original positions is complex and not worth the effort
  //  since block IDs may have shifted significantly)
  return [...result, ...removedBlocks];
}

/**
 * Tokenize text into words and whitespace for word-level diffing.
 */
function tokenize(text: string): string[] {
  // Split on word boundaries, preserving whitespace as separate tokens
  return text.match(/\S+|\s+/g) || [];
}

/**
 * Compute word-level diff between two text strings.
 * Strips HTML first, then tokenizes and runs LCS on words.
 */
export function computeWordDiff(
  oldText: string,
  newText: string
): WordDiff[] {
  const oldPlain = stripHtml(oldText);
  const newPlain = stripHtml(newText);

  const oldTokens = tokenize(oldPlain);
  const newTokens = tokenize(newPlain);

  const m = oldTokens.length;
  const n = newTokens.length;

  // LCS DP
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldTokens[i - 1] === newTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  const result: WordDiff[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
      result.push({ type: "unchanged", text: oldTokens[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: "added", text: newTokens[j - 1] });
      j--;
    } else {
      result.push({ type: "removed", text: oldTokens[i - 1] });
      i--;
    }
  }

  return result.reverse();
}

/**
 * Get the primary text content from a block for word diffing.
 */
export function getBlockText(block: EditorBlock): string | null {
  const d = block.data;
  switch (block.type) {
    case "paragraph":
    case "header":
    case "quote":
      return (d.text as string) || "";
    case "checklist": {
      const items = (d.items as Array<{ text?: string; checked?: boolean }>) || [];
      return items.map((it) => `${it.checked ? "[x]" : "[ ]"} ${it.text || ""}`).join("\n");
    }
    case "list": {
      const items = (d.items as Array<string | { content?: string }>) || [];
      return items
        .map((it) => (typeof it === "string" ? it : it.content || ""))
        .join("\n");
    }
    case "code":
      return (d.code as string) || "";
    default:
      return null;
  }
}
