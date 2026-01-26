import {
  useThemeStore,
  type ThemeMode,
  type ColorScheme,
  type FontFamily,
  type EditorWidth,
  type EditorKeymap,
  type UIMode,
} from "../../stores/themeStore";
import { useUndoHistoryStore } from "../../stores/undoHistoryStore";

const UI_MODES: { value: UIMode; label: string; description: string }[] = [
  {
    value: "classic",
    label: "Classic",
    description: "Sidebar with notebooks, folders, and pages",
  },
  {
    value: "overview",
    label: "Overview",
    description: "Tiled notebook view, like physical notebooks",
  },
];

const THEME_MODES: { value: ThemeMode; label: string; description: string }[] = [
  { value: "light", label: "Light", description: "Light background, dark text" },
  { value: "dark", label: "Dark", description: "Dark background, light text" },
  { value: "system", label: "System", description: "Follow system preference" },
];

const COLOR_SCHEMES: { value: ColorScheme; label: string; colors: string[] }[] = [
  {
    value: "catppuccin",
    label: "Catppuccin",
    colors: ["#8b5cf6", "#cdd6f4", "#1e1e2e"],
  },
  {
    value: "default",
    label: "Default",
    colors: ["#6366f1", "#fafafa", "#18181b"],
  },
  {
    value: "nord",
    label: "Nord",
    colors: ["#88c0d0", "#eceff4", "#2e3440"],
  },
  {
    value: "dracula",
    label: "Dracula",
    colors: ["#bd93f9", "#f8f8f2", "#282a36"],
  },
  {
    value: "tufte",
    label: "Tufte",
    colors: ["#a00000", "#fffff8", "#1a1a18"],
  },
];

const FONT_FAMILIES: { value: FontFamily; label: string; preview: string }[] = [
  { value: "system", label: "System Default", preview: "Aa Bb Cc" },
  { value: "inter", label: "Inter", preview: "Aa Bb Cc" },
  { value: "serif", label: "Serif (Georgia)", preview: "Aa Bb Cc" },
  { value: "tufte", label: "Tufte (Palatino)", preview: "Aa Bb Cc" },
  { value: "jetbrains-mono", label: "JetBrains Mono", preview: "Aa Bb Cc" },
  { value: "fira-code", label: "Fira Code", preview: "Aa Bb Cc" },
];

const EDITOR_WIDTHS: { value: EditorWidth; label: string; description: string }[] = [
  { value: "narrow", label: "Narrow", description: "640px" },
  { value: "medium", label: "Medium", description: "768px" },
  { value: "wide", label: "Wide", description: "960px" },
  { value: "full", label: "Full", description: "100%" },
];

const EDITOR_KEYMAPS: { value: EditorKeymap; label: string; description: string }[] = [
  { value: "standard", label: "Standard", description: "Default editor keybindings" },
  { value: "vim", label: "Vim", description: "VI-style modal editing (hjkl, w, b, i, a, etc.)" },
  { value: "emacs", label: "Emacs", description: "Emacs-style keybindings (C-f, C-b, C-n, C-p, C-k, etc.)" },
];

export function ThemeSettings() {
  const {
    settings,
    resolvedMode,
    uiMode,
    autoHidePanels,
    zenModeSettings,
    setMode,
    setColorScheme,
    setFontFamily,
    setEditorWidth,
    setEditorKeymap,
    setFontSize,
    setLineHeight,
    setUIScale,
    setUIMode,
    setAutoHidePanels,
    setZenModeSettings,
  } = useThemeStore();

  return (
    <div className="space-y-8">
      {/* UI Layout Mode */}
      <div>
        <label
          className="mb-3 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Layout Mode
        </label>
        <div className="grid grid-cols-2 gap-3">
          {UI_MODES.map((mode) => (
            <button
              key={mode.value}
              onClick={() => setUIMode(mode.value)}
              className="flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors"
              style={{
                borderColor:
                  uiMode === mode.value
                    ? "var(--color-accent)"
                    : "var(--color-border)",
                backgroundColor:
                  uiMode === mode.value
                    ? "rgba(139, 92, 246, 0.1)"
                    : "transparent",
              }}
            >
              <div
                className="flex h-12 w-16 items-center justify-center rounded-md border"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                }}
              >
                {mode.value === "classic" ? (
                  <IconSidebar />
                ) : (
                  <IconGrid />
                )}
              </div>
              <div className="text-center">
                <span
                  className="block text-sm font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {mode.label}
                </span>
                <span
                  className="block text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {mode.description}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Panel Behavior */}
      {uiMode === "classic" && (
        <div>
          <label
            className="mb-3 block text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Panel Behavior
          </label>
          <div
            className="rounded-lg border p-4"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "var(--color-bg-secondary)",
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <span
                  className="block text-sm font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Auto-hide Panels
                </span>
                <span
                  className="block text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  All panels slide out together and appear on hover
                </span>
              </div>
              <button
                onClick={() => setAutoHidePanels(!autoHidePanels)}
                className="relative h-6 w-11 rounded-full transition-colors"
                style={{
                  backgroundColor: autoHidePanels
                    ? "var(--color-accent)"
                    : "var(--color-bg-tertiary)",
                }}
              >
                <span
                  className="absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                  style={{
                    transform: autoHidePanels
                      ? "translateX(20px)"
                      : "translateX(2px)",
                  }}
                />
              </button>
            </div>
            {autoHidePanels && (
              <p
                className="mt-3 text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                Tip: Press <kbd className="rounded bg-[--color-bg-tertiary] px-1.5 py-0.5 font-mono text-[10px]">Ctrl+\</kbd> or <kbd className="rounded bg-[--color-bg-tertiary] px-1.5 py-0.5 font-mono text-[10px]">Cmd+\</kbd> to toggle panels
              </p>
            )}
          </div>
        </div>
      )}

      {/* Zen Mode Settings */}
      <div>
        <label
          className="mb-3 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Zen Mode
        </label>
        <div
          className="rounded-lg border p-4 space-y-4"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-secondary)",
          }}
        >
          <p
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            Distraction-free writing mode that hides all UI chrome. Press{" "}
            <kbd className="rounded bg-[--color-bg-tertiary] px-1.5 py-0.5 font-mono text-[10px]">
              Ctrl+Shift+.
            </kbd>{" "}
            or{" "}
            <kbd className="rounded bg-[--color-bg-tertiary] px-1.5 py-0.5 font-mono text-[10px]">
              Cmd+Shift+.
            </kbd>{" "}
            to toggle, or press <kbd className="rounded bg-[--color-bg-tertiary] px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd> to exit.
          </p>
          <div className="flex items-center justify-between">
            <div>
              <span
                className="block text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                Typewriter Scrolling
              </span>
              <span
                className="block text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                Keep the cursor vertically centered while typing
              </span>
            </div>
            <button
              onClick={() =>
                setZenModeSettings({
                  typewriterScrolling: !zenModeSettings.typewriterScrolling,
                })
              }
              className="relative h-6 w-11 rounded-full transition-colors"
              style={{
                backgroundColor: zenModeSettings.typewriterScrolling
                  ? "var(--color-accent)"
                  : "var(--color-bg-tertiary)",
              }}
            >
              <span
                className="absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                style={{
                  transform: zenModeSettings.typewriterScrolling
                    ? "translateX(20px)"
                    : "translateX(2px)",
                }}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Undo History Settings */}
      <UndoHistorySettings />

      {/* Theme Mode */}
      <div>
        <label
          className="mb-3 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Appearance
        </label>
        <div className="grid grid-cols-3 gap-3">
          {THEME_MODES.map((mode) => (
            <button
              key={mode.value}
              onClick={() => setMode(mode.value)}
              className="flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors"
              style={{
                borderColor:
                  settings.mode === mode.value
                    ? "var(--color-accent)"
                    : "var(--color-border)",
                backgroundColor:
                  settings.mode === mode.value
                    ? "rgba(139, 92, 246, 0.1)"
                    : "transparent",
              }}
            >
              <div
                className="flex h-12 w-16 items-center justify-center rounded-md border"
                style={{
                  backgroundColor:
                    mode.value === "light"
                      ? "#ffffff"
                      : mode.value === "dark"
                        ? "#1e1e2e"
                        : resolvedMode === "light"
                          ? "#ffffff"
                          : "#1e1e2e",
                  borderColor:
                    mode.value === "light"
                      ? "#e4e4e7"
                      : mode.value === "dark"
                        ? "#313244"
                        : resolvedMode === "light"
                          ? "#e4e4e7"
                          : "#313244",
                }}
              >
                {mode.value === "system" ? (
                  <IconSystem />
                ) : mode.value === "light" ? (
                  <IconSun color="#18181b" />
                ) : (
                  <IconMoon color="#cdd6f4" />
                )}
              </div>
              <span
                className="text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                {mode.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Color Scheme */}
      <div>
        <label
          className="mb-3 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Color Scheme
        </label>
        <div className="grid grid-cols-2 gap-3">
          {COLOR_SCHEMES.map((scheme) => (
            <button
              key={scheme.value}
              onClick={() => setColorScheme(scheme.value)}
              className="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors"
              style={{
                borderColor:
                  settings.colorScheme === scheme.value
                    ? "var(--color-accent)"
                    : "var(--color-border)",
                backgroundColor:
                  settings.colorScheme === scheme.value
                    ? "rgba(139, 92, 246, 0.1)"
                    : "transparent",
              }}
            >
              <div className="flex gap-1">
                {scheme.colors.map((color, i) => (
                  <div
                    key={i}
                    className="h-6 w-6 rounded-full border"
                    style={{
                      backgroundColor: color,
                      borderColor: "var(--color-border)",
                    }}
                  />
                ))}
              </div>
              <span
                className="font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                {scheme.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Font Family */}
      <div>
        <label
          className="mb-3 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Font Family
        </label>
        <div className="space-y-2">
          {FONT_FAMILIES.map((font) => (
            <button
              key={font.value}
              onClick={() => setFontFamily(font.value)}
              className="flex w-full items-center justify-between rounded-lg border p-3 transition-colors"
              style={{
                borderColor:
                  settings.fontFamily === font.value
                    ? "var(--color-accent)"
                    : "var(--color-border)",
                backgroundColor:
                  settings.fontFamily === font.value
                    ? "rgba(139, 92, 246, 0.1)"
                    : "transparent",
              }}
            >
              <span
                className="font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                {font.label}
              </span>
              <span
                className="text-lg"
                style={{
                  color: "var(--color-text-muted)",
                  fontFamily:
                    font.value === "system"
                      ? "inherit"
                      : font.value === "inter"
                        ? '"Inter", sans-serif'
                        : font.value === "jetbrains-mono"
                          ? '"JetBrains Mono", monospace'
                          : '"Fira Code", monospace',
                }}
              >
                {font.preview}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Font Size */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Editor Font Size
          </label>
          <span
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            {settings.fontSize}px
          </span>
        </div>
        <input
          type="range"
          min="12"
          max="32"
          step="1"
          value={settings.fontSize}
          onChange={(e) => setFontSize(parseInt(e.target.value))}
          className="w-full accent-[--color-accent]"
        />
        <div
          className="mt-1 flex justify-between text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          <span>12px</span>
          <span>32px</span>
        </div>
      </div>

      {/* Line Height */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Line Height
          </label>
          <span
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            {settings.lineHeight.toFixed(1)}
          </span>
        </div>
        <input
          type="range"
          min="1.4"
          max="2.0"
          step="0.1"
          value={settings.lineHeight}
          onChange={(e) => setLineHeight(parseFloat(e.target.value))}
          className="w-full accent-[--color-accent]"
        />
        <div
          className="mt-1 flex justify-between text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          <span>Compact</span>
          <span>Relaxed</span>
        </div>
      </div>

      {/* UI Scale */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            UI Scale
          </label>
          <span
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            {Math.round((settings.uiScale || 1) * 100)}%
          </span>
        </div>
        <input
          type="range"
          min="0.8"
          max="1.3"
          step="0.05"
          value={settings.uiScale || 1}
          onChange={(e) => setUIScale(parseFloat(e.target.value))}
          className="w-full accent-[--color-accent]"
        />
        <div
          className="mt-1 flex justify-between text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          <span>80%</span>
          <span>100%</span>
          <span>130%</span>
        </div>
        <p
          className="mt-2 text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          Scales sidebar, page list, tabs, and other UI elements
        </p>
      </div>

      {/* Editor Width */}
      <div>
        <label
          className="mb-3 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Editor Width
        </label>
        <div className="grid grid-cols-4 gap-2">
          {EDITOR_WIDTHS.map((width) => (
            <button
              key={width.value}
              onClick={() => setEditorWidth(width.value)}
              className="flex flex-col items-center gap-1 rounded-lg border p-3 transition-colors"
              style={{
                borderColor:
                  settings.editorWidth === width.value
                    ? "var(--color-accent)"
                    : "var(--color-border)",
                backgroundColor:
                  settings.editorWidth === width.value
                    ? "rgba(139, 92, 246, 0.1)"
                    : "transparent",
              }}
            >
              <span
                className="text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                {width.label}
              </span>
              <span
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {width.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Editor Keybindings */}
      <div>
        <label
          className="mb-3 block text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Editor Keybindings
        </label>
        <div className="grid grid-cols-2 gap-3">
          {EDITOR_KEYMAPS.map((keymap) => (
            <button
              key={keymap.value}
              onClick={() => setEditorKeymap(keymap.value)}
              className="flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors"
              style={{
                borderColor:
                  settings.editorKeymap === keymap.value
                    ? "var(--color-accent)"
                    : "var(--color-border)",
                backgroundColor:
                  settings.editorKeymap === keymap.value
                    ? "rgba(139, 92, 246, 0.1)"
                    : "transparent",
              }}
            >
              <div
                className="flex h-12 w-16 items-center justify-center rounded-md border"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                }}
              >
                {keymap.value === "vim" ? (
                  <IconVim />
                ) : keymap.value === "emacs" ? (
                  <IconEmacs />
                ) : (
                  <IconKeyboard />
                )}
              </div>
              <div className="text-center">
                <span
                  className="block text-sm font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {keymap.label}
                </span>
                <span
                  className="block text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {keymap.description}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Icons
function IconSun({ color = "currentColor" }: { color?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="M4.93 4.93l1.41 1.41" />
      <path d="M17.66 17.66l1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="M6.34 17.66l-1.41 1.41" />
      <path d="M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function IconMoon({ color = "currentColor" }: { color?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function IconSystem() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-text-muted)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </svg>
  );
}

function IconSidebar() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-text-muted)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

function IconGrid() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-text-muted)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

function IconVim() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-text-muted)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* V shape for Vim */}
      <path d="M4 4l8 16 8-16" />
      <path d="M4 4h3" />
      <path d="M17 4h3" />
    </svg>
  );
}

function IconKeyboard() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-text-muted)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M6 8h.01" />
      <path d="M10 8h.01" />
      <path d="M14 8h.01" />
      <path d="M18 8h.01" />
      <path d="M6 12h.01" />
      <path d="M10 12h.01" />
      <path d="M14 12h.01" />
      <path d="M18 12h.01" />
      <path d="M8 16h8" />
    </svg>
  );
}

function IconEmacs() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-text-muted)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Stylized E for Emacs */}
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 8h8" />
      <path d="M8 12h6" />
      <path d="M8 16h8" />
      <path d="M8 8v8" />
    </svg>
  );
}

function UndoHistorySettings() {
  const { settings, setSettings, clearAllHistory } = useUndoHistoryStore();

  return (
    <div>
      <label
        className="mb-3 block text-sm font-medium"
        style={{ color: "var(--color-text-primary)" }}
      >
        Undo History
      </label>
      <div
        className="rounded-lg border p-4 space-y-4"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
        }}
      >
        <p
          className="text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          Multi-level undo/redo with history panel. Press{" "}
          <kbd className="rounded bg-[--color-bg-tertiary] px-1.5 py-0.5 font-mono text-[10px]">
            Ctrl+Z
          </kbd>{" "}
          to undo,{" "}
          <kbd className="rounded bg-[--color-bg-tertiary] px-1.5 py-0.5 font-mono text-[10px]">
            Ctrl+Shift+Z
          </kbd>{" "}
          to redo.
        </p>

        {/* Max History Size */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span
              className="text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              History Size
            </span>
            <span
              className="text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              {settings.maxHistorySize} states
            </span>
          </div>
          <input
            type="range"
            min="10"
            max="100"
            step="10"
            value={settings.maxHistorySize}
            onChange={(e) => setSettings({ maxHistorySize: parseInt(e.target.value) })}
            className="w-full accent-[--color-accent]"
          />
          <div
            className="mt-1 flex justify-between text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            <span>10</span>
            <span>100</span>
          </div>
        </div>

        {/* Persist History Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <span
              className="block text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Persist History
            </span>
            <span
              className="block text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              Save undo history across sessions (uses storage)
            </span>
          </div>
          <button
            onClick={() => setSettings({ persistHistory: !settings.persistHistory })}
            className="relative h-6 w-11 rounded-full transition-colors"
            style={{
              backgroundColor: settings.persistHistory
                ? "var(--color-accent)"
                : "var(--color-bg-tertiary)",
            }}
          >
            <span
              className="absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
              style={{
                transform: settings.persistHistory
                  ? "translateX(20px)"
                  : "translateX(2px)",
              }}
            />
          </button>
        </div>

        {/* Clear History Button */}
        <button
          onClick={clearAllHistory}
          className="w-full rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-[--color-bg-tertiary]"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-secondary)",
          }}
        >
          Clear All History
        </button>
      </div>
    </div>
  );
}
