import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MENU_WIDTH = 190;

interface BoardColumnMenuProps {
  /** Bounding rect of the trigger button (fixed positioning anchor). */
  anchorRect: DOMRect;
  isNoValue: boolean;
  isPhone: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  wipLimit?: number;
  /** Names of the discovered priority/due properties; items hidden when absent. */
  priorityPropName?: string;
  duePropName?: string;
  onSortByPriority?: () => void;
  onSortByDue?: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onCollapse: () => void;
  onSetWipLimit: (limit: number | null) => void;
  onClose: () => void;
}

/**
 * Column header ⋯ menu. Rendered through a body portal with fixed positioning
 * because the column is a scroll container that would clip an in-flow popover
 * (same pattern as DatabaseTable's property editor).
 */
export function BoardColumnMenu({
  anchorRect,
  isNoValue,
  isPhone,
  canMoveLeft,
  canMoveRight,
  wipLimit,
  priorityPropName,
  duePropName,
  onSortByPriority,
  onSortByDue,
  onMoveLeft,
  onMoveRight,
  onCollapse,
  onSetWipLimit,
  onClose,
}: BoardColumnMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [wipEditing, setWipEditing] = useState(false);
  const [wipValue, setWipValue] = useState(wipLimit != null ? String(wipLimit) : "");

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const left = Math.max(
    8,
    Math.min(anchorRect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)
  );
  const top = anchorRect.bottom + 4;

  const commitWip = () => {
    const parsed = parseInt(wipValue, 10);
    onSetWipLimit(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
    onClose();
  };

  const hasSorts = (priorityPropName || duePropName) != null;

  return createPortal(
    <div
      ref={menuRef}
      className="db-board-col-menu"
      style={{ position: "fixed", top, left, width: MENU_WIDTH, zIndex: 100 }}
    >
      {hasSorts && (
        <>
          <div className="db-board-col-menu-label">Sort board by</div>
          {priorityPropName && (
            <button
              className="db-board-col-menu-item"
              onClick={() => {
                onSortByPriority?.();
                onClose();
              }}
            >
              {priorityPropName}
            </button>
          )}
          {duePropName && (
            <button
              className="db-board-col-menu-item"
              onClick={() => {
                onSortByDue?.();
                onClose();
              }}
            >
              {duePropName}
            </button>
          )}
          <div className="db-board-col-menu-sep" />
        </>
      )}
      {!isNoValue && (canMoveLeft || canMoveRight) && (
        <>
          {canMoveLeft && (
            <button
              className="db-board-col-menu-item"
              onClick={() => {
                onMoveLeft();
                onClose();
              }}
            >
              Move left
            </button>
          )}
          {canMoveRight && (
            <button
              className="db-board-col-menu-item"
              onClick={() => {
                onMoveRight();
                onClose();
              }}
            >
              Move right
            </button>
          )}
          <div className="db-board-col-menu-sep" />
        </>
      )}
      {!isPhone && (
        <button
          className="db-board-col-menu-item"
          onClick={() => {
            onCollapse();
            onClose();
          }}
        >
          Collapse column
        </button>
      )}
      {!isNoValue &&
        (wipEditing ? (
          <div className="db-board-col-menu-wip">
            <input
              type="number"
              min={1}
              autoFocus
              value={wipValue}
              placeholder="Limit"
              onChange={(e) => setWipValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitWip();
              }}
            />
            <button className="db-board-col-menu-wip-set" onClick={commitWip}>
              Set
            </button>
            {wipLimit != null && (
              <button
                className="db-board-col-menu-wip-clear"
                onClick={() => {
                  onSetWipLimit(null);
                  onClose();
                }}
              >
                Clear
              </button>
            )}
          </div>
        ) : (
          <button
            className="db-board-col-menu-item"
            onClick={() => setWipEditing(true)}
          >
            {wipLimit != null ? `WIP limit: ${wipLimit}…` : "Set WIP limit…"}
          </button>
        ))}
    </div>,
    document.body
  );
}
