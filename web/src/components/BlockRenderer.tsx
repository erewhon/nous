/**
 * Renders Editor.js-style blocks as read-only HTML.
 * Handles: paragraph, header, list, checklist, code, quote, delimiter,
 * callout, table, image, embed, columns.
 */

import type { ReactNode } from "react";

interface Block {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

interface ListItem {
  content: string;
  items?: ListItem[];
}

function RichText({ html }: { html: string }) {
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function renderListItems(
  items: ListItem[],
  style: "ordered" | "unordered",
): ReactNode {
  const children = items.map((item, i) => (
    <li key={i}>
      <RichText html={item.content} />
      {item.items && item.items.length > 0 && renderListItems(item.items, style)}
    </li>
  ));
  return style === "ordered" ? <ol>{children}</ol> : <ul>{children}</ul>;
}

function ChecklistBlock({
  items,
}: {
  items: Array<{ text: string; checked: boolean }>;
}) {
  return (
    <div>
      {items.map((item, i) => (
        <div
          key={i}
          className={`checklist-item ${item.checked ? "checked" : ""}`}
        >
          <input type="checkbox" checked={item.checked} readOnly />
          <span className="checklist-text">
            <RichText html={item.text} />
          </span>
        </div>
      ))}
    </div>
  );
}

function TableBlock({
  content,
  withHeadings,
}: {
  content: string[][];
  withHeadings?: boolean;
}) {
  if (!content || content.length === 0) return null;
  const [first, ...rest] = content;
  return (
    <table>
      {withHeadings && (
        <thead>
          <tr>
            {first.map((cell, i) => (
              <th key={i}>
                <RichText html={cell} />
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {(withHeadings ? rest : content).map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>
                <RichText html={cell} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ColumnsBlock({ cols }: { cols: Array<{ blocks: Block[] }> }) {
  return (
    <div style={{ display: "flex", gap: 16 }}>
      {cols.map((col, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0 }}>
          <BlockList blocks={col.blocks} />
        </div>
      ))}
    </div>
  );
}

function SingleBlock({ block }: { block: Block }) {
  const { type, data } = block;

  switch (type) {
    case "paragraph":
      return (
        <p>
          <RichText html={(data.text as string) || ""} />
        </p>
      );

    case "header": {
      const level = (data.level as number) || 2;
      const text = <RichText html={(data.text as string) || ""} />;
      if (level === 1) return <h1>{text}</h1>;
      if (level === 2) return <h2>{text}</h2>;
      if (level === 3) return <h3>{text}</h3>;
      return <h4>{text}</h4>;
    }

    case "list": {
      const style =
        (data.style as string) === "ordered" ? "ordered" : "unordered";
      const items = (data.items as ListItem[]) || [];
      return renderListItems(items, style);
    }

    case "checklist": {
      const items =
        (data.items as Array<{ text: string; checked: boolean }>) || [];
      return <ChecklistBlock items={items} />;
    }

    case "code":
      return (
        <pre>
          <code>{(data.code as string) || ""}</code>
        </pre>
      );

    case "quote":
      return (
        <blockquote>
          <RichText html={(data.text as string) || ""} />
          {data.caption ? (
            <cite
              style={{ display: "block", marginTop: 8, fontSize: 13 }}
            >
              <RichText html={data.caption as string} />
            </cite>
          ) : null}
        </blockquote>
      );

    case "delimiter":
      return <div className="delimiter">***</div>;

    case "callout":
      return (
        <div className="callout">
          {data.icon ? (
            <span className="callout-icon">{String(data.icon)}</span>
          ) : null}
          <div>
            <RichText html={(data.text as string) || ""} />
          </div>
        </div>
      );

    case "table":
      return (
        <TableBlock
          content={(data.content as string[][]) || []}
          withHeadings={data.withHeadings as boolean}
        />
      );

    case "image": {
      const url = (data.url as string) || (data.file as { url?: string })?.url;
      if (!url) return <div className="embed-block">Image</div>;
      return (
        <div className="image-block">
          <img src={url} alt={(data.caption as string) || ""} />
          {data.caption ? (
            <div className="caption">{String(data.caption)}</div>
          ) : null}
        </div>
      );
    }

    case "columns": {
      const cols = (data.cols as Array<{ blocks: Block[] }>) || [];
      if (cols.length === 0) return null;
      return <ColumnsBlock cols={cols} />;
    }

    case "embed": {
      if (data.pageId) {
        return (
          <div className="embed-block">
            Embedded page: {(data.pageTitle as string) || (data.pageId as string)}
          </div>
        );
      }
      if (data.url) {
        return (
          <div className="embed-block">
            Embed:{" "}
            <a href={data.url as string} target="_blank" rel="noopener">
              {data.url as string}
            </a>
          </div>
        );
      }
      return <div className="embed-block">Embed</div>;
    }

    case "flashcard":
      return (
        <div className="callout" style={{ flexDirection: "column" }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>
            <RichText html={(data.front as string) || "Question"} />
          </div>
          <div style={{ color: "var(--text-muted)" }}>
            <RichText html={(data.back as string) || "Answer"} />
          </div>
        </div>
      );

    case "database":
    case "liveQuery":
      return (
        <div className="embed-block">
          {type === "database" ? "Database" : "Live Query"} (view in app)
        </div>
      );

    case "drawing":
      return <div className="embed-block">Drawing (view in app)</div>;

    case "video":
      return <div className="embed-block">Video (view in app)</div>;

    case "audio":
      return <div className="embed-block">Audio (view in app)</div>;

    case "pdf":
      return <div className="embed-block">PDF (view in app)</div>;

    default:
      return null;
  }
}

export function BlockList({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block) => (
        <div key={block.id} className="block">
          <SingleBlock block={block} />
        </div>
      ))}
    </>
  );
}

export function PageContent({ content }: { content: unknown }) {
  const data = content as { blocks?: Block[] } | null;
  if (!data?.blocks || data.blocks.length === 0) {
    return (
      <div className="empty-state">
        <p>This page is empty.</p>
      </div>
    );
  }

  return <BlockList blocks={data.blocks} />;
}
