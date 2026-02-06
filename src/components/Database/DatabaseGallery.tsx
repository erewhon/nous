import { useState, useCallback, useMemo } from "react";
import type {
  DatabaseContentV2,
  DatabaseView,
  DatabaseRow,
  CellValue,
  GalleryViewConfig,
  SelectOption,
  PropertyDef,
} from "../../types/database";
import { pickNextColor, type RelationTarget } from "./CellEditors";
import { DatabaseRowDetail } from "./DatabaseRowDetail";
import { compareCellValues, applyFilter } from "./DatabaseTable";

interface DatabaseGalleryProps {
  content: DatabaseContentV2;
  view: DatabaseView;
  onUpdateContent: (
    updater: (prev: DatabaseContentV2) => DatabaseContentV2
  ) => void;
  onUpdateView: (updater: (prev: DatabaseView) => DatabaseView) => void;
  relationData?: Map<string, RelationTarget[]>;
}

export function DatabaseGallery({
  content,
  view,
  onUpdateContent,
  relationData,
}: DatabaseGalleryProps) {
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  const config = view.config as GalleryViewConfig;
  const cardSize = config.cardSize ?? "medium";

  // Determine visible properties
  const visibleProps = useMemo(() => {
    if (config.visiblePropertyIds && config.visiblePropertyIds.length > 0) {
      return config.visiblePropertyIds
        .map((id) => content.properties.find((p) => p.id === id))
        .filter((p): p is PropertyDef => p != null);
    }
    return content.properties;
  }, [config.visiblePropertyIds, content.properties]);

  const titleProp = content.properties.find((p) => p.type === "text");
  const displayProps = visibleProps.filter((p) => p.id !== titleProp?.id);

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
    const now = new Date().toISOString();
    onUpdateContent((prev) => ({
      ...prev,
      rows: [
        ...prev.rows,
        { id: crypto.randomUUID(), cells: {}, createdAt: now, updatedAt: now },
      ],
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

  const renderPropValue = (prop: PropertyDef, row: DatabaseRow) => {
    const val = row.cells[prop.id];
    if (val == null || val === "") return null;

    if (prop.type === "checkbox") {
      return val ? "\u2705" : "\u2610";
    }
    if (prop.type === "select") {
      const opt = prop.options?.find((o) => o.id === val);
      if (!opt) return null;
      return (
        <span
          className="db-select-pill"
          style={{ backgroundColor: opt.color + "30", color: opt.color }}
        >
          {opt.label}
        </span>
      );
    }
    if (prop.type === "multiSelect" && Array.isArray(val)) {
      return (
        <span className="db-gallery-card-pills">
          {val.map((id) => {
            const opt = prop.options?.find((o) => o.id === id);
            if (!opt) return null;
            return (
              <span
                key={id}
                className="db-select-pill"
                style={{ backgroundColor: opt.color + "30", color: opt.color }}
              >
                {opt.label}
              </span>
            );
          })}
        </span>
      );
    }
    if (prop.type === "url") {
      return (
        <a
          href={String(val)}
          target="_blank"
          rel="noopener noreferrer"
          className="db-cell-link"
          onClick={(e) => e.stopPropagation()}
        >
          {String(val)
            .replace(/^https?:\/\//, "")
            .slice(0, 30)}
        </a>
      );
    }
    if (prop.type === "relation" && Array.isArray(val)) {
      const targets = relationData?.get(prop.id) ?? [];
      const names = val
        .map((id) => targets.find((t) => t.id === id)?.title ?? "")
        .filter(Boolean);
      if (names.length === 0) return null;
      return (
        <span className="db-gallery-card-pills">
          {names.map((name, i) => (
            <span key={i} className="db-relation-pill">{name}</span>
          ))}
        </span>
      );
    }
    return String(val);
  };

  const sizeClass =
    cardSize === "small"
      ? "db-gallery-grid-small"
      : cardSize === "large"
        ? "db-gallery-grid-large"
        : "db-gallery-grid-medium";

  const selectedRow = selectedRowId
    ? content.rows.find((r) => r.id === selectedRowId)
    : null;

  return (
    <div className="db-gallery-wrapper">
      <div className={`db-gallery-grid ${sizeClass}`}>
        {displayRows.map((row) => {
          const title = titleProp ? String(row.cells[titleProp.id] ?? "") : "";
          return (
            <div
              key={row.id}
              className="db-gallery-card"
              onClick={() => setSelectedRowId(row.id)}
            >
              <div className="db-gallery-card-title">{title || "Untitled"}</div>
              {displayProps.slice(0, 4).map((prop) => {
                const rendered = renderPropValue(prop, row);
                if (!rendered) return null;
                return (
                  <div key={prop.id} className="db-gallery-card-row">
                    <span className="db-gallery-card-label">{prop.name}</span>
                    <span className="db-gallery-card-value">{rendered}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

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
          relationData={relationData}
        />
      )}
    </div>
  );
}
