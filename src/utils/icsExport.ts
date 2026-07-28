import ICAL from "ical.js";

/**
 * Normalized event ready for ICS serialization. `end` uses INCLUSIVE
 * semantics for all-day events (end of the last day) — buildIcs converts to
 * RFC 5545's exclusive DTEND on output.
 */
export interface ExportEvent {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  description?: string;
}

function dateOnlyTime(date: Date): ICAL.Time {
  return ICAL.Time.fromData({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    isDate: true,
  });
}

/**
 * Serialize events to a VCALENDAR string via ical.js component construction
 * (which handles text escaping). All-day events use DATE-valued DTSTART with
 * an exclusive DTEND of the day after the last day; timed events use UTC
 * DATE-TIMEs.
 */
export function buildIcs(events: ExportEvent[], calendarName: string): string {
  const calendar = new ICAL.Component(["vcalendar", [], []]);
  calendar.updatePropertyWithValue("prodid", "-//Nous//Calendar//EN");
  calendar.updatePropertyWithValue("version", "2.0");
  if (calendarName) {
    calendar.updatePropertyWithValue("x-wr-calname", calendarName);
  }

  const stamp = ICAL.Time.fromJSDate(new Date(), true);
  for (const event of events) {
    const vevent = new ICAL.Component("vevent");
    const icalEvent = new ICAL.Event(vevent);
    icalEvent.uid = event.uid;
    icalEvent.summary = event.title;
    if (event.location) {
      icalEvent.location = event.location;
    }
    if (event.description) {
      icalEvent.description = event.description;
    }

    if (event.allDay) {
      icalEvent.startDate = dateOnlyTime(event.start);
      // Exclusive DTEND: the day after the (inclusive) last day.
      icalEvent.endDate = dateOnlyTime(
        new Date(
          event.end.getFullYear(),
          event.end.getMonth(),
          event.end.getDate() + 1,
        ),
      );
    } else {
      icalEvent.startDate = ICAL.Time.fromJSDate(event.start, true);
      icalEvent.endDate = ICAL.Time.fromJSDate(event.end, true);
    }

    vevent.addPropertyWithValue("dtstamp", stamp);
    calendar.addSubcomponent(vevent);
  }

  return calendar.toString();
}
