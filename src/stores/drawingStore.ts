import { create } from "zustand";
import type {
  DrawingBlockData,
  DrawingViewerState,
  AnnotationOverlayState,
  DrawingToolType,
  PageAnnotation,
} from "../types/drawing";
import { DRAWING_COLORS, STROKE_WIDTHS } from "../types/drawing";

interface DrawingStore {
  // Full-screen viewer state (for DrawingTool blocks)
  viewerState: DrawingViewerState;

  // Page annotation overlay state
  annotationState: AnnotationOverlayState;

  // Callback for updating block data after edits
  onUpdateBlockData: ((blockId: string, data: DrawingBlockData) => void) | null;
  setOnUpdateBlockData: (
    callback: ((blockId: string, data: DrawingBlockData) => void) | null
  ) => void;

  // Viewer actions
  openViewer: (blockId: string, drawingData: DrawingBlockData) => void;
  closeViewer: () => void;
  updateViewerDrawingData: (data: Partial<DrawingBlockData>) => void;

  // Tool selection for viewer
  setSelectedTool: (tool: DrawingToolType) => void;
  setStrokeColor: (color: string) => void;
  setFillColor: (color: string | null) => void;
  setStrokeWidth: (width: number) => void;

  // Undo/redo state for viewer
  setHistoryState: (canUndo: boolean, canRedo: boolean) => void;

  // Page annotation overlay actions
  openAnnotationOverlay: (
    pageId: string,
    notebookId: string,
    annotation?: PageAnnotation
  ) => void;
  closeAnnotationOverlay: () => void;
  updateAnnotationData: (data: Partial<PageAnnotation>) => void;
  setAnnotationModified: (modified: boolean) => void;

  // Annotation tool selection (separate from block viewer)
  setAnnotationTool: (tool: DrawingToolType) => void;
  setAnnotationStrokeColor: (color: string) => void;
  setAnnotationFillColor: (color: string | null) => void;
  setAnnotationStrokeWidth: (width: number) => void;
}

const initialViewerState: DrawingViewerState = {
  isOpen: false,
  blockId: null,
  drawingData: null,
  selectedTool: "pen",
  strokeColor: DRAWING_COLORS[0].value, // Black
  fillColor: null,
  strokeWidth: STROKE_WIDTHS[2].value, // Medium (4)
  canUndo: false,
  canRedo: false,
};

const initialAnnotationState: AnnotationOverlayState = {
  isActive: false,
  pageId: null,
  notebookId: null,
  annotationData: null,
  selectedTool: "pen",
  strokeColor: DRAWING_COLORS[2].value, // Red for annotations
  fillColor: null,
  strokeWidth: STROKE_WIDTHS[1].value, // Thin (2)
  isModified: false,
};

export const useDrawingStore = create<DrawingStore>((set, get) => ({
  viewerState: initialViewerState,
  annotationState: initialAnnotationState,
  onUpdateBlockData: null,

  setOnUpdateBlockData: (callback) => {
    set({ onUpdateBlockData: callback });
  },

  openViewer: (blockId, drawingData) => {
    set({
      viewerState: {
        ...initialViewerState,
        isOpen: true,
        blockId,
        drawingData,
      },
    });
  },

  closeViewer: () => {
    const { viewerState, onUpdateBlockData } = get();

    // Save drawing data before closing
    if (viewerState.blockId && viewerState.drawingData && onUpdateBlockData) {
      onUpdateBlockData(viewerState.blockId, {
        ...viewerState.drawingData,
        lastModified: Date.now(),
      });
    }

    set({
      viewerState: initialViewerState,
    });
  },

  updateViewerDrawingData: (data) => {
    set((state) => ({
      viewerState: {
        ...state.viewerState,
        drawingData: state.viewerState.drawingData
          ? { ...state.viewerState.drawingData, ...data }
          : null,
      },
    }));
  },

  setSelectedTool: (tool) => {
    set((state) => ({
      viewerState: {
        ...state.viewerState,
        selectedTool: tool,
      },
    }));
  },

  setStrokeColor: (color) => {
    set((state) => ({
      viewerState: {
        ...state.viewerState,
        strokeColor: color,
      },
    }));
  },

  setFillColor: (color) => {
    set((state) => ({
      viewerState: {
        ...state.viewerState,
        fillColor: color,
      },
    }));
  },

  setStrokeWidth: (width) => {
    set((state) => ({
      viewerState: {
        ...state.viewerState,
        strokeWidth: width,
      },
    }));
  },

  setHistoryState: (canUndo, canRedo) => {
    set((state) => ({
      viewerState: {
        ...state.viewerState,
        canUndo,
        canRedo,
      },
    }));
  },

  // Annotation overlay actions
  openAnnotationOverlay: (pageId, notebookId, annotation) => {
    set({
      annotationState: {
        ...initialAnnotationState,
        isActive: true,
        pageId,
        notebookId,
        annotationData: annotation || null,
      },
    });
  },

  closeAnnotationOverlay: () => {
    set({
      annotationState: initialAnnotationState,
    });
  },

  updateAnnotationData: (data) => {
    set((state) => ({
      annotationState: {
        ...state.annotationState,
        annotationData: state.annotationState.annotationData
          ? { ...state.annotationState.annotationData, ...data }
          : null,
      },
    }));
  },

  setAnnotationModified: (modified) => {
    set((state) => ({
      annotationState: {
        ...state.annotationState,
        isModified: modified,
      },
    }));
  },

  setAnnotationTool: (tool) => {
    set((state) => ({
      annotationState: {
        ...state.annotationState,
        selectedTool: tool,
      },
    }));
  },

  setAnnotationStrokeColor: (color) => {
    set((state) => ({
      annotationState: {
        ...state.annotationState,
        strokeColor: color,
      },
    }));
  },

  setAnnotationFillColor: (color) => {
    set((state) => ({
      annotationState: {
        ...state.annotationState,
        fillColor: color,
      },
    }));
  },

  setAnnotationStrokeWidth: (width) => {
    set((state) => ({
      annotationState: {
        ...state.annotationState,
        strokeWidth: width,
      },
    }));
  },
}));
