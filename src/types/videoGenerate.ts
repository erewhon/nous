import { z } from "zod";

// ===== Slide Content Types =====

export const SlideContentSchema = z.object({
  title: z.string(),
  body: z.string().default(""),
  bulletPoints: z.array(z.string()).default([]),
  durationHint: z.number().nullable().optional(),
});
export type SlideContent = z.infer<typeof SlideContentSchema>;

// ===== Configuration Types =====

export const VideoThemeSchema = z.enum(["light", "dark"]);
export type VideoTheme = z.infer<typeof VideoThemeSchema>;

export const VideoTransitionSchema = z.enum(["cut", "fade"]);
export type VideoTransition = z.infer<typeof VideoTransitionSchema>;

export const VideoConfigSchema = z.object({
  width: z.number().default(1920),
  height: z.number().default(1080),
  theme: VideoThemeSchema.default("light"),
  transition: VideoTransitionSchema.default("cut"),
  title: z.string().nullable().optional(),
});
export type VideoConfig = z.infer<typeof VideoConfigSchema>;

export const VideoTTSConfigSchema = z.object({
  provider: z.string(),
  voice: z.string(),
  apiKey: z.string().nullable().optional(),
  baseUrl: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  speed: z.number().nullable().optional(),
});
export type VideoTTSConfig = z.infer<typeof VideoTTSConfigSchema>;

// ===== Result Types =====

export const VideoGenerationResultSchema = z.object({
  videoPath: z.string(),
  durationSeconds: z.number(),
  slideCount: z.number(),
  generationTimeSeconds: z.number(),
});
export type VideoGenerationResult = z.infer<typeof VideoGenerationResultSchema>;

// ===== Availability Types =====

export const VideoAvailabilitySchema = z.object({
  pillow: z.boolean(),
  ffmpeg: z.boolean(),
  pydub: z.boolean(),
  fullyAvailable: z.boolean(),
});
export type VideoAvailability = z.infer<typeof VideoAvailabilitySchema>;

// ===== Aspect Ratio Presets =====

export interface AspectRatioPreset {
  id: string;
  name: string;
  width: number;
  height: number;
}

export const ASPECT_RATIO_PRESETS: AspectRatioPreset[] = [
  { id: "16:9", name: "16:9 (1080p)", width: 1920, height: 1080 },
  { id: "16:9-720", name: "16:9 (720p)", width: 1280, height: 720 },
  { id: "4:3", name: "4:3 (1024x768)", width: 1024, height: 768 },
  { id: "1:1", name: "1:1 (Square)", width: 1080, height: 1080 },
];

// ===== State Types =====

export interface VideoGenerateState {
  isGenerating: boolean;
  error: string | null;
  result: VideoGenerationResult | null;
  progress: number; // 0-100
  currentSlide: number;
  totalSlides: number;
  slides: SlideContent[];
  config: VideoConfig;
  ttsConfig: Partial<VideoTTSConfig>;
  availability: VideoAvailability | null;
}
