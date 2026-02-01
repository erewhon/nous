import { Fragment } from "react";

/**
 * Highlights matching terms in text by wrapping them in <mark> elements
 */
export function highlightText(
  text: string,
  query: string,
  highlightStyle?: React.CSSProperties
): React.ReactNode {
  if (!query.trim() || !text) {
    return text;
  }

  // Escape special regex characters
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Split query into words for multi-word highlighting
  const words = escapedQuery.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) {
    return text;
  }

  // Create regex pattern matching any of the words
  const pattern = new RegExp(`(${words.join("|")})`, "gi");

  const parts = text.split(pattern);

  const defaultStyle: React.CSSProperties = {
    backgroundColor: "rgba(139, 92, 246, 0.3)",
    color: "inherit",
    borderRadius: "2px",
    padding: "0 2px",
  };

  const style = highlightStyle || defaultStyle;

  return (
    <>
      {parts.map((part, i) => {
        const isMatch = words.some(
          (w) => part.toLowerCase() === w.toLowerCase()
        );
        if (isMatch) {
          return (
            <mark key={i} style={style}>
              {part}
            </mark>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}
