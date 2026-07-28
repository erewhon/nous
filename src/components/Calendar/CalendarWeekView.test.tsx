// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import {
  CalendarWeekView,
  layoutDaySegments,
  weekRange,
} from "./CalendarWeekView";
import type { CalendarItem } from "./calendarSources";

afterEach(cleanup);

// Wednesday — the displayed week is Sun Jul 12 .. Sat Jul 18 2026.
const ANCHOR = new Date(2026, 6, 15);

function item(overrides: Partial<CalendarItem> & { id: string }): CalendarItem {
  return {
    sourceId: "s1",
    title: overrides.id,
    start: new Date(2026, 6, 15, 9),
    end: new Date(2026, 6, 15, 10),
    allDay: false,
    color: "#3b82f6",
    kind: "database-row",
    ...overrides,
  };
}

function renderView(
  items: CalendarItem[],
  props: Partial<React.ComponentProps<typeof CalendarWeekView>> = {},
) {
  const onAnchorChange = vi.fn();
  const onOpenItem = vi.fn();
  const utils = render(
    <CalendarWeekView
      anchor={ANCHOR}
      onAnchorChange={onAnchorChange}
      items={items}
      sourceNames={{ s1: "Projects DB" }}
      onOpenItem={onOpenItem}
      {...props}
    />,
  );
  return { ...utils, onAnchorChange, onOpenItem };
}

function dayColumn(container: HTMLElement, date: string): HTMLElement {
  const el = container.querySelector(`[data-day="${date}"]`);
  if (!el) throw new Error(`no day column for ${date}`);
  return el as HTMLElement;
}

describe("weekRange", () => {
  it("spans Sunday through the following Sunday", () => {
    const { start, end } = weekRange(ANCHOR);
    expect(start).toEqual(new Date(2026, 6, 12));
    expect(end).toEqual(new Date(2026, 6, 19));
  });
});

describe("layoutDaySegments", () => {
  it("clips a midnight-spanning event to each day", () => {
    const spanning = item({
      id: "s1:span",
      start: new Date(2026, 6, 15, 22),
      end: new Date(2026, 6, 16, 2),
    });

    const day1 = layoutDaySegments([spanning], new Date(2026, 6, 15));
    expect(day1).toHaveLength(1);
    expect(day1[0].startMin).toBe(22 * 60);
    expect(day1[0].endMin).toBe(24 * 60);

    const day2 = layoutDaySegments([spanning], new Date(2026, 6, 16));
    expect(day2).toHaveLength(1);
    expect(day2[0].startMin).toBe(0);
    expect(day2[0].endMin).toBe(2 * 60);

    // Ends AT midnight → not on the next day (exclusive rule).
    const atMidnight = item({
      id: "s1:mid",
      start: new Date(2026, 6, 15, 23),
      end: new Date(2026, 6, 16, 0),
    });
    expect(layoutDaySegments([atMidnight], new Date(2026, 6, 16))).toHaveLength(0);
  });

  it("assigns overlap columns greedily and shares cluster width", () => {
    const a = item({ id: "a", start: new Date(2026, 6, 15, 9), end: new Date(2026, 6, 15, 10) });
    const b = item({ id: "b", start: new Date(2026, 6, 15, 9, 30), end: new Date(2026, 6, 15, 10, 30) });
    const c = item({ id: "c", start: new Date(2026, 6, 15, 11), end: new Date(2026, 6, 15, 12) });

    const segments = layoutDaySegments([a, b, c], new Date(2026, 6, 15));
    const byId = Object.fromEntries(segments.map((s) => [s.item.id, s]));

    expect(byId["a"].col).toBe(0);
    expect(byId["b"].col).toBe(1);
    expect(byId["a"].cols).toBe(2);
    expect(byId["b"].cols).toBe(2);
    // c starts after the a/b cluster ended — full width again.
    expect(byId["c"].col).toBe(0);
    expect(byId["c"].cols).toBe(1);
  });
});

describe("CalendarWeekView", () => {
  it("places timed items in their day column with layout data attributes", () => {
    const { container } = renderView([
      item({ id: "s1:solo", title: "Solo" }),
    ]);

    const col = dayColumn(container, "2026-07-15");
    const seg = col.querySelector('[data-item-id="s1:solo"]');
    expect(seg).toBeTruthy();
    expect(seg?.getAttribute("data-col")).toBe("0");
    expect(seg?.getAttribute("data-overlap-cols")).toBe("1");
    expect(dayColumn(container, "2026-07-14").querySelector('[data-item-id="s1:solo"]')).toBeNull();
  });

  it("splits the column across two overlapping events", () => {
    const { container } = renderView([
      item({ id: "s1:a", title: "A", start: new Date(2026, 6, 15, 9), end: new Date(2026, 6, 15, 10) }),
      item({ id: "s1:b", title: "B", start: new Date(2026, 6, 15, 9, 30), end: new Date(2026, 6, 15, 10, 30) }),
    ]);

    const col = dayColumn(container, "2026-07-15");
    const a = col.querySelector('[data-item-id="s1:a"]');
    const b = col.querySelector('[data-item-id="s1:b"]');
    expect(a?.getAttribute("data-overlap-cols")).toBe("2");
    expect(b?.getAttribute("data-overlap-cols")).toBe("2");
    expect(new Set([a?.getAttribute("data-col"), b?.getAttribute("data-col")])).toEqual(
      new Set(["0", "1"]),
    );
  });

  it("keeps all-day items in the top lane and out of the hour grid", () => {
    const { container } = renderView([
      item({
        id: "s1:conf",
        title: "Conf",
        allDay: true,
        start: new Date(2026, 6, 15),
        end: new Date(2026, 6, 15, 23, 59, 59, 999),
      }),
    ]);

    const lane = screen.getByTestId("all-day-lane");
    expect(
      lane.querySelector('[data-allday-date="2026-07-15"] [data-item-id="s1:conf"]'),
    ).toBeTruthy();
    expect(
      dayColumn(container, "2026-07-15").querySelector('[data-item-id="s1:conf"]'),
    ).toBeNull();
  });

  it("renders a midnight-spanning event in both day columns", () => {
    const { container } = renderView([
      item({
        id: "s1:late",
        title: "Late",
        start: new Date(2026, 6, 15, 22),
        end: new Date(2026, 6, 16, 2),
      }),
    ]);

    expect(dayColumn(container, "2026-07-15").querySelector('[data-item-id="s1:late"]')).toBeTruthy();
    expect(dayColumn(container, "2026-07-16").querySelector('[data-item-id="s1:late"]')).toBeTruthy();
    expect(dayColumn(container, "2026-07-17").querySelector('[data-item-id="s1:late"]')).toBeNull();
  });

  it("navigates by whole weeks", () => {
    const { onAnchorChange } = renderView([]);

    fireEvent.click(screen.getByLabelText("Next week"));
    const next = onAnchorChange.mock.calls[0][0] as Date;
    expect(next.getDate()).toBe(22);

    fireEvent.click(screen.getByLabelText("Previous week"));
    const prev = onAnchorChange.mock.calls[1][0] as Date;
    expect(prev.getDate()).toBe(8);
  });

  it("opens the shared detail popover with the Open action", () => {
    const { container, onOpenItem } = renderView([
      item({ id: "s1:solo", title: "Solo", pageId: "p1", location: "Room 4" }),
    ]);

    fireEvent.click(
      dayColumn(container, "2026-07-15").querySelector('[data-item-id="s1:solo"]')!,
    );
    expect(screen.getByText(/Room 4/)).toBeTruthy();
    expect(screen.getByText("Projects DB")).toBeTruthy();

    fireEvent.click(screen.getByText("Open"));
    expect(onOpenItem).toHaveBeenCalledTimes(1);
  });
});
