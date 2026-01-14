import { z } from "zod";

// Card type enum
export const CardTypeSchema = z.enum(["basic", "cloze", "reversible"]);
export type CardType = z.infer<typeof CardTypeSchema>;

// Card source - standalone or linked to editor block
export const CardSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("standalone") }),
  z.object({
    type: z.literal("blockRef"),
    pageId: z.string().uuid(),
    blockId: z.string(),
  }),
]);
export type CardSource = z.infer<typeof CardSourceSchema>;

// Card status in the spaced repetition system
export const CardStatusSchema = z.enum(["new", "learning", "review", "relearning"]);
export type CardStatus = z.infer<typeof CardStatusSchema>;

// Deck - container for flashcards, belongs to a notebook
export const DeckSchema = z.object({
  id: z.string().uuid(),
  notebookId: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  color: z.string().optional(),
  cardCount: z.number().default(0),
  newCardsPerDay: z.number().default(20),
  reviewsPerDay: z.number().default(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Deck = z.infer<typeof DeckSchema>;

// Flashcard - can be standalone or linked to editor block
export const FlashcardSchema = z.object({
  id: z.string().uuid(),
  deckId: z.string().uuid(),
  front: z.string(),
  back: z.string(),
  cardType: CardTypeSchema.default("basic"),
  tags: z.array(z.string()).default([]),
  source: CardSourceSchema.default({ type: "standalone" }),
  position: z.number().default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Flashcard = z.infer<typeof FlashcardSchema>;

// Card state - current spaced repetition state
export const CardStateSchema = z.object({
  cardId: z.string().uuid(),
  interval: z.number().default(0),
  easeFactor: z.number().default(2.5),
  dueDate: z.string().datetime(),
  reviewCount: z.number().default(0),
  correctCount: z.number().default(0),
  status: CardStatusSchema.default("new"),
});
export type CardState = z.infer<typeof CardStateSchema>;

// Review record - tracks each review attempt
export const ReviewRecordSchema = z.object({
  id: z.string().uuid(),
  cardId: z.string().uuid(),
  quality: z.number().min(0).max(5),
  interval: z.number(),
  easeFactor: z.number(),
  reviewedAt: z.string().datetime(),
});
export type ReviewRecord = z.infer<typeof ReviewRecordSchema>;

// Statistics for a deck or all decks
export const ReviewStatsSchema = z.object({
  totalCards: z.number(),
  newCards: z.number(),
  learningCards: z.number(),
  reviewCards: z.number(),
  dueCards: z.number(),
  reviewsToday: z.number(),
  correctToday: z.number(),
  streakDays: z.number(),
});
export type ReviewStats = z.infer<typeof ReviewStatsSchema>;

// Card with its current state - used for review sessions
export const CardWithStateSchema = z.object({
  card: FlashcardSchema,
  state: CardStateSchema,
});
export type CardWithState = z.infer<typeof CardWithStateSchema>;

// Rating options shown to user during review
export type ReviewRating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy

// Interval preview for each rating option
export interface IntervalPreview {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

// Convert rating to interval preview index
export function ratingToPreviewIndex(rating: ReviewRating): number {
  return rating - 1;
}

// Format interval in days to human-readable string
export function formatInterval(days: number): string {
  if (days === 0) return "now";
  if (days === 1) return "1d";
  if (days < 7) return `${days}d`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "1w" : `${weeks}w`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months === 1 ? "1mo" : `${months}mo`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? "1y" : `${years}y`;
}
