import { describe, it, expect } from "vitest";
import {
  fuzzyScore,
  scoreCommand,
  rankCommands,
  rankSearchResults,
  type RankableCommand,
} from "./rankCommands";

describe("fuzzyScore", () => {
  it("returns 0 for a scattered (non-substring) match", () => {
    expect(fuzzyScore("hello", "xyz")).toBe(0);
    expect(fuzzyScore("abc", "cba")).toBe(0); // out of order
    expect(fuzzyScore("Backup & Restore", "art")).toBe(0); // scattered, not a substring
  });

  it("ranks exact > prefix > word-boundary > mid-word > separator-insensitive", () => {
    const exact = fuzzyScore("graph", "graph");
    const prefix = fuzzyScore("graph view", "graph");
    const boundary = fuzzyScore("open graph", "graph");
    const midword = fuzzyScore("biography", "graph");
    const stripped = fuzzyScore("New Page", "newpage");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(boundary);
    expect(boundary).toBeGreaterThan(midword);
    expect(midword).toBeGreaterThan(0);
    expect(stripped).toBeGreaterThan(0);
  });

  it("prefers matches at word boundaries", () => {
    // "org" at the start of the word "Organize" beats mid-word "...anize".
    const boundary = fuzzyScore("Smart Organize", "org");
    const midword = fuzzyScore("Reorganizer", "org");
    expect(boundary).toBeGreaterThan(midword);
  });

  it("is case-insensitive and trims the query", () => {
    expect(fuzzyScore("Graph", "  GRAPH  ")).toBe(fuzzyScore("graph", "graph"));
  });
});

describe("scoreCommand", () => {
  const cmd = (over: Partial<RankableCommand>): RankableCommand => ({
    title: "Title",
    ...over,
  });

  it("matches on title", () => {
    expect(scoreCommand(cmd({ title: "Open Graph View" }), "graph")).toBeGreaterThan(0);
  });

  it("matches on keywords (weighted below title)", () => {
    const byKeyword = scoreCommand(
      cmd({ title: "Random Note", keywords: ["shuffle"] }),
      "shuffle",
    );
    const byTitle = scoreCommand(cmd({ title: "Shuffle" }), "shuffle");
    expect(byKeyword).toBeGreaterThan(0);
    expect(byTitle).toBeGreaterThan(byKeyword);
  });

  it("does NOT surface a command on a subtitle-only match", () => {
    // The classic overmatch: every command's subtitle says "page".
    const c = cmd({ title: "Backup & Restore", subtitle: "Create a new page" });
    expect(scoreCommand(c, "page")).toBe(0);
  });

  it("uses subtitle only as a tiebreak once title/keywords match", () => {
    const withSub = scoreCommand(
      cmd({ title: "New Page", subtitle: "page page page" }),
      "page",
    );
    const withoutSub = scoreCommand(cmd({ title: "New Page" }), "page");
    expect(withSub).toBeGreaterThan(withoutSub);
    expect(withSub - withoutSub).toBeLessThan(withoutSub); // only a nudge
  });
});

describe("rankCommands", () => {
  const cmds: RankableCommand[] = [
    { title: "Smart Organize", keywords: ["organize"] },
    { title: "Smart Collections", keywords: ["collections"] },
    { title: "Open Art Gallery", keywords: ["art"] },
    { title: "Import Artwork", keywords: ["art", "import"] },
    { title: "Backup & Restore", subtitle: "archive everything" },
  ];

  it("returns the input unchanged for an empty query", () => {
    expect(rankCommands(cmds, "")).toEqual(cmds);
    expect(rankCommands(cmds, "   ")).toEqual(cmds);
  });

  it("ranks word-boundary matches above mid-word, drops scattered non-matches", () => {
    const out = rankCommands(cmds, "art");
    const titles = out.map((c) => c.title);
    // "Art" at a word boundary leads; "Sm[art]" still matches (real substring)
    // but ranks lower; "Backup & Restore" (scattered) is dropped entirely.
    expect(titles).toContain("Open Art Gallery");
    expect(titles).toContain("Import Artwork");
    expect(titles).not.toContain("Backup & Restore");
    expect(titles.indexOf("Open Art Gallery")).toBeLessThan(
      titles.indexOf("Smart Organize"),
    );
  });

  it("ranks an exact/prefix title hit first", () => {
    const list: RankableCommand[] = [
      { title: "Take the Tour" },
      { title: "Toggle Theme" },
      { title: "Tour" },
    ];
    expect(rankCommands(list, "tour")[0].title).toBe("Tour");
  });
});

describe("rankSearchResults", () => {
  it("sorts title-relevant pages above generic body hits at equal score", () => {
    const results = [
      { title: "Unrelated", score: 0.5, pageId: "a" }, // content-only hit
      { title: "Graph Notes", score: 0.5, pageId: "b" }, // title relates to query
    ];
    expect(rankSearchResults(results, "graph")[0].pageId).toBe("b");
  });

  it("hides results below the score threshold", () => {
    const results = [
      { title: "Strong", score: 0.8, pageId: "a" },
      { title: "Weak", score: 0.1, pageId: "b" },
    ];
    const out = rankSearchResults(results, "x", 0.2);
    expect(out.map((r) => r.pageId)).toEqual(["a"]);
  });

  it("de-duplicates the same page id", () => {
    const results = [
      { title: "Dupe", score: 1.0, pageId: "a" },
      { title: "Dupe", score: 0.5, pageId: "a" },
      { title: "Other", score: 0.7, pageId: "b" },
    ];
    const ids = rankSearchResults(results, "dupe").map((r) => r.pageId);
    expect(ids).toEqual(["a", "b"]);
  });
});
