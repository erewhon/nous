import { useCallback, useEffect, useState } from "react";
import type { Page } from "../../types/page";
import * as api from "../../utils/api";
import {
  parseCalendarConfig,
  type CalendarPageConfig,
} from "../../types/calendar";

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

interface CalendarPageProps {
  page: Page;
  notebookId: string;
  className?: string;
}

export function CalendarPage({ page, notebookId, className = "" }: CalendarPageProps) {
  const { config, isLoading, error } = useCalendarConfig(notebookId, page.id);

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
            {page.title}
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-muted)",
            }}
          >
            {config.sources.length}{" "}
            {config.sources.length === 1 ? "source" : "sources"}
          </span>
        </div>
      </div>

      {/* Body — month/week views land in follow-up tasks */}
      <div className="flex-1 flex items-center justify-center overflow-auto p-4">
        <div className="text-center max-w-md">
          <p className="mb-1" style={{ color: "var(--color-text-primary)" }}>
            {config.sources.length === 0
              ? "This calendar has no sources yet."
              : `${config.sources.length} source${
                  config.sources.length === 1 ? "" : "s"
                } configured.`}
          </p>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            Add databases with date properties or ICS calendars as sources to
            see them here.
          </p>
        </div>
      </div>
    </div>
  );
}
