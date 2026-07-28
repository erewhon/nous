import { describe, expect, it } from "vitest";
import ICAL from "ical.js";

import { buildIcs, type ExportEvent } from "./icsExport";
import { getIcsCalendarName, parseIcsEvents } from "./icsEvents";

const WINDOW_START = new Date(2026, 0, 1);
const WINDOW_END = new Date(2027, 0, 1);

function event(overrides: Partial<ExportEvent>): ExportEvent {
  return {
    uid: "row-1@nous",
    title: "Event",
    start: new Date(Date.UTC(2026, 6, 10, 14, 0)),
    end: new Date(Date.UTC(2026, 6, 10, 15, 0)),
    allDay: false,
    ...overrides,
  };
}

function firstVevent(ics: string): ICAL.Component {
  const comp = new ICAL.Component(ICAL.parse(ics));
  const vevent = comp.getFirstSubcomponent("vevent");
  if (!vevent) throw new Error("no vevent");
  return vevent;
}

describe("buildIcs", () => {
  it("produces a parseable calendar with name and prodid", () => {
    const ics = buildIcs([event({})], "My Events");

    expect(() => ICAL.parse(ics)).not.toThrow();
    expect(getIcsCalendarName(ics)).toBe("My Events");
    const comp = new ICAL.Component(ICAL.parse(ics));
    expect(comp.getFirstPropertyValue("prodid")).toBe("-//Nous//Calendar//EN");
    expect(comp.getFirstPropertyValue("version")).toBe("2.0");
    expect(firstVevent(ics).getFirstProperty("dtstamp")).toBeTruthy();
  });

  it("round-trips a timed event through the app's own import path", () => {
    const ics = buildIcs(
      [event({ location: "Berlin", description: "Bring slides" })],
      "Cal",
    );
    const [parsed] = parseIcsEvents(ics, WINDOW_START, WINDOW_END);

    expect(parsed.uid).toBe("row-1@nous");
    expect(parsed.summary).toBe("Event");
    expect(parsed.location).toBe("Berlin");
    expect(parsed.description).toBe("Bring slides");
    expect(parsed.isAllDay).toBe(false);
    expect(parsed.startDate.toISOString()).toBe("2026-07-10T14:00:00.000Z");
    expect(parsed.endDate.toISOString()).toBe("2026-07-10T15:00:00.000Z");
  });

  it("serializes a single all-day event as DATE with exclusive DTEND", () => {
    const ics = buildIcs(
      [
        event({
          allDay: true,
          start: new Date(2026, 6, 10),
          end: new Date(2026, 6, 10, 23, 59, 59, 999),
        }),
      ],
      "Cal",
    );

    const vevent = firstVevent(ics);
    const dtstart = vevent.getFirstProperty("dtstart");
    const dtend = vevent.getFirstProperty("dtend");
    expect(dtstart?.type).toBe("date");
    expect(String(dtstart?.getFirstValue())).toBe("2026-07-10");
    expect(dtend?.type).toBe("date");
    expect(String(dtend?.getFirstValue())).toBe("2026-07-11");

    // Re-import lands on the correct single day.
    const [parsed] = parseIcsEvents(ics, WINDOW_START, WINDOW_END);
    expect(parsed.isAllDay).toBe(true);
    expect(parsed.startDate.getDate()).toBe(10);
    expect(parsed.startDate.getMonth()).toBe(6);
  });

  it("extends multi-day all-day events one day past the inclusive end", () => {
    const ics = buildIcs(
      [
        event({
          allDay: true,
          start: new Date(2026, 6, 10),
          end: new Date(2026, 6, 12, 23, 59, 59, 999),
        }),
      ],
      "Cal",
    );

    expect(String(firstVevent(ics).getFirstProperty("dtend")?.getFirstValue())).toBe(
      "2026-07-13",
    );
  });

  it("survives commas semicolons and newlines in text fields", () => {
    const title = "Lunch, then; planning";
    const description = "Line one\nLine two, with; punctuation";
    const location = "Room 1; Building A, Floor 2";
    const ics = buildIcs([event({ title, description, location })], "Cal");

    const [parsed] = parseIcsEvents(ics, WINDOW_START, WINDOW_END);
    expect(parsed.summary).toBe(title);
    expect(parsed.description).toBe(description);
    expect(parsed.location).toBe(location);
  });

  it("exports an empty calendar without events", () => {
    const ics = buildIcs([], "Empty");
    expect(() => ICAL.parse(ics)).not.toThrow();
    expect(parseIcsEvents(ics, WINDOW_START, WINDOW_END)).toEqual([]);
  });
});
