/**
 * Custom page/URL embed block — replaces EmbedTool.ts.
 * Handles both internal page embeds and external URL embeds.
 */
import { createReactBlockSpec } from "@blocknote/react";

export const EmbedBlock = createReactBlockSpec(
  {
    type: "embed",
    propSchema: {
      embedType: {
        default: "page" as const,
        values: ["page", "url"] as const,
      },
      pageTitle: { default: "" },
      pageId: { default: "" },
      url: { default: "" },
      isCollapsed: { default: false },
      caption: { default: "" },
      displayMode: {
        default: "embed" as const,
        values: ["embed", "link"] as const,
      },
    },
    content: "none",
  },
  {
    render: (props) => {
      const { embedType, pageTitle, pageId, url, isCollapsed, caption, displayMode } =
        props.block.props;

      const toggleCollapse = () => {
        props.editor.updateBlock(props.block, {
          props: { isCollapsed: !isCollapsed },
        });
      };

      if (displayMode === "link") {
        return (
          <div className="bn-embed bn-embed-link" contentEditable={false}>
            <span className="bn-embed-link-icon">
              {embedType === "page" ? "📄" : "🔗"}
            </span>
            <span className="bn-embed-link-title">
              {embedType === "page" ? pageTitle || "Untitled page" : url || "No URL"}
            </span>
          </div>
        );
      }

      return (
        <div className="bn-embed" contentEditable={false}>
          <div className="bn-embed-header">
            <button onClick={toggleCollapse} className="bn-embed-collapse">
              {isCollapsed ? "▶" : "▼"}
            </button>
            <span className="bn-embed-title">
              {embedType === "page"
                ? pageTitle || "Untitled page"
                : url || "No URL set"}
            </span>
          </div>
          {!isCollapsed && (
            <div className="bn-embed-content">
              {embedType === "page" && pageId ? (
                <div className="bn-embed-page-content">
                  Embedded page: {pageTitle}
                </div>
              ) : embedType === "url" && url ? (
                isYouTubeUrl(url) ? (
                  <iframe
                    src={toYouTubeEmbed(url)}
                    className="bn-embed-youtube"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <div className="bn-embed-url-preview">
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      {url}
                    </a>
                  </div>
                )
              ) : (
                <div className="bn-embed-empty">No content configured</div>
              )}
            </div>
          )}
          {caption && <div className="bn-embed-caption">{caption}</div>}
        </div>
      );
    },
  },
);

function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/embed)/.test(url);
}

function toYouTubeEmbed(url: string): string {
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/,
  );
  return match ? `https://www.youtube.com/embed/${match[1]}` : url;
}
