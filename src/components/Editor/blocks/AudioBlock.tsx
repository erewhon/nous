/**
 * Custom audio block — replaces AudioTool.ts.
 * Handles audio playback and transcription.
 */
import { createReactBlockSpec } from "@blocknote/react";

export const AudioBlock = createReactBlockSpec(
  {
    type: "audio",
    propSchema: {
      filename: { default: "" },
      url: { default: "" },
      caption: { default: "" },
      transcription: { default: "" },
      transcriptionStatus: {
        default: "idle" as const,
        values: ["idle", "transcribing", "done", "error"] as const,
      },
      showTranscript: { default: false },
      recordedAt: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => {
      const { filename, url, caption, transcription, showTranscript } =
        props.block.props;

      if (!url) {
        return (
          <div className="bn-audio bn-audio-empty" contentEditable={false}>
            <div className="bn-audio-upload">
              <span>🎤 Drop an audio file or click to record</span>
            </div>
          </div>
        );
      }

      return (
        <div className="bn-audio" contentEditable={false}>
          <div className="bn-audio-header">
            <span>🎤 {filename || "Audio"}</span>
          </div>
          <audio src={url} controls style={{ width: "100%" }} />
          {caption && <div className="bn-audio-caption">{caption}</div>}
          {showTranscript && transcription && (
            <div className="bn-audio-transcript">
              <pre>{transcription}</pre>
            </div>
          )}
        </div>
      );
    },
  },
);
