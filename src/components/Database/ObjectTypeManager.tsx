import { useState } from "react";
import type { ObjectType, PropertyType, DatabaseViewType, CellValue } from "../../types/database";
import { useObjectTypeStore } from "../../stores/objectTypeStore";
import { PropertyTypeIcon } from "./PropertyEditor";
import "./database-styles.css";

const PROPERTY_TYPE_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "select", label: "Select" },
  { value: "multiSelect", label: "Multi-select" },
  { value: "checkbox", label: "Checkbox" },
  { value: "date", label: "Date" },
  { value: "url", label: "URL" },
];

interface ObjectTypeManagerProps {
  onClose: () => void;
}

export function ObjectTypeManager({ onClose }: ObjectTypeManagerProps) {
  const { addType, updateType, deleteType, addPropertyToType, removePropertyFromType, updatePropertyInType } =
    useObjectTypeStore();
  const allTypes = useObjectTypeStore((s) => s.getAllTypes());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState("\ud83d\udcc4");
  const [newDescription, setNewDescription] = useState("");
  const [newPropName, setNewPropName] = useState("");
  const [newPropType, setNewPropType] = useState<PropertyType>("text");

  const editingType = editingId ? allTypes.find((t) => t.id === editingId) : null;

  const handleCreate = () => {
    if (!newName.trim()) return;
    const created = addType(newName.trim(), newIcon, newDescription.trim() || undefined);
    setNewName("");
    setNewIcon("\ud83d\udcc4");
    setNewDescription("");
    setShowCreateForm(false);
    setEditingId(created.id);
  };

  const handleAddProperty = () => {
    if (!editingId || !newPropName.trim()) return;
    addPropertyToType(editingId, newPropName.trim(), newPropType);
    setNewPropName("");
    setNewPropType("text");
  };

  return (
    <div className="db-object-type-manager">
      <div className="db-object-type-header">
        <h3 className="db-object-type-title">Object Types</h3>
        <button className="db-pe-close" onClick={onClose}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {editingType ? (
        <div className="db-object-type-edit">
          <button
            className="db-toolbar-btn"
            onClick={() => setEditingId(null)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back
          </button>

          <div className="db-object-type-edit-header">
            <span className="db-object-type-icon-large">{editingType.icon}</span>
            {editingType.builtIn ? (
              <span className="db-object-type-name-display">{editingType.name}</span>
            ) : (
              <input
                className="db-pe-input db-object-type-name-input"
                value={editingType.name}
                onChange={(e) => updateType(editingType.id, { name: e.target.value })}
              />
            )}
          </div>

          {editingType.description && (
            <p className="db-object-type-description">{editingType.description}</p>
          )}

          <div className="db-pe-section">
            <label className="db-pe-label">Properties</label>
            <div className="db-object-type-props">
              {editingType.properties.map((prop, idx) => (
                <div key={idx} className="db-object-type-prop-row">
                  <PropertyTypeIcon type={prop.type} />
                  <span className="db-object-type-prop-name">{prop.name}</span>
                  <span className="db-object-type-prop-type">{prop.type}</span>
                  {!editingType.builtIn && (
                    <>
                      <OTDefaultValueInput
                        prop={prop}
                        onChange={(val) => updatePropertyInType(editingType.id, idx, { defaultValue: val ?? undefined })}
                      />
                      <button
                        className="db-pe-option-remove"
                        onClick={() => removePropertyFromType(editingType.id, idx)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>

            {!editingType.builtIn && (
              <div className="db-object-type-add-prop">
                <input
                  className="db-pe-input"
                  placeholder="Property name"
                  value={newPropName}
                  onChange={(e) => setNewPropName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddProperty(); }}
                />
                <select
                  className="db-pe-select"
                  value={newPropType}
                  onChange={(e) => setNewPropType(e.target.value as PropertyType)}
                >
                  {PROPERTY_TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <button className="db-pe-add-btn" onClick={handleAddProperty}>Add</button>
              </div>
            )}
          </div>

          {/* View configuration (custom types only) */}
          {!editingType.builtIn && (
            <div className="db-pe-section">
              <label className="db-pe-label">Default View</label>
              <div className="db-ot-view-config">
                <select
                  className="db-pe-select"
                  value={editingType.defaultViewType ?? "table"}
                  onChange={(e) => updateType(editingType.id, { defaultViewType: (e.target.value || undefined) as DatabaseViewType })}
                >
                  <option value="table">Table</option>
                  <option value="board">Board</option>
                  <option value="gallery">Gallery</option>
                  <option value="list">List</option>
                  <option value="calendar">Calendar</option>
                </select>

                {/* Group-by property (for board/table) */}
                {(editingType.defaultViewType === "board" || editingType.defaultViewType === "table") && (
                  <div className="db-ot-view-field">
                    <label className="db-pe-label-sm">Group by</label>
                    <select
                      className="db-pe-select"
                      value={editingType.defaultGroupByPropertyName ?? ""}
                      onChange={(e) => updateType(editingType.id, { defaultGroupByPropertyName: e.target.value || undefined })}
                    >
                      <option value="">None</option>
                      {editingType.properties
                        .filter((p) => p.type === "select" || p.type === "multiSelect")
                        .map((p, i) => (
                          <option key={i} value={p.name}>{p.name}</option>
                        ))}
                    </select>
                  </div>
                )}

                {/* Date property (for calendar) */}
                {editingType.defaultViewType === "calendar" && (
                  <div className="db-ot-view-field">
                    <label className="db-pe-label-sm">Date property</label>
                    <select
                      className="db-pe-select"
                      value={editingType.defaultDatePropertyName ?? ""}
                      onChange={(e) => updateType(editingType.id, { defaultDatePropertyName: e.target.value || undefined })}
                    >
                      <option value="">None</option>
                      {editingType.properties
                        .filter((p) => p.type === "date")
                        .map((p, i) => (
                          <option key={i} value={p.name}>{p.name}</option>
                        ))}
                    </select>
                  </div>
                )}

                {/* Default sort */}
                <div className="db-ot-view-field">
                  <label className="db-pe-label-sm">Default sort</label>
                  <div className="db-ot-sort-row">
                    <select
                      className="db-pe-select"
                      value={editingType.defaultSorts?.[0]?.propertyName ?? ""}
                      onChange={(e) => {
                        const name = e.target.value;
                        if (!name) {
                          updateType(editingType.id, { defaultSorts: undefined });
                        } else {
                          const dir = editingType.defaultSorts?.[0]?.direction ?? "asc";
                          updateType(editingType.id, { defaultSorts: [{ propertyName: name, direction: dir }] });
                        }
                      }}
                    >
                      <option value="">None</option>
                      {editingType.properties.map((p, i) => (
                        <option key={i} value={p.name}>{p.name}</option>
                      ))}
                    </select>
                    {editingType.defaultSorts?.[0] && (
                      <select
                        className="db-pe-select"
                        value={editingType.defaultSorts[0].direction}
                        onChange={(e) => {
                          const dir = e.target.value as "asc" | "desc";
                          updateType(editingType.id, {
                            defaultSorts: [{ propertyName: editingType.defaultSorts![0].propertyName, direction: dir }],
                          });
                        }}
                      >
                        <option value="asc">Ascending</option>
                        <option value="desc">Descending</option>
                      </select>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {!editingType.builtIn && (
            <button
              className="db-pe-delete"
              onClick={() => {
                deleteType(editingType.id);
                setEditingId(null);
              }}
            >
              Delete Object Type
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="db-object-type-list">
            {allTypes.map((ot) => (
              <button
                key={ot.id}
                className="db-object-type-card"
                onClick={() => setEditingId(ot.id)}
              >
                <span className="db-object-type-card-icon">{ot.icon}</span>
                <div className="db-object-type-card-info">
                  <span className="db-object-type-card-name">
                    {ot.name}
                    {ot.builtIn && <span className="db-object-type-badge">Built-in</span>}
                  </span>
                  {ot.description && (
                    <span className="db-object-type-card-desc">{ot.description}</span>
                  )}
                  <span className="db-object-type-card-props">
                    {ot.properties.length} properties
                  </span>
                </div>
              </button>
            ))}
          </div>

          {showCreateForm ? (
            <div className="db-object-type-create-form">
              <input
                className="db-pe-input"
                placeholder="Type name (e.g. Recipe, Task)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                autoFocus
              />
              <div className="db-object-type-create-row">
                <input
                  className="db-pe-input db-object-type-icon-input"
                  placeholder="Icon"
                  value={newIcon}
                  onChange={(e) => setNewIcon(e.target.value)}
                  maxLength={2}
                />
                <input
                  className="db-pe-input"
                  placeholder="Description (optional)"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                />
              </div>
              <div className="db-object-type-create-actions">
                <button className="db-pe-add-btn" onClick={handleCreate}>Create</button>
                <button className="db-toolbar-btn" onClick={() => setShowCreateForm(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button
              className="db-popover-action"
              onClick={() => setShowCreateForm(true)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New Object Type
            </button>
          )}
        </>
      )}
    </div>
  );
}

// Inline default value input for a property in the ObjectTypeManager
function OTDefaultValueInput({
  prop,
  onChange,
}: {
  prop: { name: string; type: PropertyType; options?: { id: string; label: string; color: string }[]; defaultValue?: CellValue };
  onChange: (val: CellValue) => void;
}) {
  const val = prop.defaultValue ?? null;

  if (prop.type === "checkbox") {
    return (
      <input
        type="checkbox"
        className="db-ot-default-checkbox"
        checked={val === true}
        onChange={(e) => onChange(e.target.checked)}
        title="Default value"
      />
    );
  }
  if (prop.type === "select" || prop.type === "multiSelect") {
    return (
      <select
        className="db-ot-default-select"
        value={typeof val === "string" ? val : ""}
        onChange={(e) => onChange(e.target.value || null)}
        title="Default value"
      >
        <option value="">No default</option>
        {(prop.options ?? []).map((opt) => (
          <option key={opt.id} value={opt.id}>{opt.label}</option>
        ))}
      </select>
    );
  }
  if (prop.type === "number") {
    return (
      <input
        className="db-ot-default-input"
        type="number"
        placeholder="Default"
        value={typeof val === "number" ? val : ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        title="Default value"
      />
    );
  }
  if (prop.type === "relation" || prop.type === "rollup") {
    return null;
  }
  return (
    <input
      className="db-ot-default-input"
      type={prop.type === "date" ? "date" : "text"}
      placeholder="Default"
      value={typeof val === "string" ? val : ""}
      onChange={(e) => onChange(e.target.value || null)}
      title="Default value"
    />
  );
}

/**
 * Object type picker for database creation — shows a grid of available types
 * including built-in and custom. Selecting one creates a database with those properties.
 */
interface ObjectTypePickerProps {
  onSelect: (objectType: ObjectType | null) => void;
  onManageTypes: () => void;
}

export function ObjectTypePicker({ onSelect, onManageTypes }: ObjectTypePickerProps) {
  const allTypes = useObjectTypeStore((s) => s.getAllTypes());

  return (
    <div className="db-object-type-picker">
      <div className="db-object-type-picker-header">
        <span className="db-popover-title">Choose a template</span>
        <button className="db-toolbar-btn" onClick={onManageTypes}>
          Manage Types
        </button>
      </div>
      <button
        className="db-object-type-picker-option"
        onClick={() => onSelect(null)}
      >
        <span className="db-object-type-card-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </span>
        <div className="db-object-type-card-info">
          <span className="db-object-type-card-name">Empty Database</span>
          <span className="db-object-type-card-desc">Start from scratch with a single text column</span>
        </div>
      </button>
      {allTypes.map((ot) => (
        <button
          key={ot.id}
          className="db-object-type-picker-option"
          onClick={() => onSelect(ot)}
        >
          <span className="db-object-type-card-icon">{ot.icon}</span>
          <div className="db-object-type-card-info">
            <span className="db-object-type-card-name">{ot.name}</span>
            {ot.description && (
              <span className="db-object-type-card-desc">{ot.description}</span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
