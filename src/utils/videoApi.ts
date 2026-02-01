import { invoke } from "@tauri-apps/api/core";
import type { TranscriptionResult } from "../types/video";

/**
 * Transcribe a video file using faster-whisper.
 */
export async function transcribeVideo(
  videoPath: string,
  modelSize?: string,
  language?: string
): Promise<TranscriptionResult> {
  return invoke<TranscriptionResult>("transcribe_video", {
    videoPath,
    modelSize,
    language,
  });
}

/**
 * Get video duration in seconds.
 */
export async function getVideoDuration(videoPath: string): Promise<number> {
  return invoke<number>("get_video_duration", { videoPath });
}

/**
 * Check if a file is a supported video format.
 */
export async function isVideoSupported(filePath: string): Promise<boolean> {
  return invoke<boolean>("is_supported_video", { filePath });
}

/**
 * Get list of supported video extensions.
 */
export async function getSupportedVideoExtensions(): Promise<string[]> {
  return invoke<string[]>("get_supported_video_extensions");
}

/**
 * Format seconds to MM:SS or HH:MM:SS string.
 */
export function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Format seconds to SRT timestamp format (HH:MM:SS,mmm).
 */
function formatSrtTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
}

/**
 * Format seconds to VTT timestamp format (HH:MM:SS.mmm).
 */
function formatVttTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

/**
 * Export transcription as plain text with timestamps.
 */
export function exportTranscriptAsText(transcription: TranscriptionResult): string {
  const lines: string[] = [];

  lines.push(`Transcription`);
  lines.push(`Language: ${transcription.language}`);
  lines.push(`Duration: ${formatTimestamp(transcription.duration)}`);
  lines.push(`Words: ${transcription.wordCount}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const segment of transcription.segments) {
    lines.push(`[${formatTimestamp(segment.start)}] ${segment.text}`);
  }

  return lines.join("\n");
}

/**
 * Export transcription as SRT subtitle format.
 */
export function exportTranscriptAsSrt(transcription: TranscriptionResult): string {
  const lines: string[] = [];

  for (let i = 0; i < transcription.segments.length; i++) {
    const segment = transcription.segments[i];

    // Sequence number (1-indexed)
    lines.push((i + 1).toString());

    // Timestamps
    lines.push(
      `${formatSrtTimestamp(segment.start)} --> ${formatSrtTimestamp(segment.end)}`
    );

    // Text
    lines.push(segment.text);

    // Blank line separator
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Export transcription as WebVTT format.
 */
export function exportTranscriptAsVtt(transcription: TranscriptionResult): string {
  const lines: string[] = [];

  // VTT header
  lines.push("WEBVTT");
  lines.push("");

  // Optional metadata
  lines.push(`NOTE Language: ${transcription.language}`);
  lines.push(`NOTE Duration: ${formatTimestamp(transcription.duration)}`);
  lines.push("");

  for (let i = 0; i < transcription.segments.length; i++) {
    const segment = transcription.segments[i];

    // Optional cue identifier
    lines.push(`segment-${i + 1}`);

    // Timestamps
    lines.push(
      `${formatVttTimestamp(segment.start)} --> ${formatVttTimestamp(segment.end)}`
    );

    // Text
    lines.push(segment.text);

    // Blank line separator
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Download transcription as a file.
 */
export function downloadTranscript(
  transcription: TranscriptionResult,
  format: "txt" | "srt" | "vtt",
  filename?: string
): void {
  let content: string;
  let mimeType: string;
  let extension: string;

  switch (format) {
    case "srt":
      content = exportTranscriptAsSrt(transcription);
      mimeType = "application/x-subrip";
      extension = ".srt";
      break;
    case "vtt":
      content = exportTranscriptAsVtt(transcription);
      mimeType = "text/vtt";
      extension = ".vtt";
      break;
    case "txt":
    default:
      content = exportTranscriptAsText(transcription);
      mimeType = "text/plain";
      extension = ".txt";
      break;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `transcript${extension}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}
