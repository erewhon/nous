import { useState, useEffect, useCallback } from "react";
import {
  useFlashcardStore,
  selectCurrentCard,
  selectReviewProgress,
} from "../../stores/flashcardStore";
import { formatInterval, type ReviewRating } from "../../types/flashcard";

interface ReviewModeProps {
  notebookId: string;
  deckId?: string;
  deckName?: string;
  onExit: () => void;
}

const RATING_CONFIG: {
  rating: ReviewRating;
  label: string;
  color: string;
  key: string;
}[] = [
  { rating: 1, label: "Again", color: "#ef4444", key: "1" },
  { rating: 2, label: "Hard", color: "#f59e0b", key: "2" },
  { rating: 3, label: "Good", color: "#10b981", key: "3" },
  { rating: 4, label: "Easy", color: "#3b82f6", key: "4" },
];

export function ReviewMode({
  notebookId,
  deckId,
  deckName,
  onExit,
}: ReviewModeProps) {
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

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleExit();
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!isRevealed) {
          setIsRevealed(true);
        }
      } else if (isRevealed && !isSubmitting) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= 4) {
          handleRate(num as ReviewRating);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRevealed, isSubmitting]);

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

  const handleExit = useCallback(() => {
    endReview();
    onExit();
  }, [endReview, onExit]);

  // Show completion screen
  if (!currentCard && dueCards.length > 0) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center"
        style={{ backgroundColor: "var(--color-bg-primary)" }}
      >
        <div className="text-center max-w-md px-8">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
            style={{ backgroundColor: "rgba(16, 185, 129, 0.1)" }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="40"
              height="40"
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
          <h2
            className="text-2xl font-bold mb-3"
            style={{ color: "var(--color-text-primary)" }}
          >
            Review Complete!
          </h2>
          <p
            className="mb-6"
            style={{ color: "var(--color-text-secondary)" }}
          >
            You've reviewed all due cards. Great job!
          </p>
          <button
            onClick={handleExit}
            className="px-6 py-2 rounded-lg font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // Show loading state
  if (!currentCard) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ backgroundColor: "var(--color-bg-primary)" }}
      >
        <div style={{ color: "var(--color-text-muted)" }}>Loading...</div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ backgroundColor: "var(--color-bg-primary)" }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <button
          onClick={handleExit}
          className="flex items-center gap-2 text-sm transition-colors hover:opacity-80"
          style={{ color: "var(--color-text-secondary)" }}
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
            <path d="m12 19-7-7 7-7M5 12h14" />
          </svg>
          Exit
        </button>

        <div
          className="font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          {deckName || "Review"}
        </div>

        <div
          className="text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          {progress.current} / {progress.total}
        </div>
      </header>

      {/* Progress bar */}
      <div
        className="h-1"
        style={{ backgroundColor: "var(--color-bg-tertiary)" }}
      >
        <div
          className="h-full transition-all duration-300"
          style={{
            backgroundColor: "var(--color-accent)",
            width: `${(progress.current / progress.total) * 100}%`,
          }}
        />
      </div>

      {/* Card area */}
      <main className="flex-1 flex items-center justify-center p-8">
        <div
          className="w-full max-w-2xl rounded-xl border shadow-lg overflow-hidden"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          {/* Front */}
          <div className="p-8 min-h-[200px]">
            <div
              className="text-xs font-semibold uppercase tracking-wide mb-4"
              style={{ color: "var(--color-text-muted)" }}
            >
              Question
            </div>
            <div
              className="text-lg leading-relaxed"
              style={{ color: "var(--color-text-primary)" }}
              dangerouslySetInnerHTML={{ __html: currentCard.card.front }}
            />
          </div>

          {/* Divider / Reveal button */}
          {!isRevealed ? (
            <button
              onClick={() => setIsRevealed(true)}
              className="w-full py-4 text-center font-medium transition-colors hover:opacity-80"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-accent)",
              }}
            >
              Show Answer
              <span
                className="ml-2 text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                (Space)
              </span>
            </button>
          ) : (
            <>
              {/* Back */}
              <div
                className="p-8 min-h-[200px]"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              >
                <div
                  className="text-xs font-semibold uppercase tracking-wide mb-4"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Answer
                </div>
                <div
                  className="text-lg leading-relaxed"
                  style={{ color: "var(--color-text-primary)" }}
                  dangerouslySetInnerHTML={{ __html: currentCard.card.back }}
                />
              </div>
            </>
          )}
        </div>
      </main>

      {/* Rating buttons */}
      {isRevealed && (
        <footer
          className="px-6 py-4 border-t"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          <div className="max-w-2xl mx-auto">
            <div className="flex gap-3">
              {RATING_CONFIG.map(({ rating, label, color, key }, index) => (
                <button
                  key={rating}
                  onClick={() => handleRate(rating)}
                  disabled={isSubmitting}
                  className="flex-1 py-3 rounded-lg font-medium transition-colors hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: color, color: "white" }}
                >
                  <div>{label}</div>
                  <div className="text-xs opacity-80 mt-0.5">
                    {intervalPreview
                      ? formatInterval(intervalPreview[index])
                      : "..."}
                    <span className="ml-1 opacity-60">({key})</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
