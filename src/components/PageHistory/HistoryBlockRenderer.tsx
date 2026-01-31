import type { EditorBlock } from "../../types/page";

interface HistoryBlockRendererProps {
  blocks: EditorBlock[];
}

export function HistoryBlockRenderer({ blocks }: HistoryBlockRendererProps) {
  return (
    <div className="space-y-3">
      {blocks.map((block) => (
        <BlockView key={block.id} block={block} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: EditorBlock }) {
  switch (block.type) {
    case "header":
      return <HeaderBlock data={block.data} />;
    case "paragraph":
      return <ParagraphBlock data={block.data} />;
    case "checklist":
      return <ChecklistBlock data={block.data} />;
    case "list":
      return <ListBlock data={block.data} />;
    case "quote":
      return <QuoteBlock data={block.data} />;
    case "code":
      return <CodeBlock data={block.data} />;
    case "table":
      return <TableBlock data={block.data} />;
    case "delimiter":
      return <DelimiterBlock />;
    case "image":
      return <ImageBlock data={block.data} />;
    case "embed":
      return <EmbedBlock data={block.data} />;
    case "callout":
      return <CalloutBlock data={block.data} />;
    default:
      return (
        <p
          className="rounded px-2 py-1 text-xs italic"
          style={{
            color: "var(--color-text-muted)",
            backgroundColor: "var(--color-bg-tertiary)",
          }}
        >
          [{block.type} block]
        </p>
      );
  }
}

function HeaderBlock({ data }: { data: Record<string, unknown> }) {
  const text = (data.text as string) || "";
  const level = (data.level as number) || 2;

  const sizeClass =
    {
      1: "text-xl font-bold",
      2: "text-lg font-semibold",
      3: "text-base font-semibold",
      4: "text-sm font-semibold",
    }[level] || "text-base font-semibold";

  return (
    <div
      className={sizeClass}
      style={{ color: "var(--color-text-primary)" }}
      dangerouslySetInnerHTML={{ __html: text }}
    />
  );
}

function ParagraphBlock({ data }: { data: Record<string, unknown> }) {
  const text = (data.text as string) || "";
  if (!text) return null;

  return (
    <p
      className="text-sm leading-relaxed"
      style={{ color: "var(--color-text-secondary)" }}
      dangerouslySetInnerHTML={{ __html: text }}
    />
  );
}

function ChecklistBlock({ data }: { data: Record<string, unknown> }) {
  const items =
    (data.items as Array<{ text?: string; checked?: boolean }>) || [];

  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <label key={i} className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={item.checked || false}
            readOnly
            className="mt-0.5 rounded"
          />
          <span
            className="text-sm"
            style={{ color: "var(--color-text-secondary)" }}
            dangerouslySetInnerHTML={{ __html: item.text || "" }}
          />
        </label>
      ))}
    </div>
  );
}

function ListBlock({ data }: { data: Record<string, unknown> }) {
  const items = (data.items as Array<string | { content?: string }>) || [];
  const style = (data.style as string) || "unordered";
  const Tag = style === "ordered" ? "ol" : "ul";

  return (
    <Tag
      className={`space-y-1 pl-5 text-sm ${style === "ordered" ? "list-decimal" : "list-disc"}`}
      style={{ color: "var(--color-text-secondary)" }}
    >
      {items.map((item, i) => {
        const text = typeof item === "string" ? item : item.content || "";
        return <li key={i} dangerouslySetInnerHTML={{ __html: text }} />;
      })}
    </Tag>
  );
}

function QuoteBlock({ data }: { data: Record<string, unknown> }) {
  const text = (data.text as string) || "";

  return (
    <blockquote
      className="border-l-2 pl-3 text-sm italic"
      style={{
        borderColor: "var(--color-accent)",
        color: "var(--color-text-muted)",
      }}
      dangerouslySetInnerHTML={{ __html: text }}
    />
  );
}

function CodeBlock({ data }: { data: Record<string, unknown> }) {
  const code = (data.code as string) || "";
  const language = (data.language as string) || "";

  return (
    <div className="overflow-hidden rounded-lg">
      {language && (
        <div
          className="px-3 py-1 text-xs"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-text-muted)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          {language}
        </div>
      )}
      <pre
        className="overflow-x-auto p-3 font-mono text-xs leading-relaxed"
        style={{
          backgroundColor: "var(--color-bg-tertiary)",
          color: "var(--color-text-primary)",
        }}
      >
        {code}
      </pre>
    </div>
  );
}

function TableBlock({ data }: { data: Record<string, unknown> }) {
  const content = (data.content as string[][]) || [];
  const withHeadings = (data.withHeadings as boolean) || false;

  if (content.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table
        className="w-full border-collapse text-sm"
        style={{ borderColor: "var(--color-border)" }}
      >
        {withHeadings && content.length > 0 && (
          <thead>
            <tr>
              {content[0].map((cell, i) => (
                <th
                  key={i}
                  className="border px-3 py-1.5 text-left text-xs font-semibold"
                  style={{
                    borderColor: "var(--color-border)",
                    backgroundColor: "var(--color-bg-tertiary)",
                    color: "var(--color-text-primary)",
                  }}
                  dangerouslySetInnerHTML={{ __html: cell }}
                />
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {content.slice(withHeadings ? 1 : 0).map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  className="border px-3 py-1.5 text-xs"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-secondary)",
                  }}
                  dangerouslySetInnerHTML={{ __html: cell }}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DelimiterBlock() {
  return (
    <hr
      className="my-2"
      style={{ borderColor: "var(--color-border)" }}
    />
  );
}

function ImageBlock({ data }: { data: Record<string, unknown> }) {
  const caption = (data.caption as string) || "";

  return (
    <p
      className="rounded px-2 py-1 text-xs italic"
      style={{
        color: "var(--color-text-muted)",
        backgroundColor: "var(--color-bg-tertiary)",
      }}
    >
      [Image{caption ? `: ${caption}` : ""}]
    </p>
  );
}

function EmbedBlock({ data }: { data: Record<string, unknown> }) {
  const service = (data.service as string) || (data.source as string) || "";

  return (
    <p
      className="rounded px-2 py-1 text-xs italic"
      style={{
        color: "var(--color-text-muted)",
        backgroundColor: "var(--color-bg-tertiary)",
      }}
    >
      [Embedded{service ? `: ${service}` : ""}]
    </p>
  );
}

function CalloutBlock({ data }: { data: Record<string, unknown> }) {
  const title = (data.title as string) || "";
  const message = (data.message as string) || (data.text as string) || "";
  const type = (data.type as string) || "info";

  const colorMap: Record<string, string> = {
    info: "var(--color-accent)",
    warning: "#f59e0b",
    error: "#ef4444",
    success: "#22c55e",
  };
  const borderColor = colorMap[type] || "var(--color-accent)";

  return (
    <div
      className="rounded-r-lg border-l-3 px-3 py-2"
      style={{
        borderLeftColor: borderColor,
        backgroundColor: "var(--color-bg-tertiary)",
      }}
    >
      {title && (
        <div
          className="mb-1 text-sm font-semibold"
          style={{ color: "var(--color-text-primary)" }}
          dangerouslySetInnerHTML={{ __html: title }}
        />
      )}
      {message && (
        <div
          className="text-sm"
          style={{ color: "var(--color-text-secondary)" }}
          dangerouslySetInnerHTML={{ __html: message }}
        />
      )}
    </div>
  );
}
