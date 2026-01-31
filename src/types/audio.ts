import { z } from "zod";

// TTS provider types
export const TTSProviderTypeSchema = z.enum([
  "openai",
  "elevenlabs",
  "kokoro",
  "openai_compatible",
]);
export type TTSProviderType = z.infer<typeof TTSProviderTypeSchema>;

// Audio generation mode
export const AudioModeSchema = z.enum(["tts", "podcast"]);
export type AudioMode = z.infer<typeof AudioModeSchema>;

// TTS configuration sent to backend
export const TTSConfigSchema = z.object({
  provider: TTSProviderTypeSchema,
  voice: z.string(),
  apiKey: z.string().nullable().optional(),
  baseUrl: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  speed: z.number().optional(),
});
export type TTSConfig = z.infer<typeof TTSConfigSchema>;

// Result from audio generation
export const AudioGenerationResultSchema = z.object({
  audioPath: z.string(),
  durationSeconds: z.number(),
  format: z.string(),
  fileSizeBytes: z.number(),
  generationTimeSeconds: z.number(),
  transcript: z
    .array(z.object({ speaker: z.string(), text: z.string() }))
    .nullable()
    .optional(),
});
export type AudioGenerationResult = z.infer<typeof AudioGenerationResultSchema>;

// Podcast transcript line
export interface PodcastLine {
  speaker: string;
  text: string;
}

// TTS voice info from backend
export const TTSVoiceInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  language: z.string().nullable().optional(),
  previewUrl: z.string().nullable().optional(),
});
export type TTSVoiceInfo = z.infer<typeof TTSVoiceInfoSchema>;

// TTS provider info from backend
export const TTSProviderInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  available: z.boolean(),
});
export type TTSProviderInfo = z.infer<typeof TTSProviderInfoSchema>;

// Podcast target length
export const PodcastLengthSchema = z.enum(["short", "medium", "long"]);
export type PodcastLength = z.infer<typeof PodcastLengthSchema>;
