// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

import { CalendarSourcesPanel } from "./CalendarSourcesPanel";
import type {
  CalendarDatabaseSource,
  CalendarPageConfig,
} from "../../types/calendar";

const getDatabase = vi.fn();

vi.mock("../../utils/api", () => ({
  getDatabase: (...args: unknown[]) => getDatabase(...args),
}));

vi.mock("../../stores/pageStore", () => ({
  usePageStore: <T,>(selector: (s: unknown) => T): T =>
    selector({
      pages: [
        { id: "db1", title: "Tasks", pageType: "database" },
        { id: "db2", title: "Contacts", pageType: "database" },
        { id: "ics1", title: "Holidays", pageType: "ics" },
        { id: "std1", title: "Notes", pageType: "standard" },
      ],
    }),
}));

const TASKS_PROPS = [
  { id: "p-title", name: "Title", type: "text" },
  { id: "p-due", name: "Due", type: "date" },
  { id: "p-done", name: "Done", type: "date" },
];
const CONTACTS_PROPS = [{ id: "p-name", name: "Name", type: "text" }];

function mockDatabases() {
  getDatabase.mockImplementation((_nb: string, pageId: string) =>
    Promise.resolve({
      database: {
        version: 2,
        properties: pageId === "db1" ? TASKS_PROPS : CONTACTS_PROPS,
        rows: [],
        views: [],
      },
    }),
  );
}

const emptyConfig: CalendarPageConfig = {
  version: 1,
  sources: [],
  viewMode: "month",
};

function renderPanel(config: CalendarPageConfig) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <CalendarSourcesPanel
      notebookId="nb-1"
      config={config}
      onChange={onChange}
      onClose={onClose}
    />,
  );
  return { ...utils, onChange, onClose };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CalendarSourcesPanel", () => {
  it("adds a database source with chosen date and end properties", async () => {
    mockDatabases();
    const { onChange } = renderPanel(emptyConfig);

    fireEvent.click(screen.getByText("+ Database"));
    fireEvent.change(screen.getByLabelText("Database page"), {
      target: { value: "db1" },
    });
    await waitFor(() => screen.getByLabelText("Date property"));
    fireEvent.change(screen.getByLabelText("Date property"), {
      target: { value: "p-due" },
    });
    fireEvent.change(screen.getByLabelText("End date property"), {
      target: { value: "p-done" },
    });
    fireEvent.click(screen.getByText("Add source"));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as CalendarPageConfig;
    expect(next.sources).toHaveLength(1);
    const source = next.sources[0] as CalendarDatabaseSource;
    expect(source.type).toBe("database");
    expect(source.pageId).toBe("db1");
    expect(source.datePropertyId).toBe("p-due");
    expect(source.endDatePropertyId).toBe("p-done");
    expect(source.id).toBeTruthy();
    expect(source.color).toBeTruthy();
  });

  it("explains and blocks adding a database without date properties", async () => {
    mockDatabases();
    renderPanel(emptyConfig);

    fireEvent.click(screen.getByText("+ Database"));
    fireEvent.change(screen.getByLabelText("Database page"), {
      target: { value: "db2" },
    });

    await waitFor(() =>
      expect(screen.getByText(/no date properties/)).toBeTruthy(),
    );
    expect(
      (screen.getByText("Add source") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("adds an ics-file source from the ics page picker", () => {
    const { onChange } = renderPanel(emptyConfig);

    fireEvent.click(screen.getByText("+ ICS file"));
    const picker = screen.getByLabelText("ICS page");
    // Only ics pages are offered
    expect(picker.textContent).toContain("Holidays");
    expect(picker.textContent).not.toContain("Notes");
    fireEvent.change(picker, { target: { value: "ics1" } });
    fireEvent.click(screen.getByText("Add source"));

    const next = onChange.mock.calls[0][0] as CalendarPageConfig;
    expect(next.sources[0]).toMatchObject({ type: "ics-file", pageId: "ics1" });
  });

  it("validates https and adds a subscription with the chosen interval", () => {
    const { onChange } = renderPanel(emptyConfig);

    fireEvent.click(screen.getByText("+ Subscription"));
    const input = screen.getByLabelText("Subscription URL");

    fireEvent.change(input, { target: { value: "http://example.com/a.ics" } });
    expect(screen.getByText(/must start with https/)).toBeTruthy();
    expect(
      (screen.getByText("Add source") as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(input, { target: { value: "https://example.com/a.ics" } });
    fireEvent.change(screen.getByLabelText("Refresh interval"), {
      target: { value: "360" },
    });
    fireEvent.click(screen.getByText("Add source"));

    const next = onChange.mock.calls[0][0] as CalendarPageConfig;
    expect(next.sources[0]).toMatchObject({
      type: "ics-subscription",
      url: "https://example.com/a.ics",
      refreshMinutes: 360,
    });
  });

  it("removes a source", () => {
    mockDatabases();
    const config: CalendarPageConfig = {
      ...emptyConfig,
      sources: [
        { type: "ics-file", id: "s1", pageId: "ics1", color: "#111" },
      ],
    };
    const { onChange } = renderPanel(config);

    fireEvent.click(screen.getByLabelText("Remove Holidays"));

    const next = onChange.mock.calls[0][0] as CalendarPageConfig;
    expect(next.sources).toEqual([]);
  });

  it("keeps the events target exclusive across database sources", () => {
    mockDatabases();
    const dbSource = (id: string, target?: boolean): CalendarDatabaseSource => ({
      type: "database",
      id,
      pageId: "db1",
      datePropertyId: "p-due",
      color: "#111",
      ...(target ? { isEventsTarget: true } : {}),
    });
    const config: CalendarPageConfig = {
      ...emptyConfig,
      sources: [dbSource("s1", true), dbSource("s2")],
    };
    const { onChange } = renderPanel(config);

    const toggles = screen.getAllByLabelText(/Use for new events/);
    fireEvent.click(toggles[1]);

    const next = onChange.mock.calls[0][0] as CalendarPageConfig;
    const [first, second] = next.sources as CalendarDatabaseSource[];
    expect(first.isEventsTarget).toBeUndefined();
    expect(second.isEventsTarget).toBe(true);
  });

  it("changes a source color from the palette", async () => {
    mockDatabases();
    const config: CalendarPageConfig = {
      ...emptyConfig,
      sources: [
        { type: "ics-file", id: "s1", pageId: "ics1", color: "#111111" },
      ],
    };
    const { onChange } = renderPanel(config);

    fireEvent.click(screen.getByLabelText("Change color for Holidays"));
    const swatches = await screen.findAllByLabelText(/^color /);
    fireEvent.click(swatches[0]);

    const next = onChange.mock.calls[0][0] as CalendarPageConfig;
    expect(next.sources[0].color).not.toBe("#111111");
    expect(next.sources[0].color).toBeTruthy();
  });
});
