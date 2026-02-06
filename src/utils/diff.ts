import type { EditorBlock } from "../types/page";

export interface DiffLine {
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
