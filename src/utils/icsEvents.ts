import ICAL from "ical.js";

export interface IcsEvent {
  /** Unique per rendered entry: `${uid}:${recurrenceId ISO}` for recurring instances, uid otherwise. */
  id: string;
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  isAllDay: boolean;
  recurring: boolean;
  recurrenceLabel?: string;
}

// Emitted-occurrence cap per event (runaway RRULE guard).
const MAX_OCCURRENCES_PER_EVENT = 1000;
// Iterator step cap per event. Iteration always starts at the event's DTSTART,
// so a long-history daily event needs thousands of skip steps before reaching
// the window; this bounds that walk without starving the emit cap.
const MAX_ITERATIONS_PER_EVENT = 10000;

/**
 * Parse ICS content and return concrete event occurrences overlapping
 * [windowStart, windowEnd]. Recurring events (RRULE/RDATE) are expanded into
 * one entry per occurrence; EXDATEs and RECURRENCE-ID overrides are honored.
 * Throws on malformed ICS — callers own the error UI.
 */
export function parseIcsEvents(
  icsContent: string,
  windowStart: Date,
  windowEnd: Date,
): IcsEvent[] {
  const comp = new ICAL.Component(ICAL.parse(icsContent));
  registerTimezones(comp);

  const vevents = comp.getAllSubcomponents("vevent");
  const masters: ICAL.Event[] = [];
  const exceptions: ICAL.Event[] = [];

  for (const vevent of vevents) {
    const event = new ICAL.Event(vevent);
    if (event.isRecurrenceException()) {
      exceptions.push(event);
    } else {
      masters.push(event);
    }
  }

  const mastersByUid = new Map<string, ICAL.Event>();
  for (const master of masters) {
    mastersByUid.set(master.uid, master);
  }

  // Orphan exceptions (feed exports an override without its master) are kept
  // as standalone events rather than dropped.
  for (const exception of exceptions) {
    const master = mastersByUid.get(exception.uid);
    if (master) {
      master.relateException(exception);
    } else {
      masters.push(exception);
    }
  }

  const results: IcsEvent[] = [];
  for (const event of masters) {
    if (event.isRecurring()) {
      results.push(...expandRecurring(event, windowStart, windowEnd));
    } else {
      const single = toIcsEvent(event, event.startDate, event.endDate, false);
      if (overlapsWindow(single.startDate, single.endDate, windowStart, windowEnd)) {
        results.push(single);
      }
    }
  }

  results.sort(
    (a, b) =>
      a.startDate.getTime() - b.startDate.getTime() ||
      a.summary.localeCompare(b.summary),
  );
  return results;
}

/** Calendar display name (X-WR-CALNAME), or null when absent. Throws on malformed ICS. */
export function getIcsCalendarName(icsContent: string): string | null {
  const comp = new ICAL.Component(ICAL.parse(icsContent));
  const name = comp.getFirstPropertyValue("x-wr-calname");
  return typeof name === "string" && name.length > 0 ? name : null;
}

function registerTimezones(comp: ICAL.Component): void {
  for (const vtimezone of comp.getAllSubcomponents("vtimezone")) {
    const timezone = new ICAL.Timezone(vtimezone);
    if (timezone.tzid && !ICAL.TimezoneService.has(timezone.tzid)) {
      ICAL.TimezoneService.register(timezone, timezone.tzid);
    }
  }
}

function expandRecurring(
  master: ICAL.Event,
  windowStart: Date,
  windowEnd: Date,
): IcsEvent[] {
  const occurrences: IcsEvent[] = [];
  const rrule = master.component.getFirstPropertyValue("rrule") as ICAL.Recur | null;
  const recurrenceLabel = rrule ? formatRecurrence(rrule) : undefined;

  const iterator = master.iterator();
  let next: ICAL.Time | null;
  let iterations = 0;

  while ((next = iterator.next() ?? null)) {
    if (
      ++iterations > MAX_ITERATIONS_PER_EVENT ||
      occurrences.length >= MAX_OCCURRENCES_PER_EVENT
    ) {
      break;
    }

    // getOccurrenceDetails substitutes RECURRENCE-ID override times/fields.
    const details = master.getOccurrenceDetails(next);
    const startDate = details.startDate.toJSDate();
    const endDate = details.endDate.toJSDate();

    // Overridden instances can move backward, so keep iterating past
    // occurrences that fall before the window instead of breaking.
    if (startDate.getTime() > windowEnd.getTime() && next.toJSDate().getTime() > windowEnd.getTime()) {
      break;
    }
    if (!overlapsWindow(startDate, endDate, windowStart, windowEnd)) {
      continue;
    }

    const item = details.item;
    occurrences.push({
      ...toIcsEvent(item, details.startDate, details.endDate, true),
      id: `${master.uid}:${next.toJSDate().toISOString()}`,
      uid: master.uid,
      recurrenceLabel,
    });
  }

  return occurrences;
}

function toIcsEvent(
  event: ICAL.Event,
  start: ICAL.Time,
  end: ICAL.Time,
  recurring: boolean,
): IcsEvent {
  return {
    id: event.uid,
    uid: event.uid,
    summary: event.summary || "Untitled Event",
    description: event.description || undefined,
    location: event.location || undefined,
    startDate: start.toJSDate(),
    endDate: end.toJSDate(),
    isAllDay: start.isDate,
    recurring,
  };
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
  // DTEND is exclusive per RFC 5545, hence strict comparisons.
  return start < windowEnd && end > windowStart;
}

export function formatRecurrence(rrule: ICAL.Recur): string {
  const freq = rrule.freq?.toLowerCase();
  const interval = rrule.interval || 1;

  if (interval === 1) {
    switch (freq) {
      case "daily":
        return "Daily";
      case "weekly":
        return "Weekly";
      case "monthly":
        return "Monthly";
      case "yearly":
        return "Yearly";
      default:
        return "Repeats";
    }
  }

  switch (freq) {
    case "daily":
      return `Every ${interval} days`;
    case "weekly":
      return `Every ${interval} weeks`;
    case "monthly":
      return `Every ${interval} months`;
    case "yearly":
      return `Every ${interval} years`;
    default:
      return "Repeats";
  }
}
