import { z } from "zod";

// ===== Transcription Types =====

// Word-level timestamp
export const TranscriptWordSchema = z.object({
  word: z.string(),
  start: z.number(), // seconds
  end: z.number(),
  probability: z.number(),
});

export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;

// Segment with words
export const TranscriptSegmentSchema = z.object({
  id: z.number(),
  start: z.number(), // seconds
  end: z.number(),
  text: z.string(),
  words: z.array(TranscriptWordSchema).default([]),
});

export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

// Full transcription result from backend
export const TranscriptionResultSchema = z.object({
  videoPath: z.string(),
  audioPath: z.string().nullable().optional(),
  language: z.string(),
  languageProbability: z.number(),
  duration: z.number(), // seconds
  segments: z.array(TranscriptSegmentSchema),
  wordCount: z.number(),
  transcriptionTime: z.number(), // seconds
});

export type TranscriptionResult = z.infer<typeof TranscriptionResultSchema>;

// ===== Video Block Types =====

// Display modes for video block
export const VideoDisplayModeSchema = z.enum(["compact", "standard", "large"]);
export type VideoDisplayMode = z.infer<typeof VideoDisplayModeSchema>;

// Transcription status
export const TranscriptionStatusSchema = z.enum([
  "none",
  "pending",
  "complete",
  "error",
]);
export type TranscriptionStatus = z.infer<typeof TranscriptionStatusSchema>;

// External video type (YouTube, Vimeo, or direct link)
export const ExternalVideoTypeSchema = z.enum(["youtube", "vimeo", "direct"]);
export type ExternalVideoType = z.infer<typeof ExternalVideoTypeSchema>;

// Video block data stored in Editor.js
export const VideoBlockDataSchema = z.object({
  // Asset filename (e.g., "1704067200000-abc123.mp4") - empty for external videos
  filename: z.string(),
  // Full URL for rendering (convertFileSrc result or external URL)
  // For local videos, this is now the file path (not asset URL)
  url: z.string(),
  // Thumbnail as data URL (data:image/jpeg;base64,...) for local videos
  thumbnailUrl: z.string().optional(),
  // Original filename for display
  originalName: z.string().optional(),
  // Caption below video
  caption: z.string().default(""),
  // Video duration in seconds
  duration: z.number().optional(),
  // Current playback position (seconds)
  currentTime: z.number().default(0),
  // Display mode in editor
  displayMode: VideoDisplayModeSchema.default("standard"),
  // Transcription data (if transcribed)
  transcription: TranscriptionResultSchema.optional(),
  // Transcription status
  transcriptionStatus: TranscriptionStatusSchema.default("none"),
  // Show transcript in block view
  showTranscript: z.boolean().default(false),
  // AI-generated two-sentence summary
  summary: z.string().optional(),
  // AI-generated three-paragraph synopsis
  synopsis: z.string().optional(),
  // External video flag
  isExternal: z.boolean().default(false),
  // Type of external video (youtube, vimeo, direct)
  externalType: ExternalVideoTypeSchema.optional(),
  // Original local file path (for linked local videos)
  localPath: z.string().optional(),
});

export type VideoBlockData = z.infer<typeof VideoBlockDataSchema>;

// ===== Full-Screen Viewer State =====

export interface VideoViewerState {
  isOpen: boolean;
  blockId: string | null;
  videoData: VideoBlockData | null;
  currentTime: number;
  isPlaying: boolean;
  showTranscript: boolean;
  highlightedSegmentId: number | null;
}

// ===== Upload Types =====

// Video upload response (following PDF pattern)
export interface VideoUploadResponse {
  success: 0 | 1;
  file: {
    url: string;              // File path (not asset URL)
    thumbnailUrl: string;     // data:image/jpeg;base64,...
    filename: string;
    originalName: string;
  };
}

// ===== Video Streaming Types =====

// Video metadata for streaming
export const VideoMetadataSchema = z.object({
  sizeBytes: z.number(),
  mimeType: z.string(),
  durationSeconds: z.number().optional(),
});

export type VideoMetadata = z.infer<typeof VideoMetadataSchema>;

// ===== Progress Types =====

// Progress event from backend during transcription
export interface TranscriptionProgressEvent {
  stage: "extracting_audio" | "loading_model" | "transcribing";
  progress: number; // 0-1
  message: string;
}

// ===== Constants =====

// Supported video formats
export const SUPPORTED_VIDEO_EXTENSIONS = [
  ".mp4",
  ".webm",
  ".mov",
  ".mkv",
  ".avi",
  ".m4v",
  ".flv",
] as const;

export const SUPPORTED_VIDEO_MIMETYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
  "video/x-msvideo",
  "video/x-m4v",
  "video/x-flv",
] as const;

// Whisper model sizes
export const WHISPER_MODEL_SIZES = [
  { name: "Tiny", value: "tiny", description: "Fastest, least accurate (~1GB VRAM)" },
  { name: "Base", value: "base", description: "Fast, good for most use cases (~1GB VRAM)" },
  { name: "Small", value: "small", description: "Balanced speed/accuracy (~2GB VRAM)" },
  { name: "Medium", value: "medium", description: "Slower, more accurate (~5GB VRAM)" },
  { name: "Large", value: "large-v3", description: "Slowest, most accurate (~10GB VRAM)" },
] as const;
