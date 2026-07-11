import { describe, it, expect } from "vitest";
import { sortFolders } from "./folderTreeUtils";
import type { Folder } from "../../types/page";

function folder(overrides: Partial<Folder> & { name: string }): Folder {
  return {
    id: crypto.randomUUID(),
    notebookId: "00000000-0000-4000-8000-000000000000",
    parentId: null,
    sectionId: null,
    folderType: "standard",
    isArchived: false,
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("sortFolders", () => {
  it("sorts by name ascending", () => {
    const folders = [
      folder({ name: "Zeta", position: 0 }),
      folder({ name: "alpha", position: 1 }),
      folder({ name: "Mid", position: 2 }),
    ];
    const sorted = sortFolders(folders, "name-asc");
    expect(sorted.map((f) => f.name)).toEqual(["alpha", "Mid", "Zeta"]);
  });

  it("sorts by name descending", () => {
    const folders = [
      folder({ name: "alpha", position: 0 }),
      folder({ name: "Zeta", position: 1 }),
    ];
    const sorted = sortFolders(folders, "name-desc");
    expect(sorted.map((f) => f.name)).toEqual(["Zeta", "alpha"]);
  });

  it("sorts by position for position and unknown options", () => {
    const folders = [
      folder({ name: "B", position: 2 }),
      folder({ name: "A", position: 1 }),
    ];
    expect(sortFolders(folders, "position").map((f) => f.name)).toEqual(["A", "B"]);
  });

  it("sorts by updatedAt descending for updated", () => {
    const folders = [
      folder({ name: "Old", updatedAt: "2026-01-01T00:00:00.000Z" }),
      folder({ name: "New", updatedAt: "2026-06-01T00:00:00.000Z" }),
    ];
    expect(sortFolders(folders, "updated").map((f) => f.name)).toEqual(["New", "Old"]);
  });

  it("sorts by createdAt descending for created", () => {
    const folders = [
      folder({ name: "Old", createdAt: "2026-01-01T00:00:00.000Z" }),
      folder({ name: "New", createdAt: "2026-06-01T00:00:00.000Z" }),
    ];
    expect(sortFolders(folders, "created").map((f) => f.name)).toEqual(["New", "Old"]);
  });

  it("keeps the archive folder last regardless of sort", () => {
    const folders = [
      folder({ name: "Archive", folderType: "archive", position: 0 }),
      folder({ name: "Zeta", position: 1 }),
      folder({ name: "alpha", position: 2 }),
    ];
    const sorted = sortFolders(folders, "name-asc");
    expect(sorted.map((f) => f.name)).toEqual(["alpha", "Zeta", "Archive"]);
  });

  it("does not mutate the input array", () => {
    const folders = [folder({ name: "B" }), folder({ name: "A" })];
    const copy = [...folders];
    sortFolders(folders, "name-asc");
    expect(folders).toEqual(copy);
  });
});
