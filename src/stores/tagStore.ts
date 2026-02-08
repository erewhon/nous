import { create } from "zustand";
import type { Page } from "../types/page";

export interface TagInfo {
  name: string;
  count: number;
  pageIds: string[];
  depth: number;
  parentTag: string | null;
  childTags: string[];
}

interface TagState {
  // Aggregated tag info (computed from pages)
  tags: Map<string, TagInfo>;

  // Filter state
  selectedTags: string[];

  // Actions
  buildTagsFromPages: (pages: Page[]) => void;
  getTagsByFrequency: () => TagInfo[];
  getTagTree: () => TagInfo[];
  toggleTagFilter: (tag: string) => void;
  setSelectedTags: (tags: string[]) => void;
  clearTagFilter: () => void;

  // For filtering pages
  filterPagesByTags: (pages: Page[]) => Page[];
}

export const useTagStore = create<TagState>((set, get) => ({
  tags: new Map(),
  selectedTags: [],

  buildTagsFromPages: (pages) => {
    const tagMap = new Map<string, TagInfo>();

    for (const page of pages) {
      for (const tag of page.tags) {
        const normalizedTag = tag.toLowerCase().trim();
        const displayTag = tag.trim();

        if (!normalizedTag) continue;

        const existing = tagMap.get(normalizedTag);
        if (existing) {
          existing.count++;
          existing.pageIds.push(page.id);
        } else {
          tagMap.set(normalizedTag, {
            name: displayTag,
            count: 1,
            pageIds: [page.id],
            depth: 0,
            parentTag: null,
            childTags: [],
          });
        }
      }
    }

    // Second pass: compute hierarchy
    for (const [key, tag] of tagMap) {
      const parts = key.split("/");
      tag.depth = parts.length - 1;
      if (parts.length > 1) {
        tag.parentTag = parts.slice(0, -1).join("/");
      }
    }

    // Create implicit parents and wire up childTags
    const allKeys = Array.from(tagMap.keys());
    for (const key of allKeys) {
      const parts = key.split("/");
      // Create any missing ancestor tags
      for (let i = 1; i < parts.length; i++) {
        const ancestorKey = parts.slice(0, i).join("/");
        if (!tagMap.has(ancestorKey)) {
          tagMap.set(ancestorKey, {
            name: ancestorKey,
            count: 0,
            pageIds: [],
            depth: i - 1,
            parentTag: i > 1 ? parts.slice(0, i - 1).join("/") : null,
            childTags: [],
          });
        }
      }
    }

    // Wire up childTags
    for (const [key, tag] of tagMap) {
      if (tag.parentTag && tagMap.has(tag.parentTag)) {
        const parent = tagMap.get(tag.parentTag)!;
        if (!parent.childTags.includes(key)) {
          parent.childTags.push(key);
        }
      }
    }

    set({ tags: tagMap });
  },

  getTagsByFrequency: () => {
    const { tags } = get();
    return Array.from(tags.values()).sort((a, b) => b.count - a.count);
  },

  getTagTree: () => {
    const { tags } = get();
    return Array.from(tags.values())
      .filter((t) => t.depth === 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  toggleTagFilter: (tag) => {
    const { selectedTags } = get();
    const normalizedTag = tag.toLowerCase().trim();

    if (selectedTags.includes(normalizedTag)) {
      set({ selectedTags: selectedTags.filter((t) => t !== normalizedTag) });
    } else {
      set({ selectedTags: [...selectedTags, normalizedTag] });
    }
  },

  setSelectedTags: (tags) => {
    set({ selectedTags: tags.map((t) => t.toLowerCase().trim()) });
  },

  clearTagFilter: () => {
    set({ selectedTags: [] });
  },

  filterPagesByTags: (pages) => {
    const { selectedTags } = get();

    if (selectedTags.length === 0) {
      return pages;
    }

    return pages.filter((page) => {
      const pageTags = page.tags.map((t) => t.toLowerCase().trim());
      // Page must have ALL selected tags (with prefix matching for hierarchy)
      return selectedTags.every((tag) =>
        pageTags.some((pt) => pt === tag || pt.startsWith(tag + "/"))
      );
    });
  },
}));
