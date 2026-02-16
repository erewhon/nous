import { create } from "zustand";
import { persist } from "zustand/middleware";
import { usePageStore } from "./pageStore";
import { aiSummarizePages, type PageSummaryInput } from "../utils/api";
import { localToday, localDateStr } from "../utils/dateLocal";

export interface DailyDigest {
  id: string; // "{notebookId}-{date}"
  date: string; // "YYYY-MM-DD"
  notebookId: string;
  summary: string;
  connections: {
    fromPageTitle: string;
    toPageTitle: string;
    relationship: string;
  }[];
  followUps: string[];
  themes: string[];
  generatedAt: string;
}

interface DigestState {
  digests: DailyDigest[];
  isGenerating: boolean;
  error: string | null;
}

interface DigestActions {
  generateDigest: (notebookId: string, date?: string) => Promise<void>;
  getDigestForDate: (notebookId: string, date: string) => DailyDigest | undefined;
  deleteDigest: (id: string) => void;
  clearError: () => void;
}

type DigestStore = DigestState & DigestActions;

function extractPlainText(content?: { blocks: Array<{ type: string; data: Record<string, unknown> }> }): string {
  if (!content?.blocks) return "";
  return content.blocks
    .map((block) => {
      if (block.type === "paragraph" || block.type === "header") {
        return ((block.data.text as string) || "").replace(/<[^>]*>/g, "");
      }
      if (block.type === "list" && Array.isArray(block.data.items)) {
        return (block.data.items as string[])
          .map((item) => (typeof item === "string" ? item.replace(/<[^>]*>/g, "") : ""))
          .join("\n");
      }
      if (block.type === "code" && typeof block.data.code === "string") {
        return block.data.code;
      }
      if (block.type === "quote" && typeof block.data.text === "string") {
        return block.data.text.replace(/<[^>]*>/g, "");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function getToday(): string {
  return localToday();
}

export const useDigestStore = create<DigestStore>()(
  persist(
    (set, get) => ({
      digests: [],
      isGenerating: false,
      error: null,

      generateDigest: async (notebookId, date) => {
        const targetDate = date || getToday();
        set({ isGenerating: true, error: null });

        try {
          const pages = usePageStore.getState().pages;
          const dayPages = pages.filter((p) => {
            if (p.notebookId !== notebookId) return false;
            if (!p.updatedAt) return false;
            const pageDate = localDateStr(new Date(p.updatedAt));
            return pageDate === targetDate;
          });

          if (dayPages.length === 0) {
            set({
              isGenerating: false,
              error: "No pages were updated on this date",
            });
            return;
          }

          const pageSummaries: PageSummaryInput[] = dayPages.map((p) => ({
            title: p.title,
            content: extractPlainText(p.content),
            tags: p.tags || [],
          }));

          const customPrompt = `Analyze the following pages updated today and return a JSON object with these fields:
- "summary": A 2-3 paragraph overview of what was worked on/learned today
- "connections": An array of objects { "fromPageTitle": string, "toPageTitle": string, "relationship": string } showing how topics connect
- "followUps": An array of strings suggesting things to explore or do next
- "themes": An array of strings identifying recurring themes or topics

Return ONLY the JSON object, no other text.`;

          const result = await aiSummarizePages(pageSummaries, {
            customPrompt,
            summaryStyle: "detailed",
          });

          let digest: DailyDigest;
          const digestId = `${notebookId}-${targetDate}`;

          try {
            const parsed = JSON.parse(result.summary);
            digest = {
              id: digestId,
              date: targetDate,
              notebookId,
              summary: parsed.summary || result.summary,
              connections: Array.isArray(parsed.connections) ? parsed.connections : [],
              followUps: Array.isArray(parsed.followUps) ? parsed.followUps : [],
              themes: Array.isArray(parsed.themes) ? parsed.themes : [],
              generatedAt: new Date().toISOString(),
            };
          } catch {
            // Fallback: use raw summary if JSON parse fails
            digest = {
              id: digestId,
              date: targetDate,
              notebookId,
              summary: result.summary,
              connections: [],
              followUps: [],
              themes: result.themes || [],
              generatedAt: new Date().toISOString(),
            };
          }

          set((state) => ({
            digests: [
              ...state.digests.filter((d) => d.id !== digestId),
              digest,
            ],
            isGenerating: false,
          }));
        } catch (e) {
          set({
            isGenerating: false,
            error: `Failed to generate digest: ${e}`,
          });
        }
      },

      getDigestForDate: (notebookId, date) => {
        const id = `${notebookId}-${date}`;
        return get().digests.find((d) => d.id === id);
      },

      deleteDigest: (id) => {
        set((state) => ({
          digests: state.digests.filter((d) => d.id !== id),
        }));
      },

      clearError: () => {
        set({ error: null });
      },
    }),
    {
      name: "katt-digest-store",
      partialize: (state) => ({ digests: state.digests }),
    }
  )
);
