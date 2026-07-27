import { describe, expect, it } from "vitest";
import { extractWikiLinks } from "./extractWikiLinks";

function para(text: string) {
  return { type: "paragraph", data: { text } };
}

describe("extractWikiLinks", () => {
  it("extracts serialized wiki-link elements (the stored form)", () => {
    const blocks = [
      para(
        'See <wiki-link data-page-title="The Extended Mind" data-page-id="p1">the extended mind</wiki-link> for more.'
      ),
    ];
    expect(extractWikiLinks(blocks)).toEqual(["The Extended Mind"]);
  });

  it("still extracts raw [[Title]] syntax", () => {
    expect(extractWikiLinks([para("Go read [[Attention]] today.")])).toEqual([
      "Attention",
    ]);
  });

  it("handles both forms mixed, deduplicated", () => {
    const blocks = [
      para('[[Alpha]] then <wiki-link data-page-title="Alpha">Alpha</wiki-link>'),
      { type: "header", data: { text: '<wiki-link data-page-title="Beta">Beta</wiki-link>', level: 2 } },
    ];
    expect(extractWikiLinks(blocks)).toEqual(["Alpha", "Beta"]);
  });

  it("decodes escaped attribute entities", () => {
    const blocks = [
      para('<wiki-link data-page-title="Q&amp;A &quot;notes&quot;">x</wiki-link>'),
    ];
    expect(extractWikiLinks(blocks)).toEqual(['Q&A "notes"']);
  });

  it("scans list and checklist items, string or object", () => {
    const blocks = [
      {
        type: "list",
        data: {
          items: [
            'First <wiki-link data-page-title="Gamma">Gamma</wiki-link>',
            { text: "[[Delta]]", checked: false },
            { content: '<wiki-link data-page-title="Epsilon">e</wiki-link>' },
          ],
        },
      },
      { type: "callout", data: { content: "[[Zeta]] inside a callout" } },
    ];
    expect(extractWikiLinks(blocks)).toEqual([
      "Gamma",
      "Delta",
      "Epsilon",
      "Zeta",
    ]);
  });

  it("returns empty for blocks without links", () => {
    expect(extractWikiLinks([para("nothing here")])).toEqual([]);
    expect(extractWikiLinks([{ type: "code", data: { code: "[[not text field]]" } }])).toEqual([]);
  });
});
