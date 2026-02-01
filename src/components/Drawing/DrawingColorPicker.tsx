import { useState, useRef, useEffect } from "react";
import { DRAWING_COLORS } from "../../types/drawing";

interface DrawingColorPickerProps {
  strokeColor: string;
  fillColor: string | null;
  onStrokeColorChange: (color: string) => void;
  onFillColorChange: (color: string | null) => void;
  compact?: boolean;
}

export function DrawingColorPicker({
  strokeColor,
  fillColor,
  onStrokeColorChange,
  onFillColorChange,
  compact = false,
}: DrawingColorPickerProps) {
  const [showStrokePicker, setShowStrokePicker] = useState(false);
  const [showFillPicker, setShowFillPicker] = useState(false);
  const [customStroke, setCustomStroke] = useState(strokeColor);
  const [customFill, setCustomFill] = useState(fillColor || "#ffffff");
  const strokePickerRef = useRef<HTMLDivElement>(null);
  const fillPickerRef = useRef<HTMLDivElement>(null);

  // Close picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        strokePickerRef.current &&
        !strokePickerRef.current.contains(e.target as Node)
      ) {
        setShowStrokePicker(false);
      }
      if (
        fillPickerRef.current &&
        !fillPickerRef.current.contains(e.target as Node)
      ) {
        setShowFillPicker(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="drawing-color-picker">
      {/* Stroke color */}
      <div className="drawing-color-picker-item" ref={strokePickerRef}>
        <button
          type="button"
          className="drawing-color-btn"
          onClick={() => setShowStrokePicker(!showStrokePicker)}
          title="Stroke color"
        >
          <span
            className="drawing-color-preview drawing-color-preview--stroke"
            style={{ backgroundColor: strokeColor }}
          />
          {!compact && <span className="drawing-color-label">Stroke</span>}
        </button>

        {showStrokePicker && (
          <div className="drawing-color-dropdown">
            <div className="drawing-color-grid">
              {DRAWING_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  className={`drawing-color-swatch ${strokeColor === color.value ? "drawing-color-swatch--active" : ""}`}
                  style={{ backgroundColor: color.value }}
                  onClick={() => {
                    onStrokeColorChange(color.value);
                    setShowStrokePicker(false);
                  }}
                  title={color.name}
                />
              ))}
            </div>
            <div className="drawing-color-custom">
              <input
                type="color"
                value={customStroke}
                onChange={(e) => setCustomStroke(e.target.value)}
                className="drawing-color-input"
              />
              <input
                type="text"
                value={customStroke}
                onChange={(e) => setCustomStroke(e.target.value)}
                placeholder="#000000"
                className="drawing-color-hex"
              />
              <button
                type="button"
                className="drawing-color-apply"
                onClick={() => {
                  onStrokeColorChange(customStroke);
                  setShowStrokePicker(false);
                }}
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Fill color */}
      <div className="drawing-color-picker-item" ref={fillPickerRef}>
        <button
          type="button"
          className="drawing-color-btn"
          onClick={() => setShowFillPicker(!showFillPicker)}
          title="Fill color"
        >
          <span
            className={`drawing-color-preview drawing-color-preview--fill ${!fillColor ? "drawing-color-preview--none" : ""}`}
            style={{ backgroundColor: fillColor || "transparent" }}
          />
          {!compact && <span className="drawing-color-label">Fill</span>}
        </button>

        {showFillPicker && (
          <div className="drawing-color-dropdown">
            <div className="drawing-color-grid">
              {/* No fill option */}
              <button
                type="button"
                className={`drawing-color-swatch drawing-color-swatch--none ${fillColor === null ? "drawing-color-swatch--active" : ""}`}
                onClick={() => {
                  onFillColorChange(null);
                  setShowFillPicker(false);
                }}
                title="No fill"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="4" y1="4" x2="20" y2="20" />
                </svg>
              </button>
              {DRAWING_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  className={`drawing-color-swatch ${fillColor === color.value ? "drawing-color-swatch--active" : ""}`}
                  style={{ backgroundColor: color.value }}
                  onClick={() => {
                    onFillColorChange(color.value);
                    setShowFillPicker(false);
                  }}
                  title={color.name}
                />
              ))}
            </div>
            <div className="drawing-color-custom">
              <input
                type="color"
                value={customFill}
                onChange={(e) => setCustomFill(e.target.value)}
                className="drawing-color-input"
              />
              <input
                type="text"
                value={customFill}
                onChange={(e) => setCustomFill(e.target.value)}
                placeholder="#ffffff"
                className="drawing-color-hex"
              />
              <button
                type="button"
                className="drawing-color-apply"
                onClick={() => {
                  onFillColorChange(customFill);
                  setShowFillPicker(false);
                }}
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
