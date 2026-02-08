import { useState, useCallback, useMemo } from "react";
import type {
  DatabaseContentV2,
  DatabaseView,
  DatabaseRow,
  CellValue,
  ListViewConfig,
  SelectOption,
} from "../../types/database";
import { createDefaultRow } from "../../types/database";
import { pickNextColor } from "./CellEditors";
import type { RelationContext } from "./useRelationContext";
import { DatabaseRowDetail } from "./DatabaseRowDetail";
import { compareCellValues, applyFilter } from "./DatabaseTable";

interface DatabaseListProps {
  content: DatabaseContentV2;
  view: DatabaseView;
  onUpdateContent: (
    updater: (prev: DatabaseContentV2) => DatabaseContentV2
  ) => void;
  onUpdateView: (updater: (prev: DatabaseView) => DatabaseView) => void;
  relationContext?: RelationContext;
}

export function DatabaseList({
  content,
  view,
  onUpdateContent,
  relationContext,
}: DatabaseListProps) {
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  const config = view.config as ListViewConfig;
  const secondaryPropertyIds = config.secondaryPropertyIds ?? [];

  // Find primary property (first text property)
  const primaryProp = content.properties.find((p) => p.type === "text");

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

  const handleAddRow = useCallback(() => {
    onUpdateContent((prev) => ({
      ...prev,
      rows: [...prev.rows, createDefaultRow(prev.properties)],
    }));
  }, [onUpdateContent]);

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

  const getDisplayValue = (row: DatabaseRow, propertyId: string): string => {
    const prop = content.properties.find((p) => p.id === propertyId);
    if (!prop) return "";

    // Rollup
    if (prop.type === "rollup") {
      const v = relationContext?.rollupValues.get(prop.id)?.get(row.id);
      return v != null ? String(v) : "";
    }

    // Back-relation
    if (prop.type === "relation" && prop.relationConfig?.direction === "back") {
      const backIds =
        relationContext?.backRelationValues.get(prop.id)?.get(row.id) ?? [];
      if (backIds.length === 0) return "";
      const sourcePageId = prop.relationConfig.databasePageId;
      const sourceContent =
        relationContext?.targetContents.get(sourcePageId);
      if (!sourceContent) return backIds.length + " linked";
      const titleProp = sourceContent.properties.find(
        (p) => p.type === "text"
      );
      return backIds
        .map((id) => {
          const r = sourceContent.rows.find((r) => r.id === id);
          return r && titleProp ? String(r.cells[titleProp.id] ?? "") : "";
        })
        .filter(Boolean)
        .join(", ");
    }

    const val = row.cells[propertyId];
    if (val == null) return "";
    if (prop.type === "select") {
      const opt = prop.options?.find((o) => o.id === val);
      return opt?.label ?? "";
    }
    if (prop.type === "multiSelect" && Array.isArray(val)) {
      return val
        .map((id) => prop.options?.find((o) => o.id === id)?.label ?? id)
        .join(", ");
    }
    if (prop.type === "checkbox") return val ? "Yes" : "No";
    if (prop.type === "relation" && Array.isArray(val)) {
      const targets = relationContext?.targets.get(prop.id) ?? [];
      return val
        .map((id) => targets.find((t) => t.id === id)?.title ?? "")
        .filter(Boolean)
        .join(", ");
    }
    return String(val);
  };

  const selectedRow = selectedRowId
    ? content.rows.find((r) => r.id === selectedRowId)
    : null;

  return (
    <div className="db-list-container">
      {displayRows.map((row) => {
        const primaryValue = primaryProp
          ? String(row.cells[primaryProp.id] ?? "")
          : "";
        const secondaryValues = secondaryPropertyIds
          .map((id) => getDisplayValue(row, id))
          .filter(Boolean);

        return (
          <div
            key={row.id}
            className="db-list-item"
            onClick={() => setSelectedRowId(row.id)}
          >
            <div className="db-list-item-content">
              <span className="db-list-item-primary">
                {primaryValue || "Untitled"}
              </span>
              {secondaryValues.length > 0 && (
                <span className="db-list-item-secondary">
                  {secondaryValues.join(" \u00b7 ")}
                </span>
              )}
            </div>
            <button
              className="db-list-item-delete"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteRow(row.id);
              }}
              title="Delete"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </button>
          </div>
        );
      })}

      <button className="db-add-row" onClick={handleAddRow}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        New row
      </button>

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
