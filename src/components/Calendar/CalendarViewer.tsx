import { useState, useEffect, useMemo, useCallback } from "react";
import ICAL from "ical.js";
import type { Page } from "../../types/page";
import { useLinkedFileSync } from "../../hooks/useLinkedFileSync";
import { LinkedFileChangedBanner } from "../LinkedFile";
import * as api from "../../utils/api";
import { useThemeStore } from "../../stores/themeStore";

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  isAllDay: boolean;
  recurrence?: string;
}

interface CalendarViewerProps {
  page: Page;
  notebookId: string;
  className?: string;
}

type ViewMode = "list" | "month";

export function CalendarViewer({ page, notebookId, className = "" }: CalendarViewerProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendarName, setCalendarName] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [isReloading, setIsReloading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const resolvedMode = useThemeStore((state) => state.resolvedMode);
  const isDark = resolvedMode === "dark";

  // Linked file sync detection
  const { isModified, dismiss, markSynced } = useLinkedFileSync(page, notebookId);

  // Reload the calendar file
  const handleReload = useCallback(async () => {
    setIsReloading(true);
    try {
      // Mark the file as synced
      await api.markLinkedFileSynced(notebookId, page.id);
      markSynced();
      // Force reload
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("Failed to reload calendar:", err);
    } finally {
      setIsReloading(false);
    }
  }, [notebookId, page.id, markSynced]);

  // Load and parse ICS file
  useEffect(() => {
    const loadCalendar = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await api.getFileContent(notebookId, page.id);
        const jcalData = ICAL.parse(result.content);
        const comp = new ICAL.Component(jcalData);

        // Get calendar name
        const calName = comp.getFirstPropertyValue("x-wr-calname") as string | null;
        setCalendarName(calName || "Calendar");

        // Parse events
        const vevents = comp.getAllSubcomponents("vevent");
        const parsedEvents: CalendarEvent[] = vevents.map((vevent) => {
          const event = new ICAL.Event(vevent);
          const startDate = event.startDate.toJSDate();
          const endDate = event.endDate.toJSDate();

          // Check if it's an all-day event
          const isAllDay = event.startDate.isDate;

          // Get recurrence rule if present
          const rrule = vevent.getFirstPropertyValue("rrule") as ICAL.Recur | null;
          const recurrence = rrule ? formatRecurrence(rrule) : undefined;

          return {
            id: event.uid,
            summary: event.summary || "Untitled Event",
            description: event.description || undefined,
            location: event.location || undefined,
            startDate,
            endDate,
            isAllDay,
            recurrence,
          };
        });

        // Sort by start date
        parsedEvents.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
        setEvents(parsedEvents);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load calendar");
        console.error("Failed to load calendar:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadCalendar();
  }, [notebookId, page.id, reloadKey]);

  // Filter events for selected month in month view
  const filteredEvents = useMemo(() => {
    if (viewMode === "list") {
      return events;
    }

    const monthStart = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1);
    const monthEnd = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0);

    return events.filter((event) => {
      return event.startDate <= monthEnd && event.endDate >= monthStart;
    });
  }, [events, viewMode, selectedMonth]);

  // Group events by date for list view
  const groupedEvents = useMemo(() => {
    const groups: Map<string, CalendarEvent[]> = new Map();

    filteredEvents.forEach((event) => {
      const dateKey = event.startDate.toDateString();
      const existing = groups.get(dateKey) || [];
      groups.set(dateKey, [...existing, event]);
    });

    return Array.from(groups.entries()).map(([date, events]) => ({
      date: new Date(date),
      events,
    }));
  }, [filteredEvents]);

  const navigateMonth = (delta: number) => {
    setSelectedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="flex items-center gap-2">
          <svg
            className="h-5 w-5 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span style={{ color: "var(--color-text-muted)" }}>Loading calendar...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-error)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto mb-2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p style={{ color: "var(--color-error)" }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Linked file changed banner */}
      {isModified && (
        <LinkedFileChangedBanner
          onReload={handleReload}
          onDismiss={dismiss}
          isReloading={isReloading}
          fileName={page.title}
        />
      )}

      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="flex items-center gap-2">
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
            style={{ color: "var(--color-accent)" }}
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            {calendarName || page.title}
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-muted)",
            }}
          >
            {events.length} events
          </span>
        </div>

        {/* View mode toggle */}
        <div
          className="flex rounded-lg overflow-hidden border"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={() => setViewMode("list")}
            className="px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              backgroundColor: viewMode === "list" ? "var(--color-accent)" : "transparent",
              color: viewMode === "list" ? "white" : "var(--color-text-secondary)",
            }}
          >
            List
          </button>
          <button
            onClick={() => setViewMode("month")}
            className="px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              backgroundColor: viewMode === "month" ? "var(--color-accent)" : "transparent",
              color: viewMode === "month" ? "white" : "var(--color-text-secondary)",
            }}
          >
            Month
          </button>
        </div>
      </div>

      {/* Month navigation (for month view) */}
      {viewMode === "month" && (
        <div
          className="flex items-center justify-between px-4 py-2 border-b"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          <button
            onClick={() => navigateMonth(-1)}
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
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            {selectedMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </span>
          <button
            onClick={() => navigateMonth(1)}
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
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      )}

      {/* Content */}
      <div
        className="flex-1 overflow-auto p-4"
        style={{ backgroundColor: isDark ? "#1a1a1a" : "#fafafa" }}
      >
        {viewMode === "list" ? (
          <ListView groupedEvents={groupedEvents} isDark={isDark} />
        ) : (
          <MonthView
            events={filteredEvents}
            selectedMonth={selectedMonth}
            isDark={isDark}
          />
        )}
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between px-4 py-2 border-t text-xs"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
          color: "var(--color-text-muted)",
        }}
      >
        <span>ICS Calendar</span>
        {page.storageMode === "linked" && page.sourceFile && (
          <span className="truncate max-w-[300px]" title={page.sourceFile}>
            {page.sourceFile}
          </span>
        )}
      </div>
    </div>
  );
}

interface ListViewProps {
  groupedEvents: { date: Date; events: CalendarEvent[] }[];
  isDark: boolean;
}

function ListView({ groupedEvents, isDark }: ListViewProps) {
  if (groupedEvents.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p style={{ color: "var(--color-text-muted)" }}>No events found</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {groupedEvents.map(({ date, events }) => (
        <div key={date.toISOString()}>
          <h3
            className="text-sm font-semibold mb-2 sticky top-0 py-1"
            style={{
              color: "var(--color-text-primary)",
              backgroundColor: isDark ? "#1a1a1a" : "#fafafa",
            }}
          >
            {formatDateHeader(date)}
          </h3>
          <div className="space-y-2">
            {events.map((event) => (
              <EventCard key={event.id} event={event} isDark={isDark} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface MonthViewProps {
  events: CalendarEvent[];
  selectedMonth: Date;
  isDark: boolean;
}

function MonthView({ events, selectedMonth, isDark }: MonthViewProps) {
  const days = useMemo(() => {
    const year = selectedMonth.getFullYear();
    const month = selectedMonth.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const startOffset = firstDay.getDay();
    const totalDays = lastDay.getDate();

    const daysArray: (Date | null)[] = [];

    // Add empty slots for days before the first of the month
    for (let i = 0; i < startOffset; i++) {
      daysArray.push(null);
    }

    // Add days of the month
    for (let i = 1; i <= totalDays; i++) {
      daysArray.push(new Date(year, month, i));
    }

    return daysArray;
  }, [selectedMonth]);

  const getEventsForDay = (date: Date): CalendarEvent[] => {
    return events.filter((event) => {
      const eventDate = event.startDate;
      return (
        eventDate.getFullYear() === date.getFullYear() &&
        eventDate.getMonth() === date.getMonth() &&
        eventDate.getDate() === date.getDate()
      );
    });
  };

  const today = new Date();
  const isToday = (date: Date) =>
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  return (
    <div className="max-w-4xl mx-auto">
      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div
            key={day}
            className="text-center text-xs font-medium py-2"
            style={{ color: "var(--color-text-muted)" }}
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((date, index) => (
          <div
            key={index}
            className="min-h-[100px] rounded-lg p-2"
            style={{
              backgroundColor: date
                ? isDark
                  ? "#262626"
                  : "#ffffff"
                : "transparent",
              border: date ? `1px solid ${isDark ? "#333" : "#e5e5e5"}` : "none",
            }}
          >
            {date && (
              <>
                <div
                  className={`text-sm font-medium mb-1 ${
                    isToday(date)
                      ? "bg-[--color-accent] text-white w-6 h-6 rounded-full flex items-center justify-center"
                      : ""
                  }`}
                  style={{ color: isToday(date) ? undefined : "var(--color-text-primary)" }}
                >
                  {date.getDate()}
                </div>
                <div className="space-y-1">
                  {getEventsForDay(date)
                    .slice(0, 3)
                    .map((event) => (
                      <div
                        key={event.id}
                        className="text-xs truncate rounded px-1 py-0.5"
                        style={{
                          backgroundColor: "var(--color-accent-subtle)",
                          color: "var(--color-accent)",
                        }}
                        title={event.summary}
                      >
                        {event.summary}
                      </div>
                    ))}
                  {getEventsForDay(date).length > 3 && (
                    <div
                      className="text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      +{getEventsForDay(date).length - 3} more
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface EventCardProps {
  event: CalendarEvent;
  isDark: boolean;
}

function EventCard({ event, isDark }: EventCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className="rounded-lg border p-3 cursor-pointer transition-colors"
      style={{
        backgroundColor: isDark ? "#262626" : "#ffffff",
        borderColor: isDark ? "#333" : "#e5e5e5",
      }}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h4
            className="text-sm font-medium truncate"
            style={{ color: "var(--color-text-primary)" }}
          >
            {event.summary}
          </h4>
          <p
            className="text-xs mt-0.5"
            style={{ color: "var(--color-text-muted)" }}
          >
            {event.isAllDay
              ? "All day"
              : `${formatTime(event.startDate)} - ${formatTime(event.endDate)}`}
          </p>
        </div>
        {event.recurrence && (
          <span
            className="text-xs px-1.5 py-0.5 rounded ml-2 flex-shrink-0"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-muted)",
            }}
          >
            {event.recurrence}
          </span>
        )}
      </div>

      {isExpanded && (
        <div className="mt-2 pt-2 border-t" style={{ borderColor: isDark ? "#333" : "#e5e5e5" }}>
          {event.location && (
            <div className="flex items-center gap-1 text-xs mb-1">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ color: "var(--color-text-muted)" }}
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span style={{ color: "var(--color-text-secondary)" }}>{event.location}</span>
            </div>
          )}
          {event.description && (
            <p
              className="text-xs whitespace-pre-wrap"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {event.description}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Helper functions
function formatDateHeader(date: Date): string {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) {
    return "Today";
  }
  if (date.toDateString() === tomorrow.toDateString()) {
    return "Tomorrow";
  }

  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRecurrence(rrule: ICAL.Recur): string {
  const freq = rrule.freq?.toLowerCase();
  const interval = rrule.interval || 1;

  if (interval === 1) {
    switch (freq) {
      case "daily":
        return "Daily";
      case "weekly":
        return "Weekly";
      case "monthly":
        return "Monthly";
      case "yearly":
        return "Yearly";
      default:
        return "Repeats";
    }
  }

  switch (freq) {
    case "daily":
      return `Every ${interval} days`;
    case "weekly":
      return `Every ${interval} weeks`;
    case "monthly":
      return `Every ${interval} months`;
    case "yearly":
      return `Every ${interval} years`;
    default:
      return "Repeats";
  }
}
