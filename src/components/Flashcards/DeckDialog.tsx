import { useState, useEffect } from "react";
import type { Deck } from "../../types/flashcard";
import { InlineColorPicker } from "../ColorPicker/ColorPicker";

interface DeckDialogProps {
  isOpen: boolean;
  deck: Deck | null; // null for creating new
  onClose: () => void;
  onSave: (data: {
    name: string;
    description?: string | null;
    color?: string | null;
    newCardsPerDay?: number;
    reviewsPerDay?: number;
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export function DeckDialog({
  isOpen,
  deck,
  onClose,
  onSave,
  onDelete,
}: DeckDialogProps) {
  const [name, setName] = useState(deck?.name || "");
  const [description, setDescription] = useState(deck?.description || "");
  const [color, setColor] = useState<string | undefined>(deck?.color);
  const [newCardsPerDay, setNewCardsPerDay] = useState(
    deck?.newCardsPerDay ?? 20
  );
  const [reviewsPerDay, setReviewsPerDay] = useState(deck?.reviewsPerDay ?? 100);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isCreating = deck === null;

  // Reset state when dialog opens/closes or deck changes
  useEffect(() => {
    if (isOpen) {
      setName(deck?.name || "");
      setDescription(deck?.description || "");
      setColor(deck?.color);
      setNewCardsPerDay(deck?.newCardsPerDay ?? 20);
      setReviewsPerDay(deck?.reviewsPerDay ?? 100);
      setIsDeleting(false);
      setIsSaving(false);
    }
  }, [isOpen, deck]);

  const handleSave = async () => {
    if (!name.trim()) return;

    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || null,
        color: color || null,
        newCardsPerDay,
        reviewsPerDay,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;

    setIsSaving(true);
    try {
      await onDelete();
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-xl p-6 shadow-xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border)",
        }}
      >
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2
            className="text-lg font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            {isCreating ? "Create Deck" : "Edit Deck"}
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
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

        {isDeleting ? (
          /* Delete confirmation view */
          <div className="space-y-4">
            <p style={{ color: "var(--color-text-secondary)" }}>
              Are you sure you want to delete this deck? All cards in the deck
              will be permanently removed.
            </p>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setIsDeleting(false)}
                className="flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-[--color-bg-tertiary]"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isSaving}
                className="flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: "#ef4444" }}
              >
                {isSaving ? "Deleting..." : "Delete Deck"}
              </button>
            </div>
          </div>
        ) : (
          /* Edit/Create view */
          <div className="space-y-4">
            {/* Name input */}
            <div className="space-y-2">
              <label
                className="block text-sm font-medium"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) {
                    handleSave();
                  }
                }}
                placeholder="Deck name..."
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
                autoFocus
              />
            </div>

            {/* Description input */}
            <div className="space-y-2">
              <label
                className="block text-sm font-medium"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Description (optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe this deck..."
                rows={2}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none resize-none"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              />
            </div>

            {/* Color picker */}
            <div className="space-y-2">
              <label
                className="block text-sm font-medium"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Color
              </label>
              <InlineColorPicker
                value={color}
                onChange={(c) => setColor(c)}
                showClear={true}
              />
            </div>

            {/* Daily limits (only shown when editing) */}
            {!isCreating && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label
                    className="block text-sm font-medium"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    New cards/day
                  </label>
                  <input
                    type="number"
                    value={newCardsPerDay}
                    onChange={(e) =>
                      setNewCardsPerDay(Math.max(0, parseInt(e.target.value) || 0))
                    }
                    min={0}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{
                      backgroundColor: "var(--color-bg-tertiary)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <label
                    className="block text-sm font-medium"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    Reviews/day
                  </label>
                  <input
                    type="number"
                    value={reviewsPerDay}
                    onChange={(e) =>
                      setReviewsPerDay(Math.max(0, parseInt(e.target.value) || 0))
                    }
                    min={0}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{
                      backgroundColor: "var(--color-bg-tertiary)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              {!isCreating && onDelete && (
                <button
                  onClick={() => setIsDeleting(true)}
                  className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:bg-[--color-bg-tertiary]"
                  style={{ color: "#ef4444" }}
                >
                  Delete
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={onClose}
                className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-[--color-bg-tertiary]"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!name.trim() || isSaving}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: "var(--color-accent)" }}
              >
                {isSaving ? "Saving..." : isCreating ? "Create" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
