import { describe, it, expect } from "vitest";

import { wikiLinkProcessor } from "./wikiLinkProcessor";
import type { InlineRef, ProcessorContext, ProcessorResult } from "../document-processor";

/** wikiLinkProcessor.process is synchronous; narrow the declared union. */
function run(ctx: ProcessorContext): ProcessorResult {
  return wikiLinkProcessor.process(ctx) as ProcessorResult;
}

// ─── Test helpers ───────────────────────────────────────────────────────────

/** A wikiLink inline content item. */
function wl(pageTitle: string, pageId = ""): InlineRef {
  return { blockId: "b1", type: "wikiLink", text: pageTitle, props: { pageTitle, pageId } };
}

/** A plain text inline item. */
function text(s: string): InlineRef {
  return { blockId: "b1", type: "text", text: s };
}

function makeCtx(opts: {
  inlines: InlineRef[];
  existingTitles?: string[];
  createPage?: (title: string) => void;
}): ProcessorContext {
  // Mirror the real resolver: case-insensitive, trimmed.
  const existing = new Set((opts.existingTitles ?? []).map((t) => t.trim().toLowerCase()));
  return {
    blocks: [],
    inlines: opts.inlines,
    text: opts.inlines.map((i) => i.text).join(" "),
    resolvePageByTitle: (title) =>
      existing.has(title.trim().toLowerCase()) ? { id: `id:${title}`, title } : null,
    createPage: opts.createPage,
    signal: new AbortController().signal,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("wikiLinkProcessor", () => {
  it("marks a link whose title has no page as broken", () => {
    const ctx = makeCtx({ inlines: [wl("Ghost")], existingTitles: [] });
    const result = run(ctx);

    expect(result.decorations).toHaveLength(1);
    const deco = result.decorations![0];
    expect(deco).toMatchObject({
      kind: "inline-attr",
      attr: "data-page-title",
      value: "Ghost",
    });
    expect(deco.kind === "inline-attr" && deco.style["text-decoration"]).toBe("line-through");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics![0].message).toContain("Ghost");
    expect(result.diagnostics![0].source).toBe("nous.wiki-link");
  });

  it("does not mark a link whose title resolves to a page", () => {
    const ctx = makeCtx({ inlines: [wl("Real Page")], existingTitles: ["Real Page"] });
    const result = run(ctx);

    expect(result.decorations ?? []).toHaveLength(0);
    expect(result.diagnostics ?? []).toHaveLength(0);
  });

  it("resolves case-insensitively via the context resolver", () => {
    const ctx = makeCtx({ inlines: [wl("foo")], existingTitles: ["Foo"] });
    const result = run(ctx);
    expect(result.decorations ?? []).toHaveLength(0);
  });

  it("dedupes by title — repeated broken link yields one decoration/diagnostic", () => {
    const ctx = makeCtx({ inlines: [wl("Ghost"), wl("Ghost"), wl("Ghost")] });
    const result = run(ctx);
    expect(result.decorations).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("decorates only the broken titles in a mixed document", () => {
    const ctx = makeCtx({
      inlines: [wl("Alive"), text("just words"), wl("Ghost"), wl("Alive")],
      existingTitles: ["Alive"],
    });
    const result = run(ctx);
    expect(result.decorations).toHaveLength(1);
    expect(result.decorations![0].kind === "inline-attr" && result.decorations![0].value).toBe(
      "Ghost",
    );
  });

  it("ignores empty / whitespace-only titles", () => {
    const ctx = makeCtx({ inlines: [wl(""), wl("   ")] });
    const result = run(ctx);
    expect(result.decorations ?? []).toHaveLength(0);
  });

  it("ignores non-wikiLink inline content", () => {
    const ctx = makeCtx({ inlines: [text("[[not a link]]"), { blockId: "b", type: "blockRef", text: "x" }] });
    const result = run(ctx);
    expect(result.decorations ?? []).toHaveLength(0);
  });

  it("emits a Create page action only when the capability is provided", () => {
    const withoutCap = run(makeCtx({ inlines: [wl("Ghost")] }));
    expect(withoutCap.actions ?? []).toHaveLength(0);

    const created: string[] = [];
    const withCap = run(
      makeCtx({ inlines: [wl("Ghost")], createPage: (t) => created.push(t) }),
    );
    expect(withCap.actions).toHaveLength(1);
    expect(withCap.actions![0].title).toBe('Create page "Ghost"');

    withCap.actions![0].run();
    expect(created).toEqual(["Ghost"]);
  });
});
