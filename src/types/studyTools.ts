import { z } from "zod";

// ===== Study Guide Types =====

export const KeyConceptSchema = z.object({
  term: z.string(),
  definition: z.string(),
});
export type KeyConcept = z.infer<typeof KeyConceptSchema>;

export const StudyGuideSectionSchema = z.object({
  heading: z.string(),
  content: z.string(),
  keyPoints: z.array(z.string()).default([]),
});
export type StudyGuideSection = z.infer<typeof StudyGuideSectionSchema>;

export const PracticeQuestionSchema = z.object({
  question: z.string(),
  answer: z.string(),
});
export type PracticeQuestion = z.infer<typeof PracticeQuestionSchema>;

export const StudyGuideSchema = z.object({
  title: z.string(),
  learningObjectives: z.array(z.string()).default([]),
  keyConcepts: z.array(KeyConceptSchema).default([]),
  sections: z.array(StudyGuideSectionSchema).default([]),
  practiceQuestions: z.array(PracticeQuestionSchema).default([]),
  summary: z.string().default(""),
});
export type StudyGuide = z.infer<typeof StudyGuideSchema>;

export const StudyGuideDepthSchema = z.enum(["brief", "standard", "comprehensive"]);
export type StudyGuideDepth = z.infer<typeof StudyGuideDepthSchema>;

export const StudyGuideOptionsSchema = z.object({
  depth: StudyGuideDepthSchema.default("standard"),
  focusAreas: z.array(z.string()).default([]),
  numPracticeQuestions: z.number().min(1).max(20).default(5),
});
export type StudyGuideOptions = z.infer<typeof StudyGuideOptionsSchema>;

// ===== FAQ Types =====

export const FAQItemSchema = z.object({
  question: z.string(),
  answer: z.string(),
  sourcePageId: z.string().nullable().optional(),
});
export type FAQItem = z.infer<typeof FAQItemSchema>;

export const FAQSchema = z.object({
  questions: z.array(FAQItemSchema).default([]),
});
export type FAQ = z.infer<typeof FAQSchema>;

// ===== Flashcard Generation Types =====

export const FlashcardCardTypeSchema = z.enum(["basic", "cloze", "reversible"]);
export type FlashcardCardType = z.infer<typeof FlashcardCardTypeSchema>;

export const GeneratedFlashcardSchema = z.object({
  front: z.string(),
  back: z.string(),
  cardType: FlashcardCardTypeSchema.default("basic"),
  tags: z.array(z.string()).default([]),
});
export type GeneratedFlashcard = z.infer<typeof GeneratedFlashcardSchema>;

export const FlashcardGenerationResultSchema = z.object({
  cards: z.array(GeneratedFlashcardSchema).default([]),
  sourcePageIds: z.array(z.string()).default([]),
});
export type FlashcardGenerationResult = z.infer<typeof FlashcardGenerationResultSchema>;

// ===== Briefing Document Types =====

export const PrioritySchema = z.enum(["low", "medium", "high"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const ActionItemSchema = z.object({
  description: z.string(),
  owner: z.string().nullable().optional(),
  deadline: z.string().nullable().optional(),
  priority: PrioritySchema.nullable().optional(),
});
export type ActionItem = z.infer<typeof ActionItemSchema>;

export const BriefingDocumentSchema = z.object({
  title: z.string(),
  executiveSummary: z.string(),
  keyFindings: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
  actionItems: z.array(ActionItemSchema).default([]),
  detailedSections: z.array(StudyGuideSectionSchema).default([]),
});
export type BriefingDocument = z.infer<typeof BriefingDocumentSchema>;

// ===== Timeline Types =====

export const TimelineEventSchema = z.object({
  id: z.string(),
  date: z.string(), // ISO date string
  title: z.string(),
  description: z.string(),
  sourcePageId: z.string(),
  category: z.string().nullable().optional(),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const TimelineSchema = z.object({
  events: z.array(TimelineEventSchema).default([]),
  dateRangeStart: z.string().nullable().optional(),
  dateRangeEnd: z.string().nullable().optional(),
});
export type Timeline = z.infer<typeof TimelineSchema>;

// ===== Concept Map Types =====

export const ConceptNodeTypeSchema = z.enum(["concept", "example", "definition"]);
export type ConceptNodeType = z.infer<typeof ConceptNodeTypeSchema>;

export const ConceptNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  nodeType: ConceptNodeTypeSchema.default("concept"),
  description: z.string().nullable().optional(),
});
export type ConceptNode = z.infer<typeof ConceptNodeSchema>;

export const ConceptLinkSchema = z.object({
  source: z.string(),
  target: z.string(),
  relationship: z.string(),
});
export type ConceptLink = z.infer<typeof ConceptLinkSchema>;

export const ConceptGraphSchema = z.object({
  nodes: z.array(ConceptNodeSchema).default([]),
  links: z.array(ConceptLinkSchema).default([]),
});
export type ConceptGraph = z.infer<typeof ConceptGraphSchema>;

// ===== Input Types =====

export const StudyPageContentSchema = z.object({
  pageId: z.string(),
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()).default([]),
});
export type StudyPageContent = z.infer<typeof StudyPageContentSchema>;

// ===== RAG/Citation Types =====

export const RAGChunkSchema = z.object({
  chunkId: z.string(),
  pageId: z.string(),
  notebookId: z.string(),
  title: z.string(),
  content: z.string(),
  score: z.number(),
});
export type RAGChunk = z.infer<typeof RAGChunkSchema>;

export const CitationSchema = z.object({
  id: z.number(),
  pageId: z.string(),
  pageTitle: z.string(),
  excerpt: z.string(),
  relevanceScore: z.number(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const CitedResponseSchema = z.object({
  content: z.string(),
  citations: z.array(CitationSchema).default([]),
});
export type CitedResponse = z.infer<typeof CitedResponseSchema>;

// ===== Generation Options =====

export interface StudyToolsGenerationOptions {
  providerType?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// ===== Panel State Types =====

export type StudyToolType =
  | "study-guide"
  | "faq"
  | "flashcards"
  | "briefing"
  | "timeline"
  | "concept-map";

export interface StudyToolsState {
  isOpen: boolean;
  activeTool: StudyToolType | null;
  selectedPageIds: string[];
  isGenerating: boolean;
  error: string | null;
  // Generated content
  studyGuide: StudyGuide | null;
  faq: FAQ | null;
  flashcards: FlashcardGenerationResult | null;
  briefing: BriefingDocument | null;
  timeline: Timeline | null;
  conceptGraph: ConceptGraph | null;
}
