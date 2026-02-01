import { useState, useCallback, useEffect } from "react";
import { useFlashcardStore } from "../../stores/flashcardStore";
import { useNotebookStore } from "../../stores/notebookStore";
import { DeckManager } from "./DeckManager";
import { DeckDialog } from "./DeckDialog";
import { CardEditor } from "./CardEditor";
import { ReviewMode } from "./ReviewMode";
import { ReviewPanel } from "./ReviewPanel";
import type { Deck, Flashcard } from "../../types/flashcard";

export function FlashcardPanel() {
  const { selectedNotebookId } = useNotebookStore();
  const {
    isPanelOpen,
    closePanel,
    isReviewing,
    reviewMode,
    startReview,
    endReview,
    decks,
    selectedDeckId,
    selectDeck,
    loadCards,
    createDeck,
    updateDeck,
    deleteDeck,
    createCard,
    updateCard,
    deleteCard,
    loadDueCards,
    loadStats,
  } = useFlashcardStore();

  // Dialog states
  const [showDeckDialog, setShowDeckDialog] = useState(false);
  const [editingDeck, setEditingDeck] = useState<Deck | null>(null);
  const [showCardEditor, setShowCardEditor] = useState(false);
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [reviewDeckId, setReviewDeckId] = useState<string | undefined>();
  const [reviewDeckName, setReviewDeckName] = useState<string | undefined>();

  // Load stats when panel opens
  useEffect(() => {
    if (isPanelOpen && selectedNotebookId) {
      loadStats(selectedNotebookId);
    }
  }, [isPanelOpen, selectedNotebookId, loadStats]);

  // Load cards when deck is selected
  useEffect(() => {
    if (selectedNotebookId && selectedDeckId) {
      loadCards(selectedNotebookId, selectedDeckId);
    }
  }, [selectedNotebookId, selectedDeckId, loadCards]);

  const handleCreateDeck = useCallback(() => {
    setEditingDeck(null);
    setShowDeckDialog(true);
  }, []);

  const handleEditDeck = useCallback((deck: Deck) => {
    setEditingDeck(deck);
    setShowDeckDialog(true);
  }, []);

  const handleSaveDeck = useCallback(
    async (data: {
      name: string;
      description?: string | null;
      color?: string | null;
      newCardsPerDay?: number;
      reviewsPerDay?: number;
    }) => {
      if (!selectedNotebookId) return;

      if (editingDeck) {
        await updateDeck(selectedNotebookId, editingDeck.id, data);
      } else {
        await createDeck(
          selectedNotebookId,
          data.name,
          data.description ?? undefined,
          data.color ?? undefined
        );
      }
      setShowDeckDialog(false);
      loadStats(selectedNotebookId);
    },
    [selectedNotebookId, editingDeck, createDeck, updateDeck, loadStats]
  );

  const handleDeleteDeck = useCallback(async () => {
    if (!selectedNotebookId || !editingDeck) return;
    await deleteDeck(selectedNotebookId, editingDeck.id);
    setShowDeckDialog(false);
    loadStats(selectedNotebookId);
  }, [selectedNotebookId, editingDeck, deleteDeck, loadStats]);

  const handleSelectDeck = useCallback(
    (deck: Deck) => {
      selectDeck(deck.id);
      // Could open a deck detail view here
    },
    [selectDeck]
  );

  const handleStartReview = useCallback(
    (deckId?: string) => {
      if (!selectedNotebookId) return;
      const deck = deckId ? decks.find((d) => d.id === deckId) : undefined;
      setReviewDeckId(deckId);
      setReviewDeckName(deck?.name);
      loadDueCards(selectedNotebookId, deckId);
      startReview("fullscreen");
    },
    [selectedNotebookId, decks, loadDueCards, startReview]
  );

  // Panel review mode - available for future use
  const _handleStartPanelReview = useCallback(
    (deckId?: string) => {
      if (!selectedNotebookId) return;
      const deck = deckId ? decks.find((d) => d.id === deckId) : undefined;
      setReviewDeckId(deckId);
      setReviewDeckName(deck?.name);
      loadDueCards(selectedNotebookId, deckId);
      startReview("panel");
    },
    [selectedNotebookId, decks, loadDueCards, startReview]
  );
  void _handleStartPanelReview; // Suppress unused warning

  const handleExitReview = useCallback(() => {
    endReview();
    if (selectedNotebookId) {
      loadStats(selectedNotebookId);
    }
  }, [endReview, selectedNotebookId, loadStats]);

  const handleExpandReview = useCallback(() => {
    startReview("fullscreen");
  }, [startReview]);

  // Card operations - available when deck detail view is added
  const _handleCreateCard = useCallback(() => {
    setEditingCard(null);
    setShowCardEditor(true);
  }, []);

  const _handleEditCard = useCallback((card: Flashcard) => {
    setEditingCard(card);
    setShowCardEditor(true);
  }, []);
  void _handleCreateCard; // Suppress unused warning
  void _handleEditCard; // Suppress unused warning

  const handleSaveCard = useCallback(
    async (data: {
      front: string;
      back: string;
      cardType: "basic" | "cloze" | "reversible";
      tags?: string[];
    }) => {
      if (!selectedNotebookId || !selectedDeckId) return;

      if (editingCard) {
        await updateCard(selectedNotebookId, editingCard.id, data);
      } else {
        await createCard(
          selectedNotebookId,
          selectedDeckId,
          data.front,
          data.back,
          data.cardType,
          data.tags
        );
      }
      setShowCardEditor(false);
      loadStats(selectedNotebookId);
    },
    [selectedNotebookId, selectedDeckId, editingCard, createCard, updateCard, loadStats]
  );

  const handleDeleteCard = useCallback(async () => {
    if (!selectedNotebookId || !editingCard) return;
    await deleteCard(selectedNotebookId, editingCard.id);
    setShowCardEditor(false);
    loadStats(selectedNotebookId);
  }, [selectedNotebookId, editingCard, deleteCard, loadStats]);

  if (!selectedNotebookId) return null;

  // Full-screen review mode
  if (isReviewing && reviewMode === "fullscreen") {
    return (
      <ReviewMode
        notebookId={selectedNotebookId}
        deckId={reviewDeckId}
        deckName={reviewDeckName}
        onExit={handleExitReview}
      />
    );
  }

  return (
    <>
      {/* Floating panel review mode */}
      {isReviewing && reviewMode === "panel" && (
        <ReviewPanel
          notebookId={selectedNotebookId}
          deckId={reviewDeckId}
          deckName={reviewDeckName}
          onClose={handleExitReview}
          onExpand={handleExpandReview}
        />
      )}

      {/* Main flashcard panel */}
      {isPanelOpen && (
        <div
          className="fixed right-0 top-0 bottom-0 z-30 w-80 border-l shadow-xl flex flex-col"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          {/* Panel header */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b"
            style={{ borderColor: "var(--color-border)" }}
          >
            <h2
              className="font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Flashcards
            </h2>
            <button
              onClick={closePanel}
              className="p-1 rounded hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-text-muted)" }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Deck manager */}
          <div className="flex-1 overflow-hidden">
            <DeckManager
              notebookId={selectedNotebookId}
              onSelectDeck={handleSelectDeck}
              onStartReview={handleStartReview}
              onCreateDeck={handleCreateDeck}
              onEditDeck={handleEditDeck}
            />
          </div>
        </div>
      )}

      {/* Deck dialog */}
      <DeckDialog
        isOpen={showDeckDialog}
        deck={editingDeck}
        onClose={() => setShowDeckDialog(false)}
        onSave={handleSaveDeck}
        onDelete={editingDeck ? handleDeleteDeck : undefined}
      />

      {/* Card editor */}
      <CardEditor
        isOpen={showCardEditor}
        card={editingCard}
        onClose={() => setShowCardEditor(false)}
        onSave={handleSaveCard}
        onDelete={editingCard ? handleDeleteCard : undefined}
      />
    </>
  );
}
