/**
 * Custom video block — replaces VideoTool.ts.
 * Handles video playback, transcription, and metadata.
 */
import { createReactBlockSpec } from "@blocknote/react";
import { useCallback } from "react";

export const VideoBlock = createReactBlockSpec(
  {
    type: "video",
    propSchema: {
      filename: { default: "" },
      url: { default: "" },
      caption: { default: "" },
      currentTime: { default: 0 },
      displayMode: {
        default: "standard" as const,
        values: ["compact", "standard", "large"] as const,
      },
      transcription: { default: "" },
      transcriptionStatus: {
        default: "idle" as const,
        values: ["idle", "transcribing", "done", "error"] as const,
      },
      showTranscript: { default: false },
    },
    content: "none",
  },
  {
    render: (props) => {
      const { filename, url, caption, displayMode, transcription, showTranscript } =
        props.block.props;

      const updateProps = useCallback(
        (update: Record<string, unknown>) => {
          props.editor.updateBlock(props.block, { props: update });
        },
        [props.editor, props.block],
      );

      if (!url) {
        return (
          <div className="bn-video bn-video-empty" contentEditable={false}>
            <div className="bn-video-upload">
              <span>🎬 Drop a video here or click to upload</span>
            </div>
          </div>
        );
      }

      const heightMap = { compact: 200, standard: 400, large: 600 } as const;
      const maxHeight = heightMap[displayMode as keyof typeof heightMap] ?? 400;

      return (
        <div className={`bn-video bn-video-${displayMode}`} contentEditable={false}>
          <div className="bn-video-header">
            <span>{filename || "Video"}</span>
          </div>
          <video
            src={url}
            controls
            style={{ width: "100%", maxHeight }}
            onTimeUpdate={(e) => {
              // Debounce: only persist every 5s
              const t = Math.floor(e.currentTarget.currentTime);
              if (t % 5 === 0) updateProps({ currentTime: t });
            }}
          />
          {caption && <div className="bn-video-caption">{caption}</div>}
          {showTranscript && transcription && (
            <div className="bn-video-transcript">
              <pre>{transcription}</pre>
            </div>
          )}
        </div>
      );
    },
  },
);
