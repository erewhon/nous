// @vitest-environment jsdom
/**
 * Regression: opening the Joplin-imported "Welcome to Joplin!" page crashed
 * the whole app with an uncaught `Error: Block type does not match` from
 * BlockNote's getBlockFromPos during initial node-view creation
 * (order/combination-dependent on a 42-block mixed document).
 *
 * The fixture is a verbatim copy of that page's Editor.js content. The test
 * mounts the real app schema through BlockNoteView — the same path
 * BlockNoteEditor.tsx uses — and must render without throwing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { schema } from "../schema";
import { editorJsToBlockNote } from "../../../utils/blockFormatConverter";
import type { EditorData } from "../../../types/page";
import joplinWelcome from "./fixtures/joplin-welcome.json";

// jsdom lacks a few globals BlockNote/ProseMirror touch during construction
// (same set the vim harness installs).
const g = globalThis as Record<string, unknown>;
if (typeof g.ResizeObserver === "undefined") {
  g.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof window.matchMedia === "undefined") {
  // @ts-expect-error minimal stub
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

function Harness({ data }: { data: EditorData }) {
  const editor = useCreateBlockNote({
    schema,
    initialContent: editorJsToBlockNote(data) as never,
  });
  return <BlockNoteView editor={editor} />;
}

afterEach(cleanup);

describe("Joplin-imported page", () => {
  it("converts with unique block ids", () => {
    const blocks = editorJsToBlockNote(joplinWelcome as EditorData);
    const ids: string[] = [];
    const walk = (bs: Array<{ id?: string; children?: unknown }>) => {
      for (const b of bs) {
        if (b.id) ids.push(b.id);
        if (Array.isArray(b.children)) walk(b.children as never);
      }
    };
    walk(blocks as never);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  it("mounts in the real editor schema without crashing", () => {
    expect(() =>
      render(<Harness data={joplinWelcome as EditorData} />)
    ).not.toThrow();
  });
});

describe("duplicate-block-id page (historic importer damage)", () => {
  // Minimal model of the real damaged pages: historic importers stamped one
  // millisecond-timestamp id on EVERY block of a page (verified on
  // "Welcome to Joplin!" in the Joplin Import 2025-01-17 notebook — 26 blocks
  // sharing id 19bce9bcef1 across heading/paragraph/image/delimiter types).
  // BlockNote resolves blocks by id, so the image/delimiter node views find
  // the first same-id block, see the wrong type, and throw
  // "Block type does not match" — killing the whole editor pane.
  const damaged: EditorData = {
    time: 0,
    version: "2.28.0",
    blocks: [
      { id: "19bce9bcef1", type: "header", data: { level: 1, text: "Title" } },
      { id: "19bce9bcef1", type: "paragraph", data: { text: "Some text" } },
      {
        id: "19bce9bcef1",
        type: "image",
        data: { caption: "", file: { url: "asset://nb/img.png" } },
      },
      {
        id: "19bce9bcef1",
        type: "list",
        data: { items: [{ content: "one", items: [] }], style: "unordered" },
      },
      {
        id: "19bce9bcef1",
        type: "list",
        data: { items: [{ content: "two", items: [] }], style: "ordered" },
      },
      { id: "19bce9bcef1", type: "delimiter", data: {} },
    ],
  };

  it("converts with unique block ids (duplicates healed, first keeps its id)", () => {
    const blocks = editorJsToBlockNote(damaged);
    const ids = blocks.map((b) => b.id as string);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("19bce9bcef1"); // first occurrence is stable
  });

  it("mounts in the real editor schema without crashing", () => {
    expect(() => render(<Harness data={damaged} />)).not.toThrow();
  });
});
