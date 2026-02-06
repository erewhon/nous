import { useState, useRef, useEffect, useCallback } from "react";
import type { CellValue, SelectOption } from "../../types/database";
import { SELECT_COLORS } from "../../types/database";

interface CellEditorProps {
  value: CellValue;
  onChange: (value: CellValue) => void;
  options?: SelectOption[];
  onAddOption?: (label: string) => SelectOption;
}

// Text cell — contentEditable div
export function TextCell({ value, onChange }: CellEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!editing) {
    return (
      <div
        className="db-cell-display"
        onDoubleClick={() => {
          setDraft(String(value ?? ""));
          setEditing(true);
        }}
      >
        {String(value ?? "")}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      className="db-cell-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        onChange(draft || null);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onChange(draft || null);
          setEditing(false);
        }
        if (e.key === "Escape") {
          setEditing(false);
        }
        if (e.key === "Tab") {
          onChange(draft || null);
          setEditing(false);
        }
      }}
    />
  );
}

// Number cell
export function NumberCell({ value, onChange }: CellEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!editing) {
    return (
      <div
        className="db-cell-display db-cell-number"
        onDoubleClick={() => {
          setDraft(value != null ? String(value) : "");
          setEditing(true);
        }}
      >
        {value != null ? String(value) : ""}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type="number"
      className="db-cell-input db-cell-number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        onChange(draft ? Number(draft) : null);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onChange(draft ? Number(draft) : null);
          setEditing(false);
        }
        if (e.key === "Escape") setEditing(false);
        if (e.key === "Tab") {
          onChange(draft ? Number(draft) : null);
          setEditing(false);
        }
      }}
    />
  );
}

// Checkbox cell
export function CheckboxCell({ value, onChange }: CellEditorProps) {
  return (
    <div className="db-cell-checkbox">
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
      />
    </div>
  );
}

// Date cell
export function DateCell({ value, onChange }: CellEditorProps) {
  return (
    <input
      type="date"
      className="db-cell-input"
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value || null)}
    />
  );
}

// URL cell — shows clickable link when not editing
export function UrlCell({ value, onChange }: CellEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!editing) {
    const url = String(value ?? "");
    return (
      <div className="db-cell-display" onDoubleClick={() => {
        setDraft(url);
        setEditing(true);
      }}>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="db-cell-link"
            onClick={(e) => e.stopPropagation()}
          >
            {url}
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type="url"
      className="db-cell-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        onChange(draft || null);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onChange(draft || null);
          setEditing(false);
        }
        if (e.key === "Escape") setEditing(false);
        if (e.key === "Tab") {
          onChange(draft || null);
          setEditing(false);
        }
      }}
    />
  );
}

// Select cell — dropdown
export function SelectCell({ value, onChange, options = [], onAddOption }: CellEditorProps) {
  const [open, setOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value);

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="db-cell-select" ref={dropdownRef}>
      <div className="db-cell-display" onClick={() => setOpen(!open)}>
        {selected ? (
          <span className="db-select-pill" style={{ backgroundColor: selected.color + "30", color: selected.color }}>
            {selected.label}
          </span>
        ) : (
          <span className="db-cell-placeholder">Select...</span>
        )}
      </div>
      {open && (
        <div className="db-select-dropdown">
          <button
            className="db-select-option"
            onClick={() => { onChange(null); setOpen(false); }}
          >
            <span className="db-cell-placeholder">Clear</span>
          </button>
          {options.map((opt) => (
            <button
              key={opt.id}
              className="db-select-option"
              onClick={() => { onChange(opt.id); setOpen(false); }}
            >
              <span className="db-select-pill" style={{ backgroundColor: opt.color + "30", color: opt.color }}>
                {opt.label}
              </span>
            </button>
          ))}
          {onAddOption && (
            <div className="db-select-add">
              <input
                type="text"
                placeholder="Add option..."
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newLabel.trim()) {
                    const opt = onAddOption(newLabel.trim());
                    onChange(opt.id);
                    setNewLabel("");
                    setOpen(false);
                  }
                }}
                className="db-select-add-input"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Multi-select cell — pill-style multi-dropdown
export function MultiSelectCell({ value, onChange, options = [], onAddOption }: CellEditorProps) {
  const [open, setOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedIds = Array.isArray(value) ? value : [];
  const selectedOptions = options.filter((o) => selectedIds.includes(o.id));

  const toggleOption = useCallback((optId: string) => {
    if (selectedIds.includes(optId)) {
      onChange(selectedIds.filter((id) => id !== optId));
    } else {
      onChange([...selectedIds, optId]);
    }
  }, [selectedIds, onChange]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="db-cell-select" ref={dropdownRef}>
      <div className="db-cell-display db-cell-multi" onClick={() => setOpen(!open)}>
        {selectedOptions.length > 0 ? (
          selectedOptions.map((opt) => (
            <span key={opt.id} className="db-select-pill" style={{ backgroundColor: opt.color + "30", color: opt.color }}>
              {opt.label}
            </span>
          ))
        ) : (
          <span className="db-cell-placeholder">Select...</span>
        )}
      </div>
      {open && (
        <div className="db-select-dropdown">
          {options.map((opt) => {
            const checked = selectedIds.includes(opt.id);
            return (
              <button
                key={opt.id}
                className={`db-select-option ${checked ? "db-select-option-checked" : ""}`}
                onClick={() => toggleOption(opt.id)}
              >
                <input type="checkbox" checked={checked} readOnly className="db-select-checkbox" />
                <span className="db-select-pill" style={{ backgroundColor: opt.color + "30", color: opt.color }}>
                  {opt.label}
                </span>
              </button>
            );
          })}
          {onAddOption && (
            <div className="db-select-add">
              <input
                type="text"
                placeholder="Add option..."
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newLabel.trim()) {
                    const opt = onAddOption(newLabel.trim());
                    toggleOption(opt.id);
                    setNewLabel("");
                  }
                }}
                className="db-select-add-input"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Helper: pick a color for a new select option
export function pickNextColor(existingOptions: SelectOption[]): string {
  const usedColors = new Set(existingOptions.map((o) => o.color));
  return SELECT_COLORS.find((c) => !usedColors.has(c)) ?? SELECT_COLORS[existingOptions.length % SELECT_COLORS.length];
}
