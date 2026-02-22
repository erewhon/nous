import { useEffect, useRef } from "react";

interface PageSearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  currentIndex: number;
  totalCount: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

export function PageSearchBar({
  query,
  onQueryChange,
  currentIndex,
  totalCount,
  onNext,
  onPrevious,
  onClose,
}: PageSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount and select text if pre-filled
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current.value) {
        inputRef.current.select();
      }
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        onPrevious();
      } else {
        onNext();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const noResults = query.length > 0 && totalCount === 0;

  return (
    <div className="page-search-bar">
      <div className="page-search-bar__icon">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>
      <input
        ref={inputRef}
        type="text"
        className="page-search-bar__input"
        style={noResults ? { borderColor: "rgba(239, 68, 68, 0.5)" } : undefined}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in page..."
        spellCheck={false}
        autoComplete="off"
      />
      <span className="page-search-bar__count">
        {query
          ? totalCount > 0
            ? `${currentIndex + 1} of ${totalCount}`
            : "0 results"
          : ""}
      </span>
      <button
        className="page-search-bar__btn"
        onClick={onPrevious}
        disabled={totalCount === 0}
        title="Previous match (Shift+Enter)"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
      <button
        className="page-search-bar__btn"
        onClick={onNext}
        disabled={totalCount === 0}
        title="Next match (Enter)"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <button
        className="page-search-bar__btn"
        onClick={onClose}
        title="Close (Escape)"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
