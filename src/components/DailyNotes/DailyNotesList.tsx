import type { Page } from "../../types/page";

interface DailyNotesListProps {
  notes: Page[];
  selectedDate: string;
  onSelectNote: (note: Page) => void;
}

const MONTH_NAMES_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const monthIndex = parseInt(month, 10) - 1;
  return `${MONTH_NAMES_SHORT[monthIndex]} ${parseInt(day, 10)}, ${year}`;
}

function getRelativeDate(dateStr: string): string | null {
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  return null;
}

export function DailyNotesList({
  notes,
  selectedDate,
  onSelectNote,
}: DailyNotesListProps) {
  if (notes.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-8 text-center"
        style={{ color: "var(--color-text-muted)" }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mb-2 opacity-50"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <p className="text-sm">No daily notes yet</p>
        <p className="text-xs">Select a date to create one</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {notes.map((note) => {
        const dateStr = note.dailyNoteDate || "";
        const isSelected = dateStr === selectedDate;
        const relativeDate = getRelativeDate(dateStr);

        return (
          <button
            key={note.id}
            onClick={() => onSelectNote(note)}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-[--color-bg-tertiary]"
            style={{
              backgroundColor: isSelected ? "var(--color-bg-tertiary)" : undefined,
            }}
          >
            <div className="flex-1 min-w-0">
              <div
                className="truncate text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                {note.title}
              </div>
              <div
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {relativeDate ? (
                  <span
                    className="font-medium"
                    style={{
                      color: relativeDate === "Today" ? "var(--color-accent)" : undefined,
                    }}
                  >
                    {relativeDate}
                  </span>
                ) : (
                  formatDate(dateStr)
                )}
              </div>
            </div>
            {isSelected && (
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
                style={{ color: "var(--color-accent)" }}
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}
