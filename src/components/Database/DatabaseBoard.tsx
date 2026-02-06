import { useState, useCallback, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  useDroppable,
  useDraggable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import type {
  DatabaseContentV2,
  DatabaseView,
  DatabaseRow,
  CellValue,
  BoardViewConfig,
  SelectOption,
  PropertyDef,
} from "../../types/database";
import { pickNextColor } from "./CellEditors";
import { DatabaseBoardCard } from "./DatabaseBoardCard";
import { DatabaseRowDetail } from "./DatabaseRowDetail";
import { compareCellValues, applyFilter } from "./DatabaseTable";

interface DatabaseBoardProps {
  content: DatabaseContentV2;
  view: DatabaseView;
  onUpdateContent: (
    updater: (prev: DatabaseContentV2) => DatabaseContentV2
  ) => void;
  onUpdateView: (updater: (prev: DatabaseView) => DatabaseView) => void;
}

const NO_VALUE_COLUMN = "__no_value__";

export function DatabaseBoard({
  content,
  view,
  onUpdateContent,
}: DatabaseBoardProps) {
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const config = view.config as BoardViewConfig;
  const groupProp = content.properties.find(
    (p) => p.id === config.groupByPropertyId
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

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

  // Build columns from options
  const columns = useMemo(() => {
    if (!groupProp) return [];

    const options = groupProp.options ?? [];
    const hiddenColumns = new Set(config.hiddenColumns ?? []);

    const cols: {
      id: string;
      label: string;
      color: string;
      rows: DatabaseRow[];
    }[] = [];

    // Group rows by property value
    const rowsByCol = new Map<string, DatabaseRow[]>();
    rowsByCol.set(NO_VALUE_COLUMN, []);

    for (const opt of options) {
      if (!hiddenColumns.has(opt.id)) {
        rowsByCol.set(opt.id, []);
      }
    }

    for (const row of displayRows) {
      const val = row.cells[config.groupByPropertyId];
      if (val == null || val === "") {
        rowsByCol.get(NO_VALUE_COLUMN)?.push(row);
      } else if (groupProp.type === "multiSelect" && Array.isArray(val)) {
        // Place in first matching column
        let placed = false;
        for (const id of val) {
          if (rowsByCol.has(id)) {
            rowsByCol.get(id)!.push(row);
            placed = true;
            break;
          }
        }
        if (!placed) rowsByCol.get(NO_VALUE_COLUMN)?.push(row);
      } else {
        const key = String(val);
        if (rowsByCol.has(key)) {
          rowsByCol.get(key)!.push(row);
        } else {
          rowsByCol.get(NO_VALUE_COLUMN)?.push(row);
        }
      }
    }

    // Build column objects
    for (const opt of options) {
      if (hiddenColumns.has(opt.id)) continue;
      cols.push({
        id: opt.id,
        label: opt.label,
        color: opt.color,
        rows: rowsByCol.get(opt.id) ?? [],
      });
    }

    // No value column at the end
    const noValueRows = rowsByCol.get(NO_VALUE_COLUMN) ?? [];
    if (noValueRows.length > 0 || cols.length === 0) {
      cols.push({
        id: NO_VALUE_COLUMN,
        label: "No value",
        color: "#6b7280",
        rows: noValueRows,
      });
    }

    return cols;
  }, [displayRows, groupProp, config]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || !groupProp) return;

    const rowId = String(active.id);
    const targetColumnId = String(over.id);
    const newValue = targetColumnId === NO_VALUE_COLUMN ? null : targetColumnId;

    onUpdateContent((prev) => ({
      ...prev,
      rows: prev.rows.map((r) => {
        if (r.id !== rowId) return r;
        if (groupProp.type === "multiSelect") {
          const current = Array.isArray(r.cells[config.groupByPropertyId])
            ? (r.cells[config.groupByPropertyId] as string[])
            : [];
          // Remove old column values and add new one
          const oldColumnIds = new Set(
            (groupProp.options ?? []).map((o) => o.id)
          );
          const filtered = current.filter((id) => !oldColumnIds.has(id));
          const newArr = newValue ? [...filtered, newValue] : filtered;
          return {
            ...r,
            cells: {
              ...r.cells,
              [config.groupByPropertyId]: newArr.length > 0 ? newArr : null,
            },
            updatedAt: new Date().toISOString(),
          };
        }
        return {
          ...r,
          cells: { ...r.cells, [config.groupByPropertyId]: newValue },
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
  };

  const handleAddCard = useCallback(
    (columnId: string) => {
      const now = new Date().toISOString();
      const cellValue = columnId === NO_VALUE_COLUMN ? null : columnId;
      const cells: Record<string, CellValue> = {};
      if (cellValue != null && groupProp) {
        cells[config.groupByPropertyId] =
          groupProp.type === "multiSelect" ? [cellValue] : cellValue;
      }
      onUpdateContent((prev) => ({
        ...prev,
        rows: [
          ...prev.rows,
          { id: crypto.randomUUID(), cells, createdAt: now, updatedAt: now },
        ],
      }));
    },
    [onUpdateContent, config.groupByPropertyId, groupProp]
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

  if (!groupProp) {
    return (
      <div className="db-board-empty">
        No select property found for board grouping.
      </div>
    );
  }

  const activeRow = activeId
    ? content.rows.find((r) => r.id === activeId)
    : null;
  const selectedRow = selectedRowId
    ? content.rows.find((r) => r.id === selectedRowId)
    : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="db-board-container">
          {columns.map((col) => (
            <BoardColumn
              key={col.id}
              id={col.id}
              label={col.label}
              color={col.color}
              rows={col.rows}
              properties={content.properties}
              onCardClick={setSelectedRowId}
              onAddCard={() => handleAddCard(col.id)}
            />
          ))}
        </div>
        <DragOverlay>
          {activeRow && (
            <DatabaseBoardCard
              row={activeRow}
              properties={content.properties}
              onClick={() => {}}
            />
          )}
        </DragOverlay>
      </DndContext>

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
        />
      )}
    </>
  );
}

function BoardColumn({
  id,
  label,
  color,
  rows,
  properties,
  onCardClick,
  onAddCard,
}: {
  id: string;
  label: string;
  color: string;
  rows: DatabaseRow[];
  properties: PropertyDef[];
  onCardClick: (rowId: string) => void;
  onAddCard: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`db-board-column ${isOver ? "db-board-column-over" : ""}`}
    >
      <div className="db-board-column-header">
        <span
          className="db-select-pill"
          style={{ backgroundColor: color + "30", color }}
        >
          {label}
        </span>
        <span className="db-board-column-count">{rows.length}</span>
      </div>
      <div className="db-board-column-cards">
        {rows.map((row) => (
          <DraggableCard
            key={row.id}
            row={row}
            properties={properties}
            onClick={() => onCardClick(row.id)}
          />
        ))}
      </div>
      <button className="db-board-add-card" onClick={onAddCard}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        New
      </button>
    </div>
  );
}

function DraggableCard({
  row,
  properties,
  onClick,
}: {
  row: DatabaseRow;
  properties: PropertyDef[];
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: row.id,
    });

  const style = transform
    ? {
        transform: `translate(${transform.x}px, ${transform.y}px)`,
        opacity: isDragging ? 0.5 : 1,
      }
    : undefined;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <DatabaseBoardCard row={row} properties={properties} onClick={onClick} />
    </div>
  );
}
