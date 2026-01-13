import { useMemo } from "react";
import type { TagInfo } from "../../stores/tagStore";

interface TagCloudProps {
  tags: TagInfo[];
  onTagClick?: (tagName: string) => void;
  selectedTags?: string[];
  maxTags?: number;
}

export function TagCloud({
  tags,
  onTagClick,
  selectedTags = [],
  maxTags = 50,
}: TagCloudProps) {
  // Calculate font sizes based on frequency
  const tagStyles = useMemo(() => {
    if (tags.length === 0) return [];

    const displayTags = tags.slice(0, maxTags);
    const counts = displayTags.map((t) => t.count);
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);
    const range = maxCount - minCount || 1;

    // Font sizes from 0.75rem to 1.5rem
    const minSize = 0.75;
    const maxSize = 1.5;

    return displayTags.map((tag) => {
      const normalized = (tag.count - minCount) / range;
      const fontSize = minSize + normalized * (maxSize - minSize);
      const opacity = 0.6 + normalized * 0.4; // 0.6 to 1.0

      return {
        ...tag,
        fontSize: `${fontSize}rem`,
        opacity,
      };
    });
  }, [tags, maxTags]);

  if (tags.length === 0) {
    return (
      <div
        className="py-8 text-center text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        No tags yet. Add tags to your pages to see them here.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 p-4">
      {tagStyles.map((tag) => {
        const isSelected = selectedTags
          .map((t) => t.toLowerCase())
          .includes(tag.name.toLowerCase());

        return (
          <button
            key={tag.name}
            onClick={() => onTagClick?.(tag.name)}
            className="rounded-full px-3 py-1 transition-all hover:scale-105"
            style={{
              fontSize: tag.fontSize,
              opacity: isSelected ? 1 : tag.opacity,
              backgroundColor: isSelected
                ? "rgba(139, 92, 246, 0.3)"
                : "rgba(139, 92, 246, 0.1)",
              color: "var(--color-accent)",
              border: isSelected
                ? "1px solid var(--color-accent)"
                : "1px solid transparent",
            }}
            title={`${tag.count} page${tag.count === 1 ? "" : "s"}`}
          >
            {tag.name}
          </button>
        );
      })}
    </div>
  );
}
