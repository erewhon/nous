import { useState, useRef, useEffect } from "react";
import type { Page } from "../../types/page";
import type {
  PropertyDef,
  PropertyType,
  DatabaseSort,
  DatabaseFilter,
  DatabaseView,
  TableViewConfig,
  DatabaseContentV2,
  DatabaseRow,
  RollupConfig,
  RollupAggregation,
  CellValue,
} from "../../types/database";
import { PropertyTypeIcon } from "./PropertyEditor";
import { exportDatabaseAsCsv } from "./exportCsv";

interface DatabaseToolbarProps {
  properties: PropertyDef[];
  view: DatabaseView;
  rows: DatabaseRow[];
  rowCount: number;
  title?: string;
  onAddProperty: (
    name: string,
    type: PropertyType,
    relationConfig?: { databasePageId: string },
    rollupConfig?: RollupConfig
  ) => void;
  onUpdateSorts: (sorts: DatabaseSort[]) => void;
  onUpdateFilters: (filters: DatabaseFilter[]) => void;
  onUpdateView: (updater: (prev: DatabaseView) => DatabaseView) => void;
  databasePages?: Page[];
  targetContents?: Map<string, DatabaseContentV2>;
  onDeleteProperty?: (propertyId: string) => void;
  pageLinkPages?: Array<{ id: string; title: string }>;
}

const TYPE_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "select", label: "Select" },
  { value: "multiSelect", label: "Multi-select" },
  { value: "checkbox", label: "Checkbox" },
  { value: "date", label: "Date" },
  { value: "url", label: "URL" },
  { value: "pageLink", label: "Page Link" },
  { value: "relation", label: "Relation" },
  { value: "rollup", label: "Rollup" },
];

export function DatabaseToolbar({
  properties,
  view,
  rows,
  rowCount,
  title,
  onAddProperty,
  onUpdateSorts,
  onUpdateFilters,
  onUpdateView,
  databasePages,
  targetContents,
  pageLinkPages,
}: DatabaseToolbarProps) {
  const [showAddProp, setShowAddProp] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showGroup, setShowGroup] = useState(false);
  const [newPropName, setNewPropName] = useState("");
  const [newPropType, setNewPropType] = useState<PropertyType>("text");

  const sorts = view.sorts;
  const filters = view.filters;
  const groupByPropertyId =
    view.type === "table"
      ? ((view.config as TableViewConfig).groupByPropertyId ?? null)
      : null;

  const handleSetGroupBy = (propertyId: string | null) => {
    onUpdateView((prev) => ({
      ...prev,
      config: {
        ...prev.config,
        groupByPropertyId: propertyId,
        collapsedGroups: [],
      },
    }));
    setShowGroup(false);
  };

  return (
    <div className="db-toolbar">
      <div className="db-toolbar-left">
        {/* Add property */}
        <div className="db-toolbar-btn-group">
          <button
            className="db-toolbar-btn"
            onClick={() => setShowAddProp(!showAddProp)}
          >
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
            Property
          </button>
          {showAddProp && (
            <AddPropertyPopover
              newPropName={newPropName}
              setNewPropName={setNewPropName}
              newPropType={newPropType}
              setNewPropType={setNewPropType}
              onAdd={(relationConfig, rollupConfig) => {
                if (newPropName.trim()) {
                  onAddProperty(
                    newPropName.trim(),
                    newPropType,
                    relationConfig,
                    rollupConfig
                  );
                  setNewPropName("");
                  setNewPropType("text");
                  setShowAddProp(false);
                }
              }}
              onClose={() => setShowAddProp(false)}
              databasePages={databasePages}
              properties={properties}
              targetContents={targetContents}
            />
          )}
        </div>

        {/* Filter */}
        <div className="db-toolbar-btn-group">
          <button
            className={`db-toolbar-btn ${filters.length > 0 ? "db-toolbar-btn-active" : ""}`}
            onClick={() => setShowFilter(!showFilter)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
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
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M11 5h10" />
              <path d="M11 9h7" />
              <path d="M11 13h4" />
              <path d="M3 17l3 3 3-3" />
              <path d="M6 18V4" />
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

        {/* Group (table view only) */}
        {view.type === "table" && (
          <div className="db-toolbar-btn-group">
            <button
              className={`db-toolbar-btn ${groupByPropertyId ? "db-toolbar-btn-active" : ""}`}
              onClick={() => setShowGroup(!showGroup)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              Group{groupByPropertyId ? " (1)" : ""}
            </button>
            {showGroup && (
              <GroupPopover
                properties={properties}
                groupByPropertyId={groupByPropertyId}
                onSetGroupBy={handleSetGroupBy}
                onClose={() => setShowGroup(false)}
              />
            )}
          </div>
        )}
        {/* Export CSV */}
        <button
          className="db-toolbar-btn"
          onClick={() => exportDatabaseAsCsv(properties, rows, title || "database", pageLinkPages)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export
        </button>
      </div>

      <div className="db-toolbar-right">
        <span className="db-toolbar-count">
          {rowCount} row{rowCount !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

const AGGREGATION_OPTIONS: { value: RollupAggregation; label: string }[] = [
  { value: "show_original", label: "Show original" },
  { value: "count", label: "Count" },
  { value: "countValues", label: "Count values" },
  { value: "countUnique", label: "Count unique" },
  { value: "sum", label: "Sum" },
  { value: "average", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
  { value: "range", label: "Range" },
  { value: "percent_empty", label: "% empty" },
  { value: "percent_not_empty", label: "% not empty" },
];

// Add Property Popover
function AddPropertyPopover({
  newPropName,
  setNewPropName,
  newPropType,
  setNewPropType,
  onAdd,
  onClose,
  databasePages,
  properties,
  targetContents,
}: {
  newPropName: string;
  setNewPropName: (v: string) => void;
  newPropType: PropertyType;
  setNewPropType: (v: PropertyType) => void;
  onAdd: (
    relationConfig?: { databasePageId: string },
    rollupConfig?: RollupConfig
  ) => void;
  onClose: () => void;
  databasePages?: Page[];
  properties?: PropertyDef[];
  targetContents?: Map<string, DatabaseContentV2>;
}) {
  const [relationTargetPageId, setRelationTargetPageId] = useState<string>("");
  // Rollup config state
  const [rollupRelationId, setRollupRelationId] = useState<string>("");
  const [rollupTargetPropId, setRollupTargetPropId] = useState<string>("");
  const [rollupAggregation, setRollupAggregation] =
    useState<RollupAggregation>("count");

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  // For rollup: get relation properties in this DB
  const relationProperties = (properties ?? []).filter(
    (p) => p.type === "relation" && p.relationConfig?.databasePageId
  );

  // Get the selected relation's target DB properties
  const selectedRelation = relationProperties.find(
    (p) => p.id === rollupRelationId
  );
  const linkedDbContent = selectedRelation?.relationConfig?.databasePageId
    ? targetContents?.get(selectedRelation.relationConfig.databasePageId)
    : null;
  const linkedDbProperties = linkedDbContent?.properties ?? [];

  const handleAdd = () => {
    if (newPropType === "relation" && relationTargetPageId) {
      onAdd({ databasePageId: relationTargetPageId });
    } else if (
      newPropType === "rollup" &&
      rollupRelationId &&
      rollupTargetPropId &&
      rollupAggregation
    ) {
      onAdd(undefined, {
        relationPropertyId: rollupRelationId,
        targetPropertyId: rollupTargetPropId,
        aggregation: rollupAggregation,
      });
    } else {
      onAdd();
    }
    setRelationTargetPageId("");
    setRollupRelationId("");
    setRollupTargetPropId("");
    setRollupAggregation("count");
  };

  const isAddDisabled =
    (newPropType === "relation" && !relationTargetPageId) ||
    (newPropType === "rollup" &&
      (!rollupRelationId || !rollupTargetPropId || !rollupAggregation));

  return (
    <div ref={ref} className="db-popover">
      <div className="db-popover-title">Add Property</div>
      <input
        className="db-pe-input"
        placeholder="Property name"
        value={newPropName}
        onChange={(e) => setNewPropName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !isAddDisabled) handleAdd();
        }}
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
      {newPropType === "relation" && (
        <div className="db-relation-config">
          <label className="db-pe-label">Target Database</label>
          {databasePages && databasePages.length > 0 ? (
            <select
              className="db-pe-select"
              value={relationTargetPageId}
              onChange={(e) => setRelationTargetPageId(e.target.value)}
            >
              <option value="">Select a database...</option>
              {databasePages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          ) : (
            <div className="db-relation-empty">
              No other databases in this notebook
            </div>
          )}
        </div>
      )}
      {newPropType === "rollup" && (
        <div className="db-rollup-config">
          <label className="db-pe-label">Relation</label>
          {relationProperties.length > 0 ? (
            <select
              className="db-pe-select"
              value={rollupRelationId}
              onChange={(e) => {
                setRollupRelationId(e.target.value);
                setRollupTargetPropId("");
              }}
            >
              <option value="">Select a relation...</option>
              {relationProperties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="db-relation-empty">
              No relation properties found. Add a relation first.
            </div>
          )}
          {rollupRelationId && linkedDbProperties.length > 0 && (
            <>
              <label className="db-pe-label">Property</label>
              <select
                className="db-pe-select"
                value={rollupTargetPropId}
                onChange={(e) => setRollupTargetPropId(e.target.value)}
              >
                <option value="">Select a property...</option>
                {linkedDbProperties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.type})
                  </option>
                ))}
              </select>
            </>
          )}
          {rollupRelationId && rollupTargetPropId && (
            <>
              <label className="db-pe-label">Aggregation</label>
              <select
                className="db-pe-select"
                value={rollupAggregation}
                onChange={(e) =>
                  setRollupAggregation(e.target.value as RollupAggregation)
                }
              >
                {AGGREGATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}
      <button
        className="db-popover-action"
        onClick={handleAdd}
        disabled={isAddDisabled}
      >
        Add
      </button>
    </div>
  );
}

// Sort Popover
function SortPopover({
  properties,
  sorts,
  onUpdateSorts,
  onClose,
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
      onUpdateSorts([
        ...sorts,
        { propertyId: properties[0].id, direction: "asc" },
      ]);
    }
  };

  const removeSort = (idx: number) => {
    onUpdateSorts(sorts.filter((_, i) => i !== idx));
  };

  const updateSort = (idx: number, updates: Partial<DatabaseSort>) => {
    onUpdateSorts(sorts.map((s, i) => (i === idx ? { ...s, ...updates } : s)));
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
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              className="db-pe-select"
              value={sort.direction}
              onChange={(e) =>
                updateSort(idx, { direction: e.target.value as "asc" | "desc" })
              }
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
            <button
              className="db-popover-remove"
              onClick={() => removeSort(idx)}
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
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        );
      })}
      <button className="db-popover-action" onClick={addSort}>
        Add sort
      </button>
    </div>
  );
}

// Operators by property type
const OPERATORS_BY_TYPE: Record<string, { value: string; label: string }[]> = {
  text: [
    { value: "contains", label: "Contains" },
    { value: "doesNotContain", label: "Does not contain" },
    { value: "equals", label: "Equals" },
    { value: "notEquals", label: "Not equals" },
    { value: "isEmpty", label: "Is empty" },
    { value: "isNotEmpty", label: "Is not empty" },
  ],
  url: [
    { value: "contains", label: "Contains" },
    { value: "doesNotContain", label: "Does not contain" },
    { value: "equals", label: "Equals" },
    { value: "notEquals", label: "Not equals" },
    { value: "isEmpty", label: "Is empty" },
    { value: "isNotEmpty", label: "Is not empty" },
  ],
  number: [
    { value: "equals", label: "=" },
    { value: "notEquals", label: "\u2260" },
    { value: "gt", label: ">" },
    { value: "gte", label: "\u2265" },
    { value: "lt", label: "<" },
    { value: "lte", label: "\u2264" },
    { value: "isEmpty", label: "Is empty" },
    { value: "isNotEmpty", label: "Is not empty" },
  ],
  select: [
    { value: "equals", label: "Equals" },
    { value: "notEquals", label: "Not equals" },
    { value: "isEmpty", label: "Is empty" },
    { value: "isNotEmpty", label: "Is not empty" },
  ],
  multiSelect: [
    { value: "equals", label: "Contains" },
    { value: "notEquals", label: "Does not contain" },
    { value: "isEmpty", label: "Is empty" },
    { value: "isNotEmpty", label: "Is not empty" },
  ],
  checkbox: [
    { value: "equals", label: "Is" },
    { value: "isEmpty", label: "Is empty" },
    { value: "isNotEmpty", label: "Is not empty" },
  ],
  date: [
    { value: "equals", label: "Equals" },
    { value: "before", label: "Before" },
    { value: "after", label: "After" },
    { value: "isEmpty", label: "Is empty" },
    { value: "isNotEmpty", label: "Is not empty" },
  ],
  pageLink: [
    { value: "isEmpty", label: "Is empty" },
    { value: "isNotEmpty", label: "Is not empty" },
  ],
};

function getOperatorsForType(type: string) {
  return OPERATORS_BY_TYPE[type] ?? OPERATORS_BY_TYPE.text;
}

function getDefaultOperator(type: string) {
  const ops = getOperatorsForType(type);
  return ops[0]?.value ?? "contains";
}

// Filter Popover
function FilterPopover({
  properties,
  filters,
  onUpdateFilters,
  onClose,
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
      const prop = properties[0];
      onUpdateFilters([
        ...filters,
        { propertyId: prop.id, operator: getDefaultOperator(prop.type), value: "" },
      ]);
    }
  };

  const removeFilter = (idx: number) => {
    onUpdateFilters(filters.filter((_, i) => i !== idx));
  };

  const updateFilter = (idx: number, updates: Partial<DatabaseFilter>) => {
    onUpdateFilters(
      filters.map((f, i) => (i === idx ? { ...f, ...updates } : f))
    );
  };

  const handlePropertyChange = (idx: number, newPropertyId: string) => {
    const newProp = properties.find((p) => p.id === newPropertyId);
    if (!newProp) return;
    const currentOp = filters[idx].operator;
    const validOps = getOperatorsForType(newProp.type);
    const isValid = validOps.some((o) => o.value === currentOp);
    updateFilter(idx, {
      propertyId: newPropertyId,
      ...(isValid ? {} : { operator: getDefaultOperator(newProp.type) }),
      value: "",
    });
  };

  return (
    <div ref={ref} className="db-popover">
      <div className="db-popover-title">Filter</div>
      {filters.map((filter, idx) => {
        const prop = properties.find((p) => p.id === filter.propertyId);
        const propType = prop?.type ?? "text";
        const operators = getOperatorsForType(propType);
        const needsValue = filter.operator !== "isEmpty" && filter.operator !== "isNotEmpty";

        return (
          <div key={idx} className="db-popover-row">
            <select
              className="db-pe-select"
              value={filter.propertyId}
              onChange={(e) => handlePropertyChange(idx, e.target.value)}
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              className="db-pe-select"
              value={filter.operator}
              onChange={(e) => updateFilter(idx, { operator: e.target.value })}
            >
              {operators.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>
            {needsValue && (
              <FilterValueInput
                propType={propType}
                options={prop?.options}
                value={filter.value}
                onChange={(v) => updateFilter(idx, { value: v })}
              />
            )}
            <button
              className="db-popover-remove"
              onClick={() => removeFilter(idx)}
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
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        );
      })}
      <button className="db-popover-action" onClick={addFilter}>
        Add filter
      </button>
    </div>
  );
}

// Type-aware filter value input
function FilterValueInput({
  propType,
  options,
  value,
  onChange,
}: {
  propType: string;
  options?: { id: string; label: string; color: string }[];
  value: CellValue;
  onChange: (v: CellValue) => void;
}) {
  switch (propType) {
    case "number":
      return (
        <input
          className="db-pe-input"
          type="number"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Value"
        />
      );
    case "date":
      return (
        <input
          className="db-pe-input"
          type="date"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "select":
    case "multiSelect":
      return (
        <select
          className="db-pe-select"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select...</option>
          {(options ?? []).map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    case "checkbox":
      return (
        <select
          className="db-pe-select"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="true">Checked</option>
          <option value="false">Unchecked</option>
        </select>
      );
    default:
      return (
        <input
          className="db-pe-input"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Value"
        />
      );
  }
}

// Group By Popover
function GroupPopover({
  properties,
  groupByPropertyId,
  onSetGroupBy,
  onClose,
}: {
  properties: PropertyDef[];
  groupByPropertyId: string | null;
  onSetGroupBy: (propertyId: string | null) => void;
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
      <div className="db-popover-title">Group by</div>
      <button
        className={`db-select-option ${!groupByPropertyId ? "db-select-option-checked" : ""}`}
        onClick={() => onSetGroupBy(null)}
      >
        None
      </button>
      {properties.map((prop) => (
        <button
          key={prop.id}
          className={`db-select-option ${groupByPropertyId === prop.id ? "db-select-option-checked" : ""}`}
          onClick={() => onSetGroupBy(prop.id)}
        >
          <PropertyTypeIcon type={prop.type} />
          {prop.name}
        </button>
      ))}
    </div>
  );
}
