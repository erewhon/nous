import { create } from "zustand";
import type {
  Deck,
  Flashcard,
  CardWithState,
  ReviewStats,
  CardType,
} from "../types/flashcard";
import * as api from "../utils/flashcardApi";

interface FlashcardState {
  // Panel state
  isPanelOpen: boolean;

  // Decks
  decks: Deck[];
  selectedDeckId: string | null;

  // Cards
  cards: Flashcard[];

  // Review session
  dueCards: CardWithState[];
  currentCardIndex: number;
  isReviewing: boolean;
  reviewMode: "fullscreen" | "panel" | null;
  intervalPreview: [number, number, number, number] | null;

  // Statistics
  stats: ReviewStats | null;

  // Loading states
  isLoading: boolean;
  error: string | null;
}

interface FlashcardActions {
  // Panel operations
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;

  // Deck operations
  loadDecks: (notebookId: string) => Promise<void>;
  selectDeck: (deckId: string | null) => void;
  createDeck: (
    notebookId: string,
    name: string,
    description?: string,
    color?: string
  ) => Promise<Deck | null>;
  updateDeck: (
    notebookId: string,
    deckId: string,
    updates: {
      name?: string;
      description?: string | null;
      color?: string | null;
      newCardsPerDay?: number;
      reviewsPerDay?: number;
    }
  ) => Promise<void>;
  deleteDeck: (notebookId: string, deckId: string) => Promise<void>;

  // Card operations
  loadCards: (notebookId: string, deckId: string) => Promise<void>;
  createCard: (
    notebookId: string,
    deckId: string,
    front: string,
    back: string,
    cardType?: CardType,
    tags?: string[]
  ) => Promise<Flashcard | null>;
  createCardFromBlock: (
    notebookId: string,
    deckId: string,
    pageId: string,
    blockId: string,
    front: string,
    back: string
  ) => Promise<Flashcard | null>;
  updateCard: (
    notebookId: string,
    cardId: string,
    updates: {
      front?: string;
      back?: string;
      cardType?: CardType;
      tags?: string[];
    }
  ) => Promise<void>;
  deleteCard: (notebookId: string, cardId: string) => Promise<void>;

  // Review operations
  loadDueCards: (notebookId: string, deckId?: string) => Promise<void>;
  startReview: (mode: "fullscreen" | "panel") => void;
  endReview: () => void;
  submitReview: (notebookId: string, cardId: string, rating: number) => Promise<void>;
  nextCard: () => void;
  previousCard: () => void;
  loadIntervalPreview: (notebookId: string, cardId: string) => Promise<void>;

  // Statistics
  loadStats: (notebookId: string, deckId?: string) => Promise<void>;

  // State management
  clearCards: () => void;
  clearError: () => void;
}

type FlashcardStore = FlashcardState & FlashcardActions;

export const useFlashcardStore = create<FlashcardStore>()((set, get) => ({
  // Initial state
  isPanelOpen: false,
  decks: [],
  selectedDeckId: null,
  cards: [],
  dueCards: [],
  currentCardIndex: 0,
  isReviewing: false,
  reviewMode: null,
  intervalPreview: null,
  stats: null,
  isLoading: false,
  error: null,

  // Panel operations
  openPanel: () => set({ isPanelOpen: true }),
  closePanel: () => set({ isPanelOpen: false, isReviewing: false, reviewMode: null }),
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),

  // Deck operations
  loadDecks: async (notebookId) => {
    set({ isLoading: true, error: null });
    try {
      const decks = await api.listDecks(notebookId);
      set({ decks, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to load decks",
        isLoading: false,
      });
    }
  },

  selectDeck: (deckId) => {
    set({ selectedDeckId: deckId });
  },

  createDeck: async (notebookId, name, description, color) => {
    set({ error: null });
    try {
      const deck = await api.createDeck(notebookId, name, description, color);
      set((state) => ({
        decks: [...state.decks, deck],
      }));
      return deck;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to create deck",
      });
      return null;
    }
  },

  updateDeck: async (notebookId, deckId, updates) => {
    set({ error: null });
    try {
      const deck = await api.updateDeck(notebookId, deckId, updates);
      set((state) => ({
        decks: state.decks.map((d) => (d.id === deckId ? deck : d)),
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to update deck",
      });
    }
  },

  deleteDeck: async (notebookId, deckId) => {
    set({ error: null });
    try {
      await api.deleteDeck(notebookId, deckId);
      set((state) => ({
        decks: state.decks.filter((d) => d.id !== deckId),
        selectedDeckId: state.selectedDeckId === deckId ? null : state.selectedDeckId,
        cards: state.selectedDeckId === deckId ? [] : state.cards,
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to delete deck",
      });
    }
  },

  // Card operations
  loadCards: async (notebookId, deckId) => {
    set({ isLoading: true, error: null });
    try {
      const cards = await api.listCards(notebookId, deckId);
      set({ cards, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to load cards",
        isLoading: false,
      });
    }
  },

  createCard: async (notebookId, deckId, front, back, cardType, tags) => {
    set({ error: null });
    try {
      const card = await api.createCard(notebookId, deckId, front, back, cardType, tags);
      set((state) => ({
        cards: [...state.cards, card],
        decks: state.decks.map((d) =>
          d.id === deckId ? { ...d, cardCount: d.cardCount + 1 } : d
        ),
      }));
      return card;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to create card",
      });
      return null;
    }
  },

  createCardFromBlock: async (notebookId, deckId, pageId, blockId, front, back) => {
    set({ error: null });
    try {
      const card = await api.createCardFromBlock(
        notebookId,
        deckId,
        pageId,
        blockId,
        front,
        back
      );
      set((state) => ({
        cards: [...state.cards, card],
        decks: state.decks.map((d) =>
          d.id === deckId ? { ...d, cardCount: d.cardCount + 1 } : d
        ),
      }));
      return card;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to create card from block",
      });
      return null;
    }
  },

  updateCard: async (notebookId, cardId, updates) => {
    set({ error: null });
    try {
      const card = await api.updateCard(notebookId, cardId, updates);
      set((state) => ({
        cards: state.cards.map((c) => (c.id === cardId ? card : c)),
        dueCards: state.dueCards.map((cws) =>
          cws.card.id === cardId ? { ...cws, card } : cws
        ),
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to update card",
      });
    }
  },

  deleteCard: async (notebookId, cardId) => {
    set({ error: null });
    try {
      const card = get().cards.find((c) => c.id === cardId);
      await api.deleteCard(notebookId, cardId);
      set((state) => ({
        cards: state.cards.filter((c) => c.id !== cardId),
        dueCards: state.dueCards.filter((cws) => cws.card.id !== cardId),
        decks: card
          ? state.decks.map((d) =>
              d.id === card.deckId
                ? { ...d, cardCount: Math.max(0, d.cardCount - 1) }
                : d
            )
          : state.decks,
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to delete card",
      });
    }
  },

  // Review operations
  loadDueCards: async (notebookId, deckId) => {
    set({ isLoading: true, error: null });
    try {
      const dueCards = await api.getDueCards(notebookId, deckId);
      set({ dueCards, currentCardIndex: 0, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to load due cards",
        isLoading: false,
      });
    }
  },

  startReview: (mode) => {
    set({ isReviewing: true, reviewMode: mode, currentCardIndex: 0 });
  },

  endReview: () => {
    set({
      isReviewing: false,
      reviewMode: null,
      currentCardIndex: 0,
      intervalPreview: null,
    });
  },

  submitReview: async (notebookId, cardId, rating) => {
    set({ error: null });
    try {
      const newState = await api.submitReview(notebookId, cardId, rating);
      // Update the card's state in dueCards
      set((state) => ({
        dueCards: state.dueCards.map((cws) =>
          cws.card.id === cardId ? { ...cws, state: newState } : cws
        ),
      }));
      // Move to next card
      get().nextCard();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to submit review",
      });
    }
  },

  nextCard: () => {
    set((state) => {
      const nextIndex = state.currentCardIndex + 1;
      if (nextIndex >= state.dueCards.length) {
        // End of review session
        return { isReviewing: false, reviewMode: null, intervalPreview: null };
      }
      return { currentCardIndex: nextIndex, intervalPreview: null };
    });
  },

  previousCard: () => {
    set((state) => ({
      currentCardIndex: Math.max(0, state.currentCardIndex - 1),
      intervalPreview: null,
    }));
  },

  loadIntervalPreview: async (notebookId, cardId) => {
    try {
      const intervals = await api.previewReviewIntervals(notebookId, cardId);
      set({ intervalPreview: intervals });
    } catch {
      // Silently fail for preview - not critical
    }
  },

  // Statistics
  loadStats: async (notebookId, deckId) => {
    set({ error: null });
    try {
      const stats = await api.getReviewStats(notebookId, deckId);
      set({ stats });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to load stats",
      });
    }
  },

  // State management
  clearCards: () => {
    set({ cards: [], dueCards: [], currentCardIndex: 0 });
  },

  clearError: () => {
    set({ error: null });
  },
}));

// Selectors
export const selectCurrentCard = (state: FlashcardState) =>
  state.dueCards[state.currentCardIndex] ?? null;

export const selectReviewProgress = (state: FlashcardState) => ({
  current: state.currentCardIndex + 1,
  total: state.dueCards.length,
  remaining: state.dueCards.length - state.currentCardIndex - 1,
});
