import { create } from "zustand";
import { WikiLinkTool } from "../components/Editor/WikiLinkTool";
import { BlockRefTool } from "../components/Editor/BlockRefTool";
import type { Page } from "../types/page";

interface LinkInfo {
  sourcePageId: string;
  sourcePageTitle: string;
  targetTitle: string;
}

export interface BlockRefInfo {
  sourcePageId: string;
  sourcePageTitle: string;
  targetPageId: string;
  targetBlockId: string;
}

interface LinkState {
  // Map of page ID -> outgoing links (page titles)
  outgoingLinks: Map<string, string[]>;
  // Map of page title -> pages that link to it
  backlinks: Map<string, LinkInfo[]>;
  // Map of target block ID -> block refs pointing to it
  blockRefBacklinks: Map<string, BlockRefInfo[]>;
}

interface LinkActions {
  // Update links for a page based on its content
  updatePageLinks: (page: Page) => void;

  // Get backlinks for a page
  getBacklinks: (pageTitle: string) => LinkInfo[];

  // Get block-level backlinks for a specific block
  getBlockBacklinks: (blockId: string) => BlockRefInfo[];

  // Clear all links
  clearLinks: () => void;

  // Build links from all pages
  buildLinksFromPages: (pages: Page[]) => void;
}

type LinkStore = LinkState & LinkActions;

export const useLinkStore = create<LinkStore>((set, get) => ({
  outgoingLinks: new Map(),
  backlinks: new Map(),
  blockRefBacklinks: new Map(),

  updatePageLinks: (page) => {
    // Skip pages without content or blocks
    if (!page.content?.blocks) {
      return;
    }

    const blocksForExtraction = page.content.blocks.map((b) => ({
      type: b.type,
      data: b.data,
    }));

    const links = WikiLinkTool.extractLinks(blocksForExtraction);
    const blockRefs = BlockRefTool.extractBlockRefs(blocksForExtraction);

    set((state) => {
      const newOutgoingLinks = new Map(state.outgoingLinks);
      const newBacklinks = new Map(state.backlinks);
      const newBlockRefBacklinks = new Map(state.blockRefBacklinks);

      // Remove old backlinks from this page
      const oldLinks = state.outgoingLinks.get(page.id) || [];
      for (const oldLink of oldLinks) {
        const existingBacklinks = newBacklinks.get(oldLink) || [];
        newBacklinks.set(
          oldLink,
          existingBacklinks.filter((bl) => bl.sourcePageId !== page.id)
        );
      }

      // Remove old block ref backlinks from this page
      for (const [blockId, refs] of newBlockRefBacklinks) {
        const filtered = refs.filter((r) => r.sourcePageId !== page.id);
        if (filtered.length > 0) {
          newBlockRefBacklinks.set(blockId, filtered);
        } else {
          newBlockRefBacklinks.delete(blockId);
        }
      }

      // Add new outgoing links
      newOutgoingLinks.set(page.id, links);

      // Add new backlinks
      for (const targetTitle of links) {
        const existingBacklinks = newBacklinks.get(targetTitle) || [];
        // Avoid duplicates
        if (!existingBacklinks.some((bl) => bl.sourcePageId === page.id)) {
          newBacklinks.set(targetTitle, [
            ...existingBacklinks,
            {
              sourcePageId: page.id,
              sourcePageTitle: page.title,
              targetTitle,
            },
          ]);
        }
      }

      // Add new block ref backlinks
      for (const ref of blockRefs) {
        const existing = newBlockRefBacklinks.get(ref.blockId) || [];
        if (!existing.some((r) => r.sourcePageId === page.id)) {
          newBlockRefBacklinks.set(ref.blockId, [
            ...existing,
            {
              sourcePageId: page.id,
              sourcePageTitle: page.title,
              targetPageId: ref.pageId,
              targetBlockId: ref.blockId,
            },
          ]);
        }
      }

      return {
        outgoingLinks: newOutgoingLinks,
        backlinks: newBacklinks,
        blockRefBacklinks: newBlockRefBacklinks,
      };
    });
  },

  getBacklinks: (pageTitle) => {
    const state = get();
    return state.backlinks.get(pageTitle) || [];
  },

  getBlockBacklinks: (blockId) => {
    const state = get();
    return state.blockRefBacklinks.get(blockId) || [];
  },

  clearLinks: () => {
    set({
      outgoingLinks: new Map(),
      backlinks: new Map(),
      blockRefBacklinks: new Map(),
    });
  },

  buildLinksFromPages: (pages) => {
    const outgoingLinks = new Map<string, string[]>();
    const backlinks = new Map<string, LinkInfo[]>();
    const blockRefBacklinks = new Map<string, BlockRefInfo[]>();

    for (const page of pages) {
      // Skip pages without content or blocks
      if (!page.content?.blocks) {
        outgoingLinks.set(page.id, []);
        continue;
      }

      const blocksForExtraction = page.content.blocks.map((b) => ({
        type: b.type,
        data: b.data,
      }));

      const links = WikiLinkTool.extractLinks(blocksForExtraction);
      const blockRefs = BlockRefTool.extractBlockRefs(blocksForExtraction);

      outgoingLinks.set(page.id, links);

      for (const targetTitle of links) {
        const existingBacklinks = backlinks.get(targetTitle) || [];
        backlinks.set(targetTitle, [
          ...existingBacklinks,
          {
            sourcePageId: page.id,
            sourcePageTitle: page.title,
            targetTitle,
          },
        ]);
      }

      for (const ref of blockRefs) {
        const existing = blockRefBacklinks.get(ref.blockId) || [];
        blockRefBacklinks.set(ref.blockId, [
          ...existing,
          {
            sourcePageId: page.id,
            sourcePageTitle: page.title,
            targetPageId: ref.pageId,
            targetBlockId: ref.blockId,
          },
        ]);
      }
    }

    set({ outgoingLinks, backlinks, blockRefBacklinks });
  },
}));
