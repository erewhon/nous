import type { Folder } from "../../types/page";
import type { PageSortOption } from "../../stores/themeStore";

// Sort sibling folders with the same option used for pages, so the tree
// orders consistently. The archive folder always sorts last regardless.
export function sortFolders(folders: Folder[], sortBy: PageSortOption): Folder[] {
  return [...folders].sort((a, b) => {
    if (a.folderType === "archive") return 1;
    if (b.folderType === "archive") return -1;
    switch (sortBy) {
      case "name-asc":
        return a.name.localeCompare(b.name);
      case "name-desc":
        return b.name.localeCompare(a.name);
      case "updated":
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      case "created":
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case "position":
      default:
        return a.position - b.position;
    }
  });
}
