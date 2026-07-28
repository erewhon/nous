// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

import { CalendarPage } from "./CalendarPage";
import type { Page } from "../../types/page";

const getFileContent = vi.fn();
const updateFileContent = vi.fn();
const getDatabase = vi.fn();
const fetchIcsSubscription = vi.fn();

vi.mock("../../utils/api", () => ({
  getFileContent: (...args: unknown[]) => getFileContent(...args),
  updateFileContent: (...args: unknown[]) => updateFileContent(...args),
  getDatabase: (...args: unknown[]) => getDatabase(...args),
  fetchIcsSubscription: (...args: unknown[]) => fetchIcsSubscription(...args),
}));

vi.mock("../../stores/pageStore", () => ({
  usePageStore: <T,>(selector: (s: unknown) => T): T =>
    selector({ pages: [], selectPage: () => {} }),
}));

const page = {
  id: "page-1",
  title: "My Calendar",
  pageType: "calendar",
} as unknown as Page;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CalendarPage", () => {
  it("renders the empty state for a fresh config", async () => {
    getFileContent.mockResolvedValue({
      content: JSON.stringify({ version: 1, sources: [], viewMode: "month" }),
    });

    render(<CalendarPage page={page} notebookId="nb-1" />);

    await waitFor(() =>
      expect(screen.getByText(/no sources yet/)).toBeTruthy(),
    );
    expect(screen.getByText("0 sources")).toBeTruthy();
  });

  it("shows the source count from the stored config", async () => {
    getFileContent.mockResolvedValue({
      content: JSON.stringify({
        version: 1,
        viewMode: "month",
        sources: [
          {
            type: "database",
            id: "s1",
            pageId: "p1",
            datePropertyId: "d1",
            color: "#000",
          },
          { type: "ics-file", id: "s2", pageId: "p2", color: "#111" },
        ],
      }),
    });

    render(<CalendarPage page={page} notebookId="nb-1" />);

    await waitFor(() => expect(screen.getByText("2 sources")).toBeTruthy());
  });

  const subscriptionConfig = JSON.stringify({
    version: 1,
    viewMode: "month",
    sources: [
      {
        type: "ics-subscription",
        id: "sub1",
        url: "https://feeds.example.com/cal.ics",
        refreshMinutes: 60,
        color: "#f97316",
      },
    ],
  });

  function todayAllDayIcs(summary: string): string {
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate(),
    ).padStart(2, "0")}`;
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//EN",
      "BEGIN:VEVENT",
      `UID:sub-ev-1`,
      `SUMMARY:${summary}`,
      `DTSTART;VALUE=DATE:${ymd}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
  }

  it("loads subscription sources through the cached fetcher", async () => {
    getFileContent.mockResolvedValue({ content: subscriptionConfig });
    fetchIcsSubscription.mockResolvedValue({
      content: todayAllDayIcs("SubEvent"),
      fetchedAt: new Date().toISOString(),
      fromCache: false,
    });

    render(<CalendarPage page={page} notebookId="nb-1" />);

    await waitFor(() =>
      expect(fetchIcsSubscription).toHaveBeenCalledWith(
        "https://feeds.example.com/cal.ics",
        3600,
      ),
    );
    expect(await screen.findByText("SubEvent")).toBeTruthy();
    expect(screen.queryByText(/stale/)).toBeNull();
  });

  it("marks a cached copy older than twice the refresh interval as stale", async () => {
    getFileContent.mockResolvedValue({ content: subscriptionConfig });
    fetchIcsSubscription.mockResolvedValue({
      content: todayAllDayIcs("SubEvent"),
      fetchedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      fromCache: true,
    });

    render(<CalendarPage page={page} notebookId="nb-1" />);

    await waitFor(() => expect(screen.getByText(/stale/)).toBeTruthy());
  });

  it("forces a cache bypass on manual refresh", async () => {
    getFileContent.mockResolvedValue({ content: subscriptionConfig });
    fetchIcsSubscription.mockResolvedValue({
      content: todayAllDayIcs("SubEvent"),
      fetchedAt: new Date().toISOString(),
      fromCache: false,
    });

    render(<CalendarPage page={page} notebookId="nb-1" />);
    await waitFor(() => expect(fetchIcsSubscription).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText("Refresh sources"));

    await waitFor(() => expect(fetchIcsSubscription).toHaveBeenCalledTimes(2));
    expect(fetchIcsSubscription.mock.calls[1]).toEqual([
      "https://feeds.example.com/cal.ics",
      0,
    ]);
  });

  it("shows an error chip when the fetch fails without a cache", async () => {
    getFileContent.mockResolvedValue({ content: subscriptionConfig });
    fetchIcsSubscription.mockRejectedValue(new Error("fetch failed: HTTP 502"));

    render(<CalendarPage page={page} notebookId="nb-1" />);

    await waitFor(() => expect(screen.getByText(/⚠/)).toBeTruthy());
    expect(screen.getByTitle(/HTTP 502/)).toBeTruthy();
  });

  it("surfaces malformed config as an error without writing the file", async () => {
    getFileContent.mockResolvedValue({ content: "not json{" });

    render(<CalendarPage page={page} notebookId="nb-1" />);

    await waitFor(() =>
      expect(
        screen.getByText("Couldn't read this calendar's configuration"),
      ).toBeTruthy(),
    );
    expect(updateFileContent).not.toHaveBeenCalled();
  });
});
