import { useState, useEffect } from "react";
import { transcribeVideo } from "../../utils/videoApi";
import { aiChat } from "../../utils/api";
import { useAIStore } from "../../stores/aiStore";
import type { TranscriptionResult } from "../../types/video";

interface TranscriptionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  videoPath: string;
  videoName: string;
  hasExistingTranscription: boolean;
  onComplete: (result: {
    transcription: TranscriptionResult;
    summary?: string;
    synopsis?: string;
  }) => void;
}

type TranscriptionStage =
  | "idle"
  | "transcribing"
  | "generating-summary"
  | "complete"
  | "error";

export function TranscriptionDialog({
  isOpen,
  onClose,
  videoPath,
  videoName,
  hasExistingTranscription,
  onComplete,
}: TranscriptionDialogProps) {
  const [generateSummary, setGenerateSummary] = useState(true);
  const [stage, setStage] = useState<TranscriptionStage>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Get AI settings from store
  const getActiveProviderType = useAIStore((state) => state.getActiveProviderType);
  const getActiveApiKey = useAIStore((state) => state.getActiveApiKey);
  const getActiveModel = useAIStore((state) => state.getActiveModel);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStage("idle");
      setProgress("");
      setError(null);
    }
  }, [isOpen]);

  const handleTranscribe = async () => {
    setStage("transcribing");
    setProgress("Extracting audio and transcribing...");
    setError(null);

    try {
      // Run transcription
      console.log("Starting transcription for:", videoPath);
      const result = await transcribeVideo(videoPath);
      console.log("Transcription complete:", result.wordCount, "words");

      let summary: string | undefined;
      let synopsis: string | undefined;

      // Generate summary if requested
      console.log("Generate summary requested:", generateSummary, "Word count:", result.wordCount);
      if (generateSummary && result.wordCount > 0) {
        setStage("generating-summary");
        setProgress("Generating AI summary and synopsis...");

        const fullTranscript = result.segments.map((s) => s.text).join(" ");
        console.log("Transcript length for summary:", fullTranscript.length, "chars");

        try {
          // Get AI credentials from store
          const providerType = getActiveProviderType();
          const apiKey = getActiveApiKey();
          const model = getActiveModel();

          if (!apiKey) {
            console.warn("No API key configured for AI provider. Skipping summary generation.");
            console.warn("Please configure your AI API key in Settings > AI.");
          } else {
            // Generate two-sentence summary
            console.log("Calling aiChat for summary with provider:", providerType, "model:", model);
            const summaryResponse = await aiChat(
              [
                {
                  role: "user",
                  content: `You are summarizing a video transcript. Provide exactly TWO sentences that capture the main topic and key points of this video. Be concise and informative.

Video: "${videoName}"

Transcript:
${fullTranscript}

Respond with only the two-sentence summary, nothing else.`,
                },
              ],
              {
                providerType,
                apiKey,
                model,
              }
            );

            console.log("Summary response:", summaryResponse);
            if (summaryResponse.content) {
              summary = summaryResponse.content.trim();
              console.log("Summary extracted:", summary.substring(0, 100) + "...");
            } else {
              console.warn("Summary response has no content field");
            }

            // Generate three-paragraph synopsis
            console.log("Calling aiChat for synopsis...");
            const synopsisResponse = await aiChat(
              [
                {
                  role: "user",
                  content: `You are creating a synopsis of a video transcript. Write exactly THREE paragraphs that provide a comprehensive overview:

Paragraph 1: Introduce the main topic and context of the video.
Paragraph 2: Describe the key points, arguments, or information presented.
Paragraph 3: Summarize conclusions, takeaways, or the significance of the content.

Video: "${videoName}"

Transcript:
${fullTranscript}

Respond with only the three paragraphs, separated by blank lines. No headings or labels.`,
                },
              ],
              {
                providerType,
                apiKey,
                model,
              }
            );

            console.log("Synopsis response received");
            if (synopsisResponse.content) {
              synopsis = synopsisResponse.content.trim();
              console.log("Synopsis extracted, length:", synopsis.length);
            } else {
              console.warn("Synopsis response has no content field");
            }
          }
        } catch (err) {
          console.error("Failed to generate summary:", err);
          // Continue without summary - don't fail the whole operation
        }
      } else {
        console.log("Skipping summary generation - generateSummary:", generateSummary, "wordCount:", result.wordCount);
      }

      console.log("Calling onComplete with summary:", !!summary, "synopsis:", !!synopsis);

      setStage("complete");
      setProgress("Complete!");

      // Return results after a brief delay to show completion
      setTimeout(() => {
        onComplete({ transcription: result, summary, synopsis });
        onClose();
      }, 500);
    } catch (err) {
      console.error("Transcription failed:", err);
      setStage("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="transcription-dialog-overlay" onClick={onClose}>
      <div
        className="transcription-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="transcription-dialog-header">
          <h3>
            {hasExistingTranscription ? "Re-transcribe Video" : "Transcribe Video"}
          </h3>
          <button className="transcription-dialog-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="transcription-dialog-body">
          {stage === "idle" && (
            <>
              <p className="transcription-dialog-info">
                {hasExistingTranscription
                  ? "This will replace the existing transcription with a new one."
                  : "Transcribe the video audio to text using AI. This may take a few minutes for longer videos."}
              </p>

              <label className="transcription-dialog-checkbox">
                <input
                  type="checkbox"
                  checked={generateSummary}
                  onChange={(e) => setGenerateSummary(e.target.checked)}
                />
                <span>Generate AI summary & synopsis</span>
              </label>

              <div className="transcription-dialog-actions">
                <button
                  className="transcription-dialog-btn secondary"
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  className="transcription-dialog-btn primary"
                  onClick={handleTranscribe}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                  {hasExistingTranscription ? "Re-transcribe" : "Transcribe"}
                </button>
              </div>
            </>
          )}

          {(stage === "transcribing" || stage === "generating-summary") && (
            <div className="transcription-dialog-progress">
              <div className="transcription-dialog-spinner">
                <svg className="animate-spin" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="0.75" />
                </svg>
              </div>
              <p className="transcription-dialog-status">{progress}</p>
              <p className="transcription-dialog-hint">
                {stage === "transcribing"
                  ? "This may take a while for longer videos..."
                  : "Almost done..."}
              </p>
            </div>
          )}

          {stage === "complete" && (
            <div className="transcription-dialog-complete">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <p>Transcription complete!</p>
            </div>
          )}

          {stage === "error" && (
            <div className="transcription-dialog-error">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p>Transcription failed</p>
              <p className="transcription-dialog-error-detail">{error}</p>
              <div className="transcription-dialog-actions">
                <button
                  className="transcription-dialog-btn secondary"
                  onClick={onClose}
                >
                  Close
                </button>
                <button
                  className="transcription-dialog-btn primary"
                  onClick={() => {
                    setStage("idle");
                    setError(null);
                  }}
                >
                  Try Again
                </button>
              </div>
            </div>
          )}
        </div>

        <style>{`
          .transcription-dialog-overlay {
            position: fixed;
            inset: 0;
            background-color: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(2px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
          }

          .transcription-dialog {
            background-color: var(--color-bg, #1a1a1a);
            border: 1px solid var(--color-border, #333);
            border-radius: 8px;
            width: 400px;
            max-width: 90vw;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          }

          .transcription-dialog-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px;
            border-bottom: 1px solid var(--color-border);
          }

          .transcription-dialog-header h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
          }

          .transcription-dialog-close {
            background: none;
            border: none;
            padding: 4px;
            cursor: pointer;
            color: var(--color-text-muted);
            border-radius: 4px;
          }

          .transcription-dialog-close:hover {
            background: var(--color-bg-hover);
            color: var(--color-text);
          }

          .transcription-dialog-body {
            padding: 20px;
          }

          .transcription-dialog-info {
            margin: 0 0 16px;
            font-size: 14px;
            color: var(--color-text-secondary);
            line-height: 1.5;
          }

          .transcription-dialog-checkbox {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            font-size: 14px;
            margin-bottom: 20px;
          }

          .transcription-dialog-checkbox input {
            width: 16px;
            height: 16px;
            cursor: pointer;
          }

          .transcription-dialog-actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
          }

          .transcription-dialog-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s;
          }

          .transcription-dialog-btn.primary {
            background: var(--color-primary);
            color: white;
            border: none;
          }

          .transcription-dialog-btn.primary:hover {
            background: var(--color-primary-hover);
          }

          .transcription-dialog-btn.secondary {
            background: var(--color-bg-secondary);
            color: var(--color-text);
            border: 1px solid var(--color-border);
          }

          .transcription-dialog-btn.secondary:hover {
            background: var(--color-bg-hover);
          }

          .transcription-dialog-progress {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 20px 0;
          }

          .transcription-dialog-spinner {
            margin-bottom: 16px;
          }

          .transcription-dialog-status {
            margin: 0;
            font-size: 14px;
            font-weight: 500;
          }

          .transcription-dialog-hint {
            margin: 8px 0 0;
            font-size: 12px;
            color: var(--color-text-muted);
          }

          .transcription-dialog-complete {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 20px 0;
          }

          .transcription-dialog-complete p {
            margin: 12px 0 0;
            font-size: 16px;
            font-weight: 500;
            color: var(--color-success);
          }

          .transcription-dialog-error {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 20px 0;
          }

          .transcription-dialog-error > p:first-of-type {
            margin: 12px 0 0;
            font-size: 16px;
            font-weight: 500;
            color: var(--color-error);
          }

          .transcription-dialog-error-detail {
            margin: 8px 0 16px;
            font-size: 12px;
            color: var(--color-text-muted);
            text-align: center;
            max-width: 300px;
            word-break: break-word;
          }

          @keyframes spin {
            to { transform: rotate(360deg); }
          }

          .animate-spin {
            animation: spin 1s linear infinite;
          }
        `}</style>
      </div>
    </div>
  );
}

export default TranscriptionDialog;
