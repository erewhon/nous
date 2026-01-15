import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";
export type ColorScheme = "default" | "catppuccin" | "nord" | "dracula";
export type FontFamily = "system" | "inter" | "jetbrains-mono" | "fira-code";
export type EditorWidth = "narrow" | "medium" | "wide" | "full";
export type UIMode = "classic" | "overview";
export type NotebookSortOption = "name-asc" | "name-desc" | "updated" | "created" | "pages";
export type EditorKeymap = "standard" | "vim" | "emacs";

interface ThemeSettings {
  mode: ThemeMode;
  colorScheme: ColorScheme;
  fontFamily: FontFamily;
  editorWidth: EditorWidth;
  editorKeymap: EditorKeymap;
  fontSize: number; // 12-20
  lineHeight: number; // 1.4-2.0
}

interface ThemeState {
  settings: ThemeSettings;
  resolvedMode: "light" | "dark"; // Actual mode after resolving "system"
  showPageStats: boolean;
  uiMode: UIMode;
  notebookSortBy: NotebookSortOption;
  setMode: (mode: ThemeMode) => void;
  setColorScheme: (scheme: ColorScheme) => void;
  setFontFamily: (font: FontFamily) => void;
  setEditorWidth: (width: EditorWidth) => void;
  setEditorKeymap: (keymap: EditorKeymap) => void;
  setFontSize: (size: number) => void;
  setLineHeight: (height: number) => void;
  togglePageStats: () => void;
  setUIMode: (mode: UIMode) => void;
  setNotebookSortBy: (sort: NotebookSortOption) => void;
  applyTheme: () => void;
}

const DEFAULT_SETTINGS: ThemeSettings = {
  mode: "dark",
  colorScheme: "catppuccin",
  fontFamily: "system",
  editorWidth: "medium",
  editorKeymap: "standard",
  fontSize: 16,
  lineHeight: 1.6,
};

// Color schemes definitions
const COLOR_SCHEMES = {
  catppuccin: {
    dark: {
      // Catppuccin Mocha
      "--color-bg-primary": "#1e1e2e",
      "--color-bg-secondary": "#181825",
      "--color-bg-tertiary": "#313244",
      "--color-bg-elevated": "#45475a",
      "--color-bg-sidebar": "#11111b",
      "--color-bg-panel": "#1e1e2e",
      "--color-text-primary": "#cdd6f4",
      "--color-text-secondary": "#a6adc8",
      "--color-text-muted": "#6c7086",
      "--color-accent": "#8b5cf6",
      "--color-accent-hover": "#a78bfa",
      "--color-accent-secondary": "#7c3aed",
      "--color-accent-tertiary": "#6d28d9",
      "--color-success": "#a6e3a1",
      "--color-warning": "#f9e2af",
      "--color-error": "#f38ba8",
      "--color-info": "#89b4fa",
      "--color-border": "#313244",
      "--color-border-muted": "#1e1e2e",
      "--color-selection": "rgba(139, 92, 246, 0.3)",
    },
    light: {
      // Catppuccin Latte
      "--color-bg-primary": "#eff1f5",
      "--color-bg-secondary": "#e6e9ef",
      "--color-bg-tertiary": "#ccd0da",
      "--color-bg-elevated": "#bcc0cc",
      "--color-bg-sidebar": "#dce0e8",
      "--color-bg-panel": "#eff1f5",
      "--color-text-primary": "#4c4f69",
      "--color-text-secondary": "#5c5f77",
      "--color-text-muted": "#8c8fa1",
      "--color-accent": "#7c3aed",
      "--color-accent-hover": "#8b5cf6",
      "--color-accent-secondary": "#6d28d9",
      "--color-accent-tertiary": "#5b21b6",
      "--color-success": "#40a02b",
      "--color-warning": "#df8e1d",
      "--color-error": "#d20f39",
      "--color-info": "#1e66f5",
      "--color-border": "#ccd0da",
      "--color-border-muted": "#e6e9ef",
      "--color-selection": "rgba(124, 58, 237, 0.2)",
    },
  },
  default: {
    dark: {
      "--color-bg-primary": "#18181b",
      "--color-bg-secondary": "#1f1f23",
      "--color-bg-tertiary": "#27272a",
      "--color-bg-elevated": "#3f3f46",
      "--color-bg-sidebar": "#0f0f12",
      "--color-bg-panel": "#18181b",
      "--color-text-primary": "#fafafa",
      "--color-text-secondary": "#a1a1aa",
      "--color-text-muted": "#71717a",
      "--color-accent": "#6366f1",
      "--color-accent-hover": "#818cf8",
      "--color-accent-secondary": "#4f46e5",
      "--color-accent-tertiary": "#4338ca",
      "--color-success": "#22c55e",
      "--color-warning": "#f59e0b",
      "--color-error": "#ef4444",
      "--color-info": "#3b82f6",
      "--color-border": "#27272a",
      "--color-border-muted": "#1f1f23",
      "--color-selection": "rgba(99, 102, 241, 0.3)",
    },
    light: {
      "--color-bg-primary": "#ffffff",
      "--color-bg-secondary": "#f4f4f5",
      "--color-bg-tertiary": "#e4e4e7",
      "--color-bg-elevated": "#d4d4d8",
      "--color-bg-sidebar": "#fafafa",
      "--color-bg-panel": "#ffffff",
      "--color-text-primary": "#18181b",
      "--color-text-secondary": "#52525b",
      "--color-text-muted": "#a1a1aa",
      "--color-accent": "#4f46e5",
      "--color-accent-hover": "#6366f1",
      "--color-accent-secondary": "#4338ca",
      "--color-accent-tertiary": "#3730a3",
      "--color-success": "#16a34a",
      "--color-warning": "#d97706",
      "--color-error": "#dc2626",
      "--color-info": "#2563eb",
      "--color-border": "#e4e4e7",
      "--color-border-muted": "#f4f4f5",
      "--color-selection": "rgba(79, 70, 229, 0.2)",
    },
  },
  nord: {
    dark: {
      // Nord Polar Night
      "--color-bg-primary": "#2e3440",
      "--color-bg-secondary": "#3b4252",
      "--color-bg-tertiary": "#434c5e",
      "--color-bg-elevated": "#4c566a",
      "--color-bg-sidebar": "#242933",
      "--color-bg-panel": "#2e3440",
      "--color-text-primary": "#eceff4",
      "--color-text-secondary": "#d8dee9",
      "--color-text-muted": "#7b88a1",
      "--color-accent": "#88c0d0",
      "--color-accent-hover": "#8fbcbb",
      "--color-accent-secondary": "#81a1c1",
      "--color-accent-tertiary": "#5e81ac",
      "--color-success": "#a3be8c",
      "--color-warning": "#ebcb8b",
      "--color-error": "#bf616a",
      "--color-info": "#81a1c1",
      "--color-border": "#434c5e",
      "--color-border-muted": "#3b4252",
      "--color-selection": "rgba(136, 192, 208, 0.3)",
    },
    light: {
      // Nord Snow Storm
      "--color-bg-primary": "#eceff4",
      "--color-bg-secondary": "#e5e9f0",
      "--color-bg-tertiary": "#d8dee9",
      "--color-bg-elevated": "#c9d1dc",
      "--color-bg-sidebar": "#f0f4f8",
      "--color-bg-panel": "#eceff4",
      "--color-text-primary": "#2e3440",
      "--color-text-secondary": "#3b4252",
      "--color-text-muted": "#7b88a1",
      "--color-accent": "#5e81ac",
      "--color-accent-hover": "#81a1c1",
      "--color-accent-secondary": "#4c6a92",
      "--color-accent-tertiary": "#3d5478",
      "--color-success": "#8fbf7f",
      "--color-warning": "#d9a657",
      "--color-error": "#b74e58",
      "--color-info": "#5e81ac",
      "--color-border": "#d8dee9",
      "--color-border-muted": "#e5e9f0",
      "--color-selection": "rgba(94, 129, 172, 0.2)",
    },
  },
  dracula: {
    dark: {
      "--color-bg-primary": "#282a36",
      "--color-bg-secondary": "#21222c",
      "--color-bg-tertiary": "#343746",
      "--color-bg-elevated": "#44475a",
      "--color-bg-sidebar": "#1e1f29",
      "--color-bg-panel": "#282a36",
      "--color-text-primary": "#f8f8f2",
      "--color-text-secondary": "#bfbfbf",
      "--color-text-muted": "#6272a4",
      "--color-accent": "#bd93f9",
      "--color-accent-hover": "#caa8fb",
      "--color-accent-secondary": "#a67bf7",
      "--color-accent-tertiary": "#8f63f5",
      "--color-success": "#50fa7b",
      "--color-warning": "#f1fa8c",
      "--color-error": "#ff5555",
      "--color-info": "#8be9fd",
      "--color-border": "#44475a",
      "--color-border-muted": "#343746",
      "--color-selection": "rgba(189, 147, 249, 0.3)",
    },
    light: {
      // Dracula-inspired light
      "--color-bg-primary": "#f8f8f2",
      "--color-bg-secondary": "#f0f0eb",
      "--color-bg-tertiary": "#e0e0db",
      "--color-bg-elevated": "#d0d0cb",
      "--color-bg-sidebar": "#f5f5f0",
      "--color-bg-panel": "#f8f8f2",
      "--color-text-primary": "#282a36",
      "--color-text-secondary": "#44475a",
      "--color-text-muted": "#6272a4",
      "--color-accent": "#9858d3",
      "--color-accent-hover": "#bd93f9",
      "--color-accent-secondary": "#7b3fb8",
      "--color-accent-tertiary": "#5e2a9d",
      "--color-success": "#3cb65b",
      "--color-warning": "#d4a017",
      "--color-error": "#e03131",
      "--color-info": "#5fb3d2",
      "--color-border": "#e0e0db",
      "--color-border-muted": "#f0f0eb",
      "--color-selection": "rgba(152, 88, 211, 0.2)",
    },
  },
};

const FONT_FAMILIES = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  inter: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  "jetbrains-mono": '"JetBrains Mono", "Fira Code", monospace',
  "fira-code": '"Fira Code", "JetBrains Mono", monospace',
};

const EDITOR_WIDTHS = {
  narrow: "640px",
  medium: "768px",
  wide: "960px",
  full: "100%",
};

// Get system preference
function getSystemTheme(): "light" | "dark" {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "dark";
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      resolvedMode: "dark",
      showPageStats: true,
      uiMode: "classic" as UIMode,
      notebookSortBy: "name-asc" as NotebookSortOption,

      setMode: (mode) => {
        set((state) => ({
          settings: { ...state.settings, mode },
          resolvedMode: mode === "system" ? getSystemTheme() : mode,
        }));
        get().applyTheme();
      },

      setColorScheme: (colorScheme) => {
        set((state) => ({
          settings: { ...state.settings, colorScheme },
        }));
        get().applyTheme();
      },

      setFontFamily: (fontFamily) => {
        set((state) => ({
          settings: { ...state.settings, fontFamily },
        }));
        get().applyTheme();
      },

      setEditorWidth: (editorWidth) => {
        set((state) => ({
          settings: { ...state.settings, editorWidth },
        }));
        get().applyTheme();
      },

      setEditorKeymap: (editorKeymap) => {
        set((state) => ({
          settings: { ...state.settings, editorKeymap },
        }));
      },

      setFontSize: (fontSize) => {
        set((state) => ({
          settings: { ...state.settings, fontSize: Math.min(20, Math.max(12, fontSize)) },
        }));
        get().applyTheme();
      },

      setLineHeight: (lineHeight) => {
        set((state) => ({
          settings: { ...state.settings, lineHeight: Math.min(2.0, Math.max(1.4, lineHeight)) },
        }));
        get().applyTheme();
      },

      togglePageStats: () => {
        set((state) => ({ showPageStats: !state.showPageStats }));
      },

      setUIMode: (mode) => {
        set({ uiMode: mode });
      },

      setNotebookSortBy: (sort) => {
        set({ notebookSortBy: sort });
      },

      applyTheme: () => {
        const { settings, resolvedMode } = get();
        const root = document.documentElement;

        // Apply color scheme
        const scheme = COLOR_SCHEMES[settings.colorScheme] || COLOR_SCHEMES.catppuccin;
        const colors = scheme[resolvedMode];

        Object.entries(colors).forEach(([key, value]) => {
          root.style.setProperty(key, value);
        });

        // Apply font family
        root.style.setProperty(
          "--font-family",
          FONT_FAMILIES[settings.fontFamily]
        );

        // Apply editor width
        root.style.setProperty(
          "--editor-max-width",
          EDITOR_WIDTHS[settings.editorWidth]
        );

        // Apply font size and line height
        root.style.setProperty("--font-size-base", `${settings.fontSize}px`);
        root.style.setProperty("--line-height-base", `${settings.lineHeight}`);

        // Set data attribute for potential CSS selectors
        root.setAttribute("data-theme", resolvedMode);
        root.setAttribute("data-color-scheme", settings.colorScheme);
      },
    }),
    {
      name: "katt-theme",
      partialize: (state) => ({ settings: state.settings, showPageStats: state.showPageStats, uiMode: state.uiMode, notebookSortBy: state.notebookSortBy }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Resolve system theme on rehydration
          if (state.settings.mode === "system") {
            state.resolvedMode = getSystemTheme();
          } else {
            state.resolvedMode = state.settings.mode;
          }
          // Apply theme after rehydration
          setTimeout(() => state.applyTheme(), 0);
        }
      },
    }
  )
);

// Listen for system theme changes
if (typeof window !== "undefined" && window.matchMedia) {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (e) => {
      const state = useThemeStore.getState();
      if (state.settings.mode === "system") {
        useThemeStore.setState({ resolvedMode: e.matches ? "dark" : "light" });
        state.applyTheme();
      }
    });
}

// Export utilities
export { COLOR_SCHEMES, FONT_FAMILIES, EDITOR_WIDTHS };
