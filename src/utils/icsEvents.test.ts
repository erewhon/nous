import { describe, expect, it } from "vitest";

import { getIcsCalendarName, parseIcsEvents } from "./icsEvents";

const wrap = (...body: string[]): string =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN", ...body, "END:VCALENDAR"].join(
    "\r\n",
  );

const vevent = (...lines: string[]): string =>
  ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");

const CHICAGO_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:America/Chicago",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:-0600",
  "TZOFFSETTO:-0500",
  "TZNAME:CDT",
  "DTSTART:19700308T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0600",
  "TZNAME:CST",
  "DTSTART:19701101T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
].join("\r\n");

const JUL1 = new Date(Date.UTC(2026, 6, 1));
const AUG1 = new Date(Date.UTC(2026, 7, 1));
const OCT1 = new Date(Date.UTC(2026, 9, 1));

describe("parseIcsEvents", () => {
  it("parses a single timed event with its fields", () => {
    const ics = wrap(
      vevent(
        "UID:single-1",
        "SUMMARY:Dentist",
        "LOCATION:Downtown",
        "DESCRIPTION:Bring insurance card",
        "DTSTART:20260701T100000Z",
        "DTEND:20260701T110000Z",
      ),
    );

    const events = parseIcsEvents(ics, JUL1, AUG1);

    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.id).toBe("single-1");
    expect(event.uid).toBe("single-1");
    expect(event.summary).toBe("Dentist");
    expect(event.location).toBe("Downtown");
    expect(event.description).toBe("Bring insurance card");
    expect(event.startDate.toISOString()).toBe("2026-07-01T10:00:00.000Z");
    expect(event.endDate.toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(event.isAllDay).toBe(false);
    expect(event.recurring).toBe(false);
    expect(event.recurrenceLabel).toBeUndefined();
  });

  it("falls back to Untitled Event when SUMMARY is missing", () => {
    const ics = wrap(
      vevent("UID:untitled-1", "DTSTART:20260701T100000Z", "DTEND:20260701T110000Z"),
    );

    const events = parseIcsEvents(ics, JUL1, AUG1);
    expect(events[0].summary).toBe("Untitled Event");
  });

  it("expands a weekly RRULE into one entry per occurrence inside the window", () => {
    const ics = wrap(
      vevent(
        "UID:weekly-1",
        "SUMMARY:Standup",
        "DTSTART:20260706T090000Z",
        "DTEND:20260706T093000Z",
        "RRULE:FREQ=WEEKLY",
      ),
    );

    const events = parseIcsEvents(ics, JUL1, OCT1);

    // Mondays: Jul 6..27 (4), Aug 3..31 (5), Sep 7..28 (4)
    expect(events).toHaveLength(13);
    expect(events[0].startDate.toISOString()).toBe("2026-07-06T09:00:00.000Z");
    expect(events[12].startDate.toISOString()).toBe("2026-09-28T09:00:00.000Z");
    for (const event of events) {
      expect(event.uid).toBe("weekly-1");
      expect(event.recurring).toBe(true);
      expect(event.recurrenceLabel).toBe("Weekly");
      expect(event.startDate.getUTCDay()).toBe(1);
      // 30-minute duration preserved on every occurrence
      expect(event.endDate.getTime() - event.startDate.getTime()).toBe(30 * 60 * 1000);
    }
    expect(new Set(events.map((e) => e.id)).size).toBe(13);
  });

  it("emits no occurrences outside the window", () => {
    const ics = wrap(
      vevent(
        "UID:weekly-2",
        "SUMMARY:Standup",
        "DTSTART:20260706T090000Z",
        "DTEND:20260706T093000Z",
        "RRULE:FREQ=WEEKLY",
      ),
    );

    const events = parseIcsEvents(ics, JUL1, AUG1);
    for (const event of events) {
      expect(event.startDate.getTime()).toBeGreaterThanOrEqual(JUL1.getTime());
      expect(event.startDate.getTime()).toBeLessThan(AUG1.getTime());
    }
    expect(events).toHaveLength(4);
  });

  it("omits EXDATE-excluded occurrences", () => {
    const ics = wrap(
      vevent(
        "UID:weekly-3",
        "SUMMARY:Standup",
        "DTSTART:20260706T090000Z",
        "DTEND:20260706T093000Z",
        "RRULE:FREQ=WEEKLY",
        "EXDATE:20260713T090000Z",
      ),
    );

    const events = parseIcsEvents(ics, JUL1, OCT1);

    expect(events).toHaveLength(12);
    expect(
      events.some((e) => e.startDate.toISOString() === "2026-07-13T09:00:00.000Z"),
    ).toBe(false);
  });

  it("honors RECURRENCE-ID overrides for moved instances", () => {
    const ics = wrap(
      vevent(
        "UID:weekly-4",
        "SUMMARY:Standup",
        "DTSTART:20260706T090000Z",
        "DTEND:20260706T093000Z",
        "RRULE:FREQ=WEEKLY",
      ),
      vevent(
        "UID:weekly-4",
        "SUMMARY:Standup (moved)",
        "RECURRENCE-ID:20260713T090000Z",
        "DTSTART:20260714T100000Z",
        "DTEND:20260714T103000Z",
      ),
    );

    const events = parseIcsEvents(ics, JUL1, OCT1);

    expect(events).toHaveLength(13);
    expect(
      events.some((e) => e.startDate.toISOString() === "2026-07-13T09:00:00.000Z"),
    ).toBe(false);
    const moved = events.find(
      (e) => e.startDate.toISOString() === "2026-07-14T10:00:00.000Z",
    );
    expect(moved).toBeDefined();
    expect(moved!.summary).toBe("Standup (moved)");
  });

  it("handles all-day events", () => {
    const ics = wrap(
      vevent(
        "UID:allday-1",
        "SUMMARY:Conference",
        "DTSTART;VALUE=DATE:20260710",
        "DTEND;VALUE=DATE:20260711",
      ),
    );

    const events = parseIcsEvents(ics, JUL1, AUG1);

    expect(events).toHaveLength(1);
    expect(events[0].isAllDay).toBe(true);
    // Date-only values land on local midnight of the calendar day.
    expect(events[0].startDate.getFullYear()).toBe(2026);
    expect(events[0].startDate.getMonth()).toBe(6);
    expect(events[0].startDate.getDate()).toBe(10);
  });

  it("includes a timed event overlapping windowStart", () => {
    const ics = wrap(
      vevent(
        "UID:overlap-1",
        "SUMMARY:Late night",
        "DTSTART:20260630T230000Z",
        "DTEND:20260701T010000Z",
      ),
    );

    expect(parseIcsEvents(ics, JUL1, AUG1)).toHaveLength(1);
  });

  it("excludes an event ending exactly at windowStart (exclusive DTEND)", () => {
    const ics = wrap(
      vevent(
        "UID:boundary-1",
        "SUMMARY:Before midnight",
        "DTSTART:20260630T230000Z",
        "DTEND:20260701T000000Z",
      ),
    );

    expect(parseIcsEvents(ics, JUL1, AUG1)).toHaveLength(0);
  });

  it("resolves TZID datetimes via VTIMEZONE registration", () => {
    const ics = wrap(
      CHICAGO_VTIMEZONE,
      vevent(
        "UID:tz-1",
        "SUMMARY:Lunch",
        "DTSTART;TZID=America/Chicago:20260706T090000",
        "DTEND;TZID=America/Chicago:20260706T100000",
      ),
    );

    const events = parseIcsEvents(ics, JUL1, AUG1);

    // 09:00 CDT (UTC-5) == 14:00Z
    expect(events[0].startDate.toISOString()).toBe("2026-07-06T14:00:00.000Z");
  });

  it("labels interval recurrences", () => {
    const ics = wrap(
      vevent(
        "UID:biweekly-1",
        "SUMMARY:Payday",
        "DTSTART:20260703T000000Z",
        "DTEND:20260703T000000Z",
        "RRULE:FREQ=WEEKLY;INTERVAL=2",
      ),
    );

    const events = parseIcsEvents(ics, JUL1, OCT1);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].recurrenceLabel).toBe("Every 2 weeks");
  });

  it("caps runaway recurrences at 1000 occurrences", () => {
    const ics = wrap(
      vevent(
        "UID:daily-1",
        "SUMMARY:Forever",
        "DTSTART:20260101T090000Z",
        "DTEND:20260101T091500Z",
        "RRULE:FREQ=DAILY",
      ),
    );

    const events = parseIcsEvents(
      ics,
      new Date(Date.UTC(2026, 0, 1)),
      new Date(Date.UTC(2036, 0, 1)),
    );

    expect(events).toHaveLength(1000);
  });

  it("sorts merged output by start date", () => {
    const ics = wrap(
      vevent(
        "UID:late-1",
        "SUMMARY:Later",
        "DTSTART:20260720T100000Z",
        "DTEND:20260720T110000Z",
      ),
      vevent(
        "UID:early-1",
        "SUMMARY:Earlier",
        "DTSTART:20260702T100000Z",
        "DTEND:20260702T110000Z",
      ),
    );

    const events = parseIcsEvents(ics, JUL1, AUG1);
    expect(events.map((e) => e.summary)).toEqual(["Earlier", "Later"]);
  });

  it("throws on malformed ICS", () => {
    expect(() => parseIcsEvents("definitely not a calendar", JUL1, AUG1)).toThrow();
  });
});

describe("getIcsCalendarName", () => {
  it("returns X-WR-CALNAME when present", () => {
    const ics = wrap("X-WR-CALNAME:Family Calendar");
    expect(getIcsCalendarName(ics)).toBe("Family Calendar");
  });

  it("returns null when absent", () => {
    expect(getIcsCalendarName(wrap())).toBeNull();
  });
});
