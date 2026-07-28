import { useCallback, useEffect, useMemo, useState } from "react";
import type { Page } from "../../types/page";
import type { DatabaseContentV2 } from "../../types/database";
import * as api from "../../utils/api";
import { usePageStore } from "../../stores/pageStore";
import {
  parseCalendarConfig,
  type CalendarPageConfig,
  type CalendarSource,
} from "../../types/calendar";
import {
  resolveDatabaseSource,
  resolveIcsSource,
  sortCalendarItems,
  type CalendarItem,
} from "./calendarSources";
import { CalendarMonthView, monthGridRange } from "./CalendarMonthView";

/**
 * Loads and persists a calendar page's source config. The config is the
 * page's file content (JSON), written through the same file-content path
 * database pages use. Parse failures surface as errors — the file is never
 * overwritten in response.
 */
export function useCalendarConfig(notebookId: string, pageId: string) {
  const [config, setConfig] = useState<CalendarPageConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await api.getFileContent(notebookId, pageId);
        const parsed = parseCalendarConfig(result.content);
        if (!cancelled) {
          setConfig(parsed);
        }
      } catch (err) {
        if (!cancelled) {
          setConfig(null);
          setError(
            err instanceof Error ? err.message : "Failed to load calendar config",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [notebookId, pageId]);

  const saveConfig = useCallback(
    async (next: CalendarPageConfig) => {
      setConfig(next);
      await api.updateFileContent(notebookId, pageId, JSON.stringify(next, null, 2));
    },
    [notebookId, pageId],
  );

  return { config, isLoading, error, saveConfig };
}

interface SourceError {
  sourceId: string;
  message: string;
}

/**
 * Loads each configured source's raw data and resolves it to CalendarItems
 * for the window. Per-source failures degrade to error entries instead of
 * blanking the calendar. ICS subscriptions are skipped until the fetcher
 * lands (Forge: "Wire ICS subscription sources into calendar resolver").
 */
function useCalendarItems(
  notebookId: string,
  config: CalendarPageConfig | null,
  windowStartMs: number,
  windowEndMs: number,
) {
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [sourceErrors, setSourceErrors] = useState<SourceError[]>([]);
  const [skippedSubscriptions, setSkippedSubscriptions] = useState(0);

  useEffect(() => {
    if (!config) {
      setItems([]);
      setSourceErrors([]);
      setSkippedSubscriptions(0);
      return;
    }
    let cancelled = false;
    const windowStart = new Date(windowStartMs);
    const windowEnd = new Date(windowEndMs);

    const loadSource = async (
      source: CalendarSource,
    ): Promise<{ items: CalendarItem[]; error: SourceError | null; skipped: boolean }> => {
      try {
        if (source.type === "database") {
          const result = await api.getDatabase(notebookId, source.pageId);
          const content = result.database as DatabaseContentV2 | null;
          if (!content || !Array.isArray(content.rows)) {
            throw new Error("Database content unavailable");
          }
          return {
            items: resolveDatabaseSource(source, content, windowStart, windowEnd),
            error: null,
            skipped: false,
          };
        }
        if (source.type === "ics-file") {
          const result = await api.getFileContent(notebookId, source.pageId);
          return {
            items: resolveIcsSource(source, result.content, windowStart, windowEnd),
            error: null,
            skipped: false,
          };
        }
        return { items: [], error: null, skipped: true };
      } catch (err) {
        return {
          items: [],
          error: {
            sourceId: source.id,
            message: err instanceof Error ? err.message : "Failed to load source",
          },
          skipped: false,
        };
      }
    };

    (async () => {
      const results = await Promise.all(config.sources.map(loadSource));
      if (cancelled) {
        return;
      }
      setItems(sortCalendarItems(results.flatMap((r) => r.items)));
      setSourceErrors(
        results.flatMap((r) => (r.error ? [r.error] : [])),
      );
      setSkippedSubscriptions(results.filter((r) => r.skipped).length);
    })();

    return () => {
      cancelled = true;
    };
  }, [notebookId, config, windowStartMs, windowEndMs]);

  return { items, sourceErrors, skippedSubscriptions };
}

interface CalendarPageProps {
  page: Page;
  notebookId: string;
  className?: string;
}

export function CalendarPage({ page, notebookId, className = "" }: CalendarPageProps) {
  const { config, isLoading, error } = useCalendarConfig(notebookId, page.id);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const gridRange = useMemo(() => monthGridRange(month), [month]);
  const { items, sourceErrors, skippedSubscriptions } = useCalendarItems(
    notebookId,
    config,
    gridRange.start.getTime(),
    gridRange.end.getTime(),
  );

  const pages = usePageStore((s) => s.pages);
  const selectPage = usePageStore((s) => s.selectPage);

  const sourceNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const source of config?.sources ?? []) {
      if (source.type === "ics-subscription") {
        try {
          names[source.id] = new URL(source.url).host;
        } catch {
          names[source.id] = source.url;
        }
      } else {
        names[source.id] =
          pages.find((p) => p.id === source.pageId)?.title ?? "Unknown page";
      }
    }
    return names;
  }, [config, pages]);

  const handleOpenItem = useCallback(
    (item: CalendarItem) => {
      if (item.pageId) {
        selectPage(item.pageId);
      }
    },
    [selectPage],
  );

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <span style={{ color: "var(--color-text-muted)" }}>Loading calendar…</span>
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center max-w-md">
          <p className="font-medium mb-1" style={{ color: "var(--color-error)" }}>
            Couldn't read this calendar's configuration
          </p>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {error ?? "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
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
            className="text-sm font-medium truncate"
            style={{ color: "var(--color-text-primary)" }}
          >
            {page.title}
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-muted)",
            }}
          >
            {config.sources.length}{" "}
            {config.sources.length === 1 ? "source" : "sources"}
          </span>
          {sourceErrors.map((sourceError) => (
            <span
              key={sourceError.sourceId}
              className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
              title={sourceError.message}
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--color-error) 15%, transparent)",
                color: "var(--color-error)",
              }}
            >
              ⚠ {sourceNames[sourceError.sourceId] ?? sourceError.sourceId}
            </span>
          ))}
          {skippedSubscriptions > 0 && (
            <span
              className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
              title="ICS subscriptions load in an upcoming update"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-muted)",
              }}
            >
              {skippedSubscriptions} subscription
              {skippedSubscriptions === 1 ? "" : "s"} pending
            </span>
          )}
        </div>
      </div>

      {/* Empty-config hint */}
      {config.sources.length === 0 && (
        <div
          className="px-4 py-2 text-xs border-b"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          This calendar has no sources yet. Add databases with date properties
          or ICS calendars as sources to see them here.
        </div>
      )}

      {/* Month grid */}
      <div className="flex-1 overflow-hidden">
        <CalendarMonthView
          month={month}
          onMonthChange={setMonth}
          items={items}
          sourceNames={sourceNames}
          onOpenItem={handleOpenItem}
        />
      </div>
    </div>
  );
}
