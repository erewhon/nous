import { useEffect } from "react";
import type { VideoBlockData } from "../../types/video";
import { useVideoStore } from "../../stores/videoStore";

interface VideoPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoPath: string;
  title?: string;
  /** Full video block data for in-app playback */
  videoData?: VideoBlockData;
  /** Block ID for tracking in the video store */
  blockId?: string;
}

/**
 * VideoPlayerModal component opens videos in the in-app fullscreen player.
 * Falls back to system player if videoData is not provided.
 */
export function VideoPlayerModal({
  isOpen,
  onClose,
  videoPath,
  title,
  videoData,
  blockId,
}: VideoPlayerModalProps) {
  const { openViewer } = useVideoStore();

  // When modal "opens", open the VideoFullScreen viewer
  useEffect(() => {
    if (!isOpen || !videoPath) {
      return;
    }

    // If we have full video data, use the in-app player
    if (videoData && blockId) {
      openViewer(blockId, videoData);
      onClose(); // Close this modal as the viewer is now handling it
      return;
    }

    // Construct minimal video data from available props
    const minimalVideoData: VideoBlockData = {
      filename: "",
      url: videoPath,
      thumbnailUrl: "",
      originalName: title || videoPath.split("/").pop() || "Video",
      caption: "",
      currentTime: 0,
      displayMode: "standard",
      transcriptionStatus: "none",
      showTranscript: false,
      isExternal: false,
      localPath: videoPath,
    };

    // Generate a temporary block ID
    const tempBlockId = blockId || `temp-video-${Date.now()}`;

    openViewer(tempBlockId, minimalVideoData);
    onClose(); // Close this modal as the viewer is now handling it
  }, [isOpen, videoPath, videoData, blockId, title, onClose, openViewer]);

  // This component doesn't render anything - it just triggers opening the viewer
  return null;
}

export default VideoPlayerModal;
