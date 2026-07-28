// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

import { CalendarMonthView, monthGridRange } from "./CalendarMonthView";
import type { CalendarItem } from "./calendarSources";

afterEach(cleanup);

const JULY = new Date(2026, 6, 1);

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

const conf = item({
  id: "s1:r1",
  title: "Conf",
  start: new Date(2026, 6, 10),
  end: new Date(2026, 6, 10, 23, 59, 59, 999),
  allDay: true,
  pageId: "p-db",
});

const standup = item({
  id: "s2:e1",
  title: "Standup",
  sourceId: "s2",
  kind: "ics-event",
  start: new Date(2026, 6, 10, 9),
  end: new Date(2026, 6, 10, 9, 30),
  location: "Zoom",
  description: "Daily sync",
  recurring: true,
  pageId: "p-ics",
  color: "#22c55e",
});

const span = item({
  id: "s1:r2",
  title: "Sprint",
  start: new Date(2026, 6, 20),
  end: new Date(2026, 6, 22, 23, 59, 59, 999),
  allDay: true,
});

const crowd = [1, 2, 3, 4, 5].map((n) =>
  item({ id: `s1:c${n}`, title: `Busy ${n}` }),
);

function renderView(
  items: CalendarItem[],
  props: Partial<React.ComponentProps<typeof CalendarMonthView>> = {},
) {
  const onMonthChange = vi.fn();
  const onOpenItem = vi.fn();
  const utils = render(
    <CalendarMonthView
      month={JULY}
      onMonthChange={onMonthChange}
      items={items}
      sourceNames={{ s1: "Projects DB", s2: "Team ICS" }}
      onOpenItem={onOpenItem}
      {...props}
    />,
  );
  return { ...utils, onMonthChange, onOpenItem };
}

function cell(container: HTMLElement, date: string): HTMLElement {
  const el = container.querySelector(`[data-date="${date}"]`);
  if (!el) throw new Error(`no cell for ${date}`);
  return el as HTMLElement;
}

describe("monthGridRange", () => {
  it("pads the month to full Sunday-to-Saturday weeks", () => {
    const { start, end } = monthGridRange(JULY);
    // July 1 2026 is a Wednesday → grid starts Sunday June 28.
    expect(start).toEqual(new Date(2026, 5, 28));
    // July 31 2026 is a Friday → grid ends Saturday August 1.
    expect(end.getMonth()).toBe(7);
    expect(end.getDate()).toBe(1);
  });
});

describe("CalendarMonthView", () => {
  it("shows the month label and places items in their day cells", () => {
    const { container } = renderView([conf, standup]);

    expect(screen.getByText("July 2026")).toBeTruthy();
    const day = cell(container, "2026-07-10");
    expect(within(day).getByText("Conf")).toBeTruthy();
    expect(within(day).getByText("Standup")).toBeTruthy();
    expect(cell(container, "2026-07-11").textContent).not.toContain("Conf");
  });

  it("renders multi-day items on every overlapped day", () => {
    const { container } = renderView([span]);

    for (const date of ["2026-07-20", "2026-07-21", "2026-07-22"]) {
      expect(within(cell(container, date)).getByText("Sprint")).toBeTruthy();
    }
    expect(cell(container, "2026-07-23").textContent).not.toContain("Sprint");
  });

  it("collapses beyond three items into a +N more popover", () => {
    const { container } = renderView(crowd);

    const day = cell(container, "2026-07-15");
    expect(within(day).getByText("Busy 1")).toBeTruthy();
    expect(within(day).getByText("Busy 3")).toBeTruthy();
    expect(within(day).queryByText("Busy 4")).toBeNull();

    fireEvent.click(within(day).getByText("+2 more"));
    expect(screen.getByText("Busy 4")).toBeTruthy();
    expect(screen.getByText("Busy 5")).toBeTruthy();
  });

  it("navigates months through the toolbar", () => {
    const { onMonthChange } = renderView([]);

    fireEvent.click(screen.getByLabelText("Next month"));
    expect(onMonthChange).toHaveBeenCalledTimes(1);
    const next = onMonthChange.mock.calls[0][0] as Date;
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(7);

    fireEvent.click(screen.getByLabelText("Previous month"));
    const prev = onMonthChange.mock.calls[1][0] as Date;
    expect(prev.getMonth()).toBe(5);
  });

  it("fires onDayClick for empty cell areas but not item chips", () => {
    const onDayClick = vi.fn();
    const { container } = renderView([conf], { onDayClick });

    fireEvent.click(cell(container, "2026-07-14"));
    expect(onDayClick).toHaveBeenCalledTimes(1);
    expect((onDayClick.mock.calls[0][0] as Date).getDate()).toBe(14);

    fireEvent.click(container.querySelector('[data-item-id="s1:r1"]')!);
    expect(onDayClick).toHaveBeenCalledTimes(1);
  });

  it("opens a detail popover with source name and Open action", () => {
    const { container, onOpenItem } = renderView([conf, standup]);

    const chip = container.querySelector('[data-item-id="s2:e1"]');
    expect(chip).toBeTruthy();
    fireEvent.click(chip as HTMLElement);

    expect(screen.getByText(/Zoom/)).toBeTruthy();
    expect(screen.getByText("Daily sync")).toBeTruthy();
    expect(screen.getByText("Team ICS")).toBeTruthy();
    expect(screen.getByText(/Repeats/)).toBeTruthy();

    fireEvent.click(screen.getByText("Open"));
    expect(onOpenItem).toHaveBeenCalledTimes(1);
    expect((onOpenItem.mock.calls[0][0] as CalendarItem).id).toBe("s2:e1");
  });
});
