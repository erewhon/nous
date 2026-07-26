import { useState, useCallback, useMemo, type CSSProperties } from "react";
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
import { generateId } from "../../utils/generateId";
import { pickNextColor } from "./CellEditors";
import type { RelationContext } from "./useRelationContext";
import { DatabaseBoardCard } from "./DatabaseBoardCard";
import { DatabaseRowDetail } from "./DatabaseRowDetail";
import { compareCellValues, applyFilter } from "./DatabaseTable";
import { isDoneStatus, resolveStatusColor } from "./boardSemantics";
import { useIsPhone } from "../../hooks/useIsPhone";

interface DatabaseBoardProps {
  content: DatabaseContentV2;
  view: DatabaseView;
  onUpdateContent: (
    updater: (prev: DatabaseContentV2) => DatabaseContentV2
  ) => void;
  onUpdateView: (updater: (prev: DatabaseView) => DatabaseView) => void;
  relationContext?: RelationContext;
  pageLinkPages?: Array<{ id: string; title: string }>;
  onNavigatePageLink?: (pageId: string) => void;
}

const NO_VALUE_COLUMN = "__no_value__";

/**
 * Move a row to a board column: rewrites the group-by cell (multiSelect drops
 * every option of the group property before appending the target). Pure so
 * drop behavior is testable without dnd-kit choreography.
 */
export function applyBoardDrop(
  prev: DatabaseContentV2,
  groupProp: PropertyDef,
  groupByPropertyId: string,
  rowId: string,
  targetColumnId: string
): DatabaseContentV2 {
  const newValue = targetColumnId === NO_VALUE_COLUMN ? null : targetColumnId;
  return {
    ...prev,
    rows: prev.rows.map((r) => {
      if (r.id !== rowId) return r;
      if (groupProp.type === "multiSelect") {
        const current = Array.isArray(r.cells[groupByPropertyId])
          ? (r.cells[groupByPropertyId] as string[])
          : [];
        // Remove old column values and add new one
        const oldColumnIds = new Set((groupProp.options ?? []).map((o) => o.id));
        const filtered = current.filter((id) => !oldColumnIds.has(id));
        const newArr = newValue ? [...filtered, newValue] : filtered;
        return {
          ...r,
          cells: {
            ...r.cells,
            [groupByPropertyId]: newArr.length > 0 ? newArr : null,
          },
          updatedAt: new Date().toISOString(),
        };
      }
      return {
        ...r,
        cells: { ...r.cells, [groupByPropertyId]: newValue },
        updatedAt: new Date().toISOString(),
      };
    }),
  };
}

export function DatabaseBoard({
  content,
  view,
  onUpdateContent,
  onUpdateView,
  relationContext,
  pageLinkPages,
  onNavigatePageLink,
}: DatabaseBoardProps) {
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeCardHeight, setActiveCardHeight] = useState<number>(56);
  const isPhone = useIsPhone();

  const config = view.config as BoardViewConfig;
  const groupProp = content.properties.find(
    (p) => p.id === config.groupByPropertyId
  );
  const cardPropertyIds = config.cardPropertyIds;

  const pointerSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  // Phone: no drag — columns are swiped one at a time (CSS scroll-snap)
  // and moving a card = changing the group property in the detail sheet
  // (mobile spec decision D). Empty sensors keep DndContext mounted for
  // the useDraggable/useDroppable hooks without ever activating a drag.
  const sensors = isPhone ? [] : pointerSensors;

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

    // Build column objects — respect custom column order if set
    const orderedOptions = config.columnOrder?.length
      ? config.columnOrder
          .map((id) => options.find((o) => o.id === id))
          .filter((o): o is SelectOption => o != null)
          .concat(options.filter((o) => !config.columnOrder!.includes(o.id)))
      : options;

    for (const opt of orderedOptions) {
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
    setActiveCardHeight(event.active.rect.current.initial?.height ?? 56);
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || !groupProp) return;

    const rowId = String(active.id);
    const targetColumnId = String(over.id);
    onUpdateContent((prev) =>
      applyBoardDrop(
        prev,
        groupProp,
        config.groupByPropertyId,
        rowId,
        targetColumnId
      )
    );
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
          { id: generateId(), cells, createdAt: now, updatedAt: now },
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
        id: generateId(),
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

  const handleMoveColumn = useCallback(
    (index: number, direction: -1 | 1) => {
      const newIndex = index + direction;
      const currentOrder = columns
        .map((c) => c.id)
        .filter((id) => id !== NO_VALUE_COLUMN);
      if (newIndex < 0 || newIndex >= currentOrder.length) return;
      const [moved] = currentOrder.splice(index, 1);
      currentOrder.splice(newIndex, 0, moved);
      onUpdateView((prev) => ({
        ...prev,
        config: { ...prev.config, columnOrder: currentOrder },
      }));
    },
    [columns, onUpdateView]
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

  // The column the dragged card came from — its color rides along on the
  // overlay so the status spine survives the lift.
  const activeColumn = activeId
    ? columns.find((c) => c.rows.some((r) => r.id === activeId))
    : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="db-board-container">
          {columns.map((col, colIdx) => (
            <BoardColumn
              key={col.id}
              id={col.id}
              label={col.label}
              color={col.color}
              rows={col.rows}
              properties={content.properties}
              selectedRowId={selectedRowId}
              dragActive={activeId != null}
              activeCardHeight={activeCardHeight}
              onCardClick={setSelectedRowId}
              onAddCard={() => handleAddCard(col.id)}
              pageLinkPages={pageLinkPages}
              formulaValues={relationContext?.formulaValues}
              cardPropertyIds={cardPropertyIds}
              canMoveLeft={colIdx > 0 && col.id !== NO_VALUE_COLUMN}
              canMoveRight={
                colIdx < columns.length - 1 &&
                col.id !== NO_VALUE_COLUMN &&
                columns[colIdx + 1]?.id !== NO_VALUE_COLUMN
              }
              onMoveLeft={() => handleMoveColumn(colIdx, -1)}
              onMoveRight={() => handleMoveColumn(colIdx, 1)}
            />
          ))}
        </div>
        <DragOverlay>
          {activeRow && (
            <div
              className="db-board-card-overlay"
              style={
                {
                  "--col-color": activeColumn
                    ? resolveStatusColor(activeColumn.label, activeColumn.color)
                    : "var(--color-text-muted)",
                } as CSSProperties
              }
            >
              <DatabaseBoardCard
                row={activeRow}
                properties={content.properties}
                onClick={() => {}}
                pageLinkPages={pageLinkPages}
                formulaValues={relationContext?.formulaValues}
                cardPropertyIds={cardPropertyIds}
                done={activeColumn ? isDoneStatus(activeColumn.label) : false}
              />
            </div>
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
          relationContext={relationContext}
          pageLinkPages={pageLinkPages}
          onNavigatePageLink={onNavigatePageLink}
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
  selectedRowId,
  dragActive,
  activeCardHeight,
  onCardClick,
  onAddCard,
  pageLinkPages,
  formulaValues,
  cardPropertyIds,
  canMoveLeft,
  canMoveRight,
  onMoveLeft,
  onMoveRight,
}: {
  id: string;
  label: string;
  color: string;
  rows: DatabaseRow[];
  properties: PropertyDef[];
  selectedRowId: string | null;
  dragActive: boolean;
  activeCardHeight: number;
  onCardClick: (rowId: string) => void;
  onAddCard: () => void;
  pageLinkPages?: Array<{ id: string; title: string }>;
  formulaValues?: Map<string, Map<string, CellValue>>;
  cardPropertyIds?: string[];
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  const colColor = resolveStatusColor(label, color);
  const done = isDoneStatus(label);
  // Dashed slot at the end of the list: the card will join this column (global
  // sorts decide where, so an insertion-position slot would lie).
  const showDropSlot = isOver && dragActive;

  return (
    <section
      ref={setNodeRef}
      className={`db-board-column ${isOver ? "db-board-column-over" : ""}`}
      style={{ "--col-color": colColor } as CSSProperties}
      aria-label={`${label} column`}
    >
      <header className="db-board-column-header">
        <span className="db-group-dot" />
        <span className="db-board-column-name">{label}</span>
        <span className="db-board-column-count">{rows.length}</span>
        <span className="db-board-column-spacer" />
        {(canMoveLeft || canMoveRight) && (
          <span className="db-board-column-reorder">
            {canMoveLeft && (
              <button
                className="db-board-move-btn"
                onClick={onMoveLeft}
                title="Move left"
              >
                ‹
              </button>
            )}
            {canMoveRight && (
              <button
                className="db-board-move-btn"
                onClick={onMoveRight}
                title="Move right"
              >
                ›
              </button>
            )}
          </span>
        )}
      </header>
      <div className="db-board-column-cards">
        {rows.map((row) => (
          <DraggableCard
            key={row.id}
            row={row}
            properties={properties}
            done={done}
            selected={row.id === selectedRowId}
            onClick={() => onCardClick(row.id)}
            pageLinkPages={pageLinkPages}
            formulaValues={formulaValues}
            cardPropertyIds={cardPropertyIds}
          />
        ))}
        {showDropSlot && (
          <div
            className="db-board-drop-slot"
            style={{ height: activeCardHeight }}
          />
        )}
        {rows.length === 0 && !showDropSlot && (
          <div className="db-board-empty-hint">
            Nothing here yet.
            <br />
            Drag a card in, or add one below.
          </div>
        )}
      </div>
      <footer className="db-board-column-foot">
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
      </footer>
    </section>
  );
}

function DraggableCard({
  row,
  properties,
  done,
  selected,
  onClick,
  pageLinkPages,
  formulaValues,
  cardPropertyIds,
}: {
  row: DatabaseRow;
  properties: PropertyDef[];
  done?: boolean;
  selected?: boolean;
  onClick: () => void;
  pageLinkPages?: Array<{ id: string; title: string }>;
  formulaValues?: Map<string, Map<string, CellValue>>;
  cardPropertyIds?: string[];
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
      <DatabaseBoardCard
        row={row}
        properties={properties}
        done={done}
        selected={selected}
        onClick={onClick}
        pageLinkPages={pageLinkPages}
        formulaValues={formulaValues}
        cardPropertyIds={cardPropertyIds}
      />
    </div>
  );
}
