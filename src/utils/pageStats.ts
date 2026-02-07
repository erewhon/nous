import type { EditorBlock } from "../types/page";

export interface PageStats {
  words: number;
  characters: number;
  readingTime: number; // minutes
  readingLevel: ReadingLevel | null;
  text: string; // Plain text content for writing assistance
}

export interface ReadingLevel {
  score: number; // Flesch-Kincaid Reading Ease score (0-100)
  grade: number; // Flesch-Kincaid Grade Level
  label: string; // Human-readable label
}

/**
 * Calculate page statistics from editor blocks
 * @param blocks Array of Editor.js blocks
 * @returns Word count, character count, reading time, and reading level
 */
export function calculatePageStats(blocks: EditorBlock[]): PageStats {
  let totalText = "";

  for (const block of blocks) {
    totalText += extractTextFromBlock(block) + " ";
  }

  const cleanText = totalText.trim();
  const words = cleanText
    .split(/\s+/)
    .filter((w) => w.length > 0);
  const wordCount = words.length;
  const characters = cleanText.replace(/\s/g, "").length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200)); // 200 wpm average

  // Calculate reading level only if there's enough content
  const readingLevel = wordCount >= 100 ? calculateReadingLevel(cleanText, words) : null;

  return {
    words: wordCount,
    characters,
    readingTime,
    readingLevel,
    text: cleanText,
  };
}

/**
 * Calculate Flesch-Kincaid reading level metrics
 */
function calculateReadingLevel(text: string, words: string[]): ReadingLevel {
  const sentences = countSentences(text);
  const syllables = countSyllables(words);
  const wordCount = words.length;

  if (sentences === 0 || wordCount === 0) {
    return { score: 0, grade: 0, label: "N/A" };
  }

  // Flesch Reading Ease: 206.835 - 1.015*(words/sentences) - 84.6*(syllables/words)
  const avgWordsPerSentence = wordCount / sentences;
  const avgSyllablesPerWord = syllables / wordCount;

  const readingEase = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);
  const score = Math.max(0, Math.min(100, Math.round(readingEase)));

  // Flesch-Kincaid Grade Level: 0.39*(words/sentences) + 11.8*(syllables/words) - 15.59
  const gradeLevel = (0.39 * avgWordsPerSentence) + (11.8 * avgSyllablesPerWord) - 15.59;
  const grade = Math.max(0, Math.round(gradeLevel * 10) / 10);

  const label = getReadingLevelLabel(score);

  return { score, grade, label };
}

/**
 * Count sentences in text (approximation)
 */
function countSentences(text: string): number {
  // Match sentence-ending punctuation followed by space or end of string
  const matches = text.match(/[.!?]+(?:\s|$)/g);
  return matches ? matches.length : 1;
}

/**
 * Count total syllables in words array
 */
function countSyllables(words: string[]): number {
  let total = 0;
  for (const word of words) {
    total += countWordSyllables(word.toLowerCase());
  }
  return total;
}

/**
 * Count syllables in a single word (approximation)
 */
function countWordSyllables(word: string): number {
  // Remove non-alphabetic characters
  word = word.replace(/[^a-z]/g, "");
  if (word.length <= 3) return 1;

  // Count vowel groups
  const vowelGroups = word.match(/[aeiouy]+/g);
  let count = vowelGroups ? vowelGroups.length : 1;

  // Adjust for common patterns
  // Silent 'e' at end
  if (word.endsWith("e") && !word.endsWith("le")) {
    count--;
  }
  // Words ending in 'le' preceded by consonant
  if (word.match(/[^aeiouy]le$/)) {
    count++;
  }
  // 'ed' ending (usually silent)
  if (word.endsWith("ed") && !word.endsWith("ted") && !word.endsWith("ded")) {
    count--;
  }
  // Ensure at least 1 syllable
  return Math.max(1, count);
}

/**
 * Get human-readable label for Flesch Reading Ease score
 */
function getReadingLevelLabel(score: number): string {
  if (score >= 90) return "Very Easy";
  if (score >= 80) return "Easy";
  if (score >= 70) return "Fairly Easy";
  if (score >= 60) return "Standard";
  if (score >= 50) return "Fairly Difficult";
  if (score >= 30) return "Difficult";
  return "Very Difficult";
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

    case "moodHabit":
      // No text content to extract
      break;

    case "pdf":
      // Extract text from PDF highlights
      if (Array.isArray(data.highlights)) {
        text = data.highlights
          .map((h: { selectedText?: string; note?: string }) =>
            `${h.selectedText || ""} ${h.note || ""}`.trim()
          )
          .join(" ");
      }
      // Also include caption
      if (data.caption) {
        text += " " + stripHtml(String(data.caption));
      }
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
