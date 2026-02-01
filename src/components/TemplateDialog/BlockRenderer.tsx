import type { EditorBlock } from "../../types/page";

interface BlockRendererProps {
  blocks: EditorBlock[];
}

export function BlockRenderer({ blocks }: BlockRendererProps) {
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
