import { useMemo, useState } from "react";
import * as api from "../../utils/api";
import { usePageStore } from "../../stores/pageStore";
import { generateId } from "../../utils/generateId";
import {
  BUILT_IN_OBJECT_TYPES,
  SELECT_COLORS,
  createDatabaseFromObjectType,
  createDefaultRow,
} from "../../types/database";
import type {
  CellValue,
  DatabaseContentV2,
  PropertyDef,
} from "../../types/database";
import type {
  CalendarDatabaseSource,
  CalendarPageConfig,
} from "../../types/calendar";

interface EventValues {
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm or ""
  endTime: string; // HH:mm or ""
  location: string;
}

function findProp(
  properties: PropertyDef[],
  name: string,
  type: PropertyDef["type"],
): PropertyDef | undefined {
  return (
    properties.find(
      (p) => p.type === type && p.name.toLowerCase() === name.toLowerCase(),
    ) ?? (name === "title" ? properties.find((p) => p.type === type) : undefined)
  );
}

function localIso(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

/**
 * Append an event row to the events-target database through the daemon's
 * merge-protected putDatabase path (fresh read → append → write with
 * baseline). Property ids are resolved by name at save time since every
 * database generates its own ids. Missing optional properties are skipped.
 */
export async function saveEventRow(
  notebookId: string,
  pageId: string,
  values: EventValues,
): Promise<void> {
  const result = await api.getDatabase(notebookId, pageId);
  const content = result.database as DatabaseContentV2 | null;
  if (!content || !Array.isArray(content.rows)) {
    throw new Error("Events database unavailable");
  }

  const row = createDefaultRow(content.properties);
  const setCell = (prop: PropertyDef | undefined, value: CellValue) => {
    if (prop) {
      row.cells[prop.id] = value;
    }
  };

  const timed = values.startTime !== "";
  setCell(findProp(content.properties, "title", "text"), values.title);
  setCell(
    findProp(content.properties, "date", "date"),
    timed ? localIso(values.date, values.startTime) : values.date,
  );
  if (timed && values.endTime !== "") {
    setCell(
      findProp(content.properties, "end date", "date"),
      localIso(values.date, values.endTime),
    );
  }
  setCell(findProp(content.properties, "all day", "checkbox"), !timed);
  if (values.location !== "") {
    setCell(findProp(content.properties, "location", "text"), values.location);
  }

  const next = { ...content, rows: [...content.rows, row] };
  await api.putDatabase(
    notebookId,
    pageId,
    next as unknown as Record<string, unknown>,
    content.rows.map((r) => r.id),
    content as unknown as Record<string, unknown>,
  );
}

function todayKey(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

interface EventQuickCreateProps {
  notebookId: string;
  config: CalendarPageConfig;
  /** Prefill for the date field (YYYY-MM-DD); defaults to today. */
  initialDate?: string;
  onClose: () => void;
  /** Called after a row was written so the grid can re-resolve. */
  onCreated: () => void;
  /** "Choose database" → open the sources panel. */
  onOpenSources: () => void;
  /** Persists config changes (used by the create-Events-database flow). */
  onConfigChange: (next: CalendarPageConfig) => void;
}

export function EventQuickCreate({
  notebookId,
  config,
  initialDate,
  onClose,
  onCreated,
  onOpenSources,
  onConfigChange,
}: EventQuickCreateProps) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(initialDate ?? todayKey());
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const target = useMemo(
    () =>
      config.sources.find(
        (s): s is CalendarDatabaseSource =>
          s.type === "database" && Boolean(s.isEventsTarget),
      ) ?? null,
    [config],
  );

  const createEventsDatabase = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const eventsType = BUILT_IN_OBJECT_TYPES.find(
        (t) => t.id === "builtin-events",
      );
      if (!eventsType) {
        throw new Error("Events template missing");
      }
      const { createPage } = usePageStore.getState();
      const pageData = await createPage(notebookId, "Events");
      if (!pageData) {
        throw new Error("Failed to create the Events database page");
      }
      const updatedPage = await api.updatePage(notebookId, pageData.id, {
        fileExtension: "database",
        pageType: "database",
      });
      usePageStore.setState((state) => ({
        pages: state.pages.map((p) => (p.id === pageData.id ? updatedPage : p)),
      }));
      const dbContent = createDatabaseFromObjectType(eventsType);
      await api.updateFileContent(
        notebookId,
        pageData.id,
        JSON.stringify(dbContent, null, 2),
      );

      const dateProp = dbContent.properties.find(
        (p) => p.type === "date" && p.name === "Date",
      );
      const endProp = dbContent.properties.find(
        (p) => p.type === "date" && p.name === "End Date",
      );
      if (!dateProp) {
        throw new Error("Events template has no Date property");
      }
      const used = new Set(config.sources.map((s) => s.color));
      const source: CalendarDatabaseSource = {
        type: "database",
        id: generateId(),
        pageId: pageData.id,
        datePropertyId: dateProp.id,
        ...(endProp ? { endDatePropertyId: endProp.id } : {}),
        color:
          SELECT_COLORS.find((c) => !used.has(c)) ??
          SELECT_COLORS[config.sources.length % SELECT_COLORS.length],
        isEventsTarget: true,
      };
      onConfigChange({ ...config, sources: [...config.sources, source] });
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to create Events database",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const save = async () => {
    if (!target || title.trim() === "" || isSaving) {
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await saveEventRow(notebookId, target.pageId, {
        title: title.trim(),
        date,
        startTime,
        endTime,
        location: location.trim(),
      });
      onCreated();
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save event");
      setIsSaving(false);
    }
  };

  const inputStyle = {
    backgroundColor: "var(--color-bg-primary)",
    borderColor: "var(--color-border)",
    color: "var(--color-text-primary)",
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed top-24 left-1/2 -translate-x-1/2 z-50 w-80 rounded-lg border shadow-xl p-3"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
        data-testid="event-quick-create"
      >
        <div
          className="text-sm font-medium mb-2"
          style={{ color: "var(--color-text-primary)" }}
        >
          New event
        </div>

        {target === null ? (
          <div className="space-y-2">
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Events are stored as rows in a database. Pick an existing
              database as the events target, or create one from the Events
              template.
            </p>
            {saveError && (
              <p className="text-xs" style={{ color: "var(--color-error)" }}>
                {saveError}
              </p>
            )}
            <div className="flex gap-1.5">
              <button
                onClick={createEventsDatabase}
                disabled={isSaving}
                className="text-xs px-2 py-1 rounded disabled:opacity-50"
                style={{ backgroundColor: "var(--color-accent)", color: "white" }}
              >
                Create Events database
              </button>
              <button
                onClick={() => {
                  onOpenSources();
                  onClose();
                }}
                className="text-xs px-2 py-1 rounded border"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Choose database
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              aria-label="Event title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              autoFocus
              className="w-full text-sm rounded border px-2 py-1"
              style={inputStyle}
            />
            <input
              aria-label="Event date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full text-xs rounded border px-2 py-1"
              style={inputStyle}
            />
            <div className="flex gap-1.5">
              <input
                aria-label="Start time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="flex-1 text-xs rounded border px-2 py-1"
                style={inputStyle}
              />
              <input
                aria-label="End time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={startTime === ""}
                className="flex-1 text-xs rounded border px-2 py-1 disabled:opacity-50"
                style={inputStyle}
              />
            </div>
            <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
              Leave the time empty for an all-day event.
            </p>
            <input
              aria-label="Event location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Location (optional)"
              className="w-full text-xs rounded border px-2 py-1"
              style={inputStyle}
            />
            {saveError && (
              <p className="text-xs" style={{ color: "var(--color-error)" }}>
                {saveError}
              </p>
            )}
            <div className="flex gap-1.5">
              <button
                onClick={save}
                disabled={title.trim() === "" || isSaving}
                className="text-xs px-2 py-1 rounded disabled:opacity-50"
                style={{ backgroundColor: "var(--color-accent)", color: "white" }}
              >
                {isSaving ? "Saving…" : "Save event"}
              </button>
              <button
                onClick={onClose}
                className="text-xs px-2 py-1 rounded border"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
