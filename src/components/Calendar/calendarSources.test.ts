import { describe, expect, it } from "vitest";

import type { DatabaseContentV2 } from "../../types/database";
import type {
  CalendarDatabaseSource,
  CalendarIcsFileSource,
} from "../../types/calendar";
import {
  databaseRowsToExportEvents,
  resolveDatabaseSource,
  resolveIcsSource,
  sortCalendarItems,
} from "./calendarSources";

const JUL1 = new Date(2026, 6, 1);
const AUG1 = new Date(2026, 7, 1);

function makeContent(
  rows: Array<Record<string, unknown>>,
): DatabaseContentV2 {
  return {
    version: 2,
    properties: [
      { id: "p-title", name: "Title", type: "text" },
      { id: "p-date", name: "Date", type: "date" },
      { id: "p-end", name: "End Date", type: "date" },
      {
        id: "p-status",
        name: "Status",
        type: "select",
        options: [
          { id: "s-open", label: "Open", color: "#111" },
          { id: "s-done", label: "Done", color: "#222" },
        ],
      },
      { id: "p-loc", name: "Location", type: "text" },
      { id: "p-notes", name: "Notes", type: "text" },
    ],
    rows: rows.map((cells, i) => ({
      id: `row-${i}`,
      cells: cells as DatabaseContentV2["rows"][number]["cells"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })),
    views: [],
  } as unknown as DatabaseContentV2;
}

const dbSource: CalendarDatabaseSource = {
  type: "database",
  id: "src-db",
  pageId: "page-db",
  datePropertyId: "p-date",
  color: "#3b82f6",
};

describe("resolveDatabaseSource", () => {
  it("maps date-only cells to all-day items spanning the day", () => {
    const content = makeContent([
      { "p-title": "Conference", "p-date": "2026-07-10" },
    ]);
    const [item] = resolveDatabaseSource(dbSource, content, JUL1, AUG1);

    expect(item.allDay).toBe(true);
    expect(item.start).toEqual(new Date(2026, 6, 10));
    expect(item.end).toEqual(new Date(2026, 6, 10, 23, 59, 59, 999));
    expect(item.title).toBe("Conference");
    expect(item.kind).toBe("database-row");
    expect(item.rowId).toBe("row-0");
    expect(item.pageId).toBe("page-db");
    expect(item.id).toBe("src-db:row-0");
  });

  it("maps datetime cells to timed items with end == start when no end property", () => {
    const content = makeContent([
      { "p-title": "Standup", "p-date": "2026-07-10T14:00:00.000Z" },
    ]);
    const [item] = resolveDatabaseSource(dbSource, content, JUL1, AUG1);

    expect(item.allDay).toBe(false);
    expect(item.start.toISOString()).toBe("2026-07-10T14:00:00.000Z");
    expect(item.end.getTime()).toBe(item.start.getTime());
  });

  it("uses an inclusive end-of-day for date-only end cells", () => {
    const content = makeContent([
      {
        "p-title": "Sprint",
        "p-date": "2026-07-06",
        "p-end": "2026-07-08",
      },
    ]);
    const source = { ...dbSource, endDatePropertyId: "p-end" };
    const [item] = resolveDatabaseSource(source, content, JUL1, AUG1);

    expect(item.end).toEqual(new Date(2026, 6, 8, 23, 59, 59, 999));
  });

  it("clamps an end before start back to the start", () => {
    const content = makeContent([
      {
        "p-title": "Backwards",
        "p-date": "2026-07-10T10:00:00.000Z",
        "p-end": "2026-07-09T10:00:00.000Z",
      },
    ]);
    const source = { ...dbSource, endDatePropertyId: "p-end" };
    const [item] = resolveDatabaseSource(source, content, JUL1, AUG1);

    expect(item.end.getTime()).toBe(item.start.getTime());
  });

  it("skips rows with missing, empty, or invalid date cells", () => {
    const content = makeContent([
      { "p-title": "No date" },
      { "p-title": "Empty", "p-date": "" },
      { "p-title": "Null", "p-date": null },
      { "p-title": "Number", "p-date": 12345 },
      { "p-title": "Garbage", "p-date": "not-a-date" },
      { "p-title": "Valid", "p-date": "2026-07-10" },
    ]);
    const items = resolveDatabaseSource(dbSource, content, JUL1, AUG1);

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Valid");
  });

  it("applies the source filter with database view semantics", () => {
    const content = makeContent([
      { "p-title": "Open task", "p-date": "2026-07-10", "p-status": "s-open" },
      { "p-title": "Done task", "p-date": "2026-07-11", "p-status": "s-done" },
    ]);
    const source: CalendarDatabaseSource = {
      ...dbSource,
      filter: { propertyId: "p-status", operator: "equals", value: "s-open" },
    };
    const items = resolveDatabaseSource(source, content, JUL1, AUG1);

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Open task");
  });

  it("ignores filters on properties missing from the schema", () => {
    const content = makeContent([
      { "p-title": "Kept", "p-date": "2026-07-10" },
    ]);
    const source: CalendarDatabaseSource = {
      ...dbSource,
      filter: { propertyId: "p-ghost", operator: "equals", value: "x" },
    };

    expect(resolveDatabaseSource(source, content, JUL1, AUG1)).toHaveLength(1);
  });

  it("window-filters items and keeps boundary overlaps", () => {
    const content = makeContent([
      { "p-title": "Before", "p-date": "2026-06-15" },
      { "p-title": "Spans start", "p-date": "2026-06-28", "p-end": "2026-07-02" },
      { "p-title": "Inside", "p-date": "2026-07-15" },
      { "p-title": "After", "p-date": "2026-08-02" },
    ]);
    const source = { ...dbSource, endDatePropertyId: "p-end" };
    const titles = resolveDatabaseSource(source, content, JUL1, AUG1).map(
      (i) => i.title,
    );

    expect(titles).toEqual(["Spans start", "Inside"]);
  });

  it("falls back to Untitled when the title cell is empty", () => {
    const content = makeContent([{ "p-date": "2026-07-10" }]);
    const [item] = resolveDatabaseSource(dbSource, content, JUL1, AUG1);

    expect(item.title).toBe("Untitled");
  });

  it("produces distinct ids for identical rows seen through two sources", () => {
    const content = makeContent([
      { "p-title": "Shared", "p-date": "2026-07-10" },
    ]);
    const a = resolveDatabaseSource(dbSource, content, JUL1, AUG1);
    const b = resolveDatabaseSource(
      { ...dbSource, id: "src-db-2" },
      content,
      JUL1,
      AUG1,
    );

    expect(a[0].id).not.toBe(b[0].id);
  });
});

describe("resolveIcsSource", () => {
  const icsSource: CalendarIcsFileSource = {
    type: "ics-file",
    id: "src-ics",
    pageId: "page-ics",
    color: "#22c55e",
  };

  const weeklyIcs = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    "BEGIN:VEVENT",
    "UID:weekly-1",
    "SUMMARY:Standup",
    "LOCATION:Zoom",
    "DTSTART:20260706T090000Z",
    "DTEND:20260706T093000Z",
    "RRULE:FREQ=WEEKLY",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("maps expanded occurrences with source-prefixed ids", () => {
    const items = resolveIcsSource(icsSource, weeklyIcs, JUL1, AUG1);

    expect(items.length).toBeGreaterThan(1);
    for (const item of items) {
      expect(item.kind).toBe("ics-event");
      expect(item.sourceId).toBe("src-ics");
      expect(item.id.startsWith("src-ics:weekly-1:")).toBe(true);
      expect(item.recurring).toBe(true);
      expect(item.location).toBe("Zoom");
      expect(item.pageId).toBe("page-ics");
      expect(item.color).toBe("#22c55e");
    }
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it("omits pageId for subscription sources", () => {
    const items = resolveIcsSource(
      {
        type: "ics-subscription",
        id: "src-sub",
        url: "https://example.com/a.ics",
        refreshMinutes: 60,
        color: "#f97316",
      },
      weeklyIcs,
      JUL1,
      AUG1,
    );

    expect(items[0].pageId).toBeUndefined();
  });

  it("throws on malformed ICS for the caller to handle", () => {
    expect(() => resolveIcsSource(icsSource, "junk", JUL1, AUG1)).toThrow();
  });
});

describe("databaseRowsToExportEvents", () => {
  it("maps rows by property name including Notes to description", () => {
    const content = makeContent([
      {
        "p-title": "Conference",
        "p-date": "2026-07-10",
        "p-end": "2026-07-12",
        "p-loc": "Berlin",
        "p-notes": "Bring badge",
      },
    ]);
    const [ev] = databaseRowsToExportEvents(content);

    expect(ev.uid).toBe("row-0@nous");
    expect(ev.title).toBe("Conference");
    expect(ev.allDay).toBe(true);
    expect(ev.start).toEqual(new Date(2026, 6, 10));
    expect(ev.end).toEqual(new Date(2026, 6, 12, 23, 59, 59, 999));
    expect(ev.location).toBe("Berlin");
    expect(ev.description).toBe("Bring badge");
  });

  it("passes timed ISO cells through and skips rows without dates", () => {
    const content = makeContent([
      { "p-title": "Timed", "p-date": "2026-07-10T14:00:00.000Z" },
      { "p-title": "No date" },
    ]);
    const events = databaseRowsToExportEvents(content);

    expect(events).toHaveLength(1);
    expect(events[0].allDay).toBe(false);
    expect(events[0].start.toISOString()).toBe("2026-07-10T14:00:00.000Z");
    expect(events[0].end.getTime()).toBe(events[0].start.getTime());
  });

  it("is not window-limited", () => {
    const content = makeContent([
      { "p-title": "Ancient", "p-date": "1999-01-01" },
      { "p-title": "Future", "p-date": "2099-12-31" },
    ]);
    expect(databaseRowsToExportEvents(content)).toHaveLength(2);
  });
});

describe("sortCalendarItems", () => {
  it("orders all-day first, then by start, then title", () => {
    const base = {
      sourceId: "s",
      color: "#000",
      kind: "database-row" as const,
    };
    const items = [
      {
        ...base,
        id: "b",
        title: "B timed",
        start: new Date(2026, 6, 10, 9),
        end: new Date(2026, 6, 10, 10),
        allDay: false,
      },
      {
        ...base,
        id: "a",
        title: "A timed",
        start: new Date(2026, 6, 10, 9),
        end: new Date(2026, 6, 10, 10),
        allDay: false,
      },
      {
        ...base,
        id: "c",
        title: "All day",
        start: new Date(2026, 6, 10),
        end: new Date(2026, 6, 10, 23, 59, 59, 999),
        allDay: true,
      },
      {
        ...base,
        id: "d",
        title: "Early timed",
        start: new Date(2026, 6, 10, 8),
        end: new Date(2026, 6, 10, 9),
        allDay: false,
      },
    ];

    expect(sortCalendarItems(items).map((i) => i.id)).toEqual([
      "c",
      "d",
      "a",
      "b",
    ]);
  });
});
