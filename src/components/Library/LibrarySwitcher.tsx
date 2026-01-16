/**
 * LibrarySwitcher component
 *
 * Dropdown in sidebar for switching between libraries.
 */

import { useState, useRef, useEffect } from "react";
import { useLibraryStore } from "../../stores/libraryStore";
import type { Library } from "../../types/library";

interface LibrarySwitcherProps {
  onManageLibraries?: () => void;
}

export function LibrarySwitcher({ onManageLibraries }: LibrarySwitcherProps) {
  const { libraries, currentLibrary, switchLibrary, fetchLibraries, fetchCurrentLibrary } =
    useLibraryStore();
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch libraries on mount
  useEffect(() => {
    fetchLibraries();
    fetchCurrentLibrary();
  }, [fetchLibraries, fetchCurrentLibrary]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSwitchLibrary = async (library: Library) => {
    if (library.id === currentLibrary?.id) {
      setIsOpen(false);
      return;
    }

    setIsSwitching(true);
    try {
      await switchLibrary(library.id);
      // Reload notebooks after switching library
      window.location.reload();
    } catch (error) {
      console.error("Failed to switch library:", error);
    } finally {
      setIsSwitching(false);
      setIsOpen(false);
    }
  };

  if (!currentLibrary) {
    return null;
  }

  return (
    <div className="relative px-4 pb-2" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isSwitching}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[--color-bg-tertiary]"
        style={{ color: "var(--color-text-secondary)" }}
      >
        <span className="text-base">{currentLibrary.icon || "📚"}</span>
        <span className="flex-1 truncate font-medium">{currentLibrary.name}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute left-4 right-4 z-50 mt-1 rounded-md border shadow-lg"
          style={{
            backgroundColor: "var(--color-bg-primary)",
            borderColor: "var(--color-border)",
          }}
        >
          <div className="py-1">
            {libraries.map((library) => (
              <button
                key={library.id}
                onClick={() => handleSwitchLibrary(library)}
                disabled={isSwitching}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                style={{
                  color:
                    library.id === currentLibrary?.id
                      ? "var(--color-accent)"
                      : "var(--color-text-primary)",
                }}
              >
                <span className="text-base">{library.icon || "📚"}</span>
                <span className="flex-1 truncate">{library.name}</span>
                {library.id === currentLibrary?.id && (
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
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                {library.isDefault && library.id !== currentLibrary?.id && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: "var(--color-bg-tertiary)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    Default
                  </span>
                )}
              </button>
            ))}
          </div>

          {onManageLibraries && (
            <>
              <div
                className="border-t"
                style={{ borderColor: "var(--color-border)" }}
              />
              <div className="py-1">
                <button
                  onClick={() => {
                    setIsOpen(false);
                    onManageLibraries();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                  style={{ color: "var(--color-text-muted)" }}
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
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  <span>Manage Libraries...</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
