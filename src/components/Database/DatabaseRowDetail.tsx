import { useState, useEffect, useRef, useCallback } from "react";
import type {
  PropertyDef,
  DatabaseRow,
  CellValue,
  SelectOption,
} from "../../types/database";
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
} from "./CellEditors";
import type { RelationContext } from "./useRelationContext";

interface DatabaseRowDetailProps {
  row: DatabaseRow;
  properties: PropertyDef[];
  onCellChange: (propertyId: string, value: CellValue) => void;
  onAddSelectOption: (propertyId: string, label: string) => SelectOption;
  onClose: () => void;
  onDelete: () => void;
  relationContext?: RelationContext;
}

export function DatabaseRowDetail({
  row,
  properties,
  onCellChange,
  onAddSelectOption,
  onClose,
  onDelete,
  relationContext,
}: DatabaseRowDetailProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const renderEditor = useCallback(
    (prop: PropertyDef) => {
      const value = row.cells[prop.id] ?? null;
      const onChange = (v: CellValue) => onCellChange(prop.id, v);

      // Rollup — read-only
      if (prop.type === "rollup") {
        const rollupVal =
          relationContext?.rollupValues.get(prop.id)?.get(row.id) ?? null;
        return <RollupCell value={rollupVal} />;
      }

      // Back-relation
      if (
        prop.type === "relation" &&
        prop.relationConfig?.direction === "back"
      ) {
        const backValues =
          relationContext?.backRelationValues.get(prop.id)?.get(row.id) ?? [];
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
                title: titleProp
                  ? String(r.cells[titleProp.id] ?? "")
                  : "",
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
              onAddOption={(label) => onAddSelectOption(prop.id, label)}
            />
          );
        case "multiSelect":
          return (
            <MultiSelectCell
              value={value}
              onChange={onChange}
              options={prop.options ?? []}
              onAddOption={(label) => onAddSelectOption(prop.id, label)}
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
        default:
          return <TextCell value={value} onChange={onChange} />;
      }
    },
    [row, onCellChange, onAddSelectOption, relationContext]
  );

  // Title: first text property value
  const titleProp = properties.find((p) => p.type === "text");
  const title = titleProp ? String(row.cells[titleProp.id] ?? "") : "";

  return (
    <div className="db-row-detail-overlay">
      <div ref={panelRef} className="db-row-detail-panel">
        <div className="db-row-detail-header">
          <h3 className="db-row-detail-title">{title || "Untitled"}</h3>
          <button className="db-pe-close" onClick={onClose}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="db-row-detail-body">
          {properties.map((prop) => (
            <div key={prop.id} className="db-row-detail-prop">
              <div className="db-row-detail-prop-label">{prop.name}</div>
              <div className="db-row-detail-prop-value">
                {renderEditor(prop)}
              </div>
            </div>
          ))}
        </div>
        <div className="db-row-detail-footer">
          <button className="db-pe-delete" onClick={onDelete}>
            Delete row
          </button>
        </div>
      </div>
    </div>
  );
}

// Helper hook for row detail modal state used by views
export function useRowDetail() {
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  return { selectedRowId, setSelectedRowId };
}
