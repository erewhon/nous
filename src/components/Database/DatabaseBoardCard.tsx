import type { DatabaseRow, PropertyDef, CellValue } from "../../types/database";
import { formatNumber } from "./formatNumber";
import {
  evaluateConditionalFormat,
  conditionalStyleToCSS,
} from "./conditionalFormat";
import {
  findDueProperty,
  findIdProperty,
  findPriorityProperty,
  priorityRank,
  resolveOptionPillStyle,
} from "./boardSemantics";

interface DatabaseBoardCardProps {
  row: DatabaseRow;
  properties: PropertyDef[];
  onClick: () => void;
  dragHandleProps?: Record<string, unknown>;
  pageLinkPages?: Array<{ id: string; title: string }>;
  formulaValues?: Map<string, Map<string, CellValue>>;
  /**
   * Property ids (in order) to show on the card, excluding the title. When
   * undefined, falls back to the first 3 non-title properties.
   */
  cardPropertyIds?: string[];
  /**
   * The board's group-by property — excluded from the default field set
   * (the column already carries it), though an explicit cardPropertyIds
   * choice can still include it.
   */
  groupByPropertyId?: string;
  /** Card sits in a Done-style column — muted + strikethrough treatment. */
  done?: boolean;
  /** Card carries the selection wash + index-mark. */
  selected?: boolean;
}

// Date-only strings must be parsed as local dates — new Date("2020-01-02")
// is UTC midnight, which renders as the previous day west of Greenwich.
function parseDateCell(val: CellValue): Date | null {
  if (typeof val !== "string" || val === "") return null;
  const dateOnly = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(val);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDueDate(val: CellValue): string | null {
  const date = parseDateCell(val);
  if (!date) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isPastDue(val: CellValue): boolean {
  const date = parseDateCell(val);
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getTime() < today.getTime();
}

export function DatabaseBoardCard({
  row,
  properties,
  onClick,
  dragHandleProps,
  pageLinkPages,
  formulaValues,
  cardPropertyIds,
  groupByPropertyId,
  done,
  selected,
}: DatabaseBoardCardProps) {
  const titleProp = properties.find((p) => p.type === "text");
  const title = titleProp ? String(row.cells[titleProp.id] ?? "") : "";

  // Which secondary properties to show: an explicit configured list (in order),
  // otherwise the first 3 non-title, non-group properties as a default.
  const secondaryProps =
    cardPropertyIds && cardPropertyIds.length > 0
      ? cardPropertyIds
          .map((id) => properties.find((p) => p.id === id))
          .filter((p): p is PropertyDef => p != null && p.id !== titleProp?.id)
      : properties
          .filter((p) => p.id !== titleProp?.id && p.id !== groupByPropertyId)
          .slice(0, 3);

  // Corkboard slots drawn from the visible set: mono ID + priority glyph on
  // the top rule, tags + due date on the meta rule; everything else renders
  // as the generic property rows below.
  const idProp = findIdProperty(secondaryProps, titleProp?.id);
  const prioProp = findPriorityProperty(secondaryProps);
  const dueProp = findDueProperty(secondaryProps);
  const tagProps = secondaryProps.filter((p) => p.type === "multiSelect");

  const consumed = new Set(
    [idProp?.id, prioProp?.id, dueProp?.id, ...tagProps.map((p) => p.id)].filter(
      (id): id is string => id != null
    )
  );
  const restProps = secondaryProps.filter((p) => !consumed.has(p.id));

  const idText = idProp ? String(row.cells[idProp.id] ?? "") : "";
  const rank = prioProp ? priorityRank(prioProp, row.cells[prioProp.id]) : null;
  const dueText = dueProp ? formatDueDate(row.cells[dueProp.id]) : null;
  const dueLate =
    dueProp != null && !done && dueText != null && isPastDue(row.cells[dueProp.id]);

  const tagPills = tagProps.flatMap((prop) => {
    const val = row.cells[prop.id];
    if (!Array.isArray(val)) return [];
    return val.flatMap((id) => {
      const opt = prop.options?.find((o) => o.id === id);
      if (!opt) return [];
      return [
        <span
          key={`${prop.id}:${id}`}
          className="db-select-pill"
          style={resolveOptionPillStyle(opt)}
        >
          {opt.label}
        </span>,
      ];
    });
  });

  const renderValue = (prop: PropertyDef) => {
    const val = row.cells[prop.id];
    if (val == null || val === "") return null;

    if (prop.type === "select") {
      const opt = prop.options?.find((o) => o.id === val);
      if (!opt) return null;
      return (
        <span
          className="db-select-pill"
          style={resolveOptionPillStyle(opt)}
        >
          {opt.label}
        </span>
      );
    }

    if (prop.type === "checkbox") {
      return <span>{val ? "☑" : "☐"}</span>;
    }

    if (prop.type === "relation" && Array.isArray(val)) {
      return (
        <span className="db-board-card-pills">
          {val.slice(0, 2).map((id, i) => (
            <span key={i} className="db-relation-pill">
              {id.slice(0, 8)}...
            </span>
          ))}
          {val.length > 2 && (
            <span className="db-board-card-more">+{val.length - 2}</span>
          )}
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
      return (
        <span className="db-pagelink-pill">{linked.title || "Untitled"}</span>
      );
    }

    if (prop.type === "number" && typeof val === "number") {
      return (
        <span className="db-board-card-text">
          {formatNumber(val, prop.numberFormat)}
        </span>
      );
    }

    if (prop.type === "date") {
      const formatted = formatDueDate(val);
      if (!formatted) return null;
      return <span className="db-board-card-due">{formatted}</span>;
    }

    return <span className="db-board-card-text">{String(val)}</span>;
  };

  const cardClass = [
    "db-board-card",
    done ? "db-board-card-done" : "",
    selected ? "db-board-card-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cardClass} onClick={onClick} {...dragHandleProps}>
      {(idText || rank != null) && (
        <div className="db-board-card-top">
          {idText && <span className="db-tid">{idText}</span>}
          <span className="db-board-card-spacer" />
          {rank != null && (
            <span
              className={`db-prio db-prio-${rank}`}
              aria-label={`Priority ${rank}`}
            >
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
      )}
      <div className={`db-board-card-title${done ? " db-done-text" : ""}`}>
        {title || "Untitled"}
      </div>
      {(tagPills.length > 0 || dueText) && (
        <div className="db-board-card-meta">
          {tagPills.length > 0 && (
            <span className="db-board-card-tagset">{tagPills}</span>
          )}
          <span className="db-board-card-spacer" />
          {dueText && (
            <span
              className={`db-board-card-due${dueLate ? " db-board-card-due-late" : ""}`}
            >
              {dueText}
            </span>
          )}
        </div>
      )}
      {restProps.map((prop) => {
        const rendered = renderValue(prop);
        if (!rendered) return null;
        const cfCSS = conditionalStyleToCSS(
          evaluateConditionalFormat(prop, row.cells[prop.id] ?? null)
        );
        return (
          <div key={prop.id} className="db-board-card-prop" style={cfCSS}>
            {rendered}
          </div>
        );
      })}
    </div>
  );
}
