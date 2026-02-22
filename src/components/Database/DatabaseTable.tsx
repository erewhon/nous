import { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import type {
  DatabaseContentV2,
  DatabaseView,
  PropertyDef,
  DatabaseRow,
  CellValue,
  SelectOption,
  DatabaseSort,
  TableViewConfig,
  SummaryAggregation,
} from "../../types/database";
import { createDefaultRow } from "../../types/database";
import {
  TextCell,
  NumberCell,
  CheckboxCell,
  DateCell,
  UrlCell,
  SelectCell,
  MultiSelectCell,
  RelationCell,
  RollupCell,
  FormulaCell,
  PageLinkCell,
  pickNextColor,
} from "./CellEditors";
import type { RelationContext } from "./useRelationContext";
import { PropertyEditor, PropertyTypeIcon } from "./PropertyEditor";
import { computeSummary, getAggregationsForType, SUMMARY_LABELS } from "./computeSummary";
import { evaluateConditionalFormat, conditionalStyleToCSS } from "./conditionalFormat";

interface DatabaseTableProps {
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

export function DatabaseTable({
  content,
  view,
  onUpdateContent,
  onUpdateView,
  relationContext,
  pageLinkPages,
  onNavigatePageLink,
}: DatabaseTableProps) {
  const [editingProperty, setEditingProperty] = useState<string | null>(null);
  const headerRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [editorPos, setEditorPos] = useState<{ top: number; left: number } | null>(null);

  // Bulk row selection
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const hasSelection = selectedRowIds.size > 0;
  const selectAllRef = useRef<HTMLInputElement>(null);

  // Position the property editor portal when editingProperty changes
  useLayoutEffect(() => {
    if (!editingProperty) {
      setEditorPos(null);
      return;
    }
    const el = headerRefs.current.get(editingProperty);
    if (el) {
      const rect = el.getBoundingClientRect();
      setEditorPos({ top: rect.bottom + 2, left: rect.left });
    }
  }, [editingProperty]);

  const sorts = view.sorts;
  const filters = view.filters;
  const propertyWidths = view.propertyWidths ?? {};
  const tableConfig = view.config as TableViewConfig;
  const groupByPropertyId = tableConfig.groupByPropertyId ?? null;
  const collapsedGroups = tableConfig.collapsedGroups ?? [];
  const propertySummaries = view.propertySummaries ?? {};
  const hiddenPropertyIds = (tableConfig as TableViewConfig & { hiddenPropertyIds?: string[] }).hiddenPropertyIds ?? [];
  const pinnedColumnCount = tableConfig.pinnedColumnCount ?? 0;

  // Visible properties — filters out hidden columns, but always keeps the first (title) property
  const visibleProperties = useMemo(() => {
    if (hiddenPropertyIds.length === 0) return content.properties;
    const hiddenSet = new Set(hiddenPropertyIds);
    return content.properties.filter(
      (prop, idx) => idx === 0 || !hiddenSet.has(prop.id)
    );
  }, [content.properties, hiddenPropertyIds]);

  // Resolve cell value: check formula → rollup → raw cell
  const resolveCellValue = useCallback(
    (row: DatabaseRow, propId: string): CellValue => {
      const prop = content.properties.find((p) => p.id === propId);
      if (prop?.type === "formula") {
        return relationContext?.formulaValues.get(propId)?.get(row.id) ?? null;
      }
      if (prop?.type === "rollup") {
        return relationContext?.rollupValues.get(propId)?.get(row.id) ?? null;
      }
      return row.cells[propId] ?? null;
    },
    [content.properties, relationContext]
  );

  // Sort and filter rows
  const displayRows = useMemo(() => {
    let rows = [...content.rows];

    // Apply filters
    for (const filter of filters) {
      const prop = content.properties.find((p) => p.id === filter.propertyId);
      if (!prop) continue;
      rows = rows.filter((row) => {
        const cellVal = resolveCellValue(row, filter.propertyId);
        return applyFilter(cellVal, filter.operator, filter.value, prop);
      });
    }

    // Apply sorts
    if (sorts.length > 0) {
      rows.sort((a, b) => {
        for (const sort of sorts) {
          const aVal = resolveCellValue(a, sort.propertyId);
          const bVal = resolveCellValue(b, sort.propertyId);
          const cmp = compareCellValues(aVal, bVal);
          if (cmp !== 0) return sort.direction === "asc" ? cmp : -cmp;
        }
        return 0;
      });
    }

    return rows;
  }, [content.rows, sorts, filters, content.properties, resolveCellValue]);

  // Group rows
  const groupedRows = useMemo(() => {
    if (!groupByPropertyId) return null;

    const prop = content.properties.find((p) => p.id === groupByPropertyId);
    if (!prop) return null;

    const groups = new Map<string, DatabaseRow[]>();
    const noValueKey = "__no_value__";

    for (const row of displayRows) {
      const cellVal = row.cells[groupByPropertyId];
      let key: string;

      if (
        cellVal == null ||
        cellVal === "" ||
        (Array.isArray(cellVal) && cellVal.length === 0)
      ) {
        key = noValueKey;
      } else if (Array.isArray(cellVal)) {
        // multiSelect — put row in each group
        for (const id of cellVal) {
          const existing = groups.get(id) ?? [];
          existing.push(row);
          groups.set(id, existing);
        }
        continue;
      } else {
        key = String(cellVal);
      }

      const existing = groups.get(key) ?? [];
      existing.push(row);
      groups.set(key, existing);
    }

    // Build ordered group list
    const result: {
      key: string;
      label: string;
      color?: string;
      rows: DatabaseRow[];
    }[] = [];

    if (prop.type === "select" || prop.type === "multiSelect") {
      for (const opt of prop.options ?? []) {
        const rows = groups.get(opt.id);
        if (rows) {
          result.push({
            key: opt.id,
            label: opt.label,
            color: opt.color,
            rows,
          });
          groups.delete(opt.id);
        }
      }
    }

    // Remaining groups (non-option values or text/number groups)
    for (const [key, rows] of groups) {
      if (key === noValueKey) continue;
      // For select types, try to find the option
      if (prop.type === "select" || prop.type === "multiSelect") {
        const opt = prop.options?.find((o) => o.id === key);
        result.push({ key, label: opt?.label ?? key, color: opt?.color, rows });
      } else {
        result.push({ key, label: key, rows });
      }
    }

    // "No value" group at end
    const noValueRows = groups.get(noValueKey);
    if (noValueRows) {
      result.push({ key: noValueKey, label: "No value", rows: noValueRows });
    }

    return result;
  }, [displayRows, groupByPropertyId, content.properties]);

  // Toggle group collapse
  const toggleGroupCollapse = useCallback(
    (groupKey: string) => {
      onUpdateView((prev) => {
        const cfg = prev.config as TableViewConfig;
        const current = cfg.collapsedGroups ?? [];
        const isCollapsed = current.includes(groupKey);
        return {
          ...prev,
          config: {
            ...prev.config,
            collapsedGroups: isCollapsed
              ? current.filter((k) => k !== groupKey)
              : [...current, groupKey],
          },
        };
      });
    },
    [onUpdateView]
  );

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

  // Add new row with default values from property definitions
  const handleAddRow = useCallback(() => {
    onUpdateContent((prev) => ({
      ...prev,
      rows: [...prev.rows, createDefaultRow(prev.properties)],
    }));
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

  // Prune stale selections when rows change (e.g. undo/redo)
  useEffect(() => {
    setSelectedRowIds((prev) => {
      if (prev.size === 0) return prev;
      const currentIds = new Set(content.rows.map((r) => r.id));
      const pruned = new Set<string>();
      for (const id of prev) {
        if (currentIds.has(id)) pruned.add(id);
      }
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [content.rows]);

  // Toggle single row selection
  const toggleRowSelection = useCallback((rowId: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  // Select-all toggle (operates on displayRows)
  const handleSelectAll = useCallback(() => {
    const allDisplayIds = displayRows.map((r) => r.id);
    setSelectedRowIds((prev) => {
      const allSelected = allDisplayIds.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(allDisplayIds);
    });
  }, [displayRows]);

  // Update indeterminate state for select-all checkbox
  useEffect(() => {
    if (!selectAllRef.current) return;
    const allDisplayIds = displayRows.map((r) => r.id);
    const selectedCount = allDisplayIds.filter((id) => selectedRowIds.has(id)).length;
    selectAllRef.current.indeterminate =
      selectedCount > 0 && selectedCount < allDisplayIds.length;
  }, [selectedRowIds, displayRows]);

  // Bulk delete
  const handleBulkDelete = useCallback(() => {
    onUpdateContent((prev) => ({
      ...prev,
      rows: prev.rows.filter((r) => !selectedRowIds.has(r.id)),
    }));
    setSelectedRowIds(new Set());
  }, [onUpdateContent, selectedRowIds]);

  // Bulk edit: set a value for a property across all selected rows
  const handleBulkEdit = useCallback(
    (propertyId: string, value: CellValue) => {
      onUpdateContent((prev) => ({
        ...prev,
        rows: prev.rows.map((r) =>
          selectedRowIds.has(r.id)
            ? {
                ...r,
                cells: { ...r.cells, [propertyId]: value },
                updatedAt: new Date().toISOString(),
              }
            : r
        ),
      }));
      setSelectedRowIds(new Set());
    },
    [onUpdateContent, selectedRowIds]
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
        views: prev.views.map((v) => ({
          ...v,
          sorts: v.sorts.filter((s) => s.propertyId !== propertyId),
          filters: v.filters.filter((f) => f.propertyId !== propertyId),
        })),
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
      onUpdateView((prev) => {
        const existingSort = prev.sorts.find(
          (s) => s.propertyId === propertyId
        );
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
    [onUpdateView]
  );

  // Column resize handlers
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, propertyId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth =
        propertyWidths[propertyId] ??
        content.properties.find((p) => p.id === propertyId)?.width ??
        150;

      const handleMove = (moveE: MouseEvent) => {
        const delta = moveE.clientX - startX;
        const newWidth = Math.max(80, startWidth + delta);
        onUpdateView((prev) => ({
          ...prev,
          propertyWidths: { ...prev.propertyWidths, [propertyId]: newWidth },
        }));
      };

      const handleUp = () => {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };

      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
    },
    [propertyWidths, content.properties, onUpdateView]
  );

  const getColWidth = (prop: PropertyDef) =>
    propertyWidths[prop.id] ?? prop.width ?? 150;

  // Compute cumulative left offsets for pinned columns
  const ROW_NUM_WIDTH = 40;
  const pinnedStyles = useMemo(() => {
    const styles: Array<React.CSSProperties> = [];
    let left = ROW_NUM_WIDTH;
    for (let i = 0; i < visibleProperties.length; i++) {
      if (i < pinnedColumnCount) {
        const isLast = i === pinnedColumnCount - 1;
        styles.push({
          position: "sticky",
          left,
          zIndex: 3,
          backgroundColor: "var(--color-bg-secondary)",
          boxShadow: isLast ? "2px 0 4px rgba(0,0,0,0.1)" : undefined,
        });
        left += getColWidth(visibleProperties[i]);
      } else {
        styles.push({});
      }
    }
    return styles;
  }, [visibleProperties, pinnedColumnCount, propertyWidths]);

  // Sticky style for pinned header cells (higher z-index than body)
  const pinnedHeaderStyles = useMemo(() => {
    return pinnedStyles.map((s) =>
      s.position ? { ...s, zIndex: 4 } : s
    );
  }, [pinnedStyles]);

  // Sticky style for pinned footer cells
  const pinnedFooterStyles = useMemo(() => {
    return pinnedStyles.map((s) =>
      s.position ? { ...s, zIndex: 1 } : s
    );
  }, [pinnedStyles]);

  // Row-num sticky style
  const rowNumStickyStyle: React.CSSProperties = {
    position: "sticky",
    left: 0,
    zIndex: 3,
    backgroundColor: "var(--color-bg-secondary)",
  };

  const rowNumHeaderStickyStyle: React.CSSProperties = {
    ...rowNumStickyStyle,
    zIndex: 4,
  };

  // Toggle pin on a column
  const handleTogglePin = useCallback(
    (colIndex: number) => {
      onUpdateView((prev) => {
        const cfg = prev.config as TableViewConfig;
        const current = cfg.pinnedColumnCount ?? 0;
        const newCount = colIndex < current ? colIndex : colIndex + 1;
        return {
          ...prev,
          config: {
            ...prev.config,
            pinnedColumnCount: newCount > 0 ? newCount : undefined,
          },
        };
      });
    },
    [onUpdateView]
  );

  // Render cell based on property type
  const renderCell = (prop: PropertyDef, row: DatabaseRow) => {
    const value = row.cells[prop.id] ?? null;
    const onChange = (v: CellValue) => handleCellChange(row.id, prop.id, v);

    // Formula — read-only computed value
    if (prop.type === "formula") {
      const formulaVal =
        relationContext?.formulaValues.get(prop.id)?.get(row.id) ?? null;
      const formulaErr =
        relationContext?.formulaErrors.get(prop.id)?.get(row.id);
      return <FormulaCell value={formulaVal} error={formulaErr} />;
    }

    // Rollup — read-only computed value
    if (prop.type === "rollup") {
      const rollupVal =
        relationContext?.rollupValues.get(prop.id)?.get(row.id) ?? null;
      return <RollupCell value={rollupVal} />;
    }

    // Back-relation — computed reverse links, editable via updateBackRelation
    if (prop.type === "relation" && prop.relationConfig?.direction === "back") {
      const backValues =
        relationContext?.backRelationValues.get(prop.id)?.get(row.id) ?? [];
      // Get targets from the source DB (which is the "target" for this back-relation)
      const sourcePageId = prop.relationConfig.databasePageId;
      const sourceContent =
        relationContext?.targetContents.get(sourcePageId);
      const targets = sourceContent
        ? sourceContent.rows.map((r) => {
            const titleProp = sourceContent.properties.find(
              (p) => p.type === "text"
            );
            return {
              id: r.id,
              title: titleProp ? String(r.cells[titleProp.id] ?? "") : "",
            };
          })
        : [];
      return (
        <RelationCell
          value={backValues.length > 0 ? backValues : null}
          onChange={(newVal) => {
            const newIds = Array.isArray(newVal) ? newVal : [];
            relationContext?.updateBackRelation(prop.id, row.id, newIds);
          }}
          targets={targets}
        />
      );
    }

    switch (prop.type) {
      case "text":
        return <TextCell value={value} onChange={onChange} />;
      case "number":
        return <NumberCell value={value} onChange={onChange} numberFormat={prop.numberFormat} />;
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
      case "relation":
        return (
          <RelationCell
            value={value}
            onChange={onChange}
            targets={relationContext?.targets.get(prop.id) ?? []}
          />
        );
      case "pageLink":
        return (
          <PageLinkCell
            value={value}
            onChange={onChange}
            pages={pageLinkPages}
            onNavigate={onNavigatePageLink}
          />
        );
      default:
        return <TextCell value={value} onChange={onChange} />;
    }
  };

  const colCount = visibleProperties.length + 1; // +1 for row num column

  const renderRowGroup = (rows: DatabaseRow[], startIdx: number) =>
    rows.map((row, idx) => {
      // Row bg color for pinned cells (match zebra striping)
      const isEven = idx % 2 === 0;
      const rowBg = isEven ? "var(--color-bg-primary)" : "var(--color-bg-secondary)";
      const isSelected = selectedRowIds.has(row.id);
      return (
        <tr key={row.id} className={`db-row${isSelected ? " db-row-selected" : ""}`}>
          <td className="db-row-num" style={rowNumStickyStyle}>
            <span className="db-row-num-text">{startIdx + idx + 1}</span>
            <input
              type="checkbox"
              className="db-row-select-checkbox"
              checked={isSelected}
              onChange={() => toggleRowSelection(row.id)}
            />
            <button
              className="db-row-delete"
              onClick={() => handleDeleteRow(row.id)}
              title="Delete row"
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
          </td>
          {visibleProperties.map((prop, colIdx) => {
            const cfCSS = conditionalStyleToCSS(
              evaluateConditionalFormat(prop, resolveCellValue(row, prop.id))
            );
            const pinStyle = pinnedStyles[colIdx];
            const isPinned = !!pinStyle.position;
            return (
              <td
                key={prop.id}
                className={`db-cell${isPinned ? " db-cell-pinned" : ""}`}
                style={{
                  width: getColWidth(prop),
                  ...cfCSS,
                  ...pinStyle,
                  ...(isPinned ? { backgroundColor: rowBg } : {}),
                }}
              >
                {renderCell(prop, row)}
              </td>
            );
          })}
        </tr>
      );
    });

  return (
    <div className={`db-table-wrapper${hasSelection ? " db-table-selecting" : ""}`}>
      <table className="db-table">
        <thead>
          <tr>
            <th className="db-row-num-header" style={rowNumHeaderStickyStyle}>
              {hasSelection ? (
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  className="db-select-all-checkbox"
                  checked={displayRows.length > 0 && displayRows.every((r) => selectedRowIds.has(r.id))}
                  onChange={handleSelectAll}
                  title="Select all"
                />
              ) : (
                "#"
              )}
            </th>
            {visibleProperties.map((prop, colIdx) => {
              const sort = sorts.find((s) => s.propertyId === prop.id);
              const isPinned = colIdx < pinnedColumnCount;
              return (
                <th
                  key={prop.id}
                  ref={(el) => {
                    if (el) headerRefs.current.set(prop.id, el);
                    else headerRefs.current.delete(prop.id);
                  }}
                  className={`db-col-header${isPinned ? " db-col-pinned" : ""}`}
                  style={{ width: getColWidth(prop), ...pinnedHeaderStyles[colIdx] }}
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
                    <button
                      className={`db-col-pin-icon${isPinned ? " db-col-pin-active" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePin(colIdx);
                      }}
                      title={isPinned ? "Unpin column" : "Pin column"}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill={isPinned ? "currentColor" : "none"}
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 17v5M9 2h6l-1 7h4l-7 8V9H7l2-7z" />
                      </svg>
                    </button>
                  </div>
                  <div
                    className="db-col-resize"
                    onMouseDown={(e) => handleResizeStart(e, prop.id)}
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {groupedRows ? (
            <>
              {groupedRows.map((group) => {
                const isCollapsed = collapsedGroups.includes(group.key);
                return (
                  <GroupRows key={group.key}>
                    <tr className="db-group-header-row">
                      <td colSpan={colCount} className="db-group-header-cell">
                        <button
                          className="db-group-toggle"
                          onClick={() => toggleGroupCollapse(group.key)}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className={`db-group-chevron ${isCollapsed ? "" : "db-group-chevron-open"}`}
                          >
                            <path d="M9 18l6-6-6-6" />
                          </svg>
                        </button>
                        {group.color ? (
                          <span
                            className="db-select-pill"
                            style={{
                              backgroundColor: group.color + "30",
                              color: group.color,
                            }}
                          >
                            {group.label}
                          </span>
                        ) : (
                          <span className="db-group-label">{group.label}</span>
                        )}
                        <span className="db-group-count">
                          {group.rows.length}
                        </span>
                      </td>
                    </tr>
                    {!isCollapsed && renderRowGroup(group.rows, 0)}
                  </GroupRows>
                );
              })}
            </>
          ) : (
            renderRowGroup(displayRows, 0)
          )}
        </tbody>
        <tfoot className="db-tfoot">
          <tr>
            <td className="db-footer-label" style={{ ...rowNumStickyStyle, zIndex: 1 }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 7V4H6v3" /><path d="M18 20v-3H6v3" /><path d="M6 12h12" />
              </svg>
            </td>
            {visibleProperties.map((prop, colIdx) => (
              <td key={prop.id} className="db-footer-cell" style={{ width: getColWidth(prop), ...pinnedFooterStyles[colIdx] }}>
                <SummaryFooterCell
                  prop={prop}
                  aggregation={propertySummaries[prop.id] as SummaryAggregation | undefined}
                  rows={displayRows}
                  computedValues={relationContext?.formulaValues}
                  onSetAggregation={(agg) => {
                    onUpdateView((prev) => ({
                      ...prev,
                      propertySummaries: {
                        ...prev.propertySummaries,
                        [prop.id]: agg,
                      },
                    }));
                  }}
                />
              </td>
            ))}
          </tr>
        </tfoot>
      </table>

      {/* Bulk action bar */}
      {hasSelection && (
        <div className="db-bulk-bar">
          <span className="db-bulk-bar-count">
            {selectedRowIds.size} row{selectedRowIds.size !== 1 ? "s" : ""} selected
          </span>
          <div className="db-bulk-bar-separator" />
          <button
            className="db-bulk-bar-btn db-bulk-bar-btn-danger"
            onClick={handleBulkDelete}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
            Delete
          </button>
          <BulkEditButton
            properties={content.properties}
            onApply={handleBulkEdit}
          />
          <div className="db-bulk-bar-separator" />
          <button
            className="db-bulk-bar-btn"
            onClick={() => setSelectedRowIds(new Set())}
          >
            Deselect
          </button>
        </div>
      )}

      {/* Add row button */}
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

      {/* Property editor rendered via portal to escape table overflow clipping */}
      {editingProperty && editorPos && (() => {
        const prop = content.properties.find((p) => p.id === editingProperty);
        if (!prop) return null;
        return createPortal(
          <div
            style={{
              position: "fixed",
              top: editorPos.top,
              left: editorPos.left,
              zIndex: 100,
            }}
          >
            <PropertyEditor
              property={prop}
              onUpdate={(updates) =>
                handlePropertyUpdate(prop.id, updates)
              }
              onDelete={() => handleDeleteProperty(prop.id)}
              onClose={() => setEditingProperty(null)}
              allProperties={content.properties}
            />
          </div>,
          document.body
        );
      })()}
    </div>
  );
}

// Summary footer cell — shows computed aggregate or "Calculate" placeholder
function SummaryFooterCell({
  prop,
  aggregation,
  rows,
  computedValues,
  onSetAggregation,
}: {
  prop: PropertyDef;
  aggregation?: SummaryAggregation;
  rows: DatabaseRow[];
  computedValues?: Map<string, Map<string, CellValue>>;
  onSetAggregation: (agg: SummaryAggregation) => void;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const validAggregations = getAggregationsForType(prop.type);
  const hasValue = aggregation && aggregation !== "none";
  const displayValue = hasValue
    ? computeSummary(rows, prop.id, aggregation, prop, computedValues)
    : null;

  return (
    <div className="db-footer-cell-inner" ref={dropdownRef}>
      <div
        className={`db-footer-cell-display ${hasValue ? "db-footer-cell-value" : ""}`}
        onClick={() => setOpen(!open)}
      >
        {hasValue ? (
          <>{SUMMARY_LABELS[aggregation]}: {displayValue}</>
        ) : (
          <span className="db-footer-cell-placeholder">Calculate</span>
        )}
      </div>
      {open && (
        <div className="db-select-dropdown db-summary-dropdown">
          {validAggregations.map((agg) => (
            <button
              key={agg}
              className={`db-select-option ${aggregation === agg ? "db-select-option-checked" : ""}`}
              onClick={() => { onSetAggregation(agg); setOpen(false); }}
            >
              {SUMMARY_LABELS[agg]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Bulk edit button — picks a property, then shows a value editor
function BulkEditButton({
  properties,
  onApply,
}: {
  properties: PropertyDef[];
  onApply: (propertyId: string, value: CellValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedProp, setSelectedProp] = useState<PropertyDef | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const popoverRef = useRef<HTMLDivElement>(null);

  // Editable property types (exclude computed)
  const editableProps = properties.filter(
    (p) =>
      p.type !== "formula" &&
      p.type !== "rollup" &&
      !(p.type === "relation" && p.relationConfig?.direction === "back")
  );

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSelectedProp(null);
        setEditValue("");
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const handleApply = () => {
    if (!selectedProp) return;
    let value: CellValue;
    switch (selectedProp.type) {
      case "number":
        value = editValue ? Number(editValue) : null;
        break;
      case "checkbox":
        value = editValue === "true";
        break;
      case "select":
        value = editValue || null;
        break;
      case "multiSelect":
        value = editValue ? [editValue] : [];
        break;
      default:
        value = editValue || null;
    }
    onApply(selectedProp.id, value);
    setOpen(false);
    setSelectedProp(null);
    setEditValue("");
  };

  return (
    <div className="db-bulk-edit-anchor" ref={popoverRef}>
      <button
        className="db-bulk-bar-btn"
        onClick={() => {
          setOpen(!open);
          setSelectedProp(null);
          setEditValue("");
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        Edit property
      </button>
      {open && (
        <div className="db-bulk-edit-popover">
          {!selectedProp ? (
            <>
              <div className="db-bulk-edit-title">Choose property</div>
              {editableProps.map((prop) => (
                <button
                  key={prop.id}
                  className="db-bulk-edit-prop-btn"
                  onClick={() => {
                    setSelectedProp(prop);
                    setEditValue("");
                  }}
                >
                  <span className="db-col-header-icon">
                    <PropertyTypeIcon type={prop.type} />
                  </span>
                  {prop.name}
                </button>
              ))}
            </>
          ) : (
            <div className="db-bulk-edit-value-section">
              <button
                className="db-bulk-edit-back"
                onClick={() => {
                  setSelectedProp(null);
                  setEditValue("");
                }}
              >
                ← Back
              </button>
              <div className="db-bulk-edit-prop-name">{selectedProp.name}</div>
              {selectedProp.type === "checkbox" ? (
                <div className="db-bulk-edit-checkbox-row">
                  <input
                    type="checkbox"
                    checked={editValue === "true"}
                    onChange={(e) =>
                      setEditValue(e.target.checked ? "true" : "false")
                    }
                    style={{ accentColor: "var(--color-accent)" }}
                  />
                  <span className="db-bulk-edit-checkbox-label">
                    {editValue === "true" ? "Checked" : "Unchecked"}
                  </span>
                </div>
              ) : selectedProp.type === "select" ||
                selectedProp.type === "multiSelect" ? (
                <select
                  className="db-bulk-edit-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                >
                  <option value="">— None —</option>
                  {(selectedProp.options ?? []).map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : selectedProp.type === "number" ? (
                <input
                  type="number"
                  className="db-bulk-edit-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  placeholder="Enter number..."
                  autoFocus
                />
              ) : selectedProp.type === "date" ? (
                <input
                  type="date"
                  className="db-bulk-edit-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  autoFocus
                />
              ) : (
                <input
                  type="text"
                  className="db-bulk-edit-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  placeholder="Enter value..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleApply();
                  }}
                />
              )}
              <button className="db-bulk-edit-apply" onClick={handleApply}>
                Apply
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Fragment wrapper for grouped rows to avoid extra DOM nodes
function GroupRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// Helper: compare cell values for sorting
function compareCellValues(a: CellValue, b: CellValue): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;

  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean")
    return Number(a) - Number(b);
  if (Array.isArray(a) && Array.isArray(b))
    return a.join(",").localeCompare(b.join(","));

  return String(a).localeCompare(String(b));
}

// Helper: apply a filter to a cell value
function applyFilter(
  cellVal: CellValue,
  operator: string,
  filterVal: CellValue,
  prop: PropertyDef
): boolean {
  switch (operator) {
    case "isEmpty":
      return (
        cellVal == null ||
        cellVal === "" ||
        (Array.isArray(cellVal) && cellVal.length === 0)
      );
    case "isNotEmpty":
      return (
        cellVal != null &&
        cellVal !== "" &&
        !(Array.isArray(cellVal) && cellVal.length === 0)
      );
    case "equals":
      if (prop.type === "checkbox") {
        return cellVal === (filterVal === "true" || filterVal === true);
      }
      if (prop.type === "multiSelect" && Array.isArray(cellVal)) {
        return cellVal.includes(String(filterVal ?? ""));
      }
      // select: both are option IDs; text/number: string comparison
      return String(cellVal ?? "") === String(filterVal ?? "");
    case "notEquals":
      if (prop.type === "checkbox") {
        return cellVal !== (filterVal === "true" || filterVal === true);
      }
      if (prop.type === "multiSelect" && Array.isArray(cellVal)) {
        return !cellVal.includes(String(filterVal ?? ""));
      }
      return String(cellVal ?? "") !== String(filterVal ?? "");
    case "contains":
      return String(cellVal ?? "")
        .toLowerCase()
        .includes(String(filterVal ?? "").toLowerCase());
    case "doesNotContain":
      return !String(cellVal ?? "")
        .toLowerCase()
        .includes(String(filterVal ?? "").toLowerCase());
    case "gt":
      return Number(cellVal) > Number(filterVal);
    case "gte":
      return Number(cellVal) >= Number(filterVal);
    case "lt":
      return Number(cellVal) < Number(filterVal);
    case "lte":
      return Number(cellVal) <= Number(filterVal);
    case "before":
      return String(cellVal ?? "") < String(filterVal ?? "");
    case "after":
      return String(cellVal ?? "") > String(filterVal ?? "");
    default:
      return true;
  }
}

// Export helpers for reuse in other views
export { compareCellValues, applyFilter };
