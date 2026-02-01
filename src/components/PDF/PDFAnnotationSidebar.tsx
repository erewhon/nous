import { useState, useCallback } from "react";
import type { PDFHighlight } from "../../types/pdf";
import { HIGHLIGHT_COLORS } from "../../types/pdf";

interface PDFAnnotationSidebarProps {
  highlights: PDFHighlight[];
  selectedHighlightId: string | null;
  onSelectHighlight: (id: string | null) => void;
  onUpdateHighlight: (id: string, updates: Partial<PDFHighlight>) => void;
  onDeleteHighlight: (id: string) => void;
  onGoToPage: (page: number) => void;
}

export function PDFAnnotationSidebar({
  highlights,
  selectedHighlightId,
  onSelectHighlight,
  onUpdateHighlight,
  onDeleteHighlight,
  onGoToPage,
}: PDFAnnotationSidebarProps) {
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteValue, setNoteValue] = useState("");

  // Group highlights by page
  const highlightsByPage = highlights.reduce(
    (acc, h) => {
      (acc[h.pageNumber] ||= []).push(h);
      return acc;
    },
    {} as Record<number, PDFHighlight[]>
  );

  const handleStartEditNote = useCallback(
    (highlight: PDFHighlight) => {
      setEditingNoteId(highlight.id);
      setNoteValue(highlight.note || "");
    },
    []
  );

  const handleSaveNote = useCallback(
    (id: string) => {
      onUpdateHighlight(id, { note: noteValue.trim() || undefined });
      setEditingNoteId(null);
      setNoteValue("");
    },
    [noteValue, onUpdateHighlight]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingNoteId(null);
    setNoteValue("");
  }, []);

  const handleChangeColor = useCallback(
    (id: string, color: string) => {
      onUpdateHighlight(id, { color });
    },
    [onUpdateHighlight]
  );

  if (highlights.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: "var(--color-text-muted)" }}
          className="mb-3"
        >
          <path d="m9 11-6 6v3h9l3-3" />
          <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
        </svg>
        <p
          className="text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          No highlights yet
        </p>
        <p
          className="mt-1 text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          Enable annotation mode and select text to create highlights
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        <h3
          className="text-sm font-semibold"
          style={{ color: "var(--color-text-primary)" }}
        >
          Highlights ({highlights.length})
        </h3>
      </div>

      {/* Highlight list */}
      <div className="flex-1 overflow-y-auto">
        {Object.entries(highlightsByPage)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([pageNum, pageHighlights]) => (
            <div key={pageNum}>
              {/* Page header */}
              <button
                onClick={() => onGoToPage(Number(pageNum))}
                className="sticky top-0 w-full px-4 py-2 text-left text-xs font-medium transition-colors hover:bg-[--color-bg-tertiary]"
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  color: "var(--color-text-muted)",
                }}
              >
                Page {pageNum}
              </button>

              {/* Highlights on this page */}
              {pageHighlights.map((highlight) => (
                <div
                  key={highlight.id}
                  className={`border-b p-3 transition-colors cursor-pointer ${
                    selectedHighlightId === highlight.id
                      ? "bg-[--color-bg-tertiary]"
                      : "hover:bg-[--color-bg-secondary]"
                  }`}
                  style={{ borderColor: "var(--color-border)" }}
                  onClick={() => {
                    onSelectHighlight(highlight.id);
                    onGoToPage(highlight.pageNumber);
                  }}
                >
                  {/* Color indicator and text */}
                  <div className="flex gap-2">
                    <div
                      className="mt-1 h-3 w-3 flex-shrink-0 rounded"
                      style={{ backgroundColor: highlight.color }}
                    />
                    <p
                      className="text-sm line-clamp-3"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      "{highlight.selectedText}"
                    </p>
                  </div>

                  {/* Note */}
                  {editingNoteId === highlight.id ? (
                    <div className="mt-2 ml-5">
                      <textarea
                        value={noteValue}
                        onChange={(e) => setNoteValue(e.target.value)}
                        autoFocus
                        placeholder="Add a note..."
                        className="w-full rounded border p-2 text-sm resize-none"
                        style={{
                          backgroundColor: "var(--color-bg-primary)",
                          borderColor: "var(--color-border)",
                          color: "var(--color-text-primary)",
                        }}
                        rows={3}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSaveNote(highlight.id);
                          }}
                          className="rounded px-3 py-1 text-xs font-medium text-white"
                          style={{ backgroundColor: "var(--color-accent)" }}
                        >
                          Save
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCancelEdit();
                          }}
                          className="rounded px-3 py-1 text-xs"
                          style={{
                            backgroundColor: "var(--color-bg-tertiary)",
                            color: "var(--color-text-secondary)",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : highlight.note ? (
                    <p
                      className="mt-2 ml-5 text-xs italic"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {highlight.note}
                    </p>
                  ) : null}

                  {/* Actions */}
                  {selectedHighlightId === highlight.id && (
                    <div
                      className="mt-3 ml-5 flex items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Color picker */}
                      <div className="flex gap-1">
                        {HIGHLIGHT_COLORS.map((color) => (
                          <button
                            key={color.value}
                            onClick={() =>
                              handleChangeColor(highlight.id, color.value)
                            }
                            className={`h-5 w-5 rounded-full transition-transform ${
                              highlight.color === color.value
                                ? "ring-2 ring-offset-1 scale-110"
                                : "hover:scale-110"
                            }`}
                            style={{
                              backgroundColor: color.value,
                            }}
                            title={color.name}
                          />
                        ))}
                      </div>

                      {/* Edit note button */}
                      <button
                        onClick={() => handleStartEditNote(highlight)}
                        className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-[--color-bg-secondary]"
                        style={{ color: "var(--color-text-muted)" }}
                        title={highlight.note ? "Edit note" : "Add note"}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                        </svg>
                        {highlight.note ? "Edit" : "Note"}
                      </button>

                      {/* Delete button */}
                      <button
                        onClick={() => onDeleteHighlight(highlight.id)}
                        className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-red-500/10"
                        style={{ color: "var(--color-error)" }}
                        title="Delete highlight"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M3 6h18" />
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                        </svg>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}
