import { create } from "zustand";
import { persist } from "zustand/middleware";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { aiChatStream } from "../utils/api";
import { usePageStore } from "./pageStore";
import type { StreamEvent } from "../types/ai";

export interface SmartCollection {
  id: string;
  name: string;
  description: string;
  pageIds: string[];
  notebookId: string;
  generatedAt: string;
}

interface CollectionState {
  collections: SmartCollection[];
  isGenerating: boolean;
  error: string | null;
  generateCollections: (notebookId: string) => Promise<void>;
  removeCollection: (id: string) => void;
  clearCollections: (notebookId: string) => void;
}

export const useCollectionStore = create<CollectionState>()(
  persist(
    (set, get) => ({
      collections: [],
      isGenerating: false,
      error: null,

      generateCollections: async (notebookId: string) => {
        set({ isGenerating: true, error: null });

        const pages = usePageStore.getState().pages.filter(
          (p) => p.notebookId === notebookId && !p.deletedAt && !p.isArchived
        );

        if (pages.length === 0) {
          set({ isGenerating: false, error: "No pages in this notebook" });
          return;
        }

        // Build page summaries for the AI
        const pageSummaries = pages.map((p) => {
          const textBlocks = p.content.blocks
            .slice(0, 5)
            .map((b) => (typeof b.data.text === "string" ? b.data.text : ""))
            .filter(Boolean)
            .join(" ");
          const preview = textBlocks.replace(/<[^>]*>/g, "").slice(0, 200);
          return `- [${p.id}] "${p.title}" — ${preview || "(no content)"}`;
        });

        const prompt = `Analyze these notebook pages and group them into 3-7 topic-based collections. Each collection should contain related pages.

Pages:
${pageSummaries.join("\n")}

Respond with ONLY a JSON array (no markdown, no explanation). Each element:
{"name": "Collection Name", "description": "Brief description", "pageIds": ["id1", "id2"]}

Rules:
- Every page should appear in at least one collection
- Collection names should be concise (2-4 words)
- Descriptions should be one sentence
- Only use page IDs from the list above`;

        let accumulated = "";
        let unlisten: UnlistenFn | null = null;

        try {
          unlisten = await listen<StreamEvent>("ai-stream", (event) => {
            const data = event.payload;
            if (data.type === "chunk") {
              accumulated += data.content;
            } else if (data.type === "done") {
              // Parse the accumulated JSON
              try {
                // Extract JSON array from response (handle markdown code fences)
                let jsonStr = accumulated.trim();
                const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                  jsonStr = jsonMatch[0];
                }

                const parsed = JSON.parse(jsonStr) as Array<{
                  name: string;
                  description: string;
                  pageIds: string[];
                }>;

                const validPageIds = new Set(pages.map((p) => p.id));
                const now = new Date().toISOString();

                const newCollections: SmartCollection[] = parsed.map((c) => ({
                  id: crypto.randomUUID(),
                  name: c.name,
                  description: c.description,
                  pageIds: c.pageIds.filter((id) => validPageIds.has(id)),
                  notebookId,
                  generatedAt: now,
                }));

                // Replace collections for this notebook
                const existing = get().collections.filter(
                  (c) => c.notebookId !== notebookId
                );
                set({
                  collections: [...existing, ...newCollections],
                  isGenerating: false,
                });
              } catch {
                set({
                  isGenerating: false,
                  error: "Failed to parse AI response",
                });
              }
            } else if (data.type === "error") {
              set({ isGenerating: false, error: data.message });
            }
          });

          await aiChatStream(prompt, {
            systemPrompt:
              "You are a note organization assistant. You analyze page titles and content to create meaningful topic-based collections. Always respond with valid JSON only.",
            temperature: 0.3,
            maxTokens: 2000,
          });
        } catch (err) {
          set({
            isGenerating: false,
            error: err instanceof Error ? err.message : "Generation failed",
          });
        } finally {
          unlisten?.();
        }
      },

      removeCollection: (id: string) => {
        set({
          collections: get().collections.filter((c) => c.id !== id),
        });
      },

      clearCollections: (notebookId: string) => {
        set({
          collections: get().collections.filter(
            (c) => c.notebookId !== notebookId
          ),
        });
      },
    }),
    {
      name: "katt-smart-collections",
      partialize: (state) => ({
        collections: state.collections,
      }),
    }
  )
);
