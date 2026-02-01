import { z } from "zod";

// ===== Zod Schemas =====

// Search result from Tavily
export const SearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string(),
  score: z.number(),
  publishedDate: z.string().nullable().optional(),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

// Search response from Tavily
export const SearchResponseSchema = z.object({
  query: z.string(),
  results: z.array(SearchResultSchema),
  answer: z.string().nullable().optional(),
  followUpQuestions: z.array(z.string()).optional(),
});

export type SearchResponse = z.infer<typeof SearchResponseSchema>;

// Scraped content from URL
export const ScrapedContentSchema = z.object({
  url: z.string(),
  title: z.string(),
  content: z.string(),
  author: z.string().nullable().optional(),
  publishedDate: z.string().nullable().optional(),
  wordCount: z.number(),
});

export type ScrapedContent = z.infer<typeof ScrapedContentSchema>;

// Source reference in summary
export const SourceRefSchema = z.object({
  title: z.string(),
  url: z.string(),
});

export type SourceRef = z.infer<typeof SourceRefSchema>;

// Research summary from AI
export const ResearchSummarySchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  sources: z.array(SourceRefSchema),
  suggestedTags: z.array(z.string()),
});

export type ResearchSummary = z.infer<typeof ResearchSummarySchema>;

// Browser automation task result
export const BrowserTaskResultSchema = z.object({
  success: z.boolean(),
  content: z.string(),
  screenshot: z.string().nullable().optional(),
  structuredData: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
});

export type BrowserTaskResult = z.infer<typeof BrowserTaskResultSchema>;

// ===== State Types =====

// Research session state
export interface ResearchSession {
  id: string;
  query: string;
  searchResults: SearchResult[];
  tavilyAnswer: string | null;
  selectedUrls: string[];
  scrapedContent: Record<string, ScrapedContent>;
  summary: ResearchSummary | null;
  createdAt: string;
}

// Web research settings
export interface WebResearchSettings {
  tavilyApiKey: string;
  maxResults: number;
  searchDepth: "basic" | "advanced";
  includeAnswer: boolean;
}
