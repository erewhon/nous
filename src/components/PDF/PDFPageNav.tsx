import { useState, useCallback } from "react";

interface PDFPageNavProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function PDFPageNav({
  currentPage,
  totalPages,
  onPageChange,
  className = "",
}: PDFPageNavProps) {
  const [inputValue, setInputValue] = useState(String(currentPage));
  const [isEditing, setIsEditing] = useState(false);

  const handlePrevious = useCallback(() => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  }, [currentPage, onPageChange]);

  const handleNext = useCallback(() => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  }, [currentPage, totalPages, onPageChange]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(e.target.value);
    },
    []
  );

  const handleInputBlur = useCallback(() => {
    setIsEditing(false);
    const page = parseInt(inputValue, 10);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
      onPageChange(page);
    } else {
      setInputValue(String(currentPage));
    }
  }, [inputValue, totalPages, currentPage, onPageChange]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        handleInputBlur();
      } else if (e.key === "Escape") {
        setIsEditing(false);
        setInputValue(String(currentPage));
      }
    },
    [handleInputBlur, currentPage]
  );

  // Update input value when currentPage changes externally
  if (!isEditing && inputValue !== String(currentPage)) {
    setInputValue(String(currentPage));
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Previous button */}
      <button
        onClick={handlePrevious}
        disabled={currentPage <= 1}
        className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
          color: "var(--color-text-secondary)",
        }}
        title="Previous page"
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
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      {/* Page input */}
      <div className="flex items-center gap-1">
        {isEditing ? (
          <input
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKeyDown}
            autoFocus
            className="w-12 rounded border px-2 py-1 text-center text-sm"
            style={{
              backgroundColor: "var(--color-bg-primary)",
              borderColor: "var(--color-accent)",
              color: "var(--color-text-primary)",
            }}
          />
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className="rounded px-2 py-1 text-sm transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-secondary)" }}
            title="Click to go to page"
          >
            {currentPage}
          </button>
        )}
        <span
          className="text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          / {totalPages}
        </span>
      </div>

      {/* Next button */}
      <button
        onClick={handleNext}
        disabled={currentPage >= totalPages}
        className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
          color: "var(--color-text-secondary)",
        }}
        title="Next page"
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
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}
