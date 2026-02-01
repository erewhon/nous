import { useState, useEffect, useCallback } from "react";
import {
  useFlashcardStore,
  selectCurrentCard,
  selectReviewProgress,
} from "../../stores/flashcardStore";
import { formatInterval, type ReviewRating } from "../../types/flashcard";

interface ReviewPanelProps {
  notebookId: string;
  deckId?: string;
  deckName?: string;
  onClose: () => void;
  onExpand?: () => void; // Switch to full-screen mode
}

const RATING_CONFIG: {
  rating: ReviewRating;
  label: string;
  color: string;
}[] = [
  { rating: 1, label: "1", color: "#ef4444" },
  { rating: 2, label: "2", color: "#f59e0b" },
  { rating: 3, label: "3", color: "#10b981" },
  { rating: 4, label: "4", color: "#3b82f6" },
];

export function ReviewPanel({
  notebookId,
  deckId,
  deckName,
  onClose,
  onExpand,
}: ReviewPanelProps) {
  const {
    dueCards,
    intervalPreview,
    loadDueCards,
    submitReview,
    loadIntervalPreview,
    endReview,
  } = useFlashcardStore();

  const currentCard = useFlashcardStore(selectCurrentCard);
  const progress = useFlashcardStore(selectReviewProgress);

  const [isRevealed, setIsRevealed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Load due cards when mounted
  useEffect(() => {
    loadDueCards(notebookId, deckId);
  }, [notebookId, deckId, loadDueCards]);

  // Load interval preview when card changes
  useEffect(() => {
    if (currentCard) {
      loadIntervalPreview(notebookId, currentCard.card.id);
    }
    setIsRevealed(false);
  }, [currentCard?.card.id, notebookId, loadIntervalPreview]);

  const handleRate = useCallback(
    async (rating: ReviewRating) => {
      if (!currentCard || isSubmitting) return;

      setIsSubmitting(true);
      try {
        await submitReview(notebookId, currentCard.card.id, rating);
        setIsRevealed(false);
      } finally {
        setIsSubmitting(false);
      }
    },
    [currentCard, notebookId, submitReview, isSubmitting]
  );

  const handleClose = useCallback(() => {
    endReview();
    onClose();
  }, [endReview, onClose]);

  // Minimized view
  if (isMinimized) {
    return (
      <div
        className="fixed bottom-4 right-4 z-40 rounded-xl shadow-lg border overflow-hidden cursor-pointer"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
        onClick={() => setIsMinimized(false)}
      >
        <div className="flex items-center gap-3 px-4 py-3">
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
          <span style={{ color: "var(--color-text-primary)" }}>
            {progress.remaining} cards left
          </span>
        </div>
      </div>
    );
  }

  // Completion view
  if (!currentCard && dueCards.length > 0) {
    return (
      <div
        className="fixed bottom-4 right-4 z-40 w-80 rounded-xl shadow-lg border overflow-hidden"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="p-4 text-center">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3"
            style={{ backgroundColor: "rgba(16, 185, 129, 0.1)" }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <path d="m9 11 3 3L22 4" />
            </svg>
          </div>
          <h3
            className="font-semibold mb-1"
            style={{ color: "var(--color-text-primary)" }}
          >
            All Done!
          </h3>
          <p
            className="text-sm mb-3"
            style={{ color: "var(--color-text-muted)" }}
          >
            You've reviewed all due cards
          </p>
          <button
            onClick={handleClose}
            className="px-4 py-1.5 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // Loading state
  if (!currentCard) {
    return (
      <div
        className="fixed bottom-4 right-4 z-40 w-80 rounded-xl shadow-lg border p-4"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
          color: "var(--color-text-muted)",
        }}
      >
        Loading...
      </div>
    );
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-40 w-80 rounded-xl shadow-lg border overflow-hidden"
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2">
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
            style={{ color: "var(--color-accent)" }}
          >
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <line x1="2" y1="12" x2="22" y2="12" />
          </svg>
          <span
            className="text-sm font-medium truncate max-w-[120px]"
            style={{ color: "var(--color-text-primary)" }}
          >
            {deckName || "Review"}
          </span>
          <span
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            {progress.current}/{progress.total}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized(true)}
            className="p-1 rounded hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Minimize"
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
              <path d="M5 12h14" />
            </svg>
          </button>
          {onExpand && (
            <button
              onClick={onExpand}
              className="p-1 rounded hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-text-muted)" }}
              title="Full screen"
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
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            </button>
          )}
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Close"
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
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Card content */}
      <div className="p-3">
        {/* Front */}
        <div
          className="text-xs font-semibold uppercase tracking-wide mb-1"
          style={{ color: "var(--color-text-muted)" }}
        >
          Q
        </div>
        <div
          className="text-sm leading-relaxed mb-3"
          style={{ color: "var(--color-text-primary)" }}
          dangerouslySetInnerHTML={{ __html: currentCard.card.front }}
        />

        {/* Reveal / Answer */}
        {!isRevealed ? (
          <button
            onClick={() => setIsRevealed(true)}
            className="w-full py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-accent)",
            }}
          >
            Show Answer
          </button>
        ) : (
          <>
            <div
              className="text-xs font-semibold uppercase tracking-wide mb-1"
              style={{ color: "var(--color-text-muted)" }}
            >
              A
            </div>
            <div
              className="text-sm leading-relaxed p-2 rounded-lg mb-3"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-primary)",
              }}
              dangerouslySetInnerHTML={{ __html: currentCard.card.back }}
            />

            {/* Rating buttons */}
            <div className="flex gap-1">
              {RATING_CONFIG.map(({ rating, label, color }, index) => (
                <button
                  key={rating}
                  onClick={() => handleRate(rating)}
                  disabled={isSubmitting}
                  className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: color, color: "white" }}
                  title={
                    intervalPreview
                      ? formatInterval(intervalPreview[index])
                      : undefined
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
