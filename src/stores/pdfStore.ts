import { create } from "zustand";
import type { PDFBlockData, PDFHighlight, PDFViewerState } from "../types/pdf";
import { HIGHLIGHT_COLORS } from "../types/pdf";

interface PDFStore {
  // Full-screen viewer state
  viewerState: PDFViewerState;

  // Callback for updating block data after edits
  onUpdateBlockData: ((blockId: string, data: PDFBlockData) => void) | null;
  setOnUpdateBlockData: (callback: ((blockId: string, data: PDFBlockData) => void) | null) => void;

  // Viewer actions
  openViewer: (blockId: string, pdfData: PDFBlockData) => void;
  closeViewer: () => void;
  setCurrentPage: (page: number) => void;
  setZoom: (zoom: number) => void;

  // Annotation mode
  startAnnotating: () => void;
  stopAnnotating: () => void;
  setSelectedColor: (color: string) => void;

  // Highlight management
  addHighlight: (highlight: Omit<PDFHighlight, "id" | "createdAt" | "updatedAt">) => void;
  updateHighlight: (id: string, updates: Partial<PDFHighlight>) => void;
  deleteHighlight: (id: string) => void;
  selectHighlight: (id: string | null) => void;

  // Get current highlights
  getHighlights: () => PDFHighlight[];
}

const initialViewerState: PDFViewerState = {
  isOpen: false,
  blockId: null,
  pdfData: null,
  currentPage: 1,
  zoom: 1.0,
  isAnnotating: false,
  selectedHighlightId: null,
  selectedColor: HIGHLIGHT_COLORS[0].value,
};

export const usePDFStore = create<PDFStore>((set, get) => ({
  viewerState: initialViewerState,
  onUpdateBlockData: null,

  setOnUpdateBlockData: (callback) => {
    set({ onUpdateBlockData: callback });
  },

  openViewer: (blockId, pdfData) => {
    set({
      viewerState: {
        ...initialViewerState,
        isOpen: true,
        blockId,
        pdfData,
        currentPage: pdfData.currentPage || 1,
      },
    });
  },

  closeViewer: () => {
    const { viewerState, onUpdateBlockData } = get();

    // Save any changes before closing
    if (viewerState.blockId && viewerState.pdfData && onUpdateBlockData) {
      onUpdateBlockData(viewerState.blockId, {
        ...viewerState.pdfData,
        currentPage: viewerState.currentPage,
      });
    }

    set({
      viewerState: initialViewerState,
    });
  },

  setCurrentPage: (page) => {
    set((state) => ({
      viewerState: {
        ...state.viewerState,
        currentPage: page,
        pdfData: state.viewerState.pdfData
          ? { ...state.viewerState.pdfData, currentPage: page }
          : null,
      },
    }));
  },

  setZoom: (zoom) => {
    set((state) => ({
      viewerState: {
        ...state.viewerState,
        zoom: Math.max(0.5, Math.min(3, zoom)),
      },
    }));
  },

  startAnnotating: () => {
    set((state) => ({
      viewerState: {
        ...state.viewerState,
        isAnnotating: true,
      },
    }));
  },

  stopAnnotating: () => {
    set((state) => ({
      viewerState: {
        ...state.viewerState,
        isAnnotating: false,
        selectedHighlightId: null,
      },
    }));
  },

  setSelectedColor: (color) => {
    set((state) => ({
      viewerState: {
        ...state.viewerState,
        selectedColor: color,
      },
    }));
  },

  addHighlight: (highlightData) => {
    const { viewerState, onUpdateBlockData } = get();
    if (!viewerState.pdfData) return;

    const now = new Date().toISOString();
    const newHighlight: PDFHighlight = {
      ...highlightData,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    const updatedHighlights = [...viewerState.pdfData.highlights, newHighlight];
    const updatedPdfData = {
      ...viewerState.pdfData,
      highlights: updatedHighlights,
    };

    set((state) => ({
      viewerState: {
        ...state.viewerState,
        pdfData: updatedPdfData,
        selectedHighlightId: newHighlight.id,
      },
    }));

    // Notify block of update
    if (viewerState.blockId && onUpdateBlockData) {
      onUpdateBlockData(viewerState.blockId, updatedPdfData);
    }
  },

  updateHighlight: (id, updates) => {
    const { viewerState, onUpdateBlockData } = get();
    if (!viewerState.pdfData) return;

    const updatedHighlights = viewerState.pdfData.highlights.map((h) =>
      h.id === id
        ? { ...h, ...updates, updatedAt: new Date().toISOString() }
        : h
    );

    const updatedPdfData = {
      ...viewerState.pdfData,
      highlights: updatedHighlights,
    };

    set((state) => ({
      viewerState: {
        ...state.viewerState,
        pdfData: updatedPdfData,
      },
    }));

    // Notify block of update
    if (viewerState.blockId && onUpdateBlockData) {
      onUpdateBlockData(viewerState.blockId, updatedPdfData);
    }
  },

  deleteHighlight: (id) => {
    const { viewerState, onUpdateBlockData } = get();
    if (!viewerState.pdfData) return;

    const updatedHighlights = viewerState.pdfData.highlights.filter(
      (h) => h.id !== id
    );

    const updatedPdfData = {
      ...viewerState.pdfData,
      highlights: updatedHighlights,
    };

    set((state) => ({
      viewerState: {
        ...state.viewerState,
        pdfData: updatedPdfData,
        selectedHighlightId:
          state.viewerState.selectedHighlightId === id
            ? null
            : state.viewerState.selectedHighlightId,
      },
    }));

    // Notify block of update
    if (viewerState.blockId && onUpdateBlockData) {
      onUpdateBlockData(viewerState.blockId, updatedPdfData);
    }
  },

  selectHighlight: (id) => {
    set((state) => ({
      viewerState: {
        ...state.viewerState,
        selectedHighlightId: id,
      },
    }));
  },

  getHighlights: () => {
    return get().viewerState.pdfData?.highlights || [];
  },
}));
