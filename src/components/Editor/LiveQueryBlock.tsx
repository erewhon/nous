import { useState, useMemo, useCallback } from "react";
import { usePageStore } from "../../stores/pageStore";
import type { Page } from "../../types/page";
import type { LiveQueryConfig, LiveQueryFilter, LiveQuerySort } from "../../types/liveQuery";

interface LiveQueryBlockProps {
  config: LiveQueryConfig;
  notebookId: string;
  onConfigChange: (config: LiveQueryConfig) => void;
  onPageClick?: (pageId: string) => void;
}

const FILTER_FIELDS = [
  { value: "title", label: "Title" },
  { value: "tag", label: "Tag" },
  { value: "pageType", label: "Page Type" },
  { value: "folder", label: "Folder" },
  { value: "content", label: "Content" },
] as const;

const FILTER_OPERATORS = [
  { value: "contains", label: "contains" },
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "starts_with", label: "starts with" },
] as const;

const SORT_FIELDS = [
  { value: "title", label: "Title" },
  { value: "createdAt", label: "Created" },
  { value: "updatedAt", label: "Updated" },
] as const;

function matchesFilter(page: Page, filter: LiveQueryFilter): boolean {
  const val = filter.value.toLowerCase();
  switch (filter.field) {
    case "title": {
      const title = page.title.toLowerCase();
      switch (filter.operator) {
        case "contains": return title.includes(val);
        case "equals": return title === val;
        case "not_equals": return title !== val;
        case "starts_with": return title.startsWith(val);
      }
      break;
    }
    case "tag": {
      const tags = page.tags.map((t) => t.toLowerCase());
      switch (filter.operator) {
        case "contains": return tags.some((t) => t.includes(val));
        case "equals": return tags.includes(val);
        case "not_equals": return !tags.includes(val);
        case "starts_with": return tags.some((t) => t.startsWith(val));
      }
      break;
    }
    case "pageType": {
      const pt = page.pageType.toLowerCase();
      switch (filter.operator) {
        case "contains": return pt.includes(val);
        case "equals": return pt === val;
        case "not_equals": return pt !== val;
        case "starts_with": return pt.startsWith(val);
      }
      break;
    }
    case "folder": {
      const folderId = (page.folderId ?? "").toLowerCase();
      switch (filter.operator) {
        case "contains": return folderId.includes(val);
        case "equals": return folderId === val;
        case "not_equals": return folderId !== val;
        case "starts_with": return folderId.startsWith(val);
      }
      break;
    }
    case "content": {
      // Search through block text data
      const text = page.content.blocks
        .map((b) => {
          const data = b.data;
          return typeof data.text === "string" ? data.text : "";
        })
        .join(" ")
        .toLowerCase();
      switch (filter.operator) {
        case "contains": return text.includes(val);
        case "equals": return text === val;
        case "not_equals": return text !== val;
        case "starts_with": return text.startsWith(val);
      }
      break;
    }
  }
  return false;
}

function sortPages(pages: Page[], sort?: LiveQuerySort): Page[] {
  if (!sort) return pages;
  const sorted = [...pages];
  sorted.sort((a, b) => {
    let cmp = 0;
    switch (sort.field) {
      case "title":
        cmp = a.title.localeCompare(b.title);
        break;
      case "createdAt":
        cmp = a.createdAt.localeCompare(b.createdAt);
        break;
      case "updatedAt":
        cmp = a.updatedAt.localeCompare(b.updatedAt);
        break;
    }
    return sort.direction === "asc" ? cmp : -cmp;
  });
  return sorted;
}

function filterPages(pages: Page[], config: LiveQueryConfig): Page[] {
  let results = pages.filter((p) => !p.deletedAt && !p.isArchived);

  for (const filter of config.filters) {
    if (!filter.value.trim()) continue;
    results = results.filter((p) => matchesFilter(p, filter));
  }

  results = sortPages(results, config.sort);

  const limit = config.limit ?? 50;
  return results.slice(0, limit);
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function LiveQueryBlock({
  config,
  notebookId,
  onConfigChange,
  onPageClick,
}: LiveQueryBlockProps) {
  const [showConfig, setShowConfig] = useState(config.filters.length === 0);
  const pages = usePageStore((s) => s.pages);
  const notebookPages = useMemo(
    () => pages.filter((p) => p.notebookId === notebookId),
    [pages, notebookId]
  );
  const results = useMemo(() => filterPages(notebookPages, config), [notebookPages, config]);
  const displayMode = config.displayMode ?? "list";

  const addFilter = useCallback(() => {
    onConfigChange({
      ...config,
      filters: [...config.filters, { field: "title", operator: "contains", value: "" }],
    });
  }, [config, onConfigChange]);

  const updateFilter = useCallback(
    (idx: number, updates: Partial<LiveQueryFilter>) => {
      const filters = config.filters.map((f, i) => (i === idx ? { ...f, ...updates } : f));
      onConfigChange({ ...config, filters });
    },
    [config, onConfigChange]
  );

  const removeFilter = useCallback(
    (idx: number) => {
      onConfigChange({ ...config, filters: config.filters.filter((_, i) => i !== idx) });
    },
    [config, onConfigChange]
  );

  return (
    <div className="live-query-block">
      <div className="lq-header">
        <span className="lq-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          Live Query
          <span className="lq-count">{results.length} result{results.length !== 1 ? "s" : ""}</span>
        </span>
        <div className="lq-header-actions">
          {/* Display mode selector */}
          <select
            className="lq-mode-select"
            value={displayMode}
            onChange={(e) => onConfigChange({ ...config, displayMode: e.target.value as "list" | "table" | "compact" })}
          >
            <option value="list">List</option>
            <option value="table">Table</option>
            <option value="compact">Compact</option>
          </select>
          <button
            className="lq-config-toggle"
            onClick={() => setShowConfig((v) => !v)}
            title="Toggle config"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
      </div>

      {/* Config panel */}
      {showConfig && (
        <div className="lq-config-panel">
          <div className="lq-filters">
            {config.filters.map((filter, idx) => (
              <div key={idx} className="lq-filter-row">
                <select
                  value={filter.field}
                  onChange={(e) => updateFilter(idx, { field: e.target.value as LiveQueryFilter["field"] })}
                >
                  {FILTER_FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                <select
                  value={filter.operator}
                  onChange={(e) => updateFilter(idx, { operator: e.target.value as LiveQueryFilter["operator"] })}
                >
                  {FILTER_OPERATORS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={filter.value}
                  placeholder="Value..."
                  onChange={(e) => updateFilter(idx, { value: e.target.value })}
                />
                <button className="lq-filter-remove" onClick={() => removeFilter(idx)}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
            <button className="lq-add-filter" onClick={addFilter}>+ Add filter</button>
          </div>

          <div className="lq-sort-row">
            <span className="lq-sort-label">Sort by</span>
            <select
              value={config.sort?.field ?? ""}
              onChange={(e) => {
                const field = e.target.value as LiveQuerySort["field"] | "";
                if (!field) {
                  onConfigChange({ ...config, sort: undefined });
                } else {
                  onConfigChange({
                    ...config,
                    sort: { field, direction: config.sort?.direction ?? "asc" },
                  });
                }
              }}
            >
              <option value="">None</option>
              {SORT_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            {config.sort && (
              <select
                value={config.sort.direction}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    sort: { ...config.sort!, direction: e.target.value as "asc" | "desc" },
                  })
                }
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            )}
          </div>

          <div className="lq-limit-row">
            <span className="lq-sort-label">Limit</span>
            <input
              type="number"
              min={1}
              max={200}
              value={config.limit ?? 50}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                onConfigChange({ ...config, limit: isNaN(v) ? undefined : Math.min(200, Math.max(1, v)) });
              }}
            />
          </div>
        </div>
      )}

      {/* Results */}
      <div className="lq-results">
        {results.length === 0 ? (
          <div className="lq-empty">
            {config.filters.length === 0
              ? "Add a filter to see matching pages"
              : "No pages match the current filters"}
          </div>
        ) : displayMode === "compact" ? (
          <div className="lq-compact-results">
            {results.map((page) => (
              <span
                key={page.id}
                className="lq-compact-link"
                onClick={() => onPageClick?.(page.id)}
              >
                {page.title || "Untitled"}
              </span>
            ))}
          </div>
        ) : displayMode === "table" ? (
          <table className="lq-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Updated</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              {results.map((page) => (
                <tr
                  key={page.id}
                  className="lq-table-row"
                  onClick={() => onPageClick?.(page.id)}
                >
                  <td className="lq-table-title">{page.title || "Untitled"}</td>
                  <td className="lq-table-type">{page.pageType}</td>
                  <td className="lq-table-date">{formatDate(page.updatedAt)}</td>
                  <td className="lq-table-tags">
                    {page.tags.slice(0, 3).join(", ")}
                    {page.tags.length > 3 && ` +${page.tags.length - 3}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          /* list mode (default) */
          results.map((page) => (
            <div
              key={page.id}
              className="lq-result-item"
              onClick={() => onPageClick?.(page.id)}
            >
              <span className="lq-result-title">{page.title || "Untitled"}</span>
              <span className="lq-result-meta">
                {formatDate(page.updatedAt)}
                {page.tags.length > 0 && (
                  <span className="lq-result-tags">
                    {page.tags.slice(0, 3).map((t) => (
                      <span key={t} className="lq-tag">{t}</span>
                    ))}
                  </span>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
