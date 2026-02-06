import { useState, useRef, useEffect } from "react";
import type { PropertyDef, PropertyType, DatabaseSort, DatabaseFilter } from "../../types/database";
import { PropertyTypeIcon } from "./PropertyEditor";

interface DatabaseToolbarProps {
  properties: PropertyDef[];
  sorts: DatabaseSort[];
  filters: DatabaseFilter[];
  rowCount: number;
  onAddProperty: (name: string, type: PropertyType) => void;
  onUpdateSorts: (sorts: DatabaseSort[]) => void;
  onUpdateFilters: (filters: DatabaseFilter[]) => void;
}

const TYPE_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "select", label: "Select" },
  { value: "multiSelect", label: "Multi-select" },
  { value: "checkbox", label: "Checkbox" },
  { value: "date", label: "Date" },
  { value: "url", label: "URL" },
];

export function DatabaseToolbar({
  properties,
  sorts,
  filters,
  rowCount,
  onAddProperty,
  onUpdateSorts,
  onUpdateFilters,
}: DatabaseToolbarProps) {
  const [showAddProp, setShowAddProp] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [newPropName, setNewPropName] = useState("");
  const [newPropType, setNewPropType] = useState<PropertyType>("text");

  return (
    <div className="db-toolbar">
      <div className="db-toolbar-left">
        {/* Add property */}
        <div className="db-toolbar-btn-group">
          <button className="db-toolbar-btn" onClick={() => setShowAddProp(!showAddProp)}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Property
          </button>
          {showAddProp && (
            <AddPropertyPopover
              newPropName={newPropName}
              setNewPropName={setNewPropName}
              newPropType={newPropType}
              setNewPropType={setNewPropType}
              onAdd={() => {
                if (newPropName.trim()) {
                  onAddProperty(newPropName.trim(), newPropType);
                  setNewPropName("");
                  setNewPropType("text");
                  setShowAddProp(false);
                }
              }}
              onClose={() => setShowAddProp(false)}
            />
          )}
        </div>

        {/* Filter */}
        <div className="db-toolbar-btn-group">
          <button
            className={`db-toolbar-btn ${filters.length > 0 ? "db-toolbar-btn-active" : ""}`}
            onClick={() => setShowFilter(!showFilter)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            Filter{filters.length > 0 ? ` (${filters.length})` : ""}
          </button>
          {showFilter && (
            <FilterPopover
              properties={properties}
              filters={filters}
              onUpdateFilters={onUpdateFilters}
              onClose={() => setShowFilter(false)}
            />
          )}
        </div>

        {/* Sort */}
        <div className="db-toolbar-btn-group">
          <button
            className={`db-toolbar-btn ${sorts.length > 0 ? "db-toolbar-btn-active" : ""}`}
            onClick={() => setShowSort(!showSort)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 5h10" /><path d="M11 9h7" /><path d="M11 13h4" />
              <path d="M3 17l3 3 3-3" /><path d="M6 18V4" />
            </svg>
            Sort{sorts.length > 0 ? ` (${sorts.length})` : ""}
          </button>
          {showSort && (
            <SortPopover
              properties={properties}
              sorts={sorts}
              onUpdateSorts={onUpdateSorts}
              onClose={() => setShowSort(false)}
            />
          )}
        </div>
      </div>

      <div className="db-toolbar-right">
        <span className="db-toolbar-count">{rowCount} row{rowCount !== 1 ? "s" : ""}</span>
      </div>
    </div>
  );
}

// Add Property Popover
function AddPropertyPopover({
  newPropName, setNewPropName, newPropType, setNewPropType, onAdd, onClose,
}: {
  newPropName: string;
  setNewPropName: (v: string) => void;
  newPropType: PropertyType;
  setNewPropType: (v: PropertyType) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  return (
    <div ref={ref} className="db-popover">
      <div className="db-popover-title">Add Property</div>
      <input
        className="db-pe-input"
        placeholder="Property name"
        value={newPropName}
        onChange={(e) => setNewPropName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }}
        autoFocus
      />
      <div className="db-popover-types">
        {TYPE_OPTIONS.map((t) => (
          <button
            key={t.value}
            className={`db-popover-type-btn ${newPropType === t.value ? "db-popover-type-btn-active" : ""}`}
            onClick={() => setNewPropType(t.value)}
          >
            <PropertyTypeIcon type={t.value} />
            {t.label}
          </button>
        ))}
      </div>
      <button className="db-popover-action" onClick={onAdd}>Add</button>
    </div>
  );
}

// Sort Popover
function SortPopover({
  properties, sorts, onUpdateSorts, onClose,
}: {
  properties: PropertyDef[];
  sorts: DatabaseSort[];
  onUpdateSorts: (sorts: DatabaseSort[]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  const addSort = () => {
    if (properties.length > 0) {
      onUpdateSorts([...sorts, { propertyId: properties[0].id, direction: "asc" }]);
    }
  };

  const removeSort = (idx: number) => {
    onUpdateSorts(sorts.filter((_, i) => i !== idx));
  };

  const updateSort = (idx: number, updates: Partial<DatabaseSort>) => {
    onUpdateSorts(sorts.map((s, i) => i === idx ? { ...s, ...updates } : s));
  };

  return (
    <div ref={ref} className="db-popover">
      <div className="db-popover-title">Sort</div>
      {sorts.map((sort, idx) => {
        return (
          <div key={idx} className="db-popover-row">
            <select
              className="db-pe-select"
              value={sort.propertyId}
              onChange={(e) => updateSort(idx, { propertyId: e.target.value })}
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              className="db-pe-select"
              value={sort.direction}
              onChange={(e) => updateSort(idx, { direction: e.target.value as "asc" | "desc" })}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
            <button className="db-popover-remove" onClick={() => removeSort(idx)}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        );
      })}
      <button className="db-popover-action" onClick={addSort}>Add sort</button>
    </div>
  );
}

// Filter Popover
function FilterPopover({
  properties, filters, onUpdateFilters, onClose,
}: {
  properties: PropertyDef[];
  filters: DatabaseFilter[];
  onUpdateFilters: (filters: DatabaseFilter[]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  const addFilter = () => {
    if (properties.length > 0) {
      onUpdateFilters([...filters, { propertyId: properties[0].id, operator: "contains", value: "" }]);
    }
  };

  const removeFilter = (idx: number) => {
    onUpdateFilters(filters.filter((_, i) => i !== idx));
  };

  const updateFilter = (idx: number, updates: Partial<DatabaseFilter>) => {
    onUpdateFilters(filters.map((f, i) => i === idx ? { ...f, ...updates } : f));
  };

  return (
    <div ref={ref} className="db-popover">
      <div className="db-popover-title">Filter</div>
      {filters.map((filter, idx) => (
        <div key={idx} className="db-popover-row">
          <select
            className="db-pe-select"
            value={filter.propertyId}
            onChange={(e) => updateFilter(idx, { propertyId: e.target.value })}
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            className="db-pe-select"
            value={filter.operator}
            onChange={(e) => updateFilter(idx, { operator: e.target.value })}
          >
            <option value="contains">Contains</option>
            <option value="equals">Equals</option>
            <option value="isEmpty">Is empty</option>
            <option value="isNotEmpty">Is not empty</option>
            <option value="gt">Greater than</option>
            <option value="lt">Less than</option>
          </select>
          {filter.operator !== "isEmpty" && filter.operator !== "isNotEmpty" && (
            <input
              className="db-pe-input"
              value={String(filter.value ?? "")}
              onChange={(e) => updateFilter(idx, { value: e.target.value })}
              placeholder="Value"
            />
          )}
          <button className="db-popover-remove" onClick={() => removeFilter(idx)}>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
      <button className="db-popover-action" onClick={addFilter}>Add filter</button>
    </div>
  );
}
