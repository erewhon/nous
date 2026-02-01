import { useState, useEffect, useRef } from "react";
import { useAudioStore } from "../../stores/audioStore";
import { useAIStore } from "../../stores/aiStore";
import { useToastStore } from "../../stores/toastStore";
import { generatePageAudio } from "../../utils/api";
import { convertFileSrc } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { copyFile } from "@tauri-apps/plugin-fs";
import type { AudioMode, PodcastLength } from "../../types/audio";
import type { AudioGenerationResult } from "../../types/audio";

interface AudioGenerateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  notebookId: string;
  pageId: string;
  pageTitle: string;
}

type GenerationStage = "configure" | "generating" | "complete" | "error";

export function AudioGenerateDialog({
  isOpen,
  onClose,
  notebookId,
  pageId,
  pageTitle,
}: AudioGenerateDialogProps) {
  const audioStore = useAudioStore();
  const aiStore = useAIStore();
  const toast = useToastStore();

  const [mode, setMode] = useState<AudioMode>("tts");
  const [stage, setStage] = useState<GenerationStage>("configure");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AudioGenerationResult | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Podcast-specific options
  const [podcastLength, setPodcastLength] = useState<PodcastLength>(
    audioStore.settings.podcastLength
  );
  const [customInstructions, setCustomInstructions] = useState("");

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStage("configure");
      setError(null);
      setResult(null);
      setIsPlaying(false);
      setCustomInstructions("");
      setPodcastLength(audioStore.settings.podcastLength);
    }
  }, [isOpen, audioStore.settings.podcastLength]);

  // Load providers/voices when dialog opens
  useEffect(() => {
    if (isOpen) {
      audioStore.loadProviders();
      audioStore.loadVoices();
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup audio on close
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    setStage("generating");
    setError(null);

    try {
      const { settings } = audioStore;
      const ttsConfig = {
        provider: settings.ttsProvider,
        voice: settings.ttsVoice,
        apiKey: settings.ttsApiKey || null,
        baseUrl: settings.ttsBaseUrl || null,
        model: settings.ttsModel || null,
        speed: settings.ttsSpeed,
      };

      const options: {
        aiConfig?: { providerType: string; apiKey?: string; model?: string };
        voiceB?: string;
        targetLength?: string;
        customInstructions?: string;
      } = {};

      if (mode === "podcast") {
        options.aiConfig = {
          providerType: aiStore.getActiveProviderType(),
          apiKey: aiStore.getActiveApiKey() || undefined,
          model: aiStore.getActiveModel() || undefined,
        };
        options.voiceB = settings.podcastVoiceB;
        options.targetLength = podcastLength;
        if (customInstructions.trim()) {
          options.customInstructions = customInstructions.trim();
        }
      }

      const audioResult = await generatePageAudio(
        notebookId,
        pageId,
        mode,
        ttsConfig,
        options
      );

      // Validate the result — empty audioPath means silent failure
      if (!audioResult.audioPath) {
        throw new Error(
          "Audio generation returned no file path. Check TTS provider settings."
        );
      }

      setResult(audioResult);
      setStage("complete");
      toast.success("Audio generated successfully");
    } catch (e) {
      // Tauri invoke errors may be strings, objects with .message, or Error instances
      let message = "Failed to generate audio";
      if (e instanceof Error) {
        message = e.message;
      } else if (typeof e === "string") {
        message = e;
      } else if (e && typeof e === "object" && "message" in e) {
        message = (e as { message: string }).message;
      }
      setError(message);
      setStage("error");
      toast.error(message);
    }
  };

  const handlePlayPause = async () => {
    if (!result) return;

    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
      return;
    }

    try {
      if (!audioRef.current) {
        // Fetch the audio file via the asset protocol and create a blob URL.
        // Direct Audio element playback from http://asset.localhost is not
        // reliably supported in all webviews.
        const assetUrl = convertFileSrc(result.audioPath);
        const response = await fetch(assetUrl);
        if (!response.ok) {
          throw new Error(`Failed to load audio file (${response.status})`);
        }
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        blobUrlRef.current = blobUrl;

        audioRef.current = new Audio(blobUrl);
        audioRef.current.onended = () => setIsPlaying(false);
        audioRef.current.onerror = () => {
          setIsPlaying(false);
          toast.error("Failed to play audio");
        };
      }

      await audioRef.current.play();
      setIsPlaying(true);
    } catch (e) {
      setIsPlaying(false);
      toast.error(e instanceof Error ? e.message : "Failed to play audio file");
    }
  };

  const handleSave = async () => {
    if (!result) return;

    const ext = result.format || "mp3";
    const defaultName = `${pageTitle || "audio"}.${ext}`;
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: "Audio", extensions: [ext] }],
    });

    if (!path) return;

    try {
      await copyFile(result.audioPath, path);
      toast.success("Audio file saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save audio file");
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-panel)",
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
            <h3
              className="text-base font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Generate Audio
            </h3>
            <p
              className="mt-0.5 text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              {pageTitle}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            <IconX />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[70vh] overflow-y-auto p-6">
          {stage === "configure" && (
            <div className="space-y-5">
              {/* Mode Selection */}
              <div>
                <label
                  className="mb-2 block text-sm font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setMode("tts")}
                    className="rounded-lg border p-3 text-left transition-colors"
                    style={{
                      borderColor:
                        mode === "tts"
                          ? "var(--color-accent)"
                          : "var(--color-border)",
                      backgroundColor:
                        mode === "tts"
                          ? "rgba(139, 92, 246, 0.1)"
                          : "transparent",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <IconSpeaker />
                      <span
                        className="text-sm font-medium"
                        style={{ color: "var(--color-text-primary)" }}
                      >
                        Text-to-Speech
                      </span>
                    </div>
                    <p
                      className="mt-1 text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Read the page content aloud with a single voice
                    </p>
                  </button>
                  <button
                    onClick={() => setMode("podcast")}
                    className="rounded-lg border p-3 text-left transition-colors"
                    style={{
                      borderColor:
                        mode === "podcast"
                          ? "var(--color-accent)"
                          : "var(--color-border)",
                      backgroundColor:
                        mode === "podcast"
                          ? "rgba(139, 92, 246, 0.1)"
                          : "transparent",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <IconMicrophone />
                      <span
                        className="text-sm font-medium"
                        style={{ color: "var(--color-text-primary)" }}
                      >
                        Podcast
                      </span>
                    </div>
                    <p
                      className="mt-1 text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Two-speaker discussion about the page content
                    </p>
                  </button>
                </div>
              </div>

              {/* TTS Voice Info */}
              <div
                className="rounded-lg border p-3"
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  borderColor: "var(--color-border)",
                }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span
                      className="text-xs font-medium"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Provider
                    </span>
                    <p
                      className="text-sm"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      {audioStore.settings.ttsProvider}
                    </p>
                  </div>
                  <div>
                    <span
                      className="text-xs font-medium"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Voice
                    </span>
                    <p
                      className="text-sm"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      {audioStore.settings.ttsVoice}
                    </p>
                  </div>
                  <div>
                    <span
                      className="text-xs font-medium"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Speed
                    </span>
                    <p
                      className="text-sm"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      {audioStore.settings.ttsSpeed}x
                    </p>
                  </div>
                </div>
                <p
                  className="mt-2 text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Configure TTS providers in Settings &gt; Audio
                </p>
              </div>

              {/* Podcast Options */}
              {mode === "podcast" && (
                <div className="space-y-4">
                  {/* Length */}
                  <div>
                    <label
                      className="mb-2 block text-sm font-medium"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      Length
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { value: "short", label: "Short", desc: "~2 min" },
                          { value: "medium", label: "Medium", desc: "~5 min" },
                          { value: "long", label: "Long", desc: "~10 min" },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setPodcastLength(opt.value)}
                          className="rounded-lg border px-3 py-2 text-center transition-colors"
                          style={{
                            borderColor:
                              podcastLength === opt.value
                                ? "var(--color-accent)"
                                : "var(--color-border)",
                            backgroundColor:
                              podcastLength === opt.value
                                ? "rgba(139, 92, 246, 0.1)"
                                : "transparent",
                          }}
                        >
                          <span
                            className="text-sm font-medium"
                            style={{ color: "var(--color-text-primary)" }}
                          >
                            {opt.label}
                          </span>
                          <span
                            className="ml-1 text-xs"
                            style={{ color: "var(--color-text-muted)" }}
                          >
                            {opt.desc}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom Instructions */}
                  <div>
                    <label
                      className="mb-2 block text-sm font-medium"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      Custom Instructions{" "}
                      <span
                        className="font-normal"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        (optional)
                      </span>
                    </label>
                    <textarea
                      value={customInstructions}
                      onChange={(e) => setCustomInstructions(e.target.value)}
                      placeholder="e.g., Focus on the practical examples, keep a humorous tone..."
                      rows={3}
                      className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[--color-accent]"
                      style={{
                        backgroundColor: "var(--color-bg-tertiary)",
                        borderColor: "var(--color-border)",
                        color: "var(--color-text-primary)",
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {stage === "generating" && (
            <div className="flex flex-col items-center py-10">
              <div
                className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-current border-t-transparent"
                style={{ color: "var(--color-accent)" }}
              />
              <p
                className="text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                {mode === "podcast"
                  ? "Generating podcast discussion..."
                  : "Generating audio..."}
              </p>
              <p
                className="mt-1 text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {mode === "podcast"
                  ? "Writing script and synthesizing voices"
                  : "Converting text to speech"}
              </p>
            </div>
          )}

          {stage === "error" && (
            <div className="py-6">
              <div
                className="rounded-lg border p-4"
                style={{
                  backgroundColor: "rgba(239, 68, 68, 0.1)",
                  borderColor: "rgba(239, 68, 68, 0.3)",
                }}
              >
                <p
                  className="text-sm font-medium"
                  style={{ color: "rgb(239, 68, 68)" }}
                >
                  Generation failed
                </p>
                <p
                  className="mt-1 text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {error}
                </p>
              </div>
            </div>
          )}

          {stage === "complete" && result && (
            <div className="space-y-4">
              {/* Audio Player */}
              <div
                className="rounded-lg border p-4"
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  borderColor: "var(--color-border)",
                }}
              >
                <div className="flex items-center gap-4">
                  <button
                    onClick={handlePlayPause}
                    className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:opacity-90"
                    style={{
                      backgroundColor: "var(--color-accent)",
                      color: "white",
                    }}
                  >
                    {isPlaying ? <IconPause /> : <IconPlay />}
                  </button>
                  <div className="flex-1">
                    <p
                      className="text-sm font-medium"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      {mode === "podcast"
                        ? "Podcast Discussion"
                        : "Audio Narration"}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {formatDuration(result.durationSeconds)} &middot;{" "}
                      {formatFileSize(result.fileSizeBytes)} &middot;{" "}
                      {result.format.toUpperCase()}
                    </p>
                  </div>
                  <button
                    onClick={handleSave}
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border transition-colors hover:bg-[--color-bg-tertiary]"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-secondary)",
                    }}
                    title="Save audio file"
                  >
                    <IconSave />
                  </button>
                </div>
              </div>

              {/* Generation Stats */}
              <div
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                Generated in {result.generationTimeSeconds.toFixed(1)}s
              </div>

              {/* Transcript (for podcast) */}
              {result.transcript && result.transcript.length > 0 && (
                <div>
                  <p
                    className="mb-2 text-sm font-medium"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    Transcript
                  </p>
                  <div
                    className="max-h-48 space-y-2 overflow-y-auto rounded-lg border p-3"
                    style={{
                      backgroundColor: "var(--color-bg-tertiary)",
                      borderColor: "var(--color-border)",
                    }}
                  >
                    {result.transcript.map((line, i) => (
                      <div key={i} className="text-xs">
                        <span
                          className="font-semibold"
                          style={{
                            color:
                              line.speaker === "A"
                                ? "var(--color-accent)"
                                : "rgb(59, 130, 246)",
                          }}
                        >
                          Host {line.speaker}:
                        </span>{" "}
                        <span style={{ color: "var(--color-text-secondary)" }}>
                          {line.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-3 border-t px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          {stage === "configure" && (
            <>
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
                style={{
                  background:
                    "linear-gradient(to bottom right, var(--color-accent), var(--color-accent-secondary))",
                }}
              >
                {mode === "podcast" ? "Generate Podcast" : "Generate Audio"}
              </button>
            </>
          )}
          {stage === "generating" && (
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm transition-colors hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Cancel
            </button>
          )}
          {(stage === "complete" || stage === "error") && (
            <>
              {stage === "error" && (
                <button
                  onClick={() => setStage("configure")}
                  className="rounded-lg px-4 py-2 text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Try Again
                </button>
              )}
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
                style={{
                  background:
                    "linear-gradient(to bottom right, var(--color-accent), var(--color-accent-secondary))",
                }}
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Icons

function IconX() {
  return (
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
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function IconSpeaker() {
  return (
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
      style={{ color: "var(--color-accent)" }}
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function IconMicrophone() {
  return (
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
      style={{ color: "var(--color-accent)" }}
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function IconSave() {
  return (
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
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}
