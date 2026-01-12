import { create } from "zustand";
import { WikiLinkTool } from "../components/Editor/WikiLinkTool";
import type { Page } from "../types/page";

interface LinkInfo {
  sourcePageId: string;
  sourcePageTitle: string;
  targetTitle: string;
}

interface LinkState {
  // Map of page ID -> outgoing links (page titles)
  outgoingLinks: Map<string, string[]>;
  // Map of page title -> pages that link to it
  backlinks: Map<string, LinkInfo[]>;
}

interface LinkActions {
  // Update links for a page based on its content
  updatePageLinks: (page: Page) => void;

  // Get backlinks for a page
  getBacklinks: (pageTitle: string) => LinkInfo[];

  // Clear all links
  clearLinks: () => void;

  // Build links from all pages
  buildLinksFromPages: (pages: Page[]) => void;
}

type LinkStore = LinkState & LinkActions;

export const useLinkStore = create<LinkStore>((set, get) => ({
  outgoingLinks: new Map(),
  backlinks: new Map(),

  updatePageLinks: (page) => {
    // Skip pages without content or blocks
    if (!page.content?.blocks) {
      return;
    }

    const links = WikiLinkTool.extractLinks(
      page.content.blocks.map((b) => ({
        type: b.type,
        data: b.data,
      }))
    );

    set((state) => {
      const newOutgoingLinks = new Map(state.outgoingLinks);
      const newBacklinks = new Map(state.backlinks);

      // Remove old backlinks from this page
      const oldLinks = state.outgoingLinks.get(page.id) || [];
      for (const oldLink of oldLinks) {
        const existingBacklinks = newBacklinks.get(oldLink) || [];
        newBacklinks.set(
          oldLink,
          existingBacklinks.filter((bl) => bl.sourcePageId !== page.id)
        );
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

      return {
        outgoingLinks: newOutgoingLinks,
        backlinks: newBacklinks,
      };
    });
  },

  getBacklinks: (pageTitle) => {
    const state = get();
    return state.backlinks.get(pageTitle) || [];
  },

  clearLinks: () => {
    set({
      outgoingLinks: new Map(),
      backlinks: new Map(),
    });
  },

  buildLinksFromPages: (pages) => {
    const outgoingLinks = new Map<string, string[]>();
    const backlinks = new Map<string, LinkInfo[]>();

    for (const page of pages) {
      // Skip pages without content or blocks
      if (!page.content?.blocks) {
        outgoingLinks.set(page.id, []);
        continue;
      }

      const links = WikiLinkTool.extractLinks(
        page.content.blocks.map((b) => ({
          type: b.type,
          data: b.data,
        }))
      );

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
    }

    set({ outgoingLinks, backlinks });
  },
}));
