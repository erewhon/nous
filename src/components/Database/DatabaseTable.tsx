import { useState, useCallback, useMemo } from "react";
import type {
  DatabaseContent,
  PropertyDef,
  DatabaseRow,
  CellValue,
  SelectOption,
  DatabaseSort,
} from "../../types/database";
import {
  TextCell,
  NumberCell,
  CheckboxCell,
  DateCell,
  UrlCell,
  SelectCell,
  MultiSelectCell,
  pickNextColor,
} from "./CellEditors";
import { PropertyEditor, PropertyTypeIcon } from "./PropertyEditor";

interface DatabaseTableProps {
  content: DatabaseContent;
  onUpdateContent: (updater: (prev: DatabaseContent) => DatabaseContent) => void;
}

export function DatabaseTable({ content, onUpdateContent }: DatabaseTableProps) {
  const [editingProperty, setEditingProperty] = useState<string | null>(null);

  // Sort and filter rows
  const displayRows = useMemo(() => {
    let rows = [...content.rows];

    // Apply filters
    for (const filter of content.filters) {
      const prop = content.properties.find((p) => p.id === filter.propertyId);
      if (!prop) continue;
      rows = rows.filter((row) => {
        const cellVal = row.cells[filter.propertyId];
        return applyFilter(cellVal, filter.operator, filter.value, prop);
      });
    }

    // Apply sorts
    if (content.sorts.length > 0) {
      rows.sort((a, b) => {
        for (const sort of content.sorts) {
          const aVal = a.cells[sort.propertyId];
          const bVal = b.cells[sort.propertyId];
          const cmp = compareCellValues(aVal, bVal);
          if (cmp !== 0) return sort.direction === "asc" ? cmp : -cmp;
        }
        return 0;
      });
    }

    return rows;
  }, [content.rows, content.sorts, content.filters, content.properties]);

  // Cell update handler
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

  // Add new row
  const handleAddRow = useCallback(() => {
    const now = new Date().toISOString();
    const newRow: DatabaseRow = {
      id: crypto.randomUUID(),
      cells: {},
      createdAt: now,
      updatedAt: now,
    };
    onUpdateContent((prev) => ({ ...prev, rows: [...prev.rows, newRow] }));
  }, [onUpdateContent]);

  // Delete row
  const handleDeleteRow = useCallback(
    (rowId: string) => {
      onUpdateContent((prev) => ({
        ...prev,
        rows: prev.rows.filter((r) => r.id !== rowId),
      }));
    },
    [onUpdateContent]
  );

  // Property update handler
  const handlePropertyUpdate = useCallback(
    (propertyId: string, updates: Partial<PropertyDef>) => {
      onUpdateContent((prev) => ({
        ...prev,
        properties: prev.properties.map((p) =>
          p.id === propertyId ? { ...p, ...updates } : p
        ),
      }));
    },
    [onUpdateContent]
  );

  // Delete property
  const handleDeleteProperty = useCallback(
    (propertyId: string) => {
      onUpdateContent((prev) => ({
        ...prev,
        properties: prev.properties.filter((p) => p.id !== propertyId),
        rows: prev.rows.map((r) => {
          const cells = { ...r.cells };
          delete cells[propertyId];
          return { ...r, cells };
        }),
        sorts: prev.sorts.filter((s) => s.propertyId !== propertyId),
        filters: prev.filters.filter((f) => f.propertyId !== propertyId),
      }));
      setEditingProperty(null);
    },
    [onUpdateContent]
  );

  // Add select option to a property
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

  // Column header sort toggle
  const handleHeaderClick = useCallback(
    (propertyId: string) => {
      onUpdateContent((prev) => {
        const existingSort = prev.sorts.find((s) => s.propertyId === propertyId);
        let newSorts: DatabaseSort[];
        if (!existingSort) {
          newSorts = [{ propertyId, direction: "asc" }];
        } else if (existingSort.direction === "asc") {
          newSorts = [{ propertyId, direction: "desc" }];
        } else {
          newSorts = [];
        }
        return { ...prev, sorts: newSorts };
      });
    },
    [onUpdateContent]
  );

  // Column resize handlers
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, propertyId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const prop = content.properties.find((p) => p.id === propertyId);
      const startX = e.clientX;
      const startWidth = prop?.width ?? 150;

      const handleMove = (moveE: MouseEvent) => {
        const delta = moveE.clientX - startX;
        const newWidth = Math.max(80, startWidth + delta);
        onUpdateContent((prev) => ({
          ...prev,
          properties: prev.properties.map((p) =>
            p.id === propertyId ? { ...p, width: newWidth } : p
          ),
        }));
      };

      const handleUp = () => {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [content.properties, onUpdateContent]
  );

  // Render cell based on property type
  const renderCell = (prop: PropertyDef, row: DatabaseRow) => {
    const value = row.cells[prop.id] ?? null;
    const onChange = (v: CellValue) => handleCellChange(row.id, prop.id, v);

    switch (prop.type) {
      case "text":
        return <TextCell value={value} onChange={onChange} />;
      case "number":
        return <NumberCell value={value} onChange={onChange} />;
      case "checkbox":
        return <CheckboxCell value={value} onChange={onChange} />;
      case "date":
        return <DateCell value={value} onChange={onChange} />;
      case "url":
        return <UrlCell value={value} onChange={onChange} />;
      case "select":
        return (
          <SelectCell
            value={value}
            onChange={onChange}
            options={prop.options ?? []}
            onAddOption={(label) => handleAddSelectOption(prop.id, label)}
          />
        );
      case "multiSelect":
        return (
          <MultiSelectCell
            value={value}
            onChange={onChange}
            options={prop.options ?? []}
            onAddOption={(label) => handleAddSelectOption(prop.id, label)}
          />
        );
      default:
        return <TextCell value={value} onChange={onChange} />;
    }
  };

  return (
    <div className="db-table-wrapper">
      <table className="db-table">
        <thead>
          <tr>
            <th className="db-row-num-header">#</th>
            {content.properties.map((prop) => {
              const sort = content.sorts.find((s) => s.propertyId === prop.id);
              return (
                <th
                  key={prop.id}
                  className="db-col-header"
                  style={{ width: prop.width ?? 150 }}
                >
                  <div
                    className="db-col-header-content"
                    onClick={() => handleHeaderClick(prop.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setEditingProperty(prop.id);
                    }}
                  >
                    <span className="db-col-header-icon">
                      <PropertyTypeIcon type={prop.type} />
                    </span>
                    <span className="db-col-header-name">{prop.name}</span>
                    {sort && (
                      <span className="db-col-sort-icon">
                        {sort.direction === "asc" ? "\u2191" : "\u2193"}
                      </span>
                    )}
                  </div>
                  <div
                    className="db-col-resize"
                    onMouseDown={(e) => handleResizeStart(e, prop.id)}
                  />
                  {editingProperty === prop.id && (
                    <PropertyEditor
                      property={prop}
                      onUpdate={(updates) => handlePropertyUpdate(prop.id, updates)}
                      onDelete={() => handleDeleteProperty(prop.id)}
                      onClose={() => setEditingProperty(null)}
                    />
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, idx) => (
            <tr key={row.id} className="db-row">
              <td className="db-row-num">
                <span className="db-row-num-text">{idx + 1}</span>
                <button
                  className="db-row-delete"
                  onClick={() => handleDeleteRow(row.id)}
                  title="Delete row"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </button>
              </td>
              {content.properties.map((prop) => (
                <td key={prop.id} className="db-cell" style={{ width: prop.width ?? 150 }}>
                  {renderCell(prop, row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Add row button */}
      <button className="db-add-row" onClick={handleAddRow}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
        New row
      </button>
    </div>
  );
}

// Helper: compare cell values for sorting
function compareCellValues(a: CellValue, b: CellValue): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;

  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  if (Array.isArray(a) && Array.isArray(b)) return a.join(",").localeCompare(b.join(","));

  return String(a).localeCompare(String(b));
}

// Helper: apply a filter to a cell value
function applyFilter(
  cellVal: CellValue,
  operator: string,
  filterVal: CellValue,
  _prop: PropertyDef
): boolean {
  switch (operator) {
    case "isEmpty":
      return cellVal == null || cellVal === "" || (Array.isArray(cellVal) && cellVal.length === 0);
    case "isNotEmpty":
      return cellVal != null && cellVal !== "" && !(Array.isArray(cellVal) && cellVal.length === 0);
    case "equals":
      return String(cellVal ?? "") === String(filterVal ?? "");
    case "contains":
      return String(cellVal ?? "").toLowerCase().includes(String(filterVal ?? "").toLowerCase());
    case "gt":
      return Number(cellVal) > Number(filterVal);
    case "lt":
      return Number(cellVal) < Number(filterVal);
    default:
      return true;
  }
}
