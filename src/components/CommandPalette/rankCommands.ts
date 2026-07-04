/**
 * Pure relevance ranking for the command palette.
 *
 * Extracted from CommandPalette.tsx so it can be unit-tested without React.
 * Replaces the old `includes()`-everything filter, which surfaced loosely
 * related commands in insertion order and let generic subtitle words ("page",
 * "note") pull in unrelated commands.
 */

/** Minimal shape a command needs to be ranked. */
export interface RankableCommand {
  title: string;
  subtitle?: string;
  keywords?: string[];
}

/** Minimal shape a backend search result needs to be re-ranked. */
export interface RankableResult {
  title: string;
  /** Backend relevance (daemon: 1.0 title hit / 0.5 content-only; RAG: 0–1). */
  score?: number;
  /** Used to de-duplicate the same page appearing twice. */
  pageId?: string;
}

// Field weights — title dominates; keywords are secondary; subtitle is only a
// tiebreak (never enough on its own to surface a command).
const KEYWORD_WEIGHT = 0.6;
const SUBTITLE_TIEBREAK = 0.05;

// Highest fuzzyScore (exact match), used to normalize into a 0–1 tiebreak.
const MAX_SCORE = 1000;

const isBoundary = (ch: string | undefined): boolean =>
  ch === undefined || /[\s\-_/.]/.test(ch);

const stripSeparators = (s: string): string => s.replace(/[\s\-_/.]+/g, "");

/**
 * Score how well `text` matches `query`. 0 means no match; higher is better.
 * Tiers, highest first: exact > prefix > word-boundary substring > mid-word
 * substring > separator-insensitive substring ("newpage" → "New Page").
 *
 * Deliberately does NOT do scattered subsequence matching: a 2–4 char query
 * like "art" should not match "B[a]ckup & [R]es[t]ore". Real substring matches
 * (e.g. "art" in "Sm[art]") are kept but rank below word-boundary hits.
 */
export function fuzzyScore(text: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  if (t === q) return MAX_SCORE;

  const idx = t.indexOf(q);
  if (idx === 0) return 850 - Math.min(t.length, 100); // prefix
  if (idx > 0) {
    const boundary = isBoundary(t[idx - 1]);
    return (boundary ? 700 : 500) - idx - t.length * 0.05; // substring
  }

  // Separator-insensitive substring, so "newpage" matches "New Page".
  const tStripped = stripSeparators(t);
  const si = tStripped.indexOf(stripSeparators(q));
  if (si >= 0) return 300 - si - tStripped.length * 0.05;

  return 0;
}

/**
 * Combined score for a command. Title and keywords can surface a command;
 * the subtitle only nudges ordering once title/keywords already matched, so
 * generic subtitle words don't drag in unrelated commands.
 */
export function scoreCommand(cmd: RankableCommand, query: string): number {
  const titleScore = fuzzyScore(cmd.title, query);
  const keywordScore =
    cmd.keywords?.reduce((best, k) => Math.max(best, fuzzyScore(k, query)), 0) ??
    0;

  let score = Math.max(titleScore, keywordScore * KEYWORD_WEIGHT);
  if (score <= 0) return 0; // no title/keyword match → excluded (ignore subtitle)

  if (cmd.subtitle) {
    score += fuzzyScore(cmd.subtitle, query) * SUBTITLE_TIEBREAK;
  }
  return score;
}

/**
 * Rank a command list against a query: drop non-matches, sort by score
 * descending (stable on ties, preserving the input order). An empty query
 * returns the list unchanged.
 */
export function rankCommands<T extends RankableCommand>(
  commands: T[],
  query: string,
): T[] {
  if (!query.trim()) return commands;
  return commands
    .map((cmd, index) => ({ cmd, index, score: scoreCommand(cmd, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.cmd);
}

/**
 * Re-rank backend search results by combining their backend score with a
 * title-fuzzy bonus (so title-relevant pages lead generic body matches),
 * drop results below `minScore`, and de-duplicate by pageId.
 */
export function rankSearchResults<T extends RankableResult>(
  results: T[],
  query: string,
  minScore = 0,
): T[] {
  const seen = new Set<string>();
  return results
    .map((r, index) => ({
      r,
      index,
      relevance: (r.score ?? 0) + fuzzyScore(r.title, query) / MAX_SCORE,
    }))
    .filter((x) => (x.r.score ?? 0) >= minScore)
    .sort((a, b) => b.relevance - a.relevance || a.index - b.index)
    .map((x) => x.r)
    .filter((r) => {
      if (!r.pageId) return true;
      if (seen.has(r.pageId)) return false;
      seen.add(r.pageId);
      return true;
    });
}

/** Visibility flags a command may carry. */
export interface CommandVisibilityFlags {
  /** Hidden in beginner mode. */
  expert?: boolean;
  /** Hidden in the browser build — the action needs the Tauri shell
   * (native dialogs, invoke-backed share/collab/AI). Remove the flag as
   * these gain daemon HTTP paths or browser fallbacks. */
  desktopOnly?: boolean;
}

/** Single predicate for palette visibility (expert mode + platform). */
export function isCommandVisible(
  cmd: CommandVisibilityFlags,
  opts: { expertMode: boolean; inShell: boolean }
): boolean {
  if (cmd.expert && !opts.expertMode) return false;
  if (cmd.desktopOnly && !opts.inShell) return false;
  return true;
}
