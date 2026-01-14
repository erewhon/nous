import { useState, useEffect } from "react";
import type { Section } from "../../types/page";
import { InlineColorPicker } from "../ColorPicker/ColorPicker";

interface SectionSettingsDialogProps {
  isOpen: boolean;
  section: Section | null; // null for creating new
  sections: Section[]; // other sections for move-to dropdown
  onClose: () => void;
  onSave: (updates: { name?: string; color?: string | null }) => Promise<void>;
  onDelete?: (moveItemsTo?: string) => Promise<void>;
}

export function SectionSettingsDialog({
  isOpen,
  section,
  sections,
  onClose,
  onSave,
  onDelete,
}: SectionSettingsDialogProps) {
  const [name, setName] = useState(section?.name || "");
  const [color, setColor] = useState<string | undefined>(section?.color);
  const [isDeleting, setIsDeleting] = useState(false);
  const [moveItemsTo, setMoveItemsTo] = useState<string>("root");
  const [isSaving, setIsSaving] = useState(false);

  const isCreating = section === null;
  const otherSections = sections.filter((s) => s.id !== section?.id);

  // Reset state when dialog opens/closes or section changes
  useEffect(() => {
    if (isOpen) {
      setName(section?.name || "");
      setColor(section?.color);
      setIsDeleting(false);
      setMoveItemsTo("root");
      setIsSaving(false);
    }
  }, [isOpen, section]);

  const handleSave = async () => {
    if (!name.trim()) return;

    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        color: color || null,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;

    setIsSaving(true);
    try {
      await onDelete(moveItemsTo === "root" ? undefined : moveItemsTo);
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
            {isCreating ? "Create Section" : "Edit Section"}
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
              What should happen to folders and pages in this section?
            </p>

            <div className="space-y-2">
              <label
                className="block text-sm font-medium"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Move items to:
              </label>
              <select
                value={moveItemsTo}
                onChange={(e) => setMoveItemsTo(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              >
                <option value="root">No section (root level)</option>
                {otherSections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

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
                {isSaving ? "Deleting..." : "Delete Section"}
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
                placeholder="Section name..."
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
                autoFocus
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
