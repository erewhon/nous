import { useState, useEffect, useRef } from "react";

// Predefined color palette
const PRESET_COLORS = [
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Yellow", value: "#eab308" },
  { name: "Lime", value: "#84cc16" },
  { name: "Green", value: "#22c55e" },
  { name: "Emerald", value: "#10b981" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Sky", value: "#0ea5e9" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Indigo", value: "#6366f1" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Purple", value: "#a855f7" },
  { name: "Fuchsia", value: "#d946ef" },
  { name: "Pink", value: "#ec4899" },
];

interface ColorPickerProps {
  value: string | undefined;
  onChange: (color: string | undefined) => void;
  showClear?: boolean;
}

export function ColorPicker({
  value,
  onChange,
  showClear = true,
}: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customColor, setCustomColor] = useState(value || "");
  const containerRef = useRef<HTMLDivElement>(null);

  // Update custom color when value changes externally
  useEffect(() => {
    setCustomColor(value || "");
  }, [value]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handlePresetClick = (color: string) => {
    onChange(color);
    setCustomColor(color);
    setIsOpen(false);
  };

  const handleCustomColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    setCustomColor(newColor);
    // Only update if it's a valid hex color
    if (/^#[0-9A-Fa-f]{6}$/.test(newColor)) {
      onChange(newColor);
    }
  };

  const handleClear = () => {
    onChange(undefined);
    setCustomColor("");
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Color button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:opacity-80"
        style={{
          backgroundColor: value || "var(--color-bg-tertiary)",
          borderColor: value ? value : "var(--color-border)",
        }}
        title={value ? `Color: ${value}` : "Choose color"}
      >
        {!value && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-text-muted)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 18a6 6 0 0 0 0-12v12z" fill="var(--color-text-muted)" />
          </svg>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-64 rounded-lg border p-3 shadow-lg"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          {/* Preset colors */}
          <div className="mb-3 grid grid-cols-8 gap-1.5">
            {PRESET_COLORS.map((color) => (
              <button
                key={color.value}
                type="button"
                onClick={() => handlePresetClick(color.value)}
                className="h-6 w-6 rounded border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: color.value,
                  borderColor:
                    value === color.value ? "white" : "transparent",
                  boxShadow:
                    value === color.value
                      ? "0 0 0 1px var(--color-accent)"
                      : "none",
                }}
                title={color.name}
              />
            ))}
          </div>

          {/* Custom color input */}
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={customColor || "#6366f1"}
              onChange={(e) => {
                setCustomColor(e.target.value);
                onChange(e.target.value);
              }}
              className="h-8 w-8 cursor-pointer rounded border-0"
              style={{ backgroundColor: "transparent" }}
            />
            <input
              type="text"
              value={customColor}
              onChange={handleCustomColorChange}
              placeholder="#000000"
              className="flex-1 rounded border px-2 py-1 text-sm outline-none"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>

          {/* Clear button */}
          {showClear && value && (
            <button
              type="button"
              onClick={handleClear}
              className="mt-2 w-full rounded px-2 py-1 text-sm transition-colors hover:opacity-80"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-secondary)",
              }}
            >
              Clear Color
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Inline color picker for use in forms/dialogs
export function InlineColorPicker({
  value,
  onChange,
  showClear = true,
}: ColorPickerProps) {
  const [customColor, setCustomColor] = useState(value || "");

  useEffect(() => {
    setCustomColor(value || "");
  }, [value]);

  const handlePresetClick = (color: string) => {
    onChange(color);
    setCustomColor(color);
  };

  const handleClear = () => {
    onChange(undefined);
    setCustomColor("");
  };

  return (
    <div className="space-y-2">
      {/* Preset colors */}
      <div className="grid grid-cols-8 gap-1.5">
        {PRESET_COLORS.map((color) => (
          <button
            key={color.value}
            type="button"
            onClick={() => handlePresetClick(color.value)}
            className="h-6 w-6 rounded border-2 transition-transform hover:scale-110"
            style={{
              backgroundColor: color.value,
              borderColor: value === color.value ? "white" : "transparent",
              boxShadow:
                value === color.value
                  ? "0 0 0 1px var(--color-accent)"
                  : "none",
            }}
            title={color.name}
          />
        ))}
      </div>

      {/* Custom color input */}
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={customColor || "#6366f1"}
          onChange={(e) => {
            setCustomColor(e.target.value);
            onChange(e.target.value);
          }}
          className="h-8 w-8 cursor-pointer rounded border-0"
          style={{ backgroundColor: "transparent" }}
        />
        <input
          type="text"
          value={customColor}
          onChange={(e) => {
            const newColor = e.target.value;
            setCustomColor(newColor);
            if (/^#[0-9A-Fa-f]{6}$/.test(newColor)) {
              onChange(newColor);
            }
          }}
          placeholder="#000000"
          className="flex-1 rounded border px-2 py-1 text-sm outline-none"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
        {showClear && value && (
          <button
            type="button"
            onClick={handleClear}
            className="rounded px-2 py-1 text-xs transition-colors hover:opacity-80"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-muted)",
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
