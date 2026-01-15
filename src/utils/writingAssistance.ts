/**
 * Writing Assistance - Spell and Grammar Checking via LanguageTool API
 */

export interface WritingIssue {
  message: string;
  shortMessage: string;
  offset: number;
  length: number;
  replacements: string[];
  rule: {
    id: string;
    category: string;
    issueType: "grammar" | "spelling" | "style" | "punctuation" | "typography";
  };
  context: {
    text: string;
    offset: number;
    length: number;
  };
}

export interface WritingCheckResult {
  issues: WritingIssue[];
  language: string;
}

/**
 * Check text for spelling and grammar issues using LanguageTool API
 * Uses the free public API endpoint
 */
export async function checkWriting(text: string, language = "en-US"): Promise<WritingCheckResult> {
  if (!text.trim()) {
    return { issues: [], language };
  }

  try {
    const response = await fetch("https://api.languagetool.org/v2/check", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        text,
        language,
        enabledOnly: "false",
      }),
    });

    if (!response.ok) {
      throw new Error(`LanguageTool API error: ${response.status}`);
    }

    const data = await response.json();

    const issues: WritingIssue[] = data.matches.map((match: {
      message: string;
      shortMessage: string;
      offset: number;
      length: number;
      replacements: Array<{ value: string }>;
      rule: { id: string; category: { id: string }; issueType: string };
      context: { text: string; offset: number; length: number };
    }) => ({
      message: match.message,
      shortMessage: match.shortMessage || match.message,
      offset: match.offset,
      length: match.length,
      replacements: match.replacements.slice(0, 5).map((r) => r.value),
      rule: {
        id: match.rule.id,
        category: match.rule.category.id,
        issueType: categorizeIssue(match.rule.category.id, match.rule.issueType),
      },
      context: {
        text: match.context.text,
        offset: match.context.offset,
        length: match.context.length,
      },
    }));

    return {
      issues,
      language: data.language?.name || language,
    };
  } catch (error) {
    console.error("Writing check failed:", error);
    throw error;
  }
}

/**
 * Categorize issue type from LanguageTool category
 */
function categorizeIssue(category: string, issueType: string): "grammar" | "spelling" | "style" | "punctuation" | "typography" {
  const categoryLower = category.toLowerCase();
  const issueTypeLower = issueType?.toLowerCase() || "";

  if (categoryLower.includes("typo") || categoryLower.includes("spell") || issueTypeLower === "misspelling") {
    return "spelling";
  }
  if (categoryLower.includes("grammar")) {
    return "grammar";
  }
  if (categoryLower.includes("punct")) {
    return "punctuation";
  }
  if (categoryLower.includes("style") || categoryLower.includes("redundancy") || categoryLower.includes("casing")) {
    return "style";
  }
  if (categoryLower.includes("typography")) {
    return "typography";
  }
  return "grammar"; // default
}

/**
 * Get color for issue type
 */
export function getIssueColor(issueType: WritingIssue["rule"]["issueType"]): string {
  switch (issueType) {
    case "spelling":
      return "rgb(239, 68, 68)"; // Red
    case "grammar":
      return "rgb(245, 158, 11)"; // Amber
    case "punctuation":
      return "rgb(59, 130, 246)"; // Blue
    case "style":
      return "rgb(139, 92, 246)"; // Purple
    case "typography":
      return "rgb(107, 114, 128)"; // Gray
    default:
      return "rgb(245, 158, 11)";
  }
}

/**
 * Get icon for issue type
 */
export function getIssueIcon(issueType: WritingIssue["rule"]["issueType"]): string {
  switch (issueType) {
    case "spelling":
      return "Abc";
    case "grammar":
      return "G";
    case "punctuation":
      return ".!?";
    case "style":
      return "S";
    case "typography":
      return "T";
    default:
      return "!";
  }
}

/**
 * Count issues by type
 */
export function countIssuesByType(issues: WritingIssue[]): Record<string, number> {
  const counts: Record<string, number> = {
    spelling: 0,
    grammar: 0,
    punctuation: 0,
    style: 0,
    typography: 0,
  };

  for (const issue of issues) {
    counts[issue.rule.issueType]++;
  }

  return counts;
}
