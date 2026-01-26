import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface VideoPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoPath: string;
  title?: string;
}

/**
 * Open a video file with the system's default video player.
 */
async function openVideoWithSystemPlayer(videoPath: string): Promise<void> {
  await invoke("open_video_with_system_player", { videoPath });
}

/**
 * VideoPlayerModal component displays a modal with a video player.
 * Videos are streamed via IPC chunks to work around Tauri's asset protocol limitations.
 */
export function VideoPlayerModal({
  isOpen,
  onClose,
  videoPath,
}: VideoPlayerModalProps) {
  // When modal "opens", open the video with system player and close immediately
  useEffect(() => {
    if (!isOpen || !videoPath) {
      return;
    }

    // Open with system player
    openVideoWithSystemPlayer(videoPath)
      .then(() => {
        console.log("Opened video with system player:", videoPath);
      })
      .catch((err) => {
        console.error("Failed to open video:", err);
      })
      .finally(() => {
        // Close the modal immediately since video opens externally
        onClose();
      });
  }, [isOpen, videoPath, onClose]);

  // This component doesn't render anything - it just triggers opening the system player
  return null;
}

export default VideoPlayerModal;
