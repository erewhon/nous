import { describe, it, expect, vi } from "vitest";
import {
  buildWikiLinkMenuItems,
  cleanWikiLinkQuery,
  WIKI_LINK_MENU_LIMIT,
} from "./wikiLinkMenuItems";

const targets = [
  { id: "1", title: "Web Frontend Parity" },
  { id: "2", title: "Feature: Web" },
  { id: "3", title: "Daily Notes" },
  { id: "4", title: "Weekly Review" },
];

function actions() {
  return { insertLink: vi.fn(), createPage: vi.fn() };
}

describe("cleanWikiLinkQuery", () => {
  it("strips trailing closing brackets", () => {
    expect(cleanWikiLinkQuery("Page]]")).toBe("Page");
    expect(cleanWikiLinkQuery("Page]")).toBe("Page");
    expect(cleanWikiLinkQuery("Page")).toBe("Page");
  });

  it("only strips at the end", () => {
    expect(cleanWikiLinkQuery("a]b")).toBe("a]b");
  });
});

describe("buildWikiLinkMenuItems", () => {
  it("lists all pages for an empty query with no create item", () => {
    const items = buildWikiLinkMenuItems(targets, "", actions());
    expect(items.map((i) => i.title)).toEqual([
      "Daily Notes",
      "Feature: Web",
      "Web Frontend Parity",
      "Weekly Review",
    ]);
  });

  it("filters case-insensitively on substring", () => {
    const items = buildWikiLinkMenuItems(targets, "web", actions());
    expect(items.map((i) => i.title)).toEqual([
      "Web Frontend Parity",
      "Feature: Web",
      'Create page "web"',
    ]);
  });

  it("keeps filtering through a colon in the query", () => {
    const items = buildWikiLinkMenuItems(targets, "Feature: W", actions());
    expect(items[0]!.title).toBe("Feature: Web");
  });

  it("puts prefix matches before substring matches", () => {
    const items = buildWikiLinkMenuItems(targets, "We", actions());
    expect(items.map((i) => i.title)).toEqual([
      "Web Frontend Parity",
      "Weekly Review",
      "Feature: Web",
      'Create page "We"',
    ]);
  });

  it("omits the create item on an exact title match", () => {
    const items = buildWikiLinkMenuItems(targets, "Daily Notes", actions());
    expect(items.map((i) => i.title)).toEqual(["Daily Notes"]);
  });

  it("exact match is case-insensitive", () => {
    const items = buildWikiLinkMenuItems(targets, "daily notes", actions());
    expect(items.map((i) => i.title)).toEqual(["Daily Notes"]);
  });

  it("offers only the create item when nothing matches", () => {
    const acts = actions();
    const items = buildWikiLinkMenuItems(targets, "Nonexistent", acts);
    expect(items).toHaveLength(1);
    items[0]!.onItemClick();
    expect(acts.createPage).toHaveBeenCalledWith("Nonexistent");
  });

  it("ignores typed closing brackets when filtering and creating", () => {
    const acts = actions();
    const items = buildWikiLinkMenuItems(targets, "Daily Notes]]", acts);
    expect(items.map((i) => i.title)).toEqual(["Daily Notes"]);
    const createItems = buildWikiLinkMenuItems(targets, "New Page]]", acts);
    createItems[0]!.onItemClick();
    expect(acts.createPage).toHaveBeenCalledWith("New Page");
  });

  it("selecting a page item inserts with title and id", () => {
    const acts = actions();
    const items = buildWikiLinkMenuItems(targets, "Daily", acts);
    items[0]!.onItemClick();
    expect(acts.insertLink).toHaveBeenCalledWith("Daily Notes", "3");
  });

  it("caps page items at the limit but keeps the create item", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      title: `Page ${String(i).padStart(2, "0")}`,
    }));
    const items = buildWikiLinkMenuItems(many, "Page", actions());
    expect(items).toHaveLength(WIKI_LINK_MENU_LIMIT + 1);
    expect(items[items.length - 1]!.title).toBe('Create page "Page"');
  });
});
