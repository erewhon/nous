import { useMemo, useState } from "react";
import type { CalendarItem } from "./calendarSources";
import { CalendarItemPopover, type PopoverPos } from "./CalendarItemPopover";

/**
 * The resolver window for a displayed month: the calendar grid padded to
 * full Sunday-to-Saturday weeks. CalendarPage feeds this to the resolvers so
 * leading/trailing adjacent-month days show their items too.
 */
export function monthGridRange(month: Date): { start: Date; end: Date } {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(
    first.getFullYear(),
    first.getMonth(),
    1 - first.getDay(),
  );
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const end = new Date(
    last.getFullYear(),
    last.getMonth(),
    last.getDate() + (6 - last.getDay()),
    23,
    59,
    59,
    999,
  );
  return { start, end };
}

function dayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 3;

interface CalendarMonthViewProps {
  /** Any date inside the displayed month. */
  month: Date;
  onMonthChange: (next: Date) => void;
  /** Resolved items covering at least monthGridRange(month). */
  items: CalendarItem[];
  /** sourceId → display name, for the detail popover. */
  sourceNames?: Record<string, string>;
  /** Navigate to the item's backing page; omit to hide the Open action. */
  onOpenItem?: (item: CalendarItem) => void;
  /** Click on a day cell's empty area (item chips stop propagation). */
  onDayClick?: (day: Date) => void;
}

export function CalendarMonthView({
  month,
  onMonthChange,
  items,
  sourceNames,
  onOpenItem,
  onDayClick,
}: CalendarMonthViewProps) {
  const [detail, setDetail] = useState<
    { item: CalendarItem; pos: PopoverPos } | null
  >(null);
  const [dayList, setDayList] = useState<{ key: string; pos: PopoverPos } | null>(
    null,
  );

  const days = useMemo(() => {
    const { start, end } = monthGridRange(month);
    const result: Date[] = [];
    for (
      let d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      d <= end;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    ) {
      result.push(d);
    }
    return result;
  }, [month]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const day of days) {
      const dayStart = day;
      const dayEnd = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        23,
        59,
        59,
        999,
      );
      // End is exclusive at exact midnight (ICS all-day events end at the
      // next day's 00:00) — strict comparison keeps them off the next day.
      const dayItems = items.filter((item) =>
        item.start.getTime() === item.end.getTime()
          ? item.start >= dayStart && item.start <= dayEnd
          : item.start <= dayEnd && item.end > dayStart,
      );
      if (dayItems.length > 0) {
        map.set(dayKey(day), dayItems);
      }
    }
    return map;
  }, [days, items]);

  const today = new Date();

  const openDetail = (item: CalendarItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setDayList(null);
    setDetail({
      item,
      pos: {
        x: Math.min(e.clientX, window.innerWidth - 340),
        y: Math.min(e.clientY, window.innerHeight - 260),
      },
    });
  };

  const navigate = (delta: number) => {
    onMonthChange(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <span
          className="text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          {month.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </span>
        <div className="flex items-center gap-1">
          <button
            aria-label="Previous month"
            onClick={() => navigate(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            ‹
          </button>
          <button
            onClick={() =>
              onMonthChange(
                new Date(today.getFullYear(), today.getMonth(), 1),
              )
            }
            className="px-2 py-1 text-xs rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Today
          </button>
          <button
            aria-label="Next month"
            onClick={() => navigate(1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            ›
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto p-3">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAY_NAMES.map((name) => (
            <div
              key={name}
              className="text-center text-xs font-medium py-1"
              style={{ color: "var(--color-text-muted)" }}
            >
              {name}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((day) => {
            const key = dayKey(day);
            const dayItems = itemsByDay.get(key) ?? [];
            const inMonth = day.getMonth() === month.getMonth();
            const isToday = isSameDay(day, today);
            return (
              <div
                key={key}
                data-date={key}
                onClick={() => onDayClick?.(day)}
                className="min-h-[96px] rounded-lg p-1.5 border"
                style={{
                  backgroundColor: inMonth
                    ? "var(--color-bg-primary)"
                    : "var(--color-bg-secondary)",
                  borderColor: "var(--color-border)",
                  opacity: inMonth ? 1 : 0.55,
                }}
              >
                <div
                  className={`text-xs font-medium mb-1 ${
                    isToday
                      ? "bg-[--color-accent] text-white w-5 h-5 rounded-full flex items-center justify-center"
                      : ""
                  }`}
                  style={{
                    color: isToday ? undefined : "var(--color-text-primary)",
                  }}
                >
                  {day.getDate()}
                </div>
                <div className="space-y-0.5">
                  {dayItems.slice(0, MAX_CHIPS).map((item) => (
                    <button
                      key={item.id}
                      data-item-id={item.id}
                      onClick={(e) => openDetail(item, e)}
                      className="block w-full text-left text-xs truncate rounded px-1 py-0.5"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${item.color} 18%, transparent)`,
                        color: item.color,
                      }}
                      title={item.title}
                    >
                      {item.title}
                    </button>
                  ))}
                  {dayItems.length > MAX_CHIPS && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetail(null);
                        setDayList({
                          key,
                          pos: {
                            x: Math.min(e.clientX, window.innerWidth - 300),
                            y: Math.min(e.clientY, window.innerHeight - 320),
                          },
                        });
                      }}
                      className="text-xs px-1"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      +{dayItems.length - MAX_CHIPS} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Day-overflow popover */}
      {dayList && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setDayList(null)}
          />
          <div
            className="fixed z-50 w-64 max-h-72 overflow-y-auto rounded-lg border p-2 shadow-lg"
            style={{
              left: dayList.pos.x,
              top: dayList.pos.y,
              backgroundColor: "var(--color-bg-primary)",
              borderColor: "var(--color-border)",
            }}
          >
            <div
              className="text-xs font-medium mb-1"
              style={{ color: "var(--color-text-muted)" }}
            >
              {dayList.key}
            </div>
            <div className="space-y-0.5">
              {(itemsByDay.get(dayList.key) ?? []).map((item) => (
                <button
                  key={item.id}
                  data-item-id={item.id}
                  onClick={(e) => openDetail(item, e)}
                  className="block w-full text-left text-xs truncate rounded px-1 py-0.5"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${item.color} 18%, transparent)`,
                    color: item.color,
                  }}
                >
                  {item.title}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Item detail popover */}
      {detail && (
        <CalendarItemPopover
          item={detail.item}
          pos={detail.pos}
          sourceName={sourceNames?.[detail.item.sourceId]}
          onOpenItem={onOpenItem}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
