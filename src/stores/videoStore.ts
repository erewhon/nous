import { create } from "zustand";
import type {
  VideoBlockData,
  VideoViewerState,
  TranscriptionResult,
} from "../types/video";

interface VideoStore {
  // Full-screen viewer state
  viewerState: VideoViewerState;

  // Callback for updating block data after edits
  onUpdateBlockData: ((blockId: string, data: VideoBlockData) => void) | null;
  setOnUpdateBlockData: (
    callback: ((blockId: string, data: VideoBlockData) => void) | null
  ) => void;

  // Viewer actions
  openViewer: (blockId: string, videoData: VideoBlockData) => void;
  closeViewer: () => void;
  setCurrentTime: (time: number) => void;
  setPlaying: (isPlaying: boolean) => void;
  togglePlaying: () => void;
  toggleTranscript: () => void;
  highlightSegment: (segmentId: number | null) => void;

  // Transcription actions (for managing transcription state from outside)
  setTranscriptionStatus: (
    blockId: string,
    status: VideoBlockData["transcriptionStatus"]
  ) => void;
  setTranscription: (
    blockId: string,
    transcription: TranscriptionResult
  ) => void;
}

const initialViewerState: VideoViewerState = {
  isOpen: false,
  blockId: null,
  videoData: null,
  currentTime: 0,
  isPlaying: false,
  showTranscript: true,
  highlightedSegmentId: null,
};

export const useVideoStore = create<VideoStore>((set, get) => ({
  viewerState: initialViewerState,
  onUpdateBlockData: null,

  setOnUpdateBlockData: (callback) => {
    set({ onUpdateBlockData: callback });
  },

  openViewer: (blockId, videoData) => {
    set({
      viewerState: {
        ...initialViewerState,
        isOpen: true,
        blockId,
        videoData,
        currentTime: videoData.currentTime || 0,
        showTranscript: !!videoData.transcription,
      },
    });
  },

  closeViewer: () => {
    const { viewerState, onUpdateBlockData } = get();

    // Save current time before closing
    if (viewerState.blockId && viewerState.videoData && onUpdateBlockData) {
      onUpdateBlockData(viewerState.blockId, {
        ...viewerState.videoData,
        currentTime: viewerState.currentTime,
      });
    }

    set({
      viewerState: initialViewerState,
    });
  },

  setCurrentTime: (time) => {
    set((state) => ({
      viewerState: {
        ...state.viewerState,
        currentTime: time,
      },
    }));
  },

  setPlaying: (isPlaying) => {
    set((state) => ({
      viewerState: {
        ...state.viewerState,
        isPlaying,
      },
    }));
  },

  togglePlaying: () => {
    set((state) => ({
      viewerState: {
        ...state.viewerState,
        isPlaying: !state.viewerState.isPlaying,
      },
    }));
  },

  toggleTranscript: () => {
    set((state) => ({
      viewerState: {
        ...state.viewerState,
        showTranscript: !state.viewerState.showTranscript,
      },
    }));
  },

  highlightSegment: (segmentId) => {
    set((state) => ({
      viewerState: {
        ...state.viewerState,
        highlightedSegmentId: segmentId,
      },
    }));
  },

  setTranscriptionStatus: (blockId, status) => {
    const { viewerState, onUpdateBlockData } = get();

    // Update viewer state if this block is open
    if (viewerState.blockId === blockId && viewerState.videoData) {
      const updatedVideoData = {
        ...viewerState.videoData,
        transcriptionStatus: status,
      };

      set((state) => ({
        viewerState: {
          ...state.viewerState,
          videoData: updatedVideoData,
        },
      }));

      if (onUpdateBlockData) {
        onUpdateBlockData(blockId, updatedVideoData);
      }
    }
  },

  setTranscription: (blockId, transcription) => {
    const { viewerState, onUpdateBlockData } = get();

    // Update viewer state if this block is open
    if (viewerState.blockId === blockId && viewerState.videoData) {
      const updatedVideoData = {
        ...viewerState.videoData,
        transcription,
        transcriptionStatus: "complete" as const,
      };

      set((state) => ({
        viewerState: {
          ...state.viewerState,
          videoData: updatedVideoData,
          showTranscript: true,
        },
      }));

      if (onUpdateBlockData) {
        onUpdateBlockData(blockId, updatedVideoData);
      }
    }
  },
}));
