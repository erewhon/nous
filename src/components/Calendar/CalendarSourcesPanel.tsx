import { useEffect, useMemo, useState } from "react";
import { usePageStore } from "../../stores/pageStore";
import * as api from "../../utils/api";
import { generateId } from "../../utils/generateId";
import { SELECT_COLORS } from "../../types/database";
import type { DatabaseContentV2, PropertyDef } from "../../types/database";
import type {
  CalendarDatabaseSource,
  CalendarPageConfig,
  CalendarSource,
} from "../../types/calendar";

type AddKind = "database" | "ics-file" | "ics-subscription";

const REFRESH_OPTIONS = [
  { label: "Every 15 minutes", value: 15 },
  { label: "Every hour", value: 60 },
  { label: "Every 6 hours", value: 360 },
  { label: "Every 24 hours", value: 1440 },
];

const TYPE_LABELS: Record<CalendarSource["type"], string> = {
  database: "Database",
  "ics-file": "ICS file",
  "ics-subscription": "Subscription",
};

function nextColor(config: CalendarPageConfig): string {
  const used = new Set(config.sources.map((s) => s.color));
  return (
    SELECT_COLORS.find((c) => !used.has(c)) ??
    SELECT_COLORS[config.sources.length % SELECT_COLORS.length]
  );
}

interface CalendarSourcesPanelProps {
  notebookId: string;
  config: CalendarPageConfig;
  /** Receives the full next config; the parent persists it immediately. */
  onChange: (next: CalendarPageConfig) => void;
  onClose: () => void;
}

export function CalendarSourcesPanel({
  notebookId,
  config,
  onChange,
  onClose,
}: CalendarSourcesPanelProps) {
  const pages = usePageStore((s) => s.pages);
  const databasePages = useMemo(
    () => pages.filter((p) => p.pageType === "database"),
    [pages],
  );
  const icsPages = useMemo(
    () => pages.filter((p) => p.pageType === "ics"),
    [pages],
  );

  // Lazily loaded property lists per database page, for date-prop dropdowns.
  const [propsByPage, setPropsByPage] = useState<
    Record<string, PropertyDef[] | "error">
  >({});

  const [addKind, setAddKind] = useState<AddKind | null>(null);
  const [addPageId, setAddPageId] = useState("");
  const [addDatePropId, setAddDatePropId] = useState("");
  const [addEndPropId, setAddEndPropId] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addRefresh, setAddRefresh] = useState(60);
  const [editingColorId, setEditingColorId] = useState<string | null>(null);

  useEffect(() => {
    const wanted = new Set<string>();
    for (const source of config.sources) {
      if (source.type === "database") {
        wanted.add(source.pageId);
      }
    }
    if (addKind === "database" && addPageId) {
      wanted.add(addPageId);
    }
    for (const pageId of wanted) {
      if (propsByPage[pageId] !== undefined) {
        continue;
      }
      api
        .getDatabase(notebookId, pageId)
        .then((result) => {
          const content = result.database as DatabaseContentV2 | null;
          setPropsByPage((prev) => ({
            ...prev,
            [pageId]: content?.properties ?? [],
          }));
        })
        .catch(() => {
          setPropsByPage((prev) => ({ ...prev, [pageId]: "error" }));
        });
    }
  }, [config.sources, addKind, addPageId, notebookId, propsByPage]);

  const datePropsFor = (pageId: string): PropertyDef[] => {
    const props = propsByPage[pageId];
    return Array.isArray(props) ? props.filter((p) => p.type === "date") : [];
  };

  const sourceName = (source: CalendarSource): string => {
    if (source.type === "ics-subscription") {
      try {
        return new URL(source.url).host;
      } catch {
        return source.url;
      }
    }
    return pages.find((p) => p.id === source.pageId)?.title ?? "Unknown page";
  };

  const update = (sources: CalendarSource[]) => {
    onChange({ ...config, sources });
  };

  const removeSource = (id: string) => {
    update(config.sources.filter((s) => s.id !== id));
  };

  const setColor = (id: string, color: string) => {
    update(config.sources.map((s) => (s.id === id ? { ...s, color } : s)));
    setEditingColorId(null);
  };

  const setDateProp = (id: string, datePropertyId: string) => {
    update(
      config.sources.map((s) =>
        s.id === id && s.type === "database" ? { ...s, datePropertyId } : s,
      ),
    );
  };

  const toggleEventsTarget = (id: string) => {
    update(
      config.sources.map((s) => {
        if (s.type !== "database") {
          return s;
        }
        const isTarget = s.id === id ? !s.isEventsTarget : false;
        return { ...s, isEventsTarget: isTarget || undefined };
      }),
    );
  };

  const resetAddForm = () => {
    setAddKind(null);
    setAddPageId("");
    setAddDatePropId("");
    setAddEndPropId("");
    setAddUrl("");
    setAddRefresh(60);
  };

  const urlIsValid = addUrl.startsWith("https://");
  const addDateProps = addPageId ? datePropsFor(addPageId) : [];
  const canAdd =
    addKind === "database"
      ? Boolean(addPageId && addDatePropId)
      : addKind === "ics-file"
        ? Boolean(addPageId)
        : addKind === "ics-subscription"
          ? urlIsValid
          : false;

  const addSource = () => {
    if (!addKind || !canAdd) {
      return;
    }
    const base = { id: generateId(), color: nextColor(config) };
    let source: CalendarSource;
    if (addKind === "database") {
      source = {
        type: "database",
        ...base,
        pageId: addPageId,
        datePropertyId: addDatePropId,
        ...(addEndPropId ? { endDatePropertyId: addEndPropId } : {}),
      };
    } else if (addKind === "ics-file") {
      source = { type: "ics-file", ...base, pageId: addPageId };
    } else {
      source = {
        type: "ics-subscription",
        ...base,
        url: addUrl,
        refreshMinutes: addRefresh,
      };
    }
    update([...config.sources, source]);
    resetAddForm();
  };

  const selectStyle = {
    backgroundColor: "var(--color-bg-primary)",
    borderColor: "var(--color-border)",
    color: "var(--color-text-primary)",
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed top-20 right-4 z-50 w-96 max-h-[75vh] overflow-y-auto rounded-lg border shadow-xl p-3"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
        data-testid="calendar-sources-panel"
      >
        <div className="flex items-center justify-between mb-2">
          <span
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Calendar sources
          </span>
          <button
            aria-label="Close sources panel"
            onClick={onClose}
            className="text-xs px-1.5"
            style={{ color: "var(--color-text-muted)" }}
          >
            ✕
          </button>
        </div>

        {/* Existing sources */}
        {config.sources.length === 0 && (
          <p className="text-xs mb-2" style={{ color: "var(--color-text-muted)" }}>
            No sources yet.
          </p>
        )}
        <div className="space-y-2 mb-3">
          {config.sources.map((source) => (
            <div
              key={source.id}
              className="rounded-lg border p-2"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div className="flex items-center gap-2">
                <button
                  aria-label={`Change color for ${sourceName(source)}`}
                  onClick={() =>
                    setEditingColorId(
                      editingColorId === source.id ? null : source.id,
                    )
                  }
                  className="h-3.5 w-3.5 rounded-full flex-shrink-0 border"
                  style={{
                    backgroundColor: source.color,
                    borderColor: "var(--color-border)",
                  }}
                />
                <span
                  className="text-xs font-medium truncate flex-1"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {sourceName(source)}
                </span>
                <span
                  className="text-[10px] px-1 py-0.5 rounded flex-shrink-0"
                  style={{
                    backgroundColor: "var(--color-bg-tertiary)",
                    color: "var(--color-text-muted)",
                  }}
                >
                  {TYPE_LABELS[source.type]}
                </span>
                <button
                  aria-label={`Remove ${sourceName(source)}`}
                  onClick={() => removeSource(source.id)}
                  className="text-xs flex-shrink-0"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  ✕
                </button>
              </div>

              {editingColorId === source.id && (
                <div className="flex gap-1 mt-2">
                  {SELECT_COLORS.map((color) => (
                    <button
                      key={color}
                      aria-label={`color ${color}`}
                      onClick={() => setColor(source.id, color)}
                      className="h-4 w-4 rounded-full border"
                      style={{
                        backgroundColor: color,
                        borderColor:
                          source.color === color
                            ? "var(--color-text-primary)"
                            : "transparent",
                      }}
                    />
                  ))}
                </div>
              )}

              {source.type === "database" && (
                <div className="flex items-center gap-2 mt-2">
                  <select
                    aria-label={`Date property for ${sourceName(source)}`}
                    value={source.datePropertyId}
                    onChange={(e) => setDateProp(source.id, e.target.value)}
                    className="text-xs rounded border px-1 py-0.5 flex-1"
                    style={selectStyle}
                  >
                    {datePropsFor(source.pageId).map((prop) => (
                      <option key={prop.id} value={prop.id}>
                        {prop.name}
                      </option>
                    ))}
                    {datePropsFor(source.pageId).every(
                      (p) => p.id !== source.datePropertyId,
                    ) && (
                      <option value={source.datePropertyId}>
                        (current property)
                      </option>
                    )}
                  </select>
                  <label
                    className="flex items-center gap-1 text-[10px] flex-shrink-0 cursor-pointer"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(
                        (source as CalendarDatabaseSource).isEventsTarget,
                      )}
                      onChange={() => toggleEventsTarget(source.id)}
                    />
                    Use for new events
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add source */}
        <div
          className="border-t pt-2"
          style={{ borderColor: "var(--color-border)" }}
        >
          {addKind === null ? (
            <div className="flex gap-1.5">
              {(Object.keys(TYPE_LABELS) as AddKind[]).map((kind) => (
                <button
                  key={kind}
                  onClick={() => setAddKind(kind)}
                  className="text-xs px-2 py-1 rounded border"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  + {TYPE_LABELS[kind]}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <div
                className="text-xs font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                Add {TYPE_LABELS[addKind]} source
              </div>

              {addKind === "database" && (
                <>
                  <select
                    aria-label="Database page"
                    value={addPageId}
                    onChange={(e) => {
                      setAddPageId(e.target.value);
                      setAddDatePropId("");
                      setAddEndPropId("");
                    }}
                    className="w-full text-xs rounded border px-1 py-1"
                    style={selectStyle}
                  >
                    <option value="">Choose a database…</option>
                    {databasePages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                  {addPageId && addDateProps.length === 0 && (
                    <p
                      className="text-[10px]"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {propsByPage[addPageId] === undefined
                        ? "Loading properties…"
                        : "This database has no date properties, so it can't be shown on a calendar."}
                    </p>
                  )}
                  {addDateProps.length > 0 && (
                    <>
                      <select
                        aria-label="Date property"
                        value={addDatePropId}
                        onChange={(e) => setAddDatePropId(e.target.value)}
                        className="w-full text-xs rounded border px-1 py-1"
                        style={selectStyle}
                      >
                        <option value="">Choose the date property…</option>
                        {addDateProps.map((prop) => (
                          <option key={prop.id} value={prop.id}>
                            {prop.name}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="End date property"
                        value={addEndPropId}
                        onChange={(e) => setAddEndPropId(e.target.value)}
                        className="w-full text-xs rounded border px-1 py-1"
                        style={selectStyle}
                      >
                        <option value="">No end date property</option>
                        {addDateProps
                          .filter((prop) => prop.id !== addDatePropId)
                          .map((prop) => (
                            <option key={prop.id} value={prop.id}>
                              {prop.name}
                            </option>
                          ))}
                      </select>
                    </>
                  )}
                </>
              )}

              {addKind === "ics-file" && (
                <select
                  aria-label="ICS page"
                  value={addPageId}
                  onChange={(e) => setAddPageId(e.target.value)}
                  className="w-full text-xs rounded border px-1 py-1"
                  style={selectStyle}
                >
                  <option value="">Choose an ICS page…</option>
                  {icsPages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              )}

              {addKind === "ics-subscription" && (
                <>
                  <input
                    aria-label="Subscription URL"
                    type="text"
                    value={addUrl}
                    onChange={(e) => setAddUrl(e.target.value)}
                    placeholder="https://example.com/calendar.ics"
                    className="w-full text-xs rounded border px-1 py-1"
                    style={selectStyle}
                  />
                  {addUrl !== "" && !urlIsValid && (
                    <p className="text-[10px]" style={{ color: "var(--color-error)" }}>
                      Subscription URLs must start with https://
                    </p>
                  )}
                  <select
                    aria-label="Refresh interval"
                    value={addRefresh}
                    onChange={(e) => setAddRefresh(Number(e.target.value))}
                    className="w-full text-xs rounded border px-1 py-1"
                    style={selectStyle}
                  >
                    {REFRESH_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <div className="flex gap-1.5">
                <button
                  onClick={addSource}
                  disabled={!canAdd}
                  className="text-xs px-2 py-1 rounded disabled:opacity-50"
                  style={{ backgroundColor: "var(--color-accent)", color: "white" }}
                >
                  Add source
                </button>
                <button
                  onClick={resetAddForm}
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
      </div>
    </>
  );
}
