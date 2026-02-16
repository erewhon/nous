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
