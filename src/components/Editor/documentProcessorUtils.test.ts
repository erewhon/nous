import { describe, it, expect } from "vitest";

import {
  buildDecorationCss,
  buildText,
  buildTitleResolver,
  cssAttrValue,
  extractInlines,
  inlineText,
  styleBody,
  type AnyBlock,
} from "./documentProcessorUtils";
import type { Decoration, InlineRef } from "../../plugin-sdk/document-processor";

describe("inlineText", () => {
  it("returns the text of a styled-text item", () => {
    expect(inlineText({ type: "text", text: "hello" })).toBe("hello");
  });

  it("joins the content of a link item", () => {
    expect(
      inlineText({ type: "link", content: [{ text: "a" }, { text: "b" }] }),
    ).toBe("ab");
  });

  it("falls back to pageTitle for custom inline content", () => {
    expect(inlineText({ type: "wikiLink", props: { pageTitle: "My Page" } })).toBe("My Page");
  });

  it("returns empty string for an unrecognized item", () => {
    expect(inlineText({ type: "mystery" })).toBe("");
  });
});

describe("extractInlines", () => {
  it("flattens inline content across blocks", () => {
    const blocks: AnyBlock[] = [
      { id: "b1", type: "paragraph", content: [{ type: "text", text: "hi" }] },
      {
        id: "b2",
        type: "paragraph",
        content: [{ type: "wikiLink", props: { pageTitle: "Foo", pageId: "" } }],
      },
    ];
    const inlines = extractInlines(blocks);
    expect(inlines).toHaveLength(2);
    expect(inlines[0]).toMatchObject({ blockId: "b1", type: "text", text: "hi" });
    expect(inlines[1]).toMatchObject({ blockId: "b2", type: "wikiLink", text: "Foo" });
  });

  it("recurses into block children (e.g. columns)", () => {
    const blocks: AnyBlock[] = [
      {
        id: "col",
        type: "columnList",
        children: [
          { id: "c1", type: "paragraph", content: [{ type: "wikiLink", props: { pageTitle: "Nested" } }] },
        ],
      },
    ];
    const inlines = extractInlines(blocks);
    expect(inlines).toHaveLength(1);
    expect(inlines[0]).toMatchObject({ blockId: "c1", type: "wikiLink", text: "Nested" });
  });

  it("skips blocks whose content is not an inline array (e.g. tables, images)", () => {
    const blocks: AnyBlock[] = [
      { id: "img", type: "image", content: undefined },
      { id: "tbl", type: "table", content: { type: "tableContent", rows: [] } },
    ];
    expect(extractInlines(blocks)).toHaveLength(0);
  });
});

describe("buildText", () => {
  it("space-joins inline text", () => {
    const inlines: InlineRef[] = [
      { blockId: "b", type: "text", text: "one" },
      { blockId: "b", type: "text", text: "two" },
    ];
    expect(buildText(inlines)).toBe("one two");
  });
});

describe("buildTitleResolver", () => {
  it("resolves case-insensitively and trimming whitespace", () => {
    const resolve = buildTitleResolver([{ id: "1", title: "Daily Note" }]);
    expect(resolve("daily note")).toMatchObject({ id: "1" });
    expect(resolve("  DAILY NOTE  ")).toMatchObject({ id: "1" });
    expect(resolve("missing")).toBeNull();
  });

  it("treats undefined page list as resolving nothing", () => {
    const resolve = buildTitleResolver(undefined);
    expect(resolve("anything")).toBeNull();
  });

  it("last duplicate title wins", () => {
    const resolve = buildTitleResolver([
      { id: "old", title: "Dup" },
      { id: "new", title: "Dup" },
    ]);
    expect(resolve("dup")).toMatchObject({ id: "new" });
  });
});

describe("cssAttrValue", () => {
  it("escapes backslashes and double quotes", () => {
    expect(cssAttrValue('a"b')).toBe('a\\"b');
    expect(cssAttrValue("a\\b")).toBe("a\\\\b");
  });
});

describe("styleBody", () => {
  it("serializes a style record to a CSS declaration body", () => {
    expect(styleBody({ color: "red", "text-decoration": "line-through" })).toBe(
      "color:red;text-decoration:line-through",
    );
  });
});

describe("buildDecorationCss", () => {
  const broken: Decoration = {
    kind: "inline-attr",
    attr: "data-page-title",
    value: "Ghost",
    style: { "text-decoration": "line-through" },
  };

  it("scopes inline-attr rules to the editor instance by pageId", () => {
    const css = buildDecorationCss([broken], "page-1");
    expect(css).toBe(
      '.bn-editor-wrapper[data-page-id="page-1"] [data-page-title="Ghost"]{text-decoration:line-through}',
    );
  });

  it("falls back to an unscoped wrapper selector without a pageId", () => {
    const css = buildDecorationCss([broken]);
    expect(css.startsWith(".bn-editor-wrapper [data-page-title=")).toBe(true);
  });

  it("ignores range decorations (no inline applier yet)", () => {
    const range: Decoration = { kind: "range", range: { blockId: "b" }, className: "x" };
    expect(buildDecorationCss([range], "p")).toBe("");
  });

  it("returns empty string for no decorations", () => {
    expect(buildDecorationCss([], "p")).toBe("");
  });

  it("escapes quotes in the attribute value", () => {
    const tricky: Decoration = {
      kind: "inline-attr",
      attr: "data-page-title",
      value: 'a"b',
      style: { color: "red" },
    };
    expect(buildDecorationCss([tricky], "p")).toContain('[data-page-title="a\\"b"]');
  });

  it("renders a block-highlight (bg + left border) scoped to the block", () => {
    const d: Decoration = {
      kind: "block-highlight",
      blockId: "blk1",
      backgroundColor: "rgba(0,0,0,0.05)",
      borderColor: "#ef4444",
      borderWidth: 2,
    };
    const css = buildDecorationCss([d], "p");
    expect(css).toContain(
      '.bn-editor-wrapper[data-page-id="p"] [data-node-type="blockContainer"][data-id="blk1"] > .bn-block-content{',
    );
    expect(css).toContain("background:rgba(0,0,0,0.05)");
    expect(css).toContain("border-left:2px solid #ef4444");
  });

  it("renders a block-badge via ::after with the label", () => {
    const d: Decoration = {
      kind: "block-badge",
      blockId: "blk1",
      label: "Hard · 42w",
      position: "top-right",
    };
    const css = buildDecorationCss([d], "p");
    expect(css).toContain('[data-id="blk1"]{position:relative}');
    expect(css).toContain('::after{content:"Hard · 42w"');
    expect(css).toContain("right:4px;left:auto");
  });
});
