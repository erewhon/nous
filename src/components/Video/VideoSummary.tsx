import ReactMarkdown from "react-markdown";

interface VideoSummaryProps {
  summary?: string;
  synopsis?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function VideoSummary({
  summary,
  synopsis,
  collapsed = false,
  onToggleCollapse,
}: VideoSummaryProps) {
  if (!summary && !synopsis) {
    return null;
  }

  return (
    <div className="video-summary">
      <div className={`video-summary-header ${collapsed ? "collapsed" : ""}`} onClick={onToggleCollapse}>
        <span className={`video-summary-chevron ${collapsed ? "" : "expanded"}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 6 15 12 9 18" />
          </svg>
        </span>
        <span className="video-summary-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </span>
        <span className="video-summary-title">AI Summary</span>
        {collapsed && summary && (
          <span className="video-summary-preview">
            {summary.length > 60 ? summary.substring(0, 60) + "..." : summary}
          </span>
        )}
      </div>

      {!collapsed && (
        <div className="video-summary-content">
          {summary && (
            <div className="video-summary-section">
              <div className="video-summary-label">Summary</div>
              <div className="video-summary-text">
                <ReactMarkdown>{summary}</ReactMarkdown>
              </div>
            </div>
          )}

          {synopsis && (
            <div className="video-summary-section">
              <div className="video-summary-label">Synopsis</div>
              <div className="video-summary-text">
                <ReactMarkdown>{synopsis}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        .video-summary {
          margin-top: 12px;
          border: 1px solid var(--color-border);
          border-radius: 6px;
          background: var(--color-bg-secondary);
          overflow: hidden;
        }

        .video-summary-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 14px;
          background: var(--color-bg-tertiary);
          cursor: pointer;
          user-select: none;
          min-height: 44px;
          border-left: 3px solid var(--color-primary);
        }

        .video-summary-header:hover {
          background: var(--color-bg-hover);
        }

        .video-summary-header.collapsed {
          background: var(--color-bg-secondary);
        }

        .video-summary-header.collapsed:hover {
          background: var(--color-bg-tertiary);
        }

        .video-summary-icon {
          display: flex;
          align-items: center;
          color: var(--color-primary);
          flex-shrink: 0;
        }

        .video-summary-title {
          font-size: var(--ui-font-size-sm);
          font-weight: 600;
          color: var(--color-text);
          flex-shrink: 0;
        }

        .video-summary-preview {
          flex: 1;
          font-size: var(--ui-font-size-xs);
          color: var(--color-text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          margin-left: 8px;
          font-style: italic;
        }

        .video-summary-chevron {
          display: flex;
          align-items: center;
          color: var(--color-text-muted);
          transition: transform 0.2s;
          flex-shrink: 0;
        }

        .video-summary-chevron.expanded {
          transform: rotate(90deg);
        }

        .video-summary-content {
          padding: 12px;
        }

        .video-summary-section {
          margin-bottom: 12px;
        }

        .video-summary-section:last-child {
          margin-bottom: 0;
        }

        .video-summary-label {
          font-size: var(--ui-font-size-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--color-text-muted);
          margin-bottom: 6px;
        }

        .video-summary-text {
          font-size: var(--ui-font-size-sm);
          line-height: 1.6;
          color: var(--color-text);
        }

        .video-summary-text p {
          margin: 0 0 8px 0;
        }

        .video-summary-text p:last-child {
          margin-bottom: 0;
        }

        .video-summary-text ul,
        .video-summary-text ol {
          margin: 0 0 8px 0;
          padding-left: 20px;
        }

        .video-summary-text li {
          margin-bottom: 4px;
        }

        .video-summary-text code {
          background: var(--color-bg-tertiary);
          padding: 2px 4px;
          border-radius: 3px;
          font-size: var(--ui-font-size-sm);
        }

        .video-summary-text pre {
          background: var(--color-bg-tertiary);
          padding: 8px;
          border-radius: 4px;
          overflow-x: auto;
          margin: 8px 0;
        }

        .video-summary-text pre code {
          background: none;
          padding: 0;
        }

        .video-summary-text strong {
          font-weight: 600;
        }

        .video-summary-text em {
          font-style: italic;
        }

        .video-summary-text blockquote {
          margin: 8px 0;
          padding-left: 12px;
          border-left: 3px solid var(--color-border);
          color: var(--color-text-secondary);
        }
      `}</style>
    </div>
  );
}

export default VideoSummary;
