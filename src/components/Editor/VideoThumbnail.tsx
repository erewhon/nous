import { useState } from "react";

interface VideoThumbnailProps {
  videoPath: string;
  thumbnailUrl: string;
  filename: string;
  duration?: number;
  onPlay: () => void;
  onDelete?: () => void;
}

/**
 * Format duration in seconds to MM:SS or HH:MM:SS format.
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/**
 * VideoThumbnail component displays a video thumbnail with a play button overlay.
 * Clicking the thumbnail opens the video in a modal player.
 */
export function VideoThumbnail({
  thumbnailUrl,
  filename,
  duration,
  onPlay,
}: VideoThumbnailProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Fallback if thumbnail fails to load
  if (imageError || !thumbnailUrl) {
    return (
      <div
        className="video-thumbnail video-thumbnail--fallback"
        onClick={onPlay}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16 / 9",
          backgroundColor: "var(--color-bg-tertiary)",
          borderRadius: "8px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          transition: "background-color 0.2s",
        }}
      >
        {/* Video icon */}
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-text-muted)"
          strokeWidth="1.5"
          style={{ marginBottom: "8px" }}
        >
          <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
          <polygon points="10 8 16 12 10 16 10 8" />
        </svg>
        <span
          style={{
            color: "var(--color-text-muted)",
            fontSize: "12px",
            maxWidth: "80%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {filename}
        </span>
        {/* Play button overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isHovered ? "rgba(0, 0, 0, 0.3)" : "transparent",
            borderRadius: "8px",
            transition: "background-color 0.2s",
          }}
        >
          {isHovered && (
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                backgroundColor: "rgba(0, 0, 0, 0.7)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="white"
                stroke="none"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="video-thumbnail"
      onClick={onPlay}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        borderRadius: "8px",
        overflow: "hidden",
        cursor: "pointer",
        backgroundColor: "var(--color-bg-tertiary)",
      }}
    >
      {/* Thumbnail image */}
      <img
        src={thumbnailUrl}
        alt={filename}
        onError={() => setImageError(true)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        }}
      />

      {/* Play button overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: isHovered ? "rgba(0, 0, 0, 0.4)" : "rgba(0, 0, 0, 0.2)",
          transition: "background-color 0.2s",
        }}
      >
        <div
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "50%",
            backgroundColor: isHovered ? "rgba(0, 0, 0, 0.8)" : "rgba(0, 0, 0, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "transform 0.2s, background-color 0.2s",
            transform: isHovered ? "scale(1.1)" : "scale(1)",
          }}
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="white"
            stroke="none"
          >
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </div>
      </div>

      {/* Duration badge */}
      {duration !== undefined && duration > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: "8px",
            right: "8px",
            padding: "2px 6px",
            backgroundColor: "rgba(0, 0, 0, 0.75)",
            borderRadius: "4px",
            color: "white",
            fontSize: "12px",
            fontWeight: 500,
            fontFamily: "monospace",
          }}
        >
          {formatDuration(duration)}
        </div>
      )}

      {/* Filename at bottom */}
      <div
        style={{
          position: "absolute",
          bottom: "8px",
          left: "8px",
          maxWidth: "calc(100% - 80px)",
          padding: "2px 8px",
          backgroundColor: "rgba(0, 0, 0, 0.75)",
          borderRadius: "4px",
          color: "white",
          fontSize: "11px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {filename}
      </div>
    </div>
  );
}

export default VideoThumbnail;
