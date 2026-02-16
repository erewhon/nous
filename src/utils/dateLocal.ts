/**
 * Local-time date helpers.
 *
 * IMPORTANT: Never use `date.toISOString().split("T")[0]` for user-facing dates.
 * toISOString() returns UTC, which shifts the date forward in western timezones
 * during evening hours (e.g., 8pm EST = next day in UTC).
 *
 * Use these helpers instead.
 */

/** Format a Date as YYYY-MM-DD in local time. */
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Get today's date as YYYY-MM-DD in local time. */
export function localToday(): string {
  return localDateStr(new Date());
}

/**
 * Parse a YYYY-MM-DD string as a local-time Date (at noon).
 *
 * IMPORTANT: Never use `new Date("YYYY-MM-DD")` for date-only strings.
 * The JS spec parses date-only ISO strings as UTC midnight, which shifts
 * the date backward in western timezones (e.g., "2026-02-16" becomes
 * Feb 15 at 4pm in UTC-8).
 */
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}
