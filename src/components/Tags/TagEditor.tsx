import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { Page } from "../../types/page";
import { usePageStore } from "../../stores/pageStore";
import { useAIStore } from "../../stores/aiStore";
import { useTagStore } from "../../stores/tagStore";
import { aiSuggestTags } from "../../utils/api";

interface TagEditorProps {
  page: Page;
  onTagsChange?: (tags: string[]) => void;
}

// Helper to extract plain text from Editor.js content
function extractPlainText(content?: Page["content"]): string {
  if (!content?.blocks) return "";
  return content.blocks
    .map((block) => {
      if (block.type === "paragraph" || block.type === "header") {
        return (block.data as { text?: string }).text || "";
      }
      if (block.type === "list" || block.type === "checklist") {
        const items = (block.data as { items?: unknown[] }).items || [];
        return items
          .map((item) => {
            if (typeof item === "string") return item;
            if (typeof item === "object" && item !== null) {
              return (item as { text?: string }).text || "";
            }
            return "";
          })
          .join(" ");
      }
      return "";
    })
    .join(" ")
    .replace(/<[^>]*>/g, "")
    .trim();
}

export function TagEditor({ page, onTagsChange }: TagEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { updatePage } = usePageStore();
  const { getActiveProviderType, getActiveApiKey, getActiveModel } = useAIStore();
  const allStoreTags = useTagStore((s) => s.getTagsByFrequency);

  // Get active API key for UI checks
  const activeApiKey = getActiveApiKey();

  const tags = page.tags || [];

  // Autocomplete matches from existing tags
  const autocompleteMatches = useMemo(() => {
    if (!inputValue.trim()) return [];
    const query = inputValue.toLowerCase().trim();
    const existingLower = tags.map((t) => t.toLowerCase());
    return allStoreTags()
      .filter(
        (t) =>
          t.name.toLowerCase().startsWith(query) &&
          !existingLower.includes(t.name.toLowerCase())
      )
      .slice(0, 6);
  }, [inputValue, tags, allStoreTags]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsEditing(false);
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleAddTag = useCallback(
    async (tag: string) => {
      const trimmed = tag.trim();
      if (!trimmed) return;

      // Check for duplicates (case-insensitive)
      const exists = tags.some((t) => t.toLowerCase() === trimmed.toLowerCase());
      if (exists) {
        setInputValue("");
        return;
      }

      const newTags = [...tags, trimmed];
      await updatePage(page.notebookId, page.id, { tags: newTags });
      onTagsChange?.(newTags);
      setInputValue("");
    },
    [tags, page.notebookId, page.id, updatePage, onTagsChange]
  );

  const handleRemoveTag = useCallback(
    async (tagToRemove: string) => {
      const newTags = tags.filter((t) => t !== tagToRemove);
      await updatePage(page.notebookId, page.id, { tags: newTags });
      onTagsChange?.(newTags);
    },
    [tags, page.notebookId, page.id, updatePage, onTagsChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      handleAddTag(inputValue);
    } else if (e.key === "Escape") {
      setIsEditing(false);
      setShowSuggestions(false);
    } else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
      // Remove last tag when backspace on empty input
      handleRemoveTag(tags[tags.length - 1]);
    }
  };

  const fetchAISuggestions = useCallback(async () => {
    const apiKey = getActiveApiKey();
    if (!apiKey) {
      setSuggestions([]);
      return;
    }

    setIsLoadingSuggestions(true);
    try {
      const content = `${page.title}\n\n${extractPlainText(page.content)}`;
      const suggested = await aiSuggestTags(content, {
        existingTags: tags,
        providerType: getActiveProviderType(),
        apiKey: apiKey,
        model: getActiveModel() || undefined,
      });

      // Filter out tags that already exist
      const filtered = suggested.filter(
        (s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase())
      );
      setSuggestions(filtered);
    } catch (err) {
      console.error("Failed to get AI tag suggestions:", err);
      setSuggestions([]);
    } finally {
      setIsLoadingSuggestions(false);
    }
  }, [page.title, page.content, tags, getActiveProviderType, getActiveApiKey, getActiveModel]);

  const handleShowSuggestions = () => {
    setShowSuggestions(true);
    if (suggestions.length === 0 && activeApiKey) {
      fetchAISuggestions();
    }
  };

  return (
    <div ref={containerRef} className="flex flex-wrap items-center gap-2">
      {/* Existing tags */}
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs"
          style={{
            backgroundColor: "rgba(139, 92, 246, 0.15)",
            color: "var(--color-accent)",
          }}
        >
          {tag}
          <button
            onClick={() => handleRemoveTag(tag)}
            className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-white/20"
            title="Remove tag"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}

      {/* Add tag input */}
      {isEditing ? (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add tag..."
            className="h-6 w-24 rounded border bg-transparent px-2 text-xs outline-none focus:border-violet-500"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
          {autocompleteMatches.length > 0 && inputValue.trim() && (
            <div
              className="absolute left-0 top-full z-50 mt-1 min-w-36 rounded-lg border shadow-lg"
              style={{
                backgroundColor: "var(--color-bg-secondary)",
                borderColor: "var(--color-border)",
              }}
            >
              {autocompleteMatches.map((match) => (
                <button
                  key={match.name}
                  onClick={() => {
                    handleAddTag(match.name);
                  }}
                  className="flex w-full items-center justify-between px-2 py-1 text-xs transition-colors hover:bg-white/10"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  <span>{match.name}</span>
                  <span
                    className="ml-2"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {match.count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={() => setIsEditing(true)}
          className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed px-2 text-xs transition-colors hover:border-violet-400"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add tag
        </button>
      )}

      {/* AI Suggestions button */}
      <button
        onClick={handleShowSuggestions}
        className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs transition-colors hover:bg-white/10"
        style={{ color: "var(--color-text-muted)" }}
        title="Get AI tag suggestions"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2a4 4 0 0 1 4 4c0 1.1-.5 2-1 3l6 6-3 3-6-6c-1 .5-1.9 1-3 1a4 4 0 1 1 0-8" />
          <circle cx="8" cy="8" r="2" />
        </svg>
        {isLoadingSuggestions ? "..." : "AI Suggest"}
      </button>

      {/* Suggestions dropdown */}
      {showSuggestions && (
        <div
          className="absolute left-0 top-full z-50 mt-2 min-w-48 rounded-lg border p-2 shadow-lg"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          <div
            className="mb-2 flex items-center justify-between text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            <span>AI Suggestions</span>
            <button
              onClick={() => setShowSuggestions(false)}
              className="rounded p-0.5 hover:bg-white/10"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {isLoadingSuggestions ? (
            <div
              className="py-4 text-center text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              Analyzing content...
            </div>
          ) : suggestions.length === 0 ? (
            <div
              className="py-4 text-center text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              {activeApiKey
                ? "No suggestions available"
                : "Configure AI in Settings"}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    handleAddTag(suggestion);
                    setSuggestions((prev) => prev.filter((s) => s !== suggestion));
                  }}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors hover:bg-violet-500/20"
                  style={{
                    backgroundColor: "rgba(139, 92, 246, 0.1)",
                    color: "var(--color-accent)",
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={fetchAISuggestions}
            disabled={isLoadingSuggestions || !activeApiKey}
            className="mt-2 w-full rounded py-1 text-xs transition-colors hover:bg-white/10 disabled:opacity-50"
            style={{ color: "var(--color-text-muted)" }}
          >
            Refresh suggestions
          </button>
        </div>
      )}
    </div>
  );
}
