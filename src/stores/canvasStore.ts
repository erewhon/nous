import { create } from "zustand";
import type {
  CanvasToolType,
  ViewportState,
  CanvasSettings,
  CanvasPageContent,
} from "../types/canvas";
import { CANVAS_DEFAULTS } from "../types/canvas";
import { DRAWING_COLORS, STROKE_WIDTHS } from "../types/drawing";

interface CanvasStore {
  // Tool state
  selectedTool: CanvasToolType;
  strokeColor: string;
  fillColor: string | null;
  strokeWidth: number;

  // Viewport state
  viewport: ViewportState;

  // Canvas settings
  settings: CanvasSettings;

  // Selection state
  selectedElementIds: string[];

  // History state
  canUndo: boolean;
  canRedo: boolean;

  // Loading state
  isLoaded: boolean;

  // Current canvas content (for saving)
  currentContent: CanvasPageContent | null;

  // Actions - Tool selection
  setSelectedTool: (tool: CanvasToolType) => void;
  setStrokeColor: (color: string) => void;
  setFillColor: (color: string | null) => void;
  setStrokeWidth: (width: number) => void;

  // Actions - Viewport
  setViewport: (viewport: Partial<ViewportState>) => void;
  setZoom: (zoom: number, centerX?: number, centerY?: number) => void;
  setPan: (panX: number, panY: number) => void;
  resetViewport: () => void;

  // Actions - Settings
  setSettings: (settings: Partial<CanvasSettings>) => void;
  toggleGrid: () => void;
  toggleSnapToGrid: () => void;

  // Actions - Selection
  setSelectedElements: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  removeFromSelection: (id: string) => void;
  clearSelection: () => void;

  // Actions - History
  setHistoryState: (canUndo: boolean, canRedo: boolean) => void;

  // Actions - Content
  setContent: (content: CanvasPageContent | null) => void;
  setLoaded: (loaded: boolean) => void;

  // Actions - Reset
  reset: () => void;
}

const initialViewport: ViewportState = {
  panX: 0,
  panY: 0,
  zoom: 1,
};

const initialSettings: CanvasSettings = {
  gridEnabled: true,
  gridSize: CANVAS_DEFAULTS.GRID_SIZE,
  snapToGrid: false,
  backgroundColor: CANVAS_DEFAULTS.BACKGROUND_COLOR,
};

export const useCanvasStore = create<CanvasStore>((set) => ({
  // Initial state
  selectedTool: "select",
  strokeColor: DRAWING_COLORS[0].value, // Black
  fillColor: null,
  strokeWidth: STROKE_WIDTHS[2].value, // Medium (4)
  viewport: initialViewport,
  settings: initialSettings,
  selectedElementIds: [],
  canUndo: false,
  canRedo: false,
  isLoaded: false,
  currentContent: null,

  // Tool selection
  setSelectedTool: (tool) => set({ selectedTool: tool }),
  setStrokeColor: (color) => set({ strokeColor: color }),
  setFillColor: (color) => set({ fillColor: color }),
  setStrokeWidth: (width) => set({ strokeWidth: width }),

  // Viewport
  setViewport: (viewport) =>
    set((state) => ({
      viewport: { ...state.viewport, ...viewport },
    })),

  setZoom: (zoom, centerX, centerY) => {
    const clampedZoom = Math.max(
      CANVAS_DEFAULTS.MIN_ZOOM,
      Math.min(CANVAS_DEFAULTS.MAX_ZOOM, zoom)
    );

    set((state) => {
      // If center point provided, adjust pan to zoom towards that point
      if (centerX !== undefined && centerY !== undefined) {
        const oldZoom = state.viewport.zoom;
        const zoomRatio = clampedZoom / oldZoom;
        const newPanX = centerX - (centerX - state.viewport.panX) * zoomRatio;
        const newPanY = centerY - (centerY - state.viewport.panY) * zoomRatio;
        return {
          viewport: {
            ...state.viewport,
            zoom: clampedZoom,
            panX: newPanX,
            panY: newPanY,
          },
        };
      }
      return {
        viewport: { ...state.viewport, zoom: clampedZoom },
      };
    });
  },

  setPan: (panX, panY) =>
    set((state) => ({
      viewport: { ...state.viewport, panX, panY },
    })),

  resetViewport: () => set({ viewport: initialViewport }),

  // Settings
  setSettings: (settings) =>
    set((state) => ({
      settings: { ...state.settings, ...settings },
    })),

  toggleGrid: () =>
    set((state) => ({
      settings: { ...state.settings, gridEnabled: !state.settings.gridEnabled },
    })),

  toggleSnapToGrid: () =>
    set((state) => ({
      settings: { ...state.settings, snapToGrid: !state.settings.snapToGrid },
    })),

  // Selection
  setSelectedElements: (ids) => set({ selectedElementIds: ids }),

  addToSelection: (id) =>
    set((state) => ({
      selectedElementIds: state.selectedElementIds.includes(id)
        ? state.selectedElementIds
        : [...state.selectedElementIds, id],
    })),

  removeFromSelection: (id) =>
    set((state) => ({
      selectedElementIds: state.selectedElementIds.filter((i) => i !== id),
    })),

  clearSelection: () => set({ selectedElementIds: [] }),

  // History
  setHistoryState: (canUndo, canRedo) => set({ canUndo, canRedo }),

  // Content
  setContent: (content) => set({ currentContent: content }),
  setLoaded: (loaded) => set({ isLoaded: loaded }),

  // Reset store state
  reset: () =>
    set({
      selectedTool: "select",
      strokeColor: DRAWING_COLORS[0].value,
      fillColor: null,
      strokeWidth: STROKE_WIDTHS[2].value,
      viewport: initialViewport,
      settings: initialSettings,
      selectedElementIds: [],
      canUndo: false,
      canRedo: false,
      isLoaded: false,
      currentContent: null,
    }),
}));
