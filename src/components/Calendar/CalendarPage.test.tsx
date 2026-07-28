// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

import { CalendarPage } from "./CalendarPage";
import type { Page } from "../../types/page";

const getFileContent = vi.fn();
const updateFileContent = vi.fn();

vi.mock("../../utils/api", () => ({
  getFileContent: (...args: unknown[]) => getFileContent(...args),
  updateFileContent: (...args: unknown[]) => updateFileContent(...args),
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
      expect(
        screen.getByText("This calendar has no sources yet."),
      ).toBeTruthy(),
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
