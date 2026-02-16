import { useState, useEffect, useCallback } from "react";
import { useVideoGenerateStore } from "../../stores/videoGenerateStore";
import { useStudyToolsStore } from "../../stores/studyToolsStore";
import { useAudioStore } from "../../stores/audioStore";
import { useToastStore } from "../../stores/toastStore";
import { SlideList } from "./SlidePreview";
import { SlideEditor } from "./SlideEditor";
import { VideoProgress } from "./VideoProgress";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { copyFile } from "@tauri-apps/plugin-fs";
import type { SlideContent, VideoTheme } from "../../types/videoGenerate";
import { ASPECT_RATIO_PRESETS } from "../../types/videoGenerate";
import { getVideoStreamUrl } from "../../utils/videoUrl";

interface VideoProgressPayload {
  currentSlide: number;
  totalSlides: number;
  status: string;
  notebookId: string;
}

interface VideoGeneratorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  notebookId: string;
}

export function VideoGeneratorDialog({
  isOpen,
  onClose,
  notebookId,
}: VideoGeneratorDialogProps) {
  const videoStore = useVideoGenerateStore();
  const studyToolsStore = useStudyToolsStore();
  const audioStore = useAudioStore();
  const toast = useToastStore();

  const [selectedSlideIndex, setSelectedSlideIndex] = useState(0);
  const [title, setTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Progress state from Tauri events
  const [progressInfo, setProgressInfo] = useState<{
    currentSlide: number;
    totalSlides: number;
    status: string;
  } | null>(null);

  // Listen for progress events from backend
  useEffect(() => {
    if (!videoStore.isGenerating) {
      setProgressInfo(null);
      return;
    }

    const unlisten = listen<VideoProgressPayload>("video-generation-progress", (event) => {
      if (event.payload.notebookId === notebookId) {
        setProgressInfo({
          currentSlide: event.payload.currentSlide,
          totalSlides: event.payload.totalSlides,
          status: event.payload.status,
        });
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [videoStore.isGenerating, notebookId]);

  // Check availability on mount
  useEffect(() => {
    if (isOpen && !videoStore.availability) {
      videoStore.checkAvailability();
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load audio providers/voices when dialog opens
  useEffect(() => {
    if (isOpen) {
      audioStore.loadProviders();
      audioStore.loadVoices();
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      videoStore.clearResult();
      videoStore.clearError();
      setTitle("");
      setSelectedSlideIndex(0);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts for slide navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't handle if we're in an input/textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      // Don't handle if no slides or showing result/generating
      if (
        videoStore.slides.length === 0 ||
        videoStore.result ||
        videoStore.isGenerating
      ) {
        return;
      }

      switch (e.key) {
        case "ArrowUp":
        case "ArrowLeft":
          e.preventDefault();
          setSelectedSlideIndex((prev) => Math.max(0, prev - 1));
          break;
        case "ArrowDown":
        case "ArrowRight":
          e.preventDefault();
          setSelectedSlideIndex((prev) =>
            Math.min(videoStore.slides.length - 1, prev + 1)
          );
          break;
        case "Delete":
        case "Backspace":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            if (videoStore.slides.length > 0) {
              videoStore.removeSlide(selectedSlideIndex);
              if (selectedSlideIndex > 0) {
                setSelectedSlideIndex(selectedSlideIndex - 1);
              }
            }
          }
          break;
      }
    },
    [videoStore.slides.length, videoStore.result, videoStore.isGenerating, selectedSlideIndex]
  );

  useEffect(() => {
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  // Helper to resolve video src URLs via the video server
  const VideoPreviewPlayer = ({ videoPath }: { videoPath: string }) => {
    const [src, setSrc] = useState<string | null>(null);
    useEffect(() => {
      getVideoStreamUrl(videoPath).then(setSrc).catch(() => setSrc(null));
    }, [videoPath]);
    return (
      <div
        className="rounded-lg overflow-hidden border"
        style={{ borderColor: "var(--color-border)" }}
      >
        {src ? (
          <video src={src} controls className="w-full" style={{ maxHeight: "400px" }} />
        ) : (
          <div className="flex items-center justify-center h-32" style={{ color: "var(--color-text-muted)" }}>
            Loading video...
          </div>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  // Generate slides from study content
  const handleGenerateSlides = () => {
    const slides: SlideContent[] = [];

    // From study guide
    if (studyToolsStore.studyGuide) {
      const guide = studyToolsStore.studyGuide;

      // Title slide with objectives
      slides.push({
        title: guide.title,
        body: guide.summary,
        bulletPoints: guide.learningObjectives.slice(0, 4),
      });

      // Key concepts slides
      if (guide.keyConcepts.length > 0) {
        const conceptsPerSlide = 3;
        for (let i = 0; i < guide.keyConcepts.length; i += conceptsPerSlide) {
          const concepts = guide.keyConcepts.slice(i, i + conceptsPerSlide);
          slides.push({
            title: "Key Concepts",
            body: "",
            bulletPoints: concepts.map((c) => `${c.term}: ${c.definition}`),
          });
        }
      }

      // Section slides
      guide.sections.forEach((section) => {
        slides.push({
          title: section.heading,
          body: section.content.slice(0, 200),
          bulletPoints: section.keyPoints.slice(0, 5),
        });
      });
    }

    // From briefing
    if (studyToolsStore.briefing) {
      const briefing = studyToolsStore.briefing;

      slides.push({
        title: briefing.title,
        body: briefing.executiveSummary,
        bulletPoints: [],
      });

      if (briefing.keyFindings.length > 0) {
        slides.push({
          title: "Key Findings",
          body: "",
          bulletPoints: briefing.keyFindings.slice(0, 6),
        });
      }

      if (briefing.recommendations.length > 0) {
        slides.push({
          title: "Recommendations",
          body: "",
          bulletPoints: briefing.recommendations.slice(0, 6),
        });
      }
    }

    if (slides.length === 0) {
      toast.error("No study content available. Generate a study guide or briefing first.");
      return;
    }

    videoStore.setSlides(slides);
    setTitle(studyToolsStore.studyGuide?.title || studyToolsStore.briefing?.title || "Presentation");
    toast.success(`Generated ${slides.length} slides from study content`);
  };

  const handleGenerateVideo = async () => {
    const result = await videoStore.generateVideo(notebookId, title || undefined);

    if (result) {
      toast.success("Video generated successfully");
    } else {
      toast.error(videoStore.error || "Failed to generate video");
    }
  };

  const handleSaveVideo = async () => {
    if (!videoStore.result) return;

    const defaultName = `${title || "presentation"}.mp4`;
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
    });

    if (path) {
      setIsSaving(true);
      try {
        await copyFile(videoStore.result.videoPath, path);
        toast.success("Video saved successfully");
      } catch (error) {
        toast.error("Failed to save video");
      } finally {
        setIsSaving(false);
      }
    }
  };

  const availability = videoStore.availability;
  const canGenerate =
    videoStore.slides.length > 0 &&
    !videoStore.isGenerating &&
    availability?.fullyAvailable;

  const hasStudyContent =
    studyToolsStore.studyGuide !== null || studyToolsStore.briefing !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] w-full max-w-5xl flex-col rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Generate Video
            </h2>
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              Create narrated presentations from your study content
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:bg-[--color-bg-tertiary]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: "var(--color-text-muted)" }}
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {videoStore.isGenerating ? (
            // Show progress
            <div className="max-w-md mx-auto py-12">
              <VideoProgress
                progress={
                  progressInfo
                    ? Math.round((progressInfo.currentSlide / progressInfo.totalSlides) * 100)
                    : videoStore.progress
                }
                currentSlide={progressInfo?.currentSlide ?? 0}
                totalSlides={progressInfo?.totalSlides ?? videoStore.slides.length}
                status={progressInfo?.status ?? "Starting video generation..."}
              />
            </div>
          ) : videoStore.result ? (
            // Show result
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3
                  className="font-semibold"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Video Generated
                </h3>
                <button
                  onClick={() => videoStore.clearResult()}
                  className="text-sm hover:underline"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Generate new
                </button>
              </div>

              {/* Saved to notebook indicator */}
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
                style={{
                  backgroundColor: "rgba(34, 197, 94, 0.1)",
                  color: "#22c55e",
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <span>
                  Saved to notebook
                  <span style={{ color: "var(--color-text-muted)" }}>
                    {" "}
                    ({videoStore.result.videoPath.split("/").pop() || videoStore.result.videoPath.split("\\").pop()})
                  </span>
                </span>
              </div>

              {/* Video preview */}
              <VideoPreviewPlayer videoPath={videoStore.result.videoPath} />

              {/* Info and actions */}
              <div className="flex items-center justify-between">
                <div
                  className="text-sm"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {videoStore.result.slideCount} slides
                  <span className="mx-2">|</span>
                  {Math.round(videoStore.result.durationSeconds)}s duration
                  <span className="mx-2">|</span>
                  Generated in {videoStore.result.generationTimeSeconds.toFixed(1)}s
                </div>

                <button
                  onClick={handleSaveVideo}
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--color-accent)",
                    color: "white",
                  }}
                >
                  {isSaving ? "Exporting..." : "Export Video"}
                </button>
              </div>
            </div>
          ) : (
            // Configuration
            <div className="space-y-6">
              {/* Availability warnings */}
              {availability && !availability.fullyAvailable && (
                <div
                  className="p-3 rounded-lg text-sm"
                  style={{
                    backgroundColor: "rgba(239, 68, 68, 0.1)",
                    color: "#ef4444",
                  }}
                >
                  {!availability.pillow && "Pillow is not installed. "}
                  {!availability.ffmpeg && "FFmpeg is not available. "}
                  Video generation requires these dependencies.
                </div>
              )}

              {/* Generate slides from study content */}
              <div
                className="p-4 rounded-lg border"
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  borderColor: "var(--color-border)",
                }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div
                      className="font-medium"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      Generate Slides from Study Content
                    </div>
                    <div
                      className="text-sm mt-1"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {hasStudyContent
                        ? "Create slides from your study guide or briefing"
                        : "Generate a study guide or briefing first using Study Tools"}
                    </div>
                  </div>
                  <button
                    onClick={handleGenerateSlides}
                    disabled={!hasStudyContent}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50"
                    style={{
                      backgroundColor: hasStudyContent
                        ? "var(--color-accent)"
                        : "var(--color-bg-tertiary)",
                      color: hasStudyContent ? "white" : "var(--color-text-muted)",
                    }}
                  >
                    Generate Slides
                  </button>
                </div>
              </div>

              {/* Slides preview */}
              {videoStore.slides.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label
                      className="text-sm font-medium"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      Slides ({videoStore.slides.length})
                    </label>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          const newSlide = {
                            title: "New Slide",
                            body: "",
                            bulletPoints: [],
                          };
                          videoStore.addSlide(newSlide);
                          setSelectedSlideIndex(videoStore.slides.length);
                        }}
                        className="text-xs px-2 py-1 rounded hover:bg-[--color-bg-tertiary] transition-colors"
                        style={{ color: "var(--color-accent)" }}
                      >
                        + Add Slide
                      </button>
                      <button
                        onClick={() => videoStore.clearSlides()}
                        className="text-xs hover:underline"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        Clear all
                      </button>
                    </div>
                  </div>
                  <SlideList
                    slides={videoStore.slides}
                    selectedIndex={selectedSlideIndex}
                    onSelectSlide={setSelectedSlideIndex}
                    onReorder={(from, to) => {
                      videoStore.reorderSlides(from, to);
                    }}
                    theme={videoStore.settings.theme}
                  />

                  {/* Slide Editor */}
                  {videoStore.slides[selectedSlideIndex] && (
                    <SlideEditor
                      slide={videoStore.slides[selectedSlideIndex]}
                      slideNumber={selectedSlideIndex + 1}
                      totalSlides={videoStore.slides.length}
                      theme={videoStore.settings.theme}
                      onUpdate={(updates) => videoStore.updateSlide(selectedSlideIndex, updates)}
                      onDelete={() => {
                        videoStore.removeSlide(selectedSlideIndex);
                        if (selectedSlideIndex > 0) {
                          setSelectedSlideIndex(selectedSlideIndex - 1);
                        }
                      }}
                      onMoveUp={() => {
                        if (selectedSlideIndex > 0) {
                          videoStore.reorderSlides(selectedSlideIndex, selectedSlideIndex - 1);
                          setSelectedSlideIndex(selectedSlideIndex - 1);
                        }
                      }}
                      onMoveDown={() => {
                        if (selectedSlideIndex < videoStore.slides.length - 1) {
                          videoStore.reorderSlides(selectedSlideIndex, selectedSlideIndex + 1);
                          setSelectedSlideIndex(selectedSlideIndex + 1);
                        }
                      }}
                      onDuplicate={() => {
                        const currentSlide = videoStore.slides[selectedSlideIndex];
                        const duplicatedSlide = {
                          ...currentSlide,
                          title: `${currentSlide.title} (copy)`,
                        };
                        videoStore.addSlide(duplicatedSlide);
                        setSelectedSlideIndex(videoStore.slides.length);
                      }}
                    />
                  )}
                </div>
              )}

              {/* Title */}
              <div>
                <label
                  className="block text-sm font-medium mb-2"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Video Title (optional)
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter video title..."
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{
                    backgroundColor: "var(--color-bg-secondary)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-primary)",
                  }}
                />
              </div>

              {/* Settings row */}
              <div className="grid grid-cols-4 gap-4">
                {/* Theme */}
                <div>
                  <label
                    className="block text-sm font-medium mb-2"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    Theme
                  </label>
                  <div className="flex gap-2">
                    {(["light", "dark"] as VideoTheme[]).map((theme) => (
                      <button
                        key={theme}
                        onClick={() => videoStore.setTheme(theme)}
                        className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium capitalize ${
                          videoStore.settings.theme === theme
                            ? "ring-2 ring-[--color-accent]"
                            : ""
                        }`}
                        style={{
                          backgroundColor:
                            theme === "dark" ? "#1a1a2e" : "#ffffff",
                          color: theme === "dark" ? "#eaeaea" : "#2c3e50",
                          border: "1px solid var(--color-border)",
                        }}
                      >
                        {theme}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Transition */}
                <div>
                  <label
                    className="block text-sm font-medium mb-2"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    Transition
                  </label>
                  <select
                    value={videoStore.settings.transition}
                    onChange={(e) =>
                      videoStore.setTransition(e.target.value as "cut" | "fade")
                    }
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    style={{
                      backgroundColor: "var(--color-bg-secondary)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    <option value="cut">Cut (instant)</option>
                    <option value="fade">Fade</option>
                  </select>
                </div>

                {/* Aspect ratio */}
                <div>
                  <label
                    className="block text-sm font-medium mb-2"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    Resolution
                  </label>
                  <select
                    value={`${videoStore.settings.width}x${videoStore.settings.height}`}
                    onChange={(e) => {
                      const preset = ASPECT_RATIO_PRESETS.find(
                        (p) => `${p.width}x${p.height}` === e.target.value
                      );
                      if (preset) {
                        videoStore.setAspectRatio(preset.width, preset.height);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    style={{
                      backgroundColor: "var(--color-bg-secondary)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {ASPECT_RATIO_PRESETS.map((preset) => (
                      <option
                        key={preset.id}
                        value={`${preset.width}x${preset.height}`}
                      >
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Voice */}
                <div>
                  <label
                    className="block text-sm font-medium mb-2"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    Narration Voice
                  </label>
                  <select
                    value={videoStore.ttsConfig.voice || audioStore.settings.ttsVoice}
                    onChange={(e) =>
                      videoStore.setTTSConfig({ voice: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    style={{
                      backgroundColor: "var(--color-bg-secondary)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {audioStore.voices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Accent Color */}
              <div>
                <label
                  className="block text-sm font-medium mb-2"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Accent Color
                </label>
                <div className="flex items-center gap-3">
                  {["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c"].map((color) => (
                    <button
                      key={color}
                      onClick={() => videoStore.setAccentColor(
                        videoStore.settings.accentColor === color ? null : color
                      )}
                      className={`w-7 h-7 rounded-full transition-all ${
                        videoStore.settings.accentColor === color
                          ? "ring-2 ring-offset-2 ring-[--color-accent] scale-110"
                          : "hover:scale-110"
                      }`}
                      style={{ backgroundColor: color }}
                      title={videoStore.settings.accentColor === color ? "Using custom accent (click to reset)" : color}
                    />
                  ))}
                  <input
                    type="color"
                    value={videoStore.settings.accentColor || "#e74c3c"}
                    onChange={(e) => videoStore.setAccentColor(e.target.value)}
                    className="w-7 h-7 rounded cursor-pointer border-0 p-0"
                    title="Custom color"
                  />
                  {videoStore.settings.accentColor && (
                    <button
                      onClick={() => videoStore.setAccentColor(null)}
                      className="text-xs hover:underline"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {/* Speed and Model row */}
              <div className="grid grid-cols-2 gap-4">
                {/* Speed */}
                <div>
                  <label
                    className="block text-sm font-medium mb-2"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    Narration Speed
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0.5"
                      max="2.0"
                      step="0.1"
                      value={videoStore.ttsConfig.speed ?? audioStore.settings.ttsSpeed ?? 1.0}
                      onChange={(e) =>
                        videoStore.setTTSConfig({ speed: parseFloat(e.target.value) })
                      }
                      className="flex-1"
                    />
                    <span
                      className="text-sm font-mono w-12 text-right"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {(videoStore.ttsConfig.speed ?? audioStore.settings.ttsSpeed ?? 1.0).toFixed(1)}x
                    </span>
                  </div>
                </div>

                {/* Model */}
                <div>
                  <label
                    className="block text-sm font-medium mb-2"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    TTS Model (optional)
                  </label>
                  <input
                    type="text"
                    value={videoStore.ttsConfig.model ?? audioStore.settings.ttsModel ?? ""}
                    onChange={(e) =>
                      videoStore.setTTSConfig({ model: e.target.value || undefined })
                    }
                    placeholder="Default model"
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    style={{
                      backgroundColor: "var(--color-bg-secondary)",
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  />
                </div>
              </div>

              {/* Error display */}
              {videoStore.error && (
                <div
                  className="p-3 rounded-lg text-sm"
                  style={{
                    backgroundColor: "rgba(239, 68, 68, 0.1)",
                    color: "#ef4444",
                  }}
                >
                  {videoStore.error}
                </div>
              )}

              {/* Generate button */}
              <button
                onClick={handleGenerateVideo}
                disabled={!canGenerate}
                className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: "var(--color-accent)" }}
              >
                {videoStore.isGenerating
                  ? "Generating..."
                  : `Generate Video (${videoStore.slides.length} slides)`}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="border-t px-6 py-3 text-center text-xs"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          Press{" "}
          <kbd
            className="rounded px-1"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          >
            Esc
          </kbd>{" "}
          to close
        </div>
      </div>
    </div>
  );
}
