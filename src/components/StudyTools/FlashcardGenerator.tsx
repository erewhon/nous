import { useState, useCallback } from "react";
import { useStudyToolsStore } from "../../stores/studyToolsStore";
import { useFlashcardStore } from "../../stores/flashcardStore";
import { useNotebookStore } from "../../stores/notebookStore";
import type { StudyPageContent, GeneratedFlashcard } from "../../types/studyTools";
import type { CardType } from "../../types/flashcard";

interface FlashcardGeneratorProps {
  pages: StudyPageContent[];
  deckId: string;
  onClose: () => void;
  onSuccess?: (count: number) => void;
}

export function FlashcardGenerator({
  pages,
  deckId,
  onClose,
  onSuccess,
}: FlashcardGeneratorProps) {
  const { selectedNotebookId } = useNotebookStore();
  const { generateFlashcards, flashcards, isGenerating, error, clearFlashcards } =
    useStudyToolsStore();
  const { createCard } = useFlashcardStore();

  const [numCards, setNumCards] = useState(20);
  const [cardTypes, setCardTypes] = useState<string[]>(["basic"]);
  const [selectedCards, setSelectedCards] = useState<Set<number>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    await generateFlashcards(pages, numCards, cardTypes);
    // Select all cards by default
    if (flashcards?.cards) {
      setSelectedCards(new Set(flashcards.cards.map((_, i) => i)));
    }
  }, [generateFlashcards, pages, numCards, cardTypes, flashcards?.cards]);

  const toggleCardType = useCallback((type: string) => {
    setCardTypes((prev) => {
      if (prev.includes(type)) {
        if (prev.length === 1) return prev; // Keep at least one type
        return prev.filter((t) => t !== type);
      }
      return [...prev, type];
    });
  }, []);

  const toggleCard = useCallback((index: number) => {
    setSelectedCards((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (!flashcards?.cards) return;
    setSelectedCards((prev) => {
      if (prev.size === flashcards.cards.length) {
        return new Set();
      }
      return new Set(flashcards.cards.map((_, i) => i));
    });
  }, [flashcards?.cards]);

  const handleSave = useCallback(async () => {
    if (!selectedNotebookId || !flashcards?.cards) return;

    setIsSaving(true);
    setSaveError(null);

    let savedCount = 0;
    try {
      for (const index of selectedCards) {
        const card = flashcards.cards[index];
        if (card) {
          await createCard(
            selectedNotebookId,
            deckId,
            card.front,
            card.back,
            card.cardType as CardType,
            card.tags
          );
          savedCount++;
        }
      }
      clearFlashcards();
      onSuccess?.(savedCount);
      onClose();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save cards"
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    selectedNotebookId,
    flashcards?.cards,
    selectedCards,
    createCard,
    deckId,
    clearFlashcards,
    onSuccess,
    onClose,
  ]);

  const handleClose = useCallback(() => {
    clearFlashcards();
    onClose();
  }, [clearFlashcards, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-2xl max-h-[80vh] rounded-xl shadow-xl flex flex-col"
        style={{ backgroundColor: "var(--color-bg-secondary)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--color-accent)" }}
            >
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              AI Flashcard Generator
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {!flashcards ? (
            // Generation options
            <div className="space-y-6">
              <div>
                <p
                  className="text-sm mb-4"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Generate flashcards from {pages.length} page
                  {pages.length !== 1 ? "s" : ""}.
                </p>

                {/* Number of cards */}
                <label className="block mb-4">
                  <span
                    className="block text-sm font-medium mb-2"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    Number of cards
                  </span>
                  <input
                    type="number"
                    min={5}
                    max={50}
                    value={numCards}
                    onChange={(e) =>
                      setNumCards(Math.max(5, Math.min(50, parseInt(e.target.value) || 20)))
                    }
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    style={{
                      backgroundColor: "var(--color-bg-primary)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  />
                </label>

                {/* Card types */}
                <div className="mb-4">
                  <span
                    className="block text-sm font-medium mb-2"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    Card types
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "basic", label: "Basic Q&A" },
                      { id: "cloze", label: "Cloze deletion" },
                      { id: "reversible", label: "Reversible" },
                    ].map((type) => (
                      <button
                        key={type.id}
                        onClick={() => toggleCardType(type.id)}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                          cardTypes.includes(type.id)
                            ? "border-[--color-accent]"
                            : "border-[--color-border]"
                        }`}
                        style={{
                          backgroundColor: cardTypes.includes(type.id)
                            ? "rgba(139, 92, 246, 0.1)"
                            : "var(--color-bg-primary)",
                          color: cardTypes.includes(type.id)
                            ? "var(--color-accent)"
                            : "var(--color-text-secondary)",
                        }}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {error && (
                <div
                  className="p-3 rounded-lg text-sm"
                  style={{
                    backgroundColor: "rgba(239, 68, 68, 0.1)",
                    color: "#ef4444",
                  }}
                >
                  {error}
                </div>
              )}
            </div>
          ) : (
            // Generated cards preview
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p
                  className="text-sm"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {flashcards.cards.length} cards generated
                </p>
                <button
                  onClick={toggleAll}
                  className="text-sm hover:underline"
                  style={{ color: "var(--color-accent)" }}
                >
                  {selectedCards.size === flashcards.cards.length
                    ? "Deselect all"
                    : "Select all"}
                </button>
              </div>

              <div className="space-y-2">
                {flashcards.cards.map((card, index) => (
                  <FlashcardPreview
                    key={index}
                    card={card}
                    isSelected={selectedCards.has(index)}
                    onToggle={() => toggleCard(index)}
                  />
                ))}
              </div>

              {saveError && (
                <div
                  className="p-3 rounded-lg text-sm"
                  style={{
                    backgroundColor: "rgba(239, 68, 68, 0.1)",
                    color: "#ef4444",
                  }}
                >
                  {saveError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-3 px-6 py-4 border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-lg text-sm transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Cancel
          </button>
          {!flashcards ? (
            <button
              onClick={handleGenerate}
              disabled={isGenerating || pages.length === 0}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: "var(--color-accent)" }}
            >
              {isGenerating ? "Generating..." : "Generate Cards"}
            </button>
          ) : (
            <>
              <button
                onClick={() => clearFlashcards()}
                className="px-4 py-2 rounded-lg text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Regenerate
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || selectedCards.size === 0}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: "var(--color-accent)" }}
              >
                {isSaving
                  ? "Saving..."
                  : `Add ${selectedCards.size} Cards to Deck`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface FlashcardPreviewProps {
  card: GeneratedFlashcard;
  isSelected: boolean;
  onToggle: () => void;
}

function FlashcardPreview({ card, isSelected, onToggle }: FlashcardPreviewProps) {
  const [isFlipped, setIsFlipped] = useState(false);

  return (
    <div
      className={`p-4 rounded-lg border cursor-pointer transition-all ${
        isSelected ? "border-[--color-accent]" : "border-[--color-border]"
      }`}
      style={{
        backgroundColor: isSelected
          ? "rgba(139, 92, 246, 0.05)"
          : "var(--color-bg-primary)",
      }}
      onClick={onToggle}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 pt-0.5">
          <div
            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              isSelected
                ? "border-[--color-accent] bg-[--color-accent]"
                : "border-[--color-border]"
            }`}
          >
            {isSelected && (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-muted)",
              }}
            >
              {card.cardType}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsFlipped(!isFlipped);
              }}
              className="text-xs hover:underline"
              style={{ color: "var(--color-accent)" }}
            >
              {isFlipped ? "Show front" : "Show back"}
            </button>
          </div>
          <div
            className="text-sm whitespace-pre-wrap"
            style={{ color: "var(--color-text-primary)" }}
          >
            {isFlipped ? card.back : card.front}
          </div>
          {card.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {card.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: "var(--color-bg-tertiary)",
                    color: "var(--color-text-muted)",
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
