import { describe, it, expect } from "vitest";
import { applyViewToRows, rawCellResolver } from "./viewRows";
import type {
  CellValue,
  DatabaseRow,
  PropertyDef,
} from "../../types/database";

const properties: PropertyDef[] = [
  { id: "title", name: "Title", type: "text" },
  { id: "score", name: "Score", type: "number" },
  { id: "done", name: "Done", type: "checkbox" },
  { id: "calc", name: "Calc", type: "formula" },
] as PropertyDef[];

function row(
  id: string,
  cells: Record<string, CellValue>,
): DatabaseRow {
  return {
    id,
    cells,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const rows = [
  row("a", { title: "Banana", score: 5, done: false }),
  row("b", { title: "Apple", score: 9, done: true }),
  row("c", { title: "Cherry", score: 1, done: true }),
  row("d", { title: "apricot", score: 5 }),
];

describe("applyViewToRows", () => {
  it("returns rows unchanged with no filters or sorts", () => {
    const out = applyViewToRows(rows, { sorts: [], filters: [] }, properties);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not mutate the input array", () => {
    const input = [...rows];
    applyViewToRows(
      input,
      { sorts: [{ propertyId: "title", direction: "asc" }], filters: [] },
      properties,
    );
    expect(input.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("applies filters", () => {
    const out = applyViewToRows(
      rows,
      {
        sorts: [],
        filters: [{ propertyId: "done", operator: "equals", value: true }],
      },
      properties,
    );
    expect(out.map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("skips filters on missing properties", () => {
    const out = applyViewToRows(
      rows,
      {
        sorts: [],
        filters: [{ propertyId: "ghost", operator: "equals", value: "x" }],
      },
      properties,
    );
    expect(out).toHaveLength(4);
  });

  it("sorts ascending and descending", () => {
    const asc = applyViewToRows(
      rows,
      { sorts: [{ propertyId: "score", direction: "asc" }], filters: [] },
      properties,
    );
    expect(asc.map((r) => r.id)).toEqual(["c", "a", "d", "b"]);

    const desc = applyViewToRows(
      rows,
      { sorts: [{ propertyId: "score", direction: "desc" }], filters: [] },
      properties,
    );
    expect(desc.map((r) => r.id)).toEqual(["b", "a", "d", "c"]);
  });

  it("tie-breaks with subsequent sorts", () => {
    const out = applyViewToRows(
      rows,
      {
        sorts: [
          { propertyId: "score", direction: "asc" },
          { propertyId: "title", direction: "asc" },
        ],
        filters: [],
      },
      properties,
    );
    // score 5 tie between "Banana"(a) and "apricot"(d): localeCompare is
    // case-insensitive-ish, apricot < Banana.
    expect(out.map((r) => r.id)).toEqual(["c", "d", "a", "b"]);
  });

  it("filters and sorts through a computed-column resolver", () => {
    const computed = new Map<string, number>([
      ["a", 10],
      ["b", 2],
      ["c", 30],
      ["d", 4],
    ]);
    const resolve = (r: DatabaseRow, propId: string): CellValue =>
      propId === "calc" ? (computed.get(r.id) ?? null) : rawCellResolver(r, propId);

    const out = applyViewToRows(
      rows,
      {
        sorts: [{ propertyId: "calc", direction: "desc" }],
        filters: [{ propertyId: "calc", operator: "gt", value: 3 }],
      },
      properties,
      resolve,
    );
    expect(out.map((r) => r.id)).toEqual(["c", "a", "d"]);
  });
});
