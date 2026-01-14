import { useState, useEffect } from "react";
import type { Flashcard, CardType } from "../../types/flashcard";

interface CardEditorProps {
  isOpen: boolean;
  card: Flashcard | null; // null for creating new
  onClose: () => void;
  onSave: (data: {
    front: string;
    back: string;
    cardType: CardType;
    tags?: string[];
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
}

const CARD_TYPES: { value: CardType; label: string; description: string }[] = [
  { value: "basic", label: "Basic", description: "Simple question and answer" },
  { value: "cloze", label: "Cloze", description: "Fill in the blank" },
  { value: "reversible", label: "Reversible", description: "Can be reviewed both ways" },
];

export function CardEditor({
  isOpen,
  card,
  onClose,
  onSave,
  onDelete,
}: CardEditorProps) {
  const [front, setFront] = useState(card?.front || "");
  const [back, setBack] = useState(card?.back || "");
  const [cardType, setCardType] = useState<CardType>(card?.cardType || "basic");
  const [tagsInput, setTagsInput] = useState(card?.tags?.join(", ") || "");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isCreating = card === null;

  // Reset state when dialog opens/closes or card changes
  useEffect(() => {
    if (isOpen) {
      setFront(card?.front || "");
      setBack(card?.back || "");
      setCardType(card?.cardType || "basic");
      setTagsInput(card?.tags?.join(", ") || "");
      setIsDeleting(false);
      setIsSaving(false);
    }
  }, [isOpen, card]);

  const handleSave = async () => {
    if (!front.trim() || !back.trim()) return;

    setIsSaving(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      await onSave({
        front: front.trim(),
        back: back.trim(),
        cardType,
        tags: tags.length > 0 ? tags : undefined,
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
        className="w-full max-w-lg rounded-xl p-6 shadow-xl"
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
            {isCreating ? "Create Card" : "Edit Card"}
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
              Are you sure you want to delete this card? This action cannot be
              undone.
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
                {isSaving ? "Deleting..." : "Delete Card"}
              </button>
            </div>
          </div>
        ) : (
          /* Edit/Create view */
          <div className="space-y-4">
            {/* Card type selector */}
            <div className="space-y-2">
              <label
                className="block text-sm font-medium"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Card Type
              </label>
              <div className="flex gap-2">
                {CARD_TYPES.map((type) => (
                  <button
                    key={type.value}
                    onClick={() => setCardType(type.value)}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                      cardType === type.value
                        ? "border-[--color-accent]"
                        : "hover:bg-[--color-bg-tertiary]"
                    }`}
                    style={{
                      borderColor:
                        cardType === type.value
                          ? "var(--color-accent)"
                          : "var(--color-border)",
                      color:
                        cardType === type.value
                          ? "var(--color-accent)"
                          : "var(--color-text-secondary)",
                    }}
                    title={type.description}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Front input */}
            <div className="space-y-2">
              <label
                className="block text-sm font-medium"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Front (Question)
              </label>
              <textarea
                value={front}
                onChange={(e) => setFront(e.target.value)}
                placeholder="Enter the question..."
                rows={3}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none resize-none"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
                autoFocus
              />
            </div>

            {/* Back input */}
            <div className="space-y-2">
              <label
                className="block text-sm font-medium"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Back (Answer)
              </label>
              <textarea
                value={back}
                onChange={(e) => setBack(e.target.value)}
                placeholder="Enter the answer..."
                rows={3}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none resize-none"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              />
            </div>

            {/* Tags input */}
            <div className="space-y-2">
              <label
                className="block text-sm font-medium"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Tags (comma-separated)
              </label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="e.g., biology, chapter-5, important"
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              />
            </div>

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
                disabled={!front.trim() || !back.trim() || isSaving}
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
