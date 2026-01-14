import { useState, useRef, useEffect } from "react";
import type { Notebook } from "../../types/notebook";

interface NotebookDropdownProps {
  notebooks: Notebook[];
  selectedNotebook: Notebook | null;
  onSelectNotebook: (id: string) => void;
  onGoToOverview: () => void;
}

export function NotebookDropdown({
  notebooks,
  selectedNotebook,
  onSelectNotebook,
  onGoToOverview,
}: NotebookDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Close dropdown on escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const accentColor = selectedNotebook?.color || "var(--color-accent)";

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-[--color-bg-tertiary]"
        style={{ backgroundColor: isOpen ? "var(--color-bg-tertiary)" : undefined }}
      >
        {/* Notebook icon with color */}
        <div
          className="flex h-6 w-6 items-center justify-center rounded"
          style={{ backgroundColor: accentColor }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
          </svg>
        </div>

        {/* Notebook name */}
        <span
          className="max-w-[180px] truncate text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          {selectedNotebook?.name || "Select Notebook"}
        </span>

        {/* Chevron */}
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
          className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
          style={{ color: "var(--color-text-muted)" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border shadow-xl"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          {/* Go to overview option */}
          <button
            onClick={() => {
              onGoToOverview();
              setIsOpen(false);
            }}
            className="flex w-full items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[--color-bg-tertiary]"
          >
            <div
              className="flex h-6 w-6 items-center justify-center rounded"
              style={{ backgroundColor: "var(--color-bg-elevated)" }}
            >
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
                style={{ color: "var(--color-text-secondary)" }}
              >
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            </div>
            <span
              className="text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              All Notebooks
            </span>
          </button>

          {/* Divider */}
          <div
            className="my-1 h-px"
            style={{ backgroundColor: "var(--color-border)" }}
          />

          {/* Notebook list */}
          <div className="max-h-64 overflow-y-auto py-1">
            {notebooks.map((notebook) => {
              const isSelected = notebook.id === selectedNotebook?.id;
              const notebookColor = notebook.color || "var(--color-accent)";
              return (
                <button
                  key={notebook.id}
                  onClick={() => {
                    onSelectNotebook(notebook.id);
                    setIsOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2 transition-colors hover:bg-[--color-bg-tertiary]"
                  style={{
                    backgroundColor: isSelected ? "var(--color-bg-tertiary)" : undefined,
                  }}
                >
                  <div
                    className="flex h-6 w-6 items-center justify-center rounded"
                    style={{ backgroundColor: notebookColor }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
                    </svg>
                  </div>
                  <span
                    className="flex-1 truncate text-left text-sm"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    {notebook.name}
                  </span>
                  {isSelected && (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ color: "var(--color-accent)" }}
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
