import { invoke } from "@tauri-apps/api/core";

/** In-memory cache: file path → video stream URL */
const cache = new Map<string, string>();

/**
 * Get a video stream URL for a local file path.
 * Results are cached in memory for the session lifetime.
 */
export async function getVideoStreamUrl(videoPath: string): Promise<string> {
  const cached = cache.get(videoPath);
  if (cached) return cached;

  const url = await invoke<string>("get_video_stream_url", { videoPath });
  cache.set(videoPath, url);
  return url;
}

/** Clear the video URL cache (e.g. on library switch). */
export function clearVideoUrlCache(): void {
  cache.clear();
}
