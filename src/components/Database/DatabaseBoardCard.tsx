import type { DatabaseRow, PropertyDef } from "../../types/database";

interface DatabaseBoardCardProps {
  row: DatabaseRow;
  properties: PropertyDef[];
  onClick: () => void;
  dragHandleProps?: Record<string, unknown>;
}

export function DatabaseBoardCard({
  row,
  properties,
  onClick,
  dragHandleProps,
}: DatabaseBoardCardProps) {
  const titleProp = properties.find((p) => p.type === "text");
  const title = titleProp ? String(row.cells[titleProp.id] ?? "") : "";

  // Show up to 3 secondary properties
  const secondaryProps = properties
    .filter((p) => p.id !== titleProp?.id)
    .slice(0, 3);

  const renderValue = (prop: PropertyDef) => {
    const val = row.cells[prop.id];
    if (val == null || val === "") return null;

    if (prop.type === "select") {
      const opt = prop.options?.find((o) => o.id === val);
      if (!opt) return null;
      return (
        <span
          className="db-select-pill"
          style={{ backgroundColor: opt.color + "30", color: opt.color }}
        >
          {opt.label}
        </span>
      );
    }

    if (prop.type === "multiSelect" && Array.isArray(val)) {
      return (
        <span className="db-board-card-pills">
          {val.slice(0, 2).map((id) => {
            const opt = prop.options?.find((o) => o.id === id);
            if (!opt) return null;
            return (
              <span
                key={id}
                className="db-select-pill"
                style={{ backgroundColor: opt.color + "30", color: opt.color }}
              >
                {opt.label}
              </span>
            );
          })}
          {val.length > 2 && (
            <span className="db-board-card-more">+{val.length - 2}</span>
          )}
        </span>
      );
    }

    if (prop.type === "checkbox") {
      return <span>{val ? "\u2611" : "\u2610"}</span>;
    }

    if (prop.type === "relation" && Array.isArray(val)) {
      return (
        <span className="db-board-card-pills">
          {val.slice(0, 2).map((id, i) => (
            <span key={i} className="db-relation-pill">{id.slice(0, 8)}...</span>
          ))}
          {val.length > 2 && <span className="db-board-card-more">+{val.length - 2}</span>}
        </span>
      );
    }

    return <span className="db-board-card-text">{String(val)}</span>;
  };

  return (
    <div className="db-board-card" onClick={onClick} {...dragHandleProps}>
      <div className="db-board-card-title">{title || "Untitled"}</div>
      {secondaryProps.map((prop) => {
        const rendered = renderValue(prop);
        if (!rendered) return null;
        return (
          <div key={prop.id} className="db-board-card-prop">
            {rendered}
          </div>
        );
      })}
    </div>
  );
}
