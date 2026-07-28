import type {
  CellValue,
  DatabaseContentV2,
} from "../../types/database";
import type {
  CalendarDatabaseSource,
  CalendarIcsFileSource,
  CalendarIcsSubscriptionSource,
} from "../../types/calendar";
import { applyFilter } from "../Database/viewRows";
import { parseIcsEvents } from "../../utils/icsEvents";
import type { ExportEvent } from "../../utils/icsExport";

/**
 * Normalized calendar entry — the one shape the calendar views render,
 * whatever the source. Pure data; the page component owns all loading.
 */
export interface CalendarItem {
  /** Unique across all sources: `${sourceId}:${rowId | icsOccurrenceId}`. */
  id: string;
  sourceId: string;
  title: string;
  start: Date;
  /** >= start; for date-only items, end of the (inclusive) last day. */
  end: Date;
  allDay: boolean;
  /** From the source config. */
  color: string;
  kind: "database-row" | "ics-event";
  /** Source page (database page or ics page). */
  pageId?: string;
  /** Database rows only. */
  rowId?: string;
  location?: string;
  description?: string;
  /** ICS occurrences of a recurring event. */
  recurring?: boolean;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ParsedCellDate {
  date: Date;
  dateOnly: boolean;
}

/**
 * Date cells are strings: "YYYY-MM-DD" from the date editor, or a full ISO
 * datetime from API/MCP writers. Date-only values resolve to LOCAL midnight
 * (new Date("YYYY-MM-DD") would parse as UTC and shift the day in western
 * timezones). Anything else is invalid and the row is skipped.
 */
function parseDateCell(value: CellValue): ParsedCellDate | null {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  if (DATE_ONLY_RE.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return { date: new Date(year, month - 1, day), dateOnly: true };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return { date, dateOnly: false };
}

function endOfDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
}

function overlapsWindow(
  start: Date,
  end: Date,
  windowStart: Date,
  windowEnd: Date,
): boolean {
  if (start.getTime() === end.getTime()) {
    return start >= windowStart && start <= windowEnd;
  }
  return start < windowEnd && end > windowStart;
}

/**
 * Resolve a database source's rows to calendar items within the window.
 * Rows without a valid date cell are skipped; the optional source filter
 * uses the same applyFilter the database views use (filters on properties
 * missing from the schema are skipped, matching applyViewToRows semantics).
 */
export function resolveDatabaseSource(
  source: CalendarDatabaseSource,
  content: DatabaseContentV2,
  windowStart: Date,
  windowEnd: Date,
): CalendarItem[] {
  const titleProp = content.properties.find((p) => p.type === "text");
  const filterProp = source.filter
    ? content.properties.find((p) => p.id === source.filter?.propertyId)
    : undefined;

  const items: CalendarItem[] = [];
  for (const row of content.rows) {
    if (
      source.filter &&
      filterProp &&
      !applyFilter(
        row.cells[source.filter.propertyId],
        source.filter.operator,
        source.filter.value,
        filterProp,
      )
    ) {
      continue;
    }

    const startCell = parseDateCell(row.cells[source.datePropertyId]);
    if (!startCell) {
      continue;
    }

    const allDay = startCell.dateOnly;
    const start = startCell.date;

    const endCell = source.endDatePropertyId
      ? parseDateCell(row.cells[source.endDatePropertyId])
      : null;
    // Database end dates are inclusive (unlike ICS DTEND): a date-only end
    // extends through the end of that day.
    let end: Date;
    if (endCell) {
      end = endCell.dateOnly ? endOfDay(endCell.date) : endCell.date;
    } else {
      end = allDay ? endOfDay(start) : start;
    }
    if (end.getTime() < start.getTime()) {
      end = allDay ? endOfDay(start) : start;
    }

    if (!overlapsWindow(start, end, windowStart, windowEnd)) {
      continue;
    }

    const rawTitle = titleProp ? row.cells[titleProp.id] : null;
    items.push({
      id: `${source.id}:${row.id}`,
      sourceId: source.id,
      title:
        typeof rawTitle === "string" && rawTitle.trim() !== ""
          ? rawTitle
          : "Untitled",
      start,
      end,
      allDay,
      color: source.color,
      kind: "database-row",
      pageId: source.pageId,
      rowId: row.id,
    });
  }
  return items;
}

/**
 * Resolve raw ICS content (file page or subscription feed) to calendar
 * items. parseIcsEvents expands recurrences and window-filters; malformed
 * ICS throws — the caller owns per-source error UI.
 */
export function resolveIcsSource(
  source: CalendarIcsFileSource | CalendarIcsSubscriptionSource,
  icsContent: string,
  windowStart: Date,
  windowEnd: Date,
): CalendarItem[] {
  return parseIcsEvents(icsContent, windowStart, windowEnd).map((event) => ({
    id: `${source.id}:${event.id}`,
    sourceId: source.id,
    title: event.summary,
    start: event.startDate,
    end: event.endDate,
    allDay: event.isAllDay,
    color: source.color,
    kind: "ics-event" as const,
    pageId: source.type === "ics-file" ? source.pageId : undefined,
    location: event.location,
    description: event.description,
    recurring: event.recurring,
  }));
}

/**
 * Map an events database's rows to exportable events for ICS serialization.
 * Properties resolve by name (Title, Date, End Date, Location, Notes →
 * description) with the same date-cell semantics the calendar resolver uses;
 * rows without a valid Date cell are skipped. Not window-limited — export
 * covers the whole database.
 */
export function databaseRowsToExportEvents(
  content: DatabaseContentV2,
): ExportEvent[] {
  const byNameType = (name: string, type: string) =>
    content.properties.find(
      (p) => p.type === type && p.name.toLowerCase() === name,
    );
  const titleProp =
    byNameType("title", "text") ??
    content.properties.find((p) => p.type === "text");
  const dateProp =
    byNameType("date", "date") ??
    content.properties.find((p) => p.type === "date");
  const endProp = byNameType("end date", "date");
  const locationProp = byNameType("location", "text");
  const notesProp = byNameType("notes", "text");
  if (!dateProp) {
    return [];
  }

  const events: ExportEvent[] = [];
  for (const row of content.rows) {
    const startCell = parseDateCell(row.cells[dateProp.id]);
    if (!startCell) {
      continue;
    }
    const allDay = startCell.dateOnly;
    const start = startCell.date;
    const endCell = endProp ? parseDateCell(row.cells[endProp.id]) : null;
    let end: Date;
    if (endCell) {
      end = endCell.dateOnly ? endOfDay(endCell.date) : endCell.date;
    } else {
      end = allDay ? endOfDay(start) : start;
    }
    if (end.getTime() < start.getTime()) {
      end = allDay ? endOfDay(start) : start;
    }

    const text = (prop: { id: string } | undefined): string | undefined => {
      const value = prop ? row.cells[prop.id] : null;
      return typeof value === "string" && value.trim() !== "" ? value : undefined;
    };

    events.push({
      uid: `${row.id}@nous`,
      title: text(titleProp) ?? "Untitled",
      start,
      end,
      allDay,
      location: text(locationProp),
      description: text(notesProp),
    });
  }
  return events;
}

/** All-day items first, then by start time, then title — the render order. */
export function sortCalendarItems(items: CalendarItem[]): CalendarItem[] {
  return [...items].sort((a, b) => {
    if (a.allDay !== b.allDay) {
      return a.allDay ? -1 : 1;
    }
    return (
      a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title)
    );
  });
}
