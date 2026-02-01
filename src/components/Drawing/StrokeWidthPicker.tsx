import { STROKE_WIDTHS } from "../../types/drawing";

interface StrokeWidthPickerProps {
  value: number;
  onChange: (width: number) => void;
  compact?: boolean;
}

export function StrokeWidthPicker({
  value,
  onChange,
  compact = false,
}: StrokeWidthPickerProps) {
  return (
    <div className={`stroke-width-picker ${compact ? "stroke-width-picker--compact" : ""}`}>
      {!compact && <span className="stroke-width-label">Width</span>}
      <div className="stroke-width-options">
        {STROKE_WIDTHS.map((width) => (
          <button
            key={width.value}
            type="button"
            className={`stroke-width-btn ${value === width.value ? "stroke-width-btn--active" : ""}`}
            onClick={() => onChange(width.value)}
            title={`${width.name} (${width.value}px)`}
          >
            <span
              className="stroke-width-preview"
              style={{
                height: `${Math.min(width.value, 8)}px`,
                width: "16px",
                backgroundColor: "currentColor",
                borderRadius: `${width.value / 2}px`,
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
