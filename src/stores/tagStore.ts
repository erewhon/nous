import { create } from "zustand";
import type { Page } from "../types/page";

export interface TagInfo {
  name: string;
  count: number;
  pageIds: string[];
}

interface TagState {
  // Aggregated tag info (computed from pages)
  tags: Map<string, TagInfo>;

  // Filter state
  selectedTags: string[];

  // Actions
  buildTagsFromPages: (pages: Page[]) => void;
  getTagsByFrequency: () => TagInfo[];
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
          });
        }
      }
    }

    set({ tags: tagMap });
  },

  getTagsByFrequency: () => {
    const { tags } = get();
    return Array.from(tags.values()).sort((a, b) => b.count - a.count);
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
      // Page must have ALL selected tags
      return selectedTags.every((tag) => pageTags.includes(tag));
    });
  },
}));
