import { useCallback, useEffect, useRef, useState } from "react";

interface ResizeHandleProps {
  /** Direction the panel can resize */
  direction: "horizontal" | "vertical";
  /** Callback when resize occurs, receives delta in pixels */
  onResize: (delta: number) => void;
  /** Optional callback when resize starts */
  onResizeStart?: () => void;
  /** Optional callback when resize ends */
  onResizeEnd?: () => void;
  /** Position of the handle relative to the panel */
  position?: "left" | "right" | "top" | "bottom";
}

export function ResizeHandle({
  direction,
  onResize,
  onResizeStart,
  onResizeEnd,
  position = "right",
}: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startPosRef.current = direction === "horizontal" ? e.clientX : e.clientY;
      onResizeStart?.();
    },
    [direction, onResizeStart]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = direction === "horizontal" ? e.clientX : e.clientY;
      const delta = currentPos - startPosRef.current;
      startPosRef.current = currentPos;

      // Invert delta for left/top positioned handles
      const adjustedDelta =
        position === "left" || position === "top" ? -delta : delta;
      onResize(adjustedDelta);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      onResizeEnd?.();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    // Prevent text selection while dragging
    document.body.style.userSelect = "none";
    document.body.style.cursor =
      direction === "horizontal" ? "col-resize" : "row-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isDragging, direction, position, onResize, onResizeEnd]);

  const isHorizontal = direction === "horizontal";

  return (
    <div
      className={`
        flex-shrink-0
        ${isHorizontal ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"}
        ${isHorizontal ? "hover:w-1" : "hover:h-1"}
        group relative
      `}
      onMouseDown={handleMouseDown}
      style={{
        backgroundColor: isDragging
          ? "var(--color-accent)"
          : "transparent",
      }}
    >
      {/* Wider hit area for easier grabbing */}
      <div
        className={`
          absolute
          ${isHorizontal ? "inset-y-0 -left-1 -right-1" : "inset-x-0 -top-1 -bottom-1"}
          ${isHorizontal ? "hover:bg-[--color-border]" : "hover:bg-[--color-border]"}
          transition-colors
        `}
        style={{
          backgroundColor: isDragging
            ? "var(--color-accent)"
            : undefined,
        }}
      />
      {/* Visual indicator line */}
      <div
        className={`
          absolute
          ${isHorizontal ? "inset-y-0 left-0 w-px" : "inset-x-0 top-0 h-px"}
          transition-colors
        `}
        style={{
          backgroundColor: isDragging
            ? "var(--color-accent)"
            : "var(--color-border)",
        }}
      />
    </div>
  );
}
