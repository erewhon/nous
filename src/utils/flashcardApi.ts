import { invoke } from "@tauri-apps/api/core";
import type {
  Deck,
  Flashcard,
  CardState,
  ReviewStats,
  CardWithState,
  CardType,
} from "../types/flashcard";

// ===== Deck API =====

export async function listDecks(notebookId: string): Promise<Deck[]> {
  return invoke<Deck[]>("list_decks", { notebookId });
}

export async function getDeck(notebookId: string, deckId: string): Promise<Deck> {
  return invoke<Deck>("get_deck", { notebookId, deckId });
}

export async function createDeck(
  notebookId: string,
  name: string,
  description?: string,
  color?: string
): Promise<Deck> {
  return invoke<Deck>("create_deck", { notebookId, name, description, color });
}

export async function updateDeck(
  notebookId: string,
  deckId: string,
  updates: {
    name?: string;
    description?: string | null;
    color?: string | null;
    newCardsPerDay?: number;
    reviewsPerDay?: number;
  }
): Promise<Deck> {
  return invoke<Deck>("update_deck", {
    notebookId,
    deckId,
    name: updates.name,
    description: updates.description !== undefined ? updates.description : undefined,
    color: updates.color !== undefined ? updates.color : undefined,
    newCardsPerDay: updates.newCardsPerDay,
    reviewsPerDay: updates.reviewsPerDay,
  });
}

export async function deleteDeck(notebookId: string, deckId: string): Promise<void> {
  return invoke("delete_deck", { notebookId, deckId });
}

// ===== Card API =====

export async function listCards(notebookId: string, deckId: string): Promise<Flashcard[]> {
  return invoke<Flashcard[]>("list_cards", { notebookId, deckId });
}

export async function getCard(notebookId: string, cardId: string): Promise<Flashcard> {
  return invoke<Flashcard>("get_card", { notebookId, cardId });
}

export async function createCard(
  notebookId: string,
  deckId: string,
  front: string,
  back: string,
  cardType?: CardType,
  tags?: string[]
): Promise<Flashcard> {
  return invoke<Flashcard>("create_card", {
    notebookId,
    deckId,
    front,
    back,
    cardType,
    tags,
  });
}

export async function createCardFromBlock(
  notebookId: string,
  deckId: string,
  pageId: string,
  blockId: string,
  front: string,
  back: string
): Promise<Flashcard> {
  return invoke<Flashcard>("create_card_from_block", {
    notebookId,
    deckId,
    pageId,
    blockId,
    front,
    back,
  });
}

export async function updateCard(
  notebookId: string,
  cardId: string,
  updates: {
    front?: string;
    back?: string;
    cardType?: CardType;
    tags?: string[];
  }
): Promise<Flashcard> {
  return invoke<Flashcard>("update_card", {
    notebookId,
    cardId,
    front: updates.front,
    back: updates.back,
    cardType: updates.cardType,
    tags: updates.tags,
  });
}

export async function deleteCard(notebookId: string, cardId: string): Promise<void> {
  return invoke("delete_card", { notebookId, cardId });
}

// ===== Review API =====

export async function getDueCards(
  notebookId: string,
  deckId?: string
): Promise<CardWithState[]> {
  return invoke<CardWithState[]>("get_due_cards", { notebookId, deckId });
}

export async function submitReview(
  notebookId: string,
  cardId: string,
  rating: number
): Promise<CardState> {
  return invoke<CardState>("submit_review", { notebookId, cardId, rating });
}

export async function getReviewStats(
  notebookId: string,
  deckId?: string
): Promise<ReviewStats> {
  return invoke<ReviewStats>("get_review_stats", { notebookId, deckId });
}

export async function getCardState(
  notebookId: string,
  cardId: string
): Promise<CardState> {
  return invoke<CardState>("get_card_state", { notebookId, cardId });
}

export async function previewReviewIntervals(
  notebookId: string,
  cardId: string
): Promise<[number, number, number, number]> {
  return invoke<[number, number, number, number]>("preview_review_intervals", {
    notebookId,
    cardId,
  });
}
