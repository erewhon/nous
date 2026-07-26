// Semantic heuristics shared by the board and grouped-table views.
//
// Select options carry user-chosen literal hex colors; these helpers layer a
// name-based mapping onto well-known status labels so status boards track the
// theme (Ready=info, In Progress=accent, Done=success, ...) while unrecognized
// options keep their stored color. Done-ness, priority, ID, and due-date
// discovery live here too so every view agrees on what those names mean.

import type { CellValue, PropertyDef } from "../../types/database";

export type SemanticToken =
  | "text-muted"
  | "info"
  | "accent"
  | "warning"
  | "error"
  | "success";

const STATUS_NAME_TOKENS: Record<SemanticToken, string[]> = {
  "text-muted": [
    "backlog",
    "todo",
    "to do",
    "later",
    "icebox",
    "someday",
    "triage",
    "no value",
  ],
  info: ["ready", "planned", "next", "up next", "open"],
  accent: ["in progress", "doing", "active", "wip", "started", "in flight"],
  warning: [
    "review",
    "in review",
    "qa",
    "testing",
    "waiting",
    "on hold",
    "paused",
  ],
  error: ["blocked", "stuck", "failed"],
  success: [
    "done",
    "complete",
    "completed",
    "shipped",
    "finished",
    "closed",
    "resolved",
    "merged",
  ],
};

const NAME_TO_TOKEN: Map<string, SemanticToken> = new Map(
  (
    Object.entries(STATUS_NAME_TOKENS) as [SemanticToken, string[]][]
  ).flatMap(([token, names]) => names.map((n) => [n, token] as const))
);

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[-_\s]+/g, " ");
}

/**
 * Resolve a column/group label to a CSS color. Well-known status names map to
 * semantic theme tokens (`var(--color-*)`); anything else falls back to the
 * option's stored color, then to the muted text token.
 */
export function resolveStatusColor(label: string, fallback?: string): string {
  const token = NAME_TO_TOKEN.get(normalizeLabel(label));
  if (token) return `var(--color-${token})`;
  return fallback || "var(--color-text-muted)";
}

/** Whether a column label denotes completion (drives the Done card treatment). */
export function isDoneStatus(label: string): boolean {
  return NAME_TO_TOKEN.get(normalizeLabel(label)) === "success";
}

const PRIORITY_NAME_RE = /^p(rio(rity)?)?$/i;

/** First property that looks like a priority: a select or number named like "priority". */
export function findPriorityProperty(
  props: PropertyDef[]
): PropertyDef | undefined {
  return props.find(
    (p) =>
      (p.type === "select" || p.type === "number") &&
      PRIORITY_NAME_RE.test(p.name.trim())
  );
}

const PRIORITY_WORD_RANKS: [RegExp, 0 | 1 | 2 | 3][] = [
  [/^(urgent|critical|highest)$/, 0],
  [/^high$/, 1],
  [/^(medium|normal)$/, 2],
  [/^(low|lowest)$/, 3],
];

/**
 * Rank a priority cell 0 (highest) .. 3 (lowest) for the bar-glyph.
 * Returns null when the value doesn't express a priority (renders no glyph).
 */
export function priorityRank(
  prop: PropertyDef,
  value: CellValue | undefined
): 0 | 1 | 2 | 3 | null {
  if (value == null || value === "") return null;
  if (prop.type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.min(3, Math.max(0, Math.round(n))) as 0 | 1 | 2 | 3;
  }
  // select: value is the option id — rank by the option's label
  const opt = prop.options?.find((o) => o.id === value);
  if (!opt) return null;
  const label = normalizeLabel(opt.label);
  const numeric = label.match(/^p?([0-3])$/);
  if (numeric) return Number(numeric[1]) as 0 | 1 | 2 | 3;
  for (const [re, rank] of PRIORITY_WORD_RANKS) {
    if (re.test(label)) return rank;
  }
  const index = prop.options?.indexOf(opt) ?? -1;
  if (index < 0) return null;
  return Math.min(3, index) as 0 | 1 | 2 | 3;
}

const ID_NAME_RE = /^(id|ref|key|ticket|issue)$/i;

/**
 * First text property that reads as a human-facing record ID (never row UUIDs).
 * The title property is excluded — it's already the card's headline.
 */
export function findIdProperty(
  props: PropertyDef[],
  titlePropertyId?: string
): PropertyDef | undefined {
  return props.find(
    (p) =>
      p.type === "text" &&
      p.id !== titlePropertyId &&
      ID_NAME_RE.test(p.name.trim())
  );
}

/** First date property (used as the card's due-date slot). */
export function findDueProperty(props: PropertyDef[]): PropertyDef | undefined {
  return props.find((p) => p.type === "date");
}
