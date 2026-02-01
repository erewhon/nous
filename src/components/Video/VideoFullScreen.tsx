import { useEffect, useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useVideoStore } from "../../stores/videoStore";
import { useAIStore } from "../../stores/aiStore";
import { TranscriptPanel } from "./TranscriptPanel";

interface VideoFullScreenProps {
  onExportTranscript?: (format: "txt" | "srt" | "vtt") => void;
}

export function VideoFullScreen({ onExportTranscript }: VideoFullScreenProps) {
  const {
    viewerState,
    closeViewer,
    setCurrentTime,
    togglePlaying,
    toggleTranscript,
    highlightSegment,
  } = useVideoStore();

  const { openPanelWithPrompt } = useAIStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const {
    isOpen,
    videoData,
    currentTime,
    isPlaying,
  } = viewerState;

  // Fetch streaming URL for local videos
  useEffect(() => {
    if (!isOpen || !videoData) {
      setStreamUrl(null);
      setStreamError(null);
      return;
    }

    // For external videos (YouTube, Vimeo, direct HTTP URLs), use the URL directly
    if (videoData.isExternal && videoData.externalType !== "direct") {
      // YouTube/Vimeo embeds don't need streaming
      setStreamUrl(null);
      return;
    }

    // For direct HTTP/HTTPS URLs, use them directly
    if (videoData.url.startsWith("http://") || videoData.url.startsWith("https://")) {
      // Check if it's our asset protocol URL that needs to be converted
      if (!videoData.url.includes("asset.localhost")) {
        setStreamUrl(videoData.url);
        return;
      }
    }

    // For local videos, get the streaming URL from the backend
    // Extract the actual file path from the URL or use localPath
    const videoPath = videoData.localPath || videoData.url;

    // Skip if the path is already a streaming URL
    if (videoPath.includes("127.0.0.1")) {
      setStreamUrl(videoPath);
      return;
    }

    // Get streaming URL from backend
    invoke<string>("get_video_stream_url", { videoPath })
      .then((url) => {
        setStreamUrl(url);
        setStreamError(null);
      })
      .catch((err) => {
        console.error("Failed to get video stream URL:", err);
        setStreamError(String(err));
        // Fallback to original URL
        setStreamUrl(videoData.url);
      });
  }, [isOpen, videoData]);

  // Sync video element with store state
  useEffect(() => {
    if (videoRef.current && isOpen) {
      if (isPlaying && videoRef.current.paused) {
        videoRef.current.play();
      } else if (!isPlaying && !videoRef.current.paused) {
        videoRef.current.pause();
      }
    }
  }, [isPlaying, isOpen]);

  // Update store when video time changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
    };

    const handlePlay = () => {
      useVideoStore.getState().setPlaying(true);
    };

    const handlePause = () => {
      useVideoStore.getState().setPlaying(false);
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
    };
  }, [setCurrentTime]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in search input
      if ((e.target as HTMLElement).tagName === "INPUT") return;

      switch (e.key) {
        case "Escape":
          closeViewer();
          break;
        case " ":
          e.preventDefault();
          togglePlaying();
          break;
        case "ArrowLeft":
          if (videoRef.current) {
            videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
          }
          break;
        case "ArrowRight":
          if (videoRef.current) {
            videoRef.current.currentTime = Math.min(
              videoRef.current.duration,
              videoRef.current.currentTime + 5
            );
          }
          break;
        case "t":
        case "T":
          if (videoData?.transcription) {
            toggleTranscript();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeViewer, togglePlaying, toggleTranscript, videoData?.transcription]);

  // Handle segment click from transcript
  const handleSegmentClick = useCallback(
    (segment: { start: number; id: number }) => {
      if (videoRef.current) {
        videoRef.current.currentTime = segment.start;
        videoRef.current.play();
      }
      highlightSegment(segment.id);
    },
    [highlightSegment]
  );

  // Handle copy segment
  const handleCopySegment = useCallback((text: string) => {
    // Could show a toast here
    console.log("Copied:", text.substring(0, 50));
  }, []);

  // Handle summarize transcript with AI
  const handleSummarizeTranscript = useCallback((transcript: string) => {
    const videoName = videoData?.originalName || "video";
    const duration = videoData?.transcription?.duration;
    const durationStr = duration
      ? `${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, "0")}`
      : "unknown";

    // Create a summarization request
    const prompt = `Please summarize the following video transcript from "${videoName}" (${durationStr} duration). Provide:
1. A brief overview (2-3 sentences)
2. Key points or topics covered
3. Any notable quotes or important details

Transcript:
${transcript}`;

    // Open AI panel with the prompt - it will auto-submit
    openPanelWithPrompt(prompt);
  }, [videoData, openPanelWithPrompt]);

  if (!isOpen || !videoData) return null;

  return (
    <div className="video-fullscreen-overlay">
      <div className="video-fullscreen-container">
        {/* Header */}
        <div className="video-fullscreen-header">
          <div className="video-fullscreen-title">
            <h2>{videoData.originalName || "Video"}</h2>
            {videoData.transcription && (
              <span className="video-fullscreen-badge">
                Transcribed ({videoData.transcription.wordCount} words)
              </span>
            )}
          </div>
          <div className="video-fullscreen-actions">
            {videoData.transcription && (
              <>
                <button
                  type="button"
                  onClick={() => setShowSidebar(!showSidebar)}
                  className={`video-fullscreen-btn ${showSidebar ? "video-fullscreen-btn--active" : ""}`}
                  title="Toggle transcript panel"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </button>
                <div className="video-fullscreen-export">
                  <button
                    type="button"
                    className="video-fullscreen-btn"
                    title="Export transcript"
                    onClick={() => onExportTranscript?.("txt")}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </button>
                </div>
              </>
            )}
            <button
              type="button"
              onClick={closeViewer}
              className="video-fullscreen-btn video-fullscreen-close"
              title="Close (Escape)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="video-fullscreen-content">
          {/* Video player */}
          <div
            className="video-fullscreen-player"
            style={{ flex: showSidebar && videoData.transcription ? "1 1 60%" : "1" }}
          >
            {streamUrl ? (
              <video
                ref={videoRef}
                src={streamUrl}
                controls
                className="video-fullscreen-video"
              />
            ) : streamError ? (
              <div className="video-fullscreen-error">
                <p>Failed to load video</p>
                <p className="video-fullscreen-error-detail">{streamError}</p>
              </div>
            ) : (
              <div className="video-fullscreen-loading">
                <svg className="animate-spin" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
                  <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="0.75"/>
                </svg>
                <p>Loading video...</p>
              </div>
            )}
          </div>

          {/* Transcript sidebar */}
          {showSidebar && videoData.transcription && (
            <div className="video-fullscreen-sidebar">
              <TranscriptPanel
                transcription={videoData.transcription}
                currentTime={currentTime}
                onSegmentClick={handleSegmentClick}
                onCopySegment={handleCopySegment}
                onSummarize={handleSummarizeTranscript}
              />
            </div>
          )}
        </div>

        {/* Footer with shortcuts hint */}
        <div className="video-fullscreen-footer">
          <span>
            <kbd>Space</kbd> Play/Pause
          </span>
          <span>
            <kbd>←</kbd> <kbd>→</kbd> Seek 5s
          </span>
          {videoData.transcription && (
            <span>
              <kbd>T</kbd> Toggle transcript
            </span>
          )}
          <span>
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>

      <style>{`
        .video-fullscreen-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.9);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .video-fullscreen-container {
          width: 95%;
          height: 95%;
          background: var(--color-bg-primary);
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .video-fullscreen-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid var(--color-border);
          background: var(--color-bg-secondary);
        }

        .video-fullscreen-title {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .video-fullscreen-title h2 {
          margin: 0;
          font-size: 16px;
          font-weight: 500;
          color: var(--color-text-primary);
        }

        .video-fullscreen-badge {
          font-size: 11px;
          padding: 2px 8px;
          background: var(--color-accent-bg);
          color: var(--color-accent);
          border-radius: 10px;
        }

        .video-fullscreen-actions {
          display: flex;
          gap: 8px;
        }

        .video-fullscreen-btn {
          padding: 6px 8px;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: var(--color-text-secondary);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .video-fullscreen-btn:hover {
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
        }

        .video-fullscreen-btn--active {
          background: var(--color-accent-bg);
          color: var(--color-accent);
        }

        .video-fullscreen-close:hover {
          background: var(--color-error-bg);
          color: var(--color-error);
        }

        .video-fullscreen-content {
          flex: 1;
          display: flex;
          min-height: 0;
        }

        .video-fullscreen-player {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #000;
          padding: 16px;
        }

        .video-fullscreen-video {
          max-width: 100%;
          max-height: 100%;
          border-radius: 4px;
        }

        .video-fullscreen-sidebar {
          width: 350px;
          flex-shrink: 0;
        }

        .video-fullscreen-footer {
          display: flex;
          justify-content: center;
          gap: 24px;
          padding: 8px 16px;
          background: var(--color-bg-secondary);
          border-top: 1px solid var(--color-border);
          font-size: 12px;
          color: var(--color-text-muted);
        }

        .video-fullscreen-footer kbd {
          display: inline-block;
          padding: 2px 5px;
          font-family: monospace;
          font-size: 11px;
          background: var(--color-bg-tertiary);
          border: 1px solid var(--color-border);
          border-radius: 3px;
          margin: 0 2px;
        }

        .video-fullscreen-loading,
        .video-fullscreen-error {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: var(--color-text-muted);
          font-size: 14px;
        }

        .video-fullscreen-error {
          color: var(--color-error);
        }

        .video-fullscreen-error-detail {
          font-size: 12px;
          color: var(--color-text-muted);
          max-width: 300px;
          text-align: center;
          word-break: break-all;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .animate-spin {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
