// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DocumentProcessorIssues } from "./DocumentProcessorIssues";

// vitest globals are off → register cleanup manually.
afterEach(() => cleanup());

describe("DocumentProcessorIssues", () => {
  it("renders nothing when there are no diagnostics or actions", () => {
    const { container } = render(
      <DocumentProcessorIssues results={{ diagnostics: [], actions: [] }} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("expands the chip to show diagnostics and runs an action on click", () => {
    const run = vi.fn();
    render(
      <DocumentProcessorIssues
        results={{
          diagnostics: [
            {
              range: { blockId: "" },
              severity: "info",
              message: 'No page titled "Foo"',
              source: "nous.wiki-link",
            },
          ],
          actions: [{ id: "create:Foo", title: 'Create page "Foo"', run }],
        }}
      />
    );

    // Starts collapsed as a chip.
    fireEvent.click(screen.getByTitle("Show document suggestions"));

    // Diagnostic message is shown once expanded.
    expect(screen.getByText('No page titled "Foo"')).toBeInTheDocument();

    // Clicking the action invokes its run().
    fireEvent.click(screen.getByText('Create page "Foo"'));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("shows an action even with no diagnostics", () => {
    const run = vi.fn();
    render(
      <DocumentProcessorIssues
        results={{
          diagnostics: [],
          actions: [{ id: "a", title: "Do the thing", run }],
        }}
      />
    );
    fireEvent.click(screen.getByTitle("Show document suggestions"));
    expect(screen.getByText("Do the thing")).toBeInTheDocument();
  });
});
