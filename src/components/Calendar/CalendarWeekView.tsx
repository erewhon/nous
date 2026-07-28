import { useEffect, useMemo, useRef, useState } from "react";
import type { CalendarItem } from "./calendarSources";
import { CalendarItemPopover, type PopoverPos } from "./CalendarItemPopover";

/** The resolver window for a displayed week: Sunday through next Sunday. */
export function weekRange(anchor: Date): { start: Date; end: Date } {
  const start = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate() - anchor.getDay(),
  );
  const end = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + 7,
  );
  return { start, end };
}

const HOUR_PX = 48;
const MIN_SEGMENT_PX = HOUR_PX / 2; // 30 minutes of readable height
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

interface DaySegment {
  item: CalendarItem;
  /** Clipped to the day: minutes from the day's midnight. */
  startMin: number;
  endMin: number;
  col: number;
  cols: number;
}

/**
 * Clip timed items to one day and assign overlap columns: greedy leftmost
 * free sub-column in start order, then each overlap cluster shares its
 * member count so concurrent events split the column width evenly.
 */
export function layoutDaySegments(
  items: CalendarItem[],
  day: Date,
): DaySegment[] {
  const dayStartMs = day.getTime();
  const dayEndMs = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() + 1,
  ).getTime();

  const segments = items
    .filter(
      (item) =>
        !item.allDay &&
        // End exclusive at exact midnight, same rule as the month grid.
        (item.start.getTime() === item.end.getTime()
          ? item.start.getTime() >= dayStartMs && item.start.getTime() < dayEndMs
          : item.start.getTime() < dayEndMs && item.end.getTime() > dayStartMs),
    )
    .map((item) => {
      const startMs = Math.max(item.start.getTime(), dayStartMs);
      const endMs = Math.min(item.end.getTime(), dayEndMs);
      return {
        item,
        startMin: (startMs - dayStartMs) / 60_000,
        endMin: Math.max((endMs - dayStartMs) / 60_000, 0),
        col: 0,
        cols: 1,
      };
    })
    .sort(
      (a, b) =>
        a.startMin - b.startMin ||
        b.endMin - a.endMin ||
        a.item.title.localeCompare(b.item.title),
    );

  // Greedy column assignment. Overlap accounting uses each segment's
  // rendered extent (minimum height included) so visually touching events
  // still split the width.
  const renderedEnd = (seg: DaySegment) =>
    Math.max(seg.endMin, seg.startMin + MIN_SEGMENT_PX / (HOUR_PX / 60));
  const colEnds: number[] = [];
  let cluster: DaySegment[] = [];
  let clusterMaxEnd = -1;

  const closeCluster = () => {
    const cols = Math.max(...cluster.map((s) => s.col)) + 1;
    for (const seg of cluster) {
      seg.cols = cols;
    }
    cluster = [];
    colEnds.length = 0;
  };

  for (const seg of segments) {
    if (cluster.length > 0 && seg.startMin >= clusterMaxEnd) {
      closeCluster();
    }
    let col = colEnds.findIndex((end) => end <= seg.startMin);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(renderedEnd(seg));
    } else {
      colEnds[col] = renderedEnd(seg);
    }
    seg.col = col;
    cluster.push(seg);
    clusterMaxEnd = Math.max(clusterMaxEnd, renderedEnd(seg));
  }
  if (cluster.length > 0) {
    closeCluster();
  }

  return segments;
}

interface CalendarWeekViewProps {
  /** Any date inside the displayed week. */
  anchor: Date;
  onAnchorChange: (next: Date) => void;
  /** Resolved items covering at least weekRange(anchor). */
  items: CalendarItem[];
  /** sourceId → display name, for the detail popover. */
  sourceNames?: Record<string, string>;
  /** Navigate to the item's backing page; omit to hide the Open action. */
  onOpenItem?: (item: CalendarItem) => void;
}

export function CalendarWeekView({
  anchor,
  onAnchorChange,
  items,
  sourceNames,
  onOpenItem,
}: CalendarWeekViewProps) {
  const [detail, setDetail] = useState<
    { item: CalendarItem; pos: PopoverPos } | null
  >(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const days = useMemo(() => {
    const { start } = weekRange(anchor);
    return Array.from(
      { length: 7 },
      (_, i) =>
        new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
    );
  }, [anchor]);

  const allDayByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const day of days) {
      const dayStart = day.getTime();
      const dayEnd = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate() + 1,
      ).getTime();
      const dayItems = items.filter(
        (item) =>
          item.allDay &&
          item.start.getTime() < dayEnd &&
          item.end.getTime() > dayStart,
      );
      map.set(dayKey(day), dayItems);
    }
    return map;
  }, [days, items]);

  const segmentsByDay = useMemo(() => {
    const map = new Map<string, DaySegment[]>();
    for (const day of days) {
      map.set(dayKey(day), layoutDaySegments(items, day));
    }
    return map;
  }, [days, items]);

  // Tick each minute so the current-time line moves.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 7 * HOUR_PX;
    }
  }, []);

  const now = new Date();
  const label = `${days[0].toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} – ${days[6].toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  const openDetail = (item: CalendarItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setDetail({
      item,
      pos: {
        x: Math.min(e.clientX, window.innerWidth - 340),
        y: Math.min(e.clientY, window.innerHeight - 260),
      },
    });
  };

  const navigate = (deltaDays: number) => {
    onAnchorChange(
      new Date(
        anchor.getFullYear(),
        anchor.getMonth(),
        anchor.getDate() + deltaDays,
      ),
    );
  };

  return (
    <div className="flex flex-col h-full" data-testid="calendar-week-view">
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
          {label}
        </span>
        <div className="flex items-center gap-1">
          <button
            aria-label="Previous week"
            onClick={() => navigate(-7)}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            ‹
          </button>
          <button
            onClick={() => onAnchorChange(new Date())}
            className="px-2 py-1 text-xs rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Today
          </button>
          <button
            aria-label="Next week"
            onClick={() => navigate(7)}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            ›
          </button>
        </div>
      </div>

      {/* Day headers + all-day lane */}
      <div
        className="border-b"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="flex">
          <div className="w-12 flex-shrink-0" />
          {days.map((day) => (
            <div key={dayKey(day)} className="flex-1 text-center py-1">
              <span
                className="text-xs font-medium"
                style={{
                  color: isSameDay(day, now)
                    ? "var(--color-accent)"
                    : "var(--color-text-muted)",
                }}
              >
                {DAY_NAMES[day.getDay()]} {day.getDate()}
              </span>
            </div>
          ))}
        </div>
        <div className="flex" data-testid="all-day-lane">
          <div
            className="w-12 flex-shrink-0 text-[10px] text-right pr-1 pt-0.5"
            style={{ color: "var(--color-text-muted)" }}
          >
            all-day
          </div>
          {days.map((day) => {
            const key = dayKey(day);
            return (
              <div key={key} data-allday-date={key} className="flex-1 px-0.5 pb-1 space-y-0.5 min-h-[18px]">
                {(allDayByDay.get(key) ?? []).map((item) => (
                  <button
                    key={item.id}
                    data-item-id={item.id}
                    onClick={(e) => openDetail(item, e)}
                    className="block w-full text-left text-xs truncate rounded px-1"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${item.color} 18%, transparent)`,
                      color: item.color,
                    }}
                    title={item.title}
                  >
                    {item.title}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Hour grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex relative" style={{ height: 24 * HOUR_PX }}>
          {/* Hour gutter */}
          <div className="w-12 flex-shrink-0 relative">
            {Array.from({ length: 24 }, (_, hour) => (
              <div
                key={hour}
                className="absolute right-1 text-[10px]"
                style={{
                  top: hour * HOUR_PX - 6,
                  color: "var(--color-text-muted)",
                }}
              >
                {hour === 0 ? "" : `${hour}:00`}
              </div>
            ))}
          </div>
          {/* Day columns */}
          {days.map((day) => {
            const key = dayKey(day);
            const segments = segmentsByDay.get(key) ?? [];
            const showNowLine = isSameDay(day, now);
            return (
              <div
                key={key}
                data-day={key}
                className="flex-1 relative border-l"
                style={{ borderColor: "var(--color-border)" }}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <div
                    key={hour}
                    className="absolute w-full border-t"
                    style={{
                      top: hour * HOUR_PX,
                      borderColor: "var(--color-border)",
                      opacity: 0.5,
                    }}
                  />
                ))}
                {segments.map((seg) => {
                  const height = Math.max(
                    ((seg.endMin - seg.startMin) / 60) * HOUR_PX,
                    MIN_SEGMENT_PX,
                  );
                  const widthPct = 100 / seg.cols;
                  return (
                    <button
                      key={`${seg.item.id}:${seg.startMin}`}
                      data-item-id={seg.item.id}
                      data-col={seg.col}
                      data-overlap-cols={seg.cols}
                      onClick={(e) => openDetail(seg.item, e)}
                      className="absolute text-left text-[11px] leading-tight rounded px-1 py-0.5 overflow-hidden border"
                      style={{
                        top: (seg.startMin / 60) * HOUR_PX,
                        height,
                        left: `${seg.col * widthPct}%`,
                        width: `calc(${widthPct}% - 2px)`,
                        backgroundColor: `color-mix(in srgb, ${seg.item.color} 22%, var(--color-bg-primary))`,
                        borderColor: seg.item.color,
                        color: seg.item.color,
                      }}
                      title={seg.item.title}
                    >
                      {seg.item.title}
                    </button>
                  );
                })}
                {showNowLine && (
                  <div
                    data-testid="now-line"
                    className="absolute w-full pointer-events-none"
                    style={{
                      top:
                        ((now.getHours() * 60 + now.getMinutes()) / 60) *
                        HOUR_PX,
                      borderTop: "2px solid var(--color-error)",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

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
