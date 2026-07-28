import { describe, expect, it } from "vitest";

import {
  CalendarPageConfigSchema,
  createDefaultCalendarConfig,
  parseCalendarConfig,
} from "./calendar";

const dbSource = {
  type: "database",
  id: "src-1",
  pageId: "page-1",
  datePropertyId: "prop-date",
  color: "#3b82f6",
} as const;

describe("CalendarPageConfigSchema", () => {
  it("parses a full config with all three source types", () => {
    const config = CalendarPageConfigSchema.parse({
      version: 1,
      viewMode: "week",
      sources: [
        { ...dbSource, endDatePropertyId: "prop-end", isEventsTarget: true },
        { type: "ics-file", id: "src-2", pageId: "page-2", color: "#22c55e" },
        {
          type: "ics-subscription",
          id: "src-3",
          url: "https://example.com/feed.ics",
          color: "#f97316",
        },
      ],
    });

    expect(config.sources).toHaveLength(3);
    expect(config.viewMode).toBe("week");
  });

  it("applies defaults for sources, viewMode, and refreshMinutes", () => {
    const config = CalendarPageConfigSchema.parse({ version: 1 });
    expect(config.sources).toEqual([]);
    expect(config.viewMode).toBe("month");

    const withSub = CalendarPageConfigSchema.parse({
      version: 1,
      sources: [
        {
          type: "ics-subscription",
          id: "s",
          url: "https://example.com/a.ics",
          color: "#000",
        },
      ],
    });
    const sub = withSub.sources[0];
    expect(sub.type === "ics-subscription" && sub.refreshMinutes).toBe(60);
  });

  it("rejects unknown source types", () => {
    expect(() =>
      CalendarPageConfigSchema.parse({
        version: 1,
        sources: [{ type: "carrier-pigeon", id: "s", color: "#000" }],
      }),
    ).toThrow();
  });

  it("rejects non-https subscription URLs", () => {
    expect(() =>
      CalendarPageConfigSchema.parse({
        version: 1,
        sources: [
          {
            type: "ics-subscription",
            id: "s",
            url: "http://example.com/a.ics",
            color: "#000",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects more than one events target", () => {
    expect(() =>
      CalendarPageConfigSchema.parse({
        version: 1,
        sources: [
          { ...dbSource, isEventsTarget: true },
          { ...dbSource, id: "src-9", isEventsTarget: true },
        ],
      }),
    ).toThrow(/events target/i);
  });

  it("rejects unknown versions", () => {
    expect(() => CalendarPageConfigSchema.parse({ version: 2 })).toThrow();
  });
});

describe("parseCalendarConfig", () => {
  it("returns the default config for empty content", () => {
    expect(parseCalendarConfig("")).toEqual(createDefaultCalendarConfig());
    expect(parseCalendarConfig("  \n")).toEqual(createDefaultCalendarConfig());
  });

  it("round-trips a serialized config", () => {
    const config = {
      ...createDefaultCalendarConfig(),
      sources: [dbSource],
    };
    expect(parseCalendarConfig(JSON.stringify(config, null, 2))).toEqual(config);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseCalendarConfig("not json{")).toThrow();
  });
});
