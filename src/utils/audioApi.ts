import { invoke } from "@tauri-apps/api/core";
import type { TTSConfig, AudioGenerationResult } from "../types/audio";
import type { TranscriptionResult } from "../types/audio";

export async function transcribeAudio(
  audioPath: string,
  modelSize?: string,
  language?: string,
): Promise<TranscriptionResult> {
  return invoke<TranscriptionResult>("transcribe_audio", {
    audioPath,
    modelSize,
    language,
  });
}

export async function synthesizeText(
  text: string,
  ttsConfig: TTSConfig,
): Promise<AudioGenerationResult> {
  return invoke<AudioGenerationResult>("synthesize_text", {
    text,
    ttsConfig,
  });
}

export interface SaveAudioResult {
  path: string;
  filename: string;
}

export async function saveAudioRecording(
  notebookId: string,
  audioDataBase64: string,
  format: string,
): Promise<SaveAudioResult> {
  return invoke<SaveAudioResult>("save_audio_recording", {
    notebookId,
    audioDataBase64,
    format,
  });
}
