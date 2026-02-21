import type { DatabaseRow, PropertyDef, CellValue } from "../../types/database";
import { formatNumber } from "./formatNumber";

interface DatabaseBoardCardProps {
  row: DatabaseRow;
  properties: PropertyDef[];
  onClick: () => void;
  dragHandleProps?: Record<string, unknown>;
  pageLinkPages?: Array<{ id: string; title: string }>;
  formulaValues?: Map<string, Map<string, CellValue>>;
}

export function DatabaseBoardCard({
  row,
  properties,
  onClick,
  dragHandleProps,
  pageLinkPages,
  formulaValues,
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

    if (prop.type === "formula") {
      const fv = formulaValues?.get(prop.id)?.get(row.id);
      if (fv == null || fv === "") return null;
      return <span className="db-board-card-text">{String(fv)}</span>;
    }

    if (prop.type === "rollup") {
      // Rollup values are not available in card context (no relation context passed)
      return null;
    }

    if (prop.type === "pageLink" && typeof val === "string") {
      const linked = pageLinkPages?.find((p) => p.id === val);
      if (!linked) return null;
      return <span className="db-pagelink-pill">{linked.title || "Untitled"}</span>;
    }

    if (prop.type === "number" && typeof val === "number") {
      return <span className="db-board-card-text">{formatNumber(val, prop.numberFormat)}</span>;
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
