import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { usePageStore } from "../../stores/pageStore";
import { useLinkStore } from "../../stores/linkStore";
import type { EditorBlock } from "../../types/page";

interface BlockEmbedProps {
  targetBlockId?: string;
  targetPageId?: string;
  notebookId: string;
  embeddingPageId?: string;
  readOnly: boolean;
  onBlockSelect: (blockId: string, pageId: string) => void;
  onNavigate: (pageId: string) => void;
}

/** Strip HTML tags to get plain text */
function stripHtml(html: string): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

interface BlockResult {
  blockId: string;
  pageId: string;
  pageTitle: string;
  blockText: string;
  blockType: string;
}

/** Block picker shown when no target is selected */
function BlockPicker({
  notebookId,
  onSelect,
}: {
  notebookId: string;
  onSelect: (blockId: string, pageId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results: BlockResult[] = useMemo(() => {
    if (query.length < 2) return [];
    const pages = usePageStore.getState().pages;
    const matches: BlockResult[] = [];
    const lowerQuery = query.toLowerCase();

    for (const page of pages) {
      if (page.notebookId !== notebookId) continue;
      if (!page.content?.blocks) continue;

      for (const block of page.content.blocks) {
        if (matches.length >= 20) break;

        let text = "";
        if (
          (block.type === "paragraph" || block.type === "header") &&
          typeof block.data.text === "string"
        ) {
          text = stripHtml(block.data.text);
        } else if (block.type === "list" && Array.isArray(block.data.items)) {
          text = (block.data.items as unknown[])
            .map((item) => (typeof item === "string" ? stripHtml(item) : ""))
            .join(" ");
        } else if (block.type === "code" && typeof block.data.code === "string") {
          text = block.data.code;
        }

        if (text && text.toLowerCase().includes(lowerQuery)) {
          matches.push({
            blockId: block.id,
            pageId: page.id,
            pageTitle: page.title,
            blockText: text.length > 120 ? text.slice(0, 120) + "..." : text,
            blockType: block.type,
          });
        }
      }
      if (matches.length >= 20) break;
    }
    return matches;
  }, [query, notebookId]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (results[selectedIndex]) {
            onSelect(results[selectedIndex].blockId, results[selectedIndex].pageId);
          }
          break;
      }
    },
    [results, selectedIndex, onSelect]
  );

  return (
    <div className="block-embed-picker">
      <div className="block-embed-picker__header">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search blocks to embed..."
          className="block-embed-picker__input"
        />
      </div>
      {results.length > 0 && (
        <div className="block-embed-picker__results">
          {results.map((r, i) => (
            <div
              key={`${r.pageId}-${r.blockId}`}
              className={`block-embed-picker__item ${i === selectedIndex ? "block-embed-picker__item--selected" : ""}`}
              onClick={() => onSelect(r.blockId, r.pageId)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="block-embed-picker__text">{r.blockText}</span>
              <span className="block-embed-picker__meta">
                <span className="block-embed-picker__type">{r.blockType}</span>
                <span className="block-embed-picker__page">{r.pageTitle}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {query.length >= 2 && results.length === 0 && (
        <div className="block-embed-picker__empty">No blocks found</div>
      )}
    </div>
  );
}

/** Render block HTML for non-editable types */
function renderBlockHtml(block: EditorBlock): string {
  const data = block.data;
  switch (block.type) {
    case "paragraph":
      return typeof data.text === "string" ? data.text : "";
    case "header": {
      const level = (data.level as number) || 2;
      const text = typeof data.text === "string" ? data.text : "";
      return `<h${level}>${text}</h${level}>`;
    }
    case "list": {
      const items = Array.isArray(data.items) ? data.items : [];
      const tag = data.style === "ordered" ? "ol" : "ul";
      const lis = items.map((item: unknown) => `<li>${typeof item === "string" ? item : ""}</li>`).join("");
      return `<${tag}>${lis}</${tag}>`;
    }
    case "code":
      return `<pre><code>${typeof data.code === "string" ? data.code : ""}</code></pre>`;
    case "quote":
      return `<blockquote>${typeof data.text === "string" ? data.text : ""}</blockquote>`;
    default:
      return `<div style="opacity:0.5;font-style:italic">[${block.type} block]</div>`;
  }
}

export function BlockEmbed({
  targetBlockId,
  targetPageId,
  notebookId,
  embeddingPageId,
  readOnly,
  onBlockSelect,
  onNavigate,
}: BlockEmbedProps) {
  const pages = usePageStore((s) => s.pages);
  const updatePageContent = usePageStore((s) => s.updatePageContent);
  const setPageContentLocal = usePageStore((s) => s.setPageContentLocal);

  const registerBlockEmbed = useLinkStore((s) => s.registerBlockEmbed);
  const unregisterBlockEmbed = useLinkStore((s) => s.unregisterBlockEmbed);
  const isBlockSynced = useLinkStore((s) => s.isBlockSynced);
  const getBlockEmbedPages = useLinkStore((s) => s.getBlockEmbedPages);

  // Register/unregister this embed for transclusion tracking
  useEffect(() => {
    if (targetBlockId && embeddingPageId) {
      registerBlockEmbed(targetBlockId, embeddingPageId);
      return () => {
        unregisterBlockEmbed(targetBlockId, embeddingPageId);
      };
    }
  }, [targetBlockId, embeddingPageId, registerBlockEmbed, unregisterBlockEmbed]);

  const embedCount = targetBlockId ? getBlockEmbedPages(targetBlockId).length : 0;
  const isSynced = targetBlockId ? isBlockSynced(targetBlockId) : false;

  // Track local editable text to avoid clobbering during live sync
  const editingRef = useRef(false);
  const lastKnownTextRef = useRef<string>("");
  const contentEditableRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // No target selected — show picker
  if (!targetBlockId || !targetPageId) {
    return <BlockPicker notebookId={notebookId} onSelect={onBlockSelect} />;
  }

  // Find target page and block
  const sourcePage = pages.find((p) => p.id === targetPageId);
  const targetBlock = sourcePage?.content?.blocks?.find(
    (b) => b.id === targetBlockId
  );

  const isEditable =
    !readOnly &&
    targetBlock &&
    (targetBlock.type === "paragraph" || targetBlock.type === "header");

  // Get current text content from target block
  const blockText = targetBlock
    ? typeof targetBlock.data.text === "string"
      ? targetBlock.data.text
      : ""
    : "";

  // Live sync: update contentEditable when source changes (but not while editing)
  useEffect(() => {
    if (!contentEditableRef.current || editingRef.current) return;
    if (blockText !== lastKnownTextRef.current) {
      contentEditableRef.current.innerHTML = blockText;
      lastKnownTextRef.current = blockText;
    }
  }, [blockText]);

  // Initialize contentEditable on mount
  useEffect(() => {
    if (contentEditableRef.current && blockText) {
      contentEditableRef.current.innerHTML = blockText;
      lastKnownTextRef.current = blockText;
    }
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetBlockId]);

  // Save edited content back to source page
  const saveEdit = useCallback(
    (newHtml: string) => {
      if (!sourcePage || !targetBlock) return;
      const updatedBlocks = sourcePage.content.blocks.map((b) =>
        b.id === targetBlockId ? { ...b, data: { ...b.data, text: newHtml } } : b
      );
      const updatedContent = { ...sourcePage.content, blocks: updatedBlocks };
      setPageContentLocal(sourcePage.id, updatedContent);
      updatePageContent(sourcePage.notebookId, sourcePage.id, updatedContent, false);
      lastKnownTextRef.current = newHtml;
    },
    [sourcePage, targetBlock, targetBlockId, setPageContentLocal, updatePageContent]
  );

  const handleInput = useCallback(() => {
    editingRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (contentEditableRef.current) {
        saveEdit(contentEditableRef.current.innerHTML);
      }
      editingRef.current = false;
    }, 500);
  }, [saveEdit]);

  const handleBlur = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (contentEditableRef.current) {
      saveEdit(contentEditableRef.current.innerHTML);
    }
    editingRef.current = false;
  }, [saveEdit]);

  // Cleanup debounce
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Broken state
  if (!sourcePage || !targetBlock) {
    return (
      <div className="block-embed-container block-embed-broken">
        <div className="block-embed-header">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>Embedded block not found</span>
        </div>
        <div className="block-embed-content" style={{ opacity: 0.5, fontStyle: "italic" }}>
          The source block or page may have been deleted.
        </div>
      </div>
    );
  }

  return (
    <div className="block-embed-container">
      <div className="block-embed-header">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
          <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </svg>
        <span
          className="block-embed-header__page"
          onClick={() => onNavigate(targetPageId)}
          title="Go to source page"
        >
          {sourcePage.title || "Untitled"}
        </span>
        <span className="block-embed-header__label">Synced</span>
        {isSynced && embedCount > 1 && (
          <span className="block-embed-synced-badge" title={`Embedded in ${embedCount} pages`}>
            {embedCount}
          </span>
        )}
      </div>
      <div className="block-embed-content">
        {isEditable ? (
          <div
            ref={contentEditableRef}
            contentEditable
            suppressContentEditableWarning
            className="block-embed-editable"
            onInput={handleInput}
            onBlur={handleBlur}
          />
        ) : (
          <div
            className="block-embed-readonly"
            dangerouslySetInnerHTML={{ __html: renderBlockHtml(targetBlock) }}
          />
        )}
      </div>
    </div>
  );
}
