import { useState, useRef, useCallback } from "react";
import type { PropertyDef, PropertyType, SelectOption, CellValue, NumberFormat, FormulaConfig } from "../../types/database";
import { pickNextColor } from "./CellEditors";
import { evaluateFormula } from "./formulaEvaluator";
import { useFormulaAutocomplete, FormulaDropdown } from "./FormulaAutocomplete";

interface PropertyEditorProps {
  property: PropertyDef;
  onUpdate: (updates: Partial<PropertyDef>) => void;
  onDelete: () => void;
  onClose: () => void;
  allProperties?: PropertyDef[];
}

const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  multiSelect: "Multi-select",
  checkbox: "Checkbox",
  date: "Date",
  url: "URL",
  relation: "Relation",
  rollup: "Rollup",
  pageLink: "Page Link",
  formula: "Formula",
};

export function PropertyEditor({ property, onUpdate, onDelete, onClose, allProperties }: PropertyEditorProps) {
  const [name, setName] = useState(property.name);
  const [newOptionLabel, setNewOptionLabel] = useState("");

  const handleRename = () => {
    if (name.trim() && name !== property.name) {
      onUpdate({ name: name.trim() });
    }
  };

  const handleTypeChange = (newType: PropertyType) => {
    const updates: Partial<PropertyDef> = { type: newType };
    if (newType === "select" || newType === "multiSelect") {
      if (!property.options) {
        updates.options = [];
      }
    }
    onUpdate(updates);
  };

  const handleAddOption = () => {
    if (!newOptionLabel.trim()) return;
    const existing = property.options ?? [];
    const newOption: SelectOption = {
      id: crypto.randomUUID(),
      label: newOptionLabel.trim(),
      color: pickNextColor(existing),
    };
    onUpdate({ options: [...existing, newOption] });
    setNewOptionLabel("");
  };

  const handleRemoveOption = (optId: string) => {
    onUpdate({ options: (property.options ?? []).filter((o) => o.id !== optId) });
  };

  const handleOptionColorChange = (optId: string, color: string) => {
    onUpdate({
      options: (property.options ?? []).map((o) =>
        o.id === optId ? { ...o, color } : o
      ),
    });
  };

  return (
    <div className="db-property-editor" onClick={(e) => e.stopPropagation()}>
      <div className="db-pe-header">
        <span className="db-pe-title">Edit Property</span>
        <button className="db-pe-close" onClick={onClose}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Name */}
      <div className="db-pe-section">
        <label className="db-pe-label">Name</label>
        <input
          className="db-pe-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }}
        />
      </div>

      {/* Type */}
      <div className="db-pe-section">
        <label className="db-pe-label">Type</label>
        {property.relationConfig?.direction === "back" ? (
          <div className="db-pe-readonly">
            Relation (back-link)
          </div>
        ) : property.type === "rollup" ? (
          <div className="db-pe-readonly">
            Rollup
          </div>
        ) : property.type === "formula" ? (
          <div className="db-pe-readonly">
            Formula
          </div>
        ) : (
          <select
            className="db-pe-select"
            value={property.type}
            onChange={(e) => handleTypeChange(e.target.value as PropertyType)}
          >
            {Object.entries(PROPERTY_TYPE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        )}
      </div>

      {/* Options for select/multiSelect */}
      {(property.type === "select" || property.type === "multiSelect") && (
        <div className="db-pe-section">
          <label className="db-pe-label">Options</label>
          <div className="db-pe-options">
            {(property.options ?? []).map((opt) => (
              <div key={opt.id} className="db-pe-option-row">
                <input
                  type="color"
                  value={opt.color}
                  onChange={(e) => handleOptionColorChange(opt.id, e.target.value)}
                  className="db-pe-color-input"
                />
                <span className="db-select-pill" style={{ backgroundColor: opt.color + "30", color: opt.color }}>
                  {opt.label}
                </span>
                <button className="db-pe-option-remove" onClick={() => handleRemoveOption(opt.id)}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
            <div className="db-pe-add-option">
              <input
                type="text"
                placeholder="Add option..."
                value={newOptionLabel}
                onChange={(e) => setNewOptionLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddOption(); }}
                className="db-pe-input"
              />
              <button className="db-pe-add-btn" onClick={handleAddOption}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Number format */}
      {property.type === "number" && (
        <NumberFormatEditor
          format={property.numberFormat}
          onChange={(fmt) => onUpdate({ numberFormat: fmt })}
        />
      )}

      {/* Formula editor */}
      {property.type === "formula" && (
        <FormulaEditor
          formulaConfig={property.formulaConfig}
          onUpdate={(cfg) => onUpdate({ formulaConfig: cfg })}
          allProperties={(allProperties ?? []).filter((p) => p.id !== property.id)}
        />
      )}

      {/* Default value */}
      {property.type !== "relation" && property.type !== "rollup" && property.type !== "pageLink" && property.type !== "formula" && (
        <div className="db-pe-section">
          <label className="db-pe-label">Default value</label>
          <DefaultValueEditor
            type={property.type}
            options={property.options ?? []}
            value={property.defaultValue ?? null}
            onChange={(val) => onUpdate({ defaultValue: val ?? undefined })}
          />
        </div>
      )}

      {/* Delete */}
      <div className="db-pe-section">
        {property.relationConfig?.direction === "back" ? (
          <div className="db-pe-readonly" style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
            Delete the source relation in the other database to remove this back-relation.
          </div>
        ) : (
          <button className="db-pe-delete" onClick={onDelete}>
            Delete Property
          </button>
        )}
      </div>
    </div>
  );
}

// Default value editor per property type
function DefaultValueEditor({
  type,
  options,
  value,
  onChange,
}: {
  type: PropertyType;
  options: SelectOption[];
  value: CellValue;
  onChange: (val: CellValue) => void;
}) {
  switch (type) {
    case "checkbox":
      return (
        <label className="db-pe-default-checkbox">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>Checked by default</span>
        </label>
      );
    case "select":
      return (
        <select
          className="db-pe-select"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">None</option>
          {options.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.label}</option>
          ))}
        </select>
      );
    case "multiSelect":
      return (
        <select
          className="db-pe-select"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">None</option>
          {options.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.label}</option>
          ))}
        </select>
      );
    case "number":
      return (
        <input
          className="db-pe-input"
          type="number"
          placeholder="Default number"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? null : Number(v));
          }}
        />
      );
    case "date":
      return (
        <input
          className="db-pe-input"
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    default:
      // text, url
      return (
        <input
          className="db-pe-input"
          type="text"
          placeholder={`Default ${type} value`}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
  }
}

// Number format editor
function NumberFormatEditor({
  format,
  onChange,
}: {
  format?: NumberFormat;
  onChange: (fmt: NumberFormat | undefined) => void;
}) {
  const style = format?.style ?? "plain";
  const decimals = format?.decimals;
  const thousandsSeparator = format?.thousandsSeparator ?? false;
  const currencySymbol = format?.currencySymbol ?? "$";

  const update = (patch: Partial<NumberFormat>) => {
    onChange({ style, thousandsSeparator, currencySymbol, ...format, ...patch });
  };

  return (
    <div className="db-pe-section">
      <label className="db-pe-label">Format</label>
      <select
        className="db-pe-select"
        value={style}
        onChange={(e) => {
          const s = e.target.value as NumberFormat["style"];
          if (s === "plain" && !thousandsSeparator && decimals == null) {
            onChange(undefined);
          } else {
            update({ style: s });
          }
        }}
      >
        <option value="plain">Plain</option>
        <option value="currency">Currency</option>
        <option value="percent">Percent</option>
      </select>
      <div className="db-pe-numfmt-row">
        <label className="db-pe-label">Decimals</label>
        <input
          className="db-pe-input"
          type="number"
          min={0}
          max={10}
          placeholder="Auto"
          value={decimals != null ? decimals : ""}
          onChange={(e) => {
            const v = e.target.value;
            update({ decimals: v === "" ? undefined : Number(v) });
          }}
          style={{ width: 70 }}
        />
      </div>
      <label className="db-pe-default-checkbox">
        <input
          type="checkbox"
          checked={thousandsSeparator}
          onChange={(e) => update({ thousandsSeparator: e.target.checked })}
        />
        <span>Thousands separator</span>
      </label>
      {style === "currency" && (
        <div className="db-pe-numfmt-row">
          <label className="db-pe-label">Symbol</label>
          <input
            className="db-pe-input"
            type="text"
            value={currencySymbol}
            onChange={(e) => update({ currencySymbol: e.target.value })}
            style={{ width: 60 }}
          />
        </div>
      )}
    </div>
  );
}

// Formula editor component
function FormulaEditor({
  formulaConfig,
  onUpdate,
  allProperties,
}: {
  formulaConfig?: FormulaConfig;
  onUpdate: (cfg: FormulaConfig) => void;
  allProperties: PropertyDef[];
}) {
  const [expression, setExpression] = useState(formulaConfig?.expression ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showFunctions, setShowFunctions] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const columns = allProperties.map((p) => ({ name: p.name, type: p.type }));

  const onExpressionChange = useCallback((newExpr: string, cursorPos: number) => {
    setExpression(newExpr);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(cursorPos, cursorPos);
      }
    });
  }, []);

  const {
    dropdownVisible,
    dropdownItems,
    selectedIndex,
    handleKeyDown,
    handleInput,
    dismiss,
    acceptSuggestion,
  } = useFormulaAutocomplete(textareaRef, columns, expression, onExpressionChange);

  const handleBlur = () => {
    // Validate expression
    if (expression.trim()) {
      const result = evaluateFormula(expression, {});
      // Only show parse errors, not "Unknown column" errors (those are expected)
      if (result.error && !result.error.startsWith("Unknown column")) {
        setValidationError(result.error);
      } else {
        setValidationError(null);
      }
    } else {
      setValidationError(null);
    }
    onUpdate({ ...formulaConfig, expression });
    dismiss();
  };

  const insertColumn = (name: string) => {
    const ref = /\s/.test(name) ? `\`${name}\`` : name;
    setExpression((prev) => prev + ref);
  };

  return (
    <div className="db-pe-section">
      <label className="db-pe-label">Expression</label>
      <div style={{ position: "relative" }}>
        <textarea
          ref={textareaRef}
          className="db-pe-input db-formula-textarea"
          placeholder="e.g. Price * Quantity"
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onBlur={handleBlur}
          rows={3}
        />
        {dropdownVisible && (
          <FormulaDropdown
            items={dropdownItems}
            selectedIndex={selectedIndex}
            onSelect={acceptSuggestion}
          />
        )}
      </div>
      {validationError && (
        <div className="db-formula-validation-error">{validationError}</div>
      )}
      <div className="db-formula-columns">
        <span className="db-pe-label">Columns:</span>
        <div className="db-formula-chips">
          {allProperties.map((p) => (
            <button
              key={p.id}
              className="db-formula-chip"
              onClick={() => insertColumn(p.name)}
              title={`Insert ${p.name}`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>
      <div className="db-formula-result-type">
        <label className="db-pe-label">Result type (optional)</label>
        <select
          className="db-pe-select"
          value={formulaConfig?.resultType ?? ""}
          onChange={(e) =>
            onUpdate({
              ...formulaConfig,
              expression: expression,
              resultType: (e.target.value || undefined) as FormulaConfig["resultType"],
            })
          }
        >
          <option value="">Auto</option>
          <option value="string">String</option>
          <option value="number">Number</option>
          <option value="boolean">Boolean</option>
          <option value="date">Date</option>
        </select>
      </div>
      <button
        className="db-formula-fn-toggle"
        onClick={() => setShowFunctions(!showFunctions)}
      >
        {showFunctions ? "Hide" : "Show"} function reference
      </button>
      {showFunctions && (
        <div className="db-formula-fn-ref">
          <div><strong>Conditional:</strong> if(cond, then, else)</div>
          <div><strong>String:</strong> concat, length, lower, upper, contains, replace, trim</div>
          <div><strong>Math:</strong> abs, round, floor, ceil, min, max, sqrt, pow</div>
          <div><strong>Date:</strong> now, dateAdd(date, n, unit), dateDiff(d1, d2, unit)</div>
          <div><strong>Convert:</strong> toNumber, toString, empty</div>
          <div><strong>Operators:</strong> + - * / % == != {"<"} {">"} {"<="} {">="} && || !</div>
        </div>
      )}
    </div>
  );
}

// Type icon component for column headers
export function PropertyTypeIcon({ type }: { type: PropertyType }) {
  switch (type) {
    case "text":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" />
        </svg>
      );
    case "number":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 9h16" /><path d="M4 15h16" /><path d="M10 3 8 21" /><path d="M16 3 14 21" />
        </svg>
      );
    case "select":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "multiSelect":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" />
        </svg>
      );
    case "checkbox":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" /><path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "date":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" />
        </svg>
      );
    case "url":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      );
    case "relation":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12h8" /><path d="M12 4v16" /><circle cx="18" cy="6" r="3" /><circle cx="18" cy="18" r="3" />
        </svg>
      );
    case "rollup":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v20" /><path d="M2 12h20" /><path d="m4 4 4 4" /><path d="m4 20 4-4" /><path d="m20 4-4 4" /><path d="m20 20-4-4" />
        </svg>
      );
    case "pageLink":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M9 13h6" /><path d="M9 17h3" />
        </svg>
      );
    case "formula":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 4H6a2 2 0 0 0-2 2v2" /><path d="m6 12 4 4-4 4" /><path d="M14 16h6" />
        </svg>
      );
  }
}
