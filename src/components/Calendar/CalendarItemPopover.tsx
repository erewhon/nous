import type { CalendarItem } from "./calendarSources";

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatItemTime(item: CalendarItem): string {
  if (item.allDay) {
    return isSameDay(item.start, item.end)
      ? "All day"
      : `All day · ${item.start.toLocaleDateString()} – ${item.end.toLocaleDateString()}`;
  }
  if (item.start.getTime() === item.end.getTime()) {
    return `${item.start.toLocaleDateString()} ${formatTime(item.start)}`;
  }
  return `${item.start.toLocaleDateString()} ${formatTime(item.start)} – ${
    isSameDay(item.start, item.end) ? "" : `${item.end.toLocaleDateString()} `
  }${formatTime(item.end)}`;
}

export interface PopoverPos {
  x: number;
  y: number;
}

interface CalendarItemPopoverProps {
  item: CalendarItem;
  pos: PopoverPos;
  sourceName?: string;
  /** Navigate to the item's backing page; omit to hide the Open action. */
  onOpenItem?: (item: CalendarItem) => void;
  onClose: () => void;
}

/** Detail popover shared by the month and week views. */
export function CalendarItemPopover({
  item,
  pos,
  sourceName,
  onOpenItem,
  onClose,
}: CalendarItemPopoverProps) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 w-80 rounded-lg border p-3 shadow-lg"
        style={{
          left: pos.x,
          top: pos.y,
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="flex items-start gap-2 mb-1">
          <span
            className="mt-1 h-2.5 w-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: item.color }}
          />
          <div className="min-w-0">
            <div
              className="text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              {item.title}
            </div>
            <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {formatItemTime(item)}
              {item.recurring ? " · Repeats" : ""}
            </div>
          </div>
        </div>
        {item.location && (
          <div
            className="text-xs mb-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            📍 {item.location}
          </div>
        )}
        {item.description && (
          <p
            className="text-xs whitespace-pre-wrap mb-1 max-h-32 overflow-y-auto"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {item.description}
          </p>
        )}
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {sourceName ?? ""}
          </span>
          {onOpenItem && item.pageId && (
            <button
              onClick={() => {
                onOpenItem(item);
                onClose();
              }}
              className="text-xs px-2 py-1 rounded"
              style={{ backgroundColor: "var(--color-accent)", color: "white" }}
            >
              Open
            </button>
          )}
        </div>
      </div>
    </>
  );
}
