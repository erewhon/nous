import { describe, it, expect, vi } from "vitest";

// localStorage polyfill for the node test env (runs before hoisted imports).
vi.hoisted(() => {
  const mem = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

import { editorJsToBlockNote, blockNoteToEditorJs } from "./blockFormatConverter";
import { registerCustomBlock } from "../plugin-sdk/custom-block";
import type { EditorData } from "../types/page";

registerCustomBlock({
  id: "testDiagram",
  title: "Test Diagram",
  propSchema: { code: { default: "" }, variant: { default: "plain" } },
  Render: () => null,
});

function doc(blocks: EditorData["blocks"]): EditorData {
  return { time: 1, version: "2.28.0", blocks };
}

describe("contributed block conversion", () => {
  it("maps a contributed type to its block spec props", () => {
    const bn = editorJsToBlockNote(
      doc([{ id: "b1", type: "testDiagram", data: { code: "A->B" } }]),
    );
    expect(bn).toEqual([
      {
        id: "b1",
        type: "testDiagram",
        props: { code: "A->B", variant: "plain" },
      },
    ]);
  });

  it("round-trips a contributed block through save", () => {
    const original = doc([
      {
        id: "b1",
        type: "testDiagram",
        data: { code: "graph TD", variant: "fancy" },
      },
    ]);
    const back = blockNoteToEditorJs(editorJsToBlockNote(original));
    expect(back.blocks).toEqual([
      {
        id: "b1",
        type: "testDiagram",
        data: { code: "graph TD", variant: "fancy" },
      },
    ]);
  });

  it("drops non-string prop values back to declared defaults", () => {
    const bn = editorJsToBlockNote(
      doc([{ id: "b1", type: "testDiagram", data: { code: 42 } }]),
    );
    expect(bn[0]!.props).toEqual({ code: "", variant: "plain" });
  });
});

describe("unknown block preservation", () => {
  it("converts an unknown type to unknownBlock with data preserved", () => {
    const bn = editorJsToBlockNote(
      doc([
        {
          id: "b1",
          type: "bogusWidget",
          data: { nested: { a: [1, 2], b: "x" }, flag: true },
        },
      ]),
    );
    expect(bn).toEqual([
      {
        id: "b1",
        type: "unknownBlock",
        props: {
          originalType: "bogusWidget",
          dataJson: JSON.stringify({ nested: { a: [1, 2], b: "x" }, flag: true }),
        },
      },
    ]);
  });

  it("round-trips an unknown block byte-identically", () => {
    const original = doc([
      {
        id: "b1",
        type: "bogusWidget",
        data: { nested: { a: [1, 2], b: "x" }, flag: true, n: null },
      },
    ]);
    const back = blockNoteToEditorJs(editorJsToBlockNote(original));
    expect(JSON.stringify(back.blocks)).toBe(JSON.stringify(original.blocks));
  });

  it("survives corrupted dataJson without throwing", () => {
    const back = blockNoteToEditorJs([
      {
        id: "b1",
        type: "unknownBlock",
        props: { originalType: "bogusWidget", dataJson: "{not json" },
      },
    ]);
    expect(back.blocks).toEqual([
      { id: "b1", type: "bogusWidget", data: {} },
    ]);
  });

  it("does not emit the old lossy unsupported-block paragraph", () => {
    const bn = editorJsToBlockNote(
      doc([{ id: "b1", type: "bogusWidget", data: {} }]),
    );
    expect(JSON.stringify(bn)).not.toContain("Unsupported block");
  });
});
