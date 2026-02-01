import { useEffect } from "react";
import { useFlashcardStore } from "../../stores/flashcardStore";
import type { Deck } from "../../types/flashcard";

interface DeckManagerProps {
  notebookId: string;
  onSelectDeck: (deck: Deck) => void;
  onStartReview: (deckId?: string) => void;
  onCreateDeck: () => void;
  onEditDeck: (deck: Deck) => void;
}

export function DeckManager({
  notebookId,
  onSelectDeck,
  onStartReview,
  onCreateDeck,
  onEditDeck,
}: DeckManagerProps) {
  const { decks, loadDecks, stats, loadStats, isLoading } = useFlashcardStore();

  useEffect(() => {
    loadDecks(notebookId);
    loadStats(notebookId);
  }, [notebookId, loadDecks, loadStats]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "var(--color-accent)" }}
          >
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <line x1="2" y1="12" x2="22" y2="12" />
          </svg>
          <h2
            className="font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Flashcards
          </h2>
        </div>
        <button
          onClick={onCreateDeck}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-sm transition-colors hover:bg-[--color-bg-tertiary]"
          style={{ color: "var(--color-accent)" }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Deck
        </button>
      </div>

      {/* Stats Summary */}
      {stats && (
        <div
          className="px-4 py-3 border-b grid grid-cols-3 gap-2 text-center"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-tertiary)",
          }}
        >
          <div>
            <div
              className="text-lg font-semibold"
              style={{ color: "var(--color-accent)" }}
            >
              {stats.dueCards}
            </div>
            <div
              className="text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              Due
            </div>
          </div>
          <div>
            <div
              className="text-lg font-semibold"
              style={{ color: "#10b981" }}
            >
              {stats.newCards}
            </div>
            <div
              className="text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              New
            </div>
          </div>
          <div>
            <div
              className="text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              {stats.totalCards}
            </div>
            <div
              className="text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              Total
            </div>
          </div>
        </div>
      )}

      {/* Review All Button */}
      {stats && stats.dueCards > 0 && (
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
          <button
            onClick={() => onStartReview()}
            className="w-full py-2 rounded-lg font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            Review All ({stats.dueCards} cards)
          </button>
        </div>
      )}

      {/* Deck List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div
            className="flex items-center justify-center py-8"
            style={{ color: "var(--color-text-muted)" }}
          >
            Loading...
          </div>
        ) : decks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--color-text-muted)" }}
              >
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <line x1="2" y1="12" x2="22" y2="12" />
              </svg>
            </div>
            <p
              className="text-sm mb-2"
              style={{ color: "var(--color-text-secondary)" }}
            >
              No decks yet
            </p>
            <p
              className="text-xs mb-4"
              style={{ color: "var(--color-text-muted)" }}
            >
              Create a deck to start adding flashcards
            </p>
            <button
              onClick={onCreateDeck}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:opacity-90"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
              }}
            >
              Create Deck
            </button>
          </div>
        ) : (
          <div className="py-2">
            {decks.map((deck) => (
              <DeckItem
                key={deck.id}
                deck={deck}
                onClick={() => onSelectDeck(deck)}
                onEdit={() => onEditDeck(deck)}
                onReview={() => onStartReview(deck.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface DeckItemProps {
  deck: Deck;
  onClick: () => void;
  onEdit: () => void;
  onReview: () => void;
}

function DeckItem({ deck, onClick, onEdit, onReview }: DeckItemProps) {
  return (
    <div
      className="mx-2 mb-1 rounded-lg border transition-colors hover:bg-[--color-bg-tertiary] cursor-pointer group"
      style={{
        borderColor: deck.color || "var(--color-border)",
        borderLeftWidth: deck.color ? "3px" : "1px",
      }}
      onClick={onClick}
    >
      <div className="px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div
              className="font-medium truncate"
              style={{ color: "var(--color-text-primary)" }}
            >
              {deck.name}
            </div>
            {deck.description && (
              <div
                className="text-xs truncate mt-0.5"
                style={{ color: "var(--color-text-muted)" }}
              >
                {deck.description}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="p-1 rounded hover:bg-[--color-bg-secondary]"
              style={{ color: "var(--color-text-muted)" }}
              title="Edit deck"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-2 text-xs">
          <span style={{ color: "var(--color-text-muted)" }}>
            {deck.cardCount} cards
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReview();
            }}
            className="px-2 py-0.5 rounded text-xs font-medium transition-colors hover:opacity-80"
            style={{
              backgroundColor: "rgba(139, 92, 246, 0.1)",
              color: "var(--color-accent)",
            }}
          >
            Review
          </button>
        </div>
      </div>
    </div>
  );
}
