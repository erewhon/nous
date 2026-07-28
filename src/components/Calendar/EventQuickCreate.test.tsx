// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

import { EventQuickCreate } from "./EventQuickCreate";
import type {
  CalendarPageConfig,
  CalendarDatabaseSource,
} from "../../types/calendar";
import type { DatabaseRow } from "../../types/database";

const getDatabase = vi.fn();
const putDatabase = vi.fn();
const updatePage = vi.fn();
const updateFileContent = vi.fn();

vi.mock("../../utils/api", () => ({
  getDatabase: (...args: unknown[]) => getDatabase(...args),
  putDatabase: (...args: unknown[]) => putDatabase(...args),
  updatePage: (...args: unknown[]) => updatePage(...args),
  updateFileContent: (...args: unknown[]) => updateFileContent(...args),
}));

const createPage = vi.fn();
vi.mock("../../stores/pageStore", () => ({
  usePageStore: Object.assign(
    <T,>(selector: (s: unknown) => T): T => selector({ pages: [] }),
    {
      getState: () => ({ createPage }),
      setState: () => {},
    },
  ),
}));

const EVENTS_PROPS = [
  { id: "p-t", name: "Title", type: "text" },
  { id: "p-d", name: "Date", type: "date" },
  { id: "p-e", name: "End Date", type: "date" },
  { id: "p-a", name: "All Day", type: "checkbox", defaultValue: false },
  { id: "p-l", name: "Location", type: "text" },
];

const EVENTS_CONTENT = {
  version: 2,
  properties: EVENTS_PROPS,
  rows: [
    {
      id: "r0",
      cells: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  views: [],
};

const targetSource: CalendarDatabaseSource = {
  type: "database",
  id: "s1",
  pageId: "events-db",
  datePropertyId: "p-d",
  endDatePropertyId: "p-e",
  color: "#111",
  isEventsTarget: true,
};

const configWithTarget: CalendarPageConfig = {
  version: 1,
  sources: [targetSource],
  viewMode: "month",
};

const emptyConfig: CalendarPageConfig = {
  version: 1,
  sources: [],
  viewMode: "month",
};

function renderQuickCreate(config: CalendarPageConfig) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const onOpenSources = vi.fn();
  const onConfigChange = vi.fn();
  const utils = render(
    <EventQuickCreate
      notebookId="nb-1"
      config={config}
      initialDate="2026-07-15"
      onClose={onClose}
      onCreated={onCreated}
      onOpenSources={onOpenSources}
      onConfigChange={onConfigChange}
    />,
  );
  return { ...utils, onClose, onCreated, onOpenSources, onConfigChange };
}

function savedRow(): DatabaseRow {
  const next = putDatabase.mock.calls[0][2] as { rows: DatabaseRow[] };
  return next.rows[next.rows.length - 1];
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EventQuickCreate", () => {
  it("saves an all-day event through the merge-protected row-add path", async () => {
    getDatabase.mockResolvedValue({ database: EVENTS_CONTENT });
    putDatabase.mockResolvedValue(undefined);
    const { onCreated, onClose } = renderQuickCreate(configWithTarget);

    fireEvent.change(screen.getByLabelText("Event title"), {
      target: { value: "Conference" },
    });
    fireEvent.change(screen.getByLabelText("Event location"), {
      target: { value: "Berlin" },
    });
    fireEvent.click(screen.getByText("Save event"));

    await waitFor(() => expect(putDatabase).toHaveBeenCalledTimes(1));
    const [nb, pageId, , baselineRowIds, baseline] = putDatabase.mock.calls[0];
    expect(nb).toBe("nb-1");
    expect(pageId).toBe("events-db");
    expect(baselineRowIds).toEqual(["r0"]);
    expect(baseline).toBe(EVENTS_CONTENT);

    const row = savedRow();
    expect(row.cells["p-t"]).toBe("Conference");
    expect(row.cells["p-d"]).toBe("2026-07-15");
    expect(row.cells["p-a"]).toBe(true);
    expect(row.cells["p-l"]).toBe("Berlin");
    expect(row.cells["p-e"]).toBeUndefined();

    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("saves a timed event with ISO datetimes and All Day false", async () => {
    getDatabase.mockResolvedValue({ database: EVENTS_CONTENT });
    putDatabase.mockResolvedValue(undefined);
    renderQuickCreate(configWithTarget);

    fireEvent.change(screen.getByLabelText("Event title"), {
      target: { value: "Standup" },
    });
    fireEvent.change(screen.getByLabelText("Start time"), {
      target: { value: "09:00" },
    });
    fireEvent.change(screen.getByLabelText("End time"), {
      target: { value: "09:30" },
    });
    fireEvent.click(screen.getByText("Save event"));

    await waitFor(() => expect(putDatabase).toHaveBeenCalledTimes(1));
    const row = savedRow();
    expect(row.cells["p-d"]).toBe(new Date(2026, 6, 15, 9, 0).toISOString());
    expect(row.cells["p-e"]).toBe(new Date(2026, 6, 15, 9, 30).toISOString());
    expect(row.cells["p-a"]).toBe(false);
  });

  it("requires a title before saving", () => {
    renderQuickCreate(configWithTarget);

    expect(
      (screen.getByText("Save event") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(putDatabase).not.toHaveBeenCalled();
  });

  it("offers target setup when no events database is configured", () => {
    const { onOpenSources, onClose } = renderQuickCreate(emptyConfig);

    expect(screen.getByText("Create Events database")).toBeTruthy();
    fireEvent.click(screen.getByText("Choose database"));
    expect(onOpenSources).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("creates an Events database from the template and wires it as target", async () => {
    createPage.mockResolvedValue({ id: "new-db" });
    updatePage.mockResolvedValue({ id: "new-db", pageType: "database" });
    updateFileContent.mockResolvedValue(undefined);
    const { onConfigChange } = renderQuickCreate(emptyConfig);

    fireEvent.click(screen.getByText("Create Events database"));

    await waitFor(() => expect(onConfigChange).toHaveBeenCalledTimes(1));
    expect(createPage).toHaveBeenCalledWith("nb-1", "Events");
    expect(updatePage).toHaveBeenCalledWith("nb-1", "new-db", {
      fileExtension: "database",
      pageType: "database",
    });
    // The database content written is the real Events template output.
    const written = JSON.parse(
      updateFileContent.mock.calls[0][2] as string,
    );
    expect(written.views[0].type).toBe("calendar");

    const next = onConfigChange.mock.calls[0][0] as CalendarPageConfig;
    const source = next.sources[0] as CalendarDatabaseSource;
    expect(source.type).toBe("database");
    expect(source.pageId).toBe("new-db");
    expect(source.isEventsTarget).toBe(true);
    expect(source.datePropertyId).toBeTruthy();
    expect(source.endDatePropertyId).toBeTruthy();
  });
});
