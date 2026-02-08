import { useState, useCallback, useMemo } from "react";
import type {
  DatabaseContentV2,
  DatabaseView,
  DatabaseRow,
  CellValue,
  CalendarViewConfig,
  SelectOption,
} from "../../types/database";
import { createDefaultRow } from "../../types/database";
import { pickNextColor } from "./CellEditors";
import type { RelationContext } from "./useRelationContext";
import { DatabaseRowDetail } from "./DatabaseRowDetail";
import { compareCellValues, applyFilter } from "./DatabaseTable";

interface DatabaseCalendarProps {
  content: DatabaseContentV2;
  view: DatabaseView;
  onUpdateContent: (
    updater: (prev: DatabaseContentV2) => DatabaseContentV2
  ) => void;
  onUpdateView: (updater: (prev: DatabaseView) => DatabaseView) => void;
  relationContext?: RelationContext;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function DatabaseCalendar({
  content,
  view,
  onUpdateContent,
  relationContext,
}: DatabaseCalendarProps) {
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const config = view.config as CalendarViewConfig;
  const dateProp = content.properties.find(
    (p) => p.id === config.datePropertyId
  );
  const titleProp = content.properties.find((p) => p.type === "text");

  // Filter and sort rows
  const displayRows = useMemo(() => {
    let rows = [...content.rows];

    for (const filter of view.filters) {
      const prop = content.properties.find((p) => p.id === filter.propertyId);
      if (!prop) continue;
      rows = rows.filter((row) =>
        applyFilter(
          row.cells[filter.propertyId],
          filter.operator,
          filter.value,
          prop
        )
      );
    }

    if (view.sorts.length > 0) {
      rows.sort((a, b) => {
        for (const sort of view.sorts) {
          const cmp = compareCellValues(
            a.cells[sort.propertyId],
            b.cells[sort.propertyId]
          );
          if (cmp !== 0) return sort.direction === "asc" ? cmp : -cmp;
        }
        return 0;
      });
    }

    return rows;
  }, [content.rows, view.sorts, view.filters, content.properties]);

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = firstDay.getDay();
    const totalDays = lastDay.getDate();

    const days: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i++) days.push(null);
    for (let i = 1; i <= totalDays; i++) days.push(new Date(year, month, i));

    return days;
  }, [currentMonth]);

  // Group rows by date
  const rowsByDate = useMemo(() => {
    if (!dateProp) return new Map<string, DatabaseRow[]>();

    const map = new Map<string, DatabaseRow[]>();
    for (const row of displayRows) {
      const dateVal = row.cells[config.datePropertyId];
      if (typeof dateVal === "string" && dateVal) {
        const key = dateVal.slice(0, 10); // YYYY-MM-DD
        const existing = map.get(key) ?? [];
        existing.push(row);
        map.set(key, existing);
      }
    }
    return map;
  }, [displayRows, dateProp, config.datePropertyId]);

  // Unscheduled rows
  const unscheduledRows = useMemo(() => {
    if (!dateProp) return displayRows;
    return displayRows.filter((row) => {
      const val = row.cells[config.datePropertyId];
      return !val || typeof val !== "string" || !val.trim();
    });
  }, [displayRows, dateProp, config.datePropertyId]);

  const today = new Date();
  const isToday = (date: Date) =>
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  const formatDateKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const handlePrevMonth = () => {
    setCurrentMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
    );
  };

  const handleNextMonth = () => {
    setCurrentMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
    );
  };

  const handleToday = () => {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  const handleAddRowOnDate = useCallback(
    (dateStr: string) => {
      onUpdateContent((prev) => {
        const row = createDefaultRow(prev.properties);
        // Merge date cell on top of defaults
        if (dateProp) {
          row.cells[config.datePropertyId] = dateStr;
        }
        return { ...prev, rows: [...prev.rows, row] };
      });
    },
    [onUpdateContent, config.datePropertyId, dateProp]
  );

  const handleDeleteRow = useCallback(
    (rowId: string) => {
      onUpdateContent((prev) => ({
        ...prev,
        rows: prev.rows.filter((r) => r.id !== rowId),
      }));
      setSelectedRowId(null);
    },
    [onUpdateContent]
  );

  const handleCellChange = useCallback(
    (rowId: string, propertyId: string, value: CellValue) => {
      onUpdateContent((prev) => ({
        ...prev,
        rows: prev.rows.map((r) =>
          r.id === rowId
            ? {
                ...r,
                cells: { ...r.cells, [propertyId]: value },
                updatedAt: new Date().toISOString(),
              }
            : r
        ),
      }));
    },
    [onUpdateContent]
  );

  const handleAddSelectOption = useCallback(
    (propertyId: string, label: string): SelectOption => {
      const existing =
        content.properties.find((p) => p.id === propertyId)?.options ?? [];
      const newOption: SelectOption = {
        id: crypto.randomUUID(),
        label,
        color: pickNextColor(existing),
      };
      onUpdateContent((prev) => ({
        ...prev,
        properties: prev.properties.map((p) =>
          p.id === propertyId
            ? { ...p, options: [...(p.options ?? []), newOption] }
            : p
        ),
      }));
      return newOption;
    },
    [content.properties, onUpdateContent]
  );

  if (!dateProp) {
    return (
      <div className="db-calendar-empty">
        No date property found. Add a date property to use calendar view.
      </div>
    );
  }

  const monthLabel = currentMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const selectedRow = selectedRowId
    ? content.rows.find((r) => r.id === selectedRowId)
    : null;

  return (
    <div className="db-calendar-wrapper">
      {/* Navigation */}
      <div className="db-calendar-nav">
        <button className="db-toolbar-btn" onClick={handlePrevMonth}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button className="db-toolbar-btn" onClick={handleToday}>
          Today
        </button>
        <button className="db-toolbar-btn" onClick={handleNextMonth}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <span className="db-calendar-month-label">{monthLabel}</span>
      </div>

      {/* Day headers */}
      <div className="db-calendar-grid-header">
        {DAY_NAMES.map((day) => (
          <div key={day} className="db-calendar-day-name">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="db-calendar-grid">
        {calendarDays.map((date, index) => {
          if (!date) {
            return (
              <div
                key={index}
                className="db-calendar-cell db-calendar-cell-empty"
              />
            );
          }

          const dateKey = formatDateKey(date);
          const dayRows = rowsByDate.get(dateKey) ?? [];

          return (
            <div
              key={index}
              className={`db-calendar-cell ${isToday(date) ? "db-calendar-cell-today" : ""}`}
              onClick={() => {
                if (dayRows.length === 0) handleAddRowOnDate(dateKey);
              }}
            >
              <div className="db-calendar-cell-date">{date.getDate()}</div>
              <div className="db-calendar-cell-items">
                {dayRows.slice(0, 3).map((row) => {
                  const title = titleProp
                    ? String(row.cells[titleProp.id] ?? "")
                    : "";
                  return (
                    <div
                      key={row.id}
                      className="db-calendar-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRowId(row.id);
                      }}
                    >
                      {title || "Untitled"}
                    </div>
                  );
                })}
                {dayRows.length > 3 && (
                  <div className="db-calendar-more">
                    +{dayRows.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Unscheduled section */}
      {unscheduledRows.length > 0 && (
        <div className="db-calendar-unscheduled">
          <div className="db-calendar-unscheduled-header">
            Unscheduled ({unscheduledRows.length})
          </div>
          <div className="db-calendar-unscheduled-items">
            {unscheduledRows.map((row) => {
              const title = titleProp
                ? String(row.cells[titleProp.id] ?? "")
                : "";
              return (
                <div
                  key={row.id}
                  className="db-calendar-item"
                  onClick={() => setSelectedRowId(row.id)}
                >
                  {title || "Untitled"}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selectedRow && (
        <DatabaseRowDetail
          row={selectedRow}
          properties={content.properties}
          onCellChange={(propId, val) =>
            handleCellChange(selectedRow.id, propId, val)
          }
          onAddSelectOption={handleAddSelectOption}
          onClose={() => setSelectedRowId(null)}
          onDelete={() => handleDeleteRow(selectedRow.id)}
          relationContext={relationContext}
        />
      )}
    </div>
  );
}
