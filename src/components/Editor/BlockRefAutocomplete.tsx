import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { usePageStore } from "../../stores/pageStore";

interface BlockRefAutocompleteProps {
  containerRef: React.RefObject<HTMLElement | null>;
  notebookId: string;
  onInsertRef: () => void;
}

interface BlockResult {
  blockId: string;
  pageId: string;
  pageTitle: string;
  blockText: string;
}

interface DropdownPosition {
  top: number;
  left: number;
}

/** Strip HTML tags from a string to get plain text */
function stripHtml(html: string): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

export function BlockRefAutocomplete({
  containerRef,
  notebookId,
  onInsertRef,
}: BlockRefAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<DropdownPosition>({ top: 0, left: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [triggerRange, setTriggerRange] = useState<Range | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Debounce the query for searching
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Search blocks across all pages in the current notebook
  const filteredBlocks: BlockResult[] = useMemo(() => {
    if (debouncedQuery.length < 2) return [];

    const pages = usePageStore.getState().pages;
    const results: BlockResult[] = [];
    const lowerQuery = debouncedQuery.toLowerCase();

    for (const page of pages) {
      if (page.notebookId !== notebookId) continue;
      if (!page.content?.blocks) continue;

      for (const block of page.content.blocks) {
        if (results.length >= 20) break;

        let text = "";
        if (
          (block.type === "paragraph" || block.type === "header") &&
          typeof block.data.text === "string"
        ) {
          text = stripHtml(block.data.text);
        } else if (block.type === "list" && Array.isArray(block.data.items)) {
          text = block.data.items
            .map((item: unknown) => (typeof item === "string" ? stripHtml(item) : ""))
            .join(" ");
        }

        if (text && text.toLowerCase().includes(lowerQuery)) {
          results.push({
            blockId: block.id,
            pageId: page.id,
            pageTitle: page.title,
            blockText: text.length > 120 ? text.slice(0, 120) + "..." : text,
          });
        }
      }
      if (results.length >= 20) break;
    }

    return results;
  }, [debouncedQuery, notebookId]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [debouncedQuery]);

  // Get caret coordinates for positioning dropdown
  const getCaretCoordinates = useCallback((): DropdownPosition | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    return {
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
    };
  }, []);

  // Find (( pattern in text before cursor
  const findTriggerPattern = useCallback((): { query: string; range: Range } | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    if (!range.collapsed) return null;

    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return null;

    const text = node.textContent || "";
    const cursorPos = range.startOffset;
    const textBeforeCursor = text.slice(0, cursorPos);

    // Find the last (( that isn't closed
    const lastParens = textBeforeCursor.lastIndexOf("((");
    if (lastParens === -1) return null;

    // Check if there's a )) between the (( and cursor
    const afterParens = textBeforeCursor.slice(lastParens + 2);
    if (afterParens.includes("))")) return null;

    // Get the query text after ((
    const queryText = afterParens;

    // Create a range that spans from (( to cursor
    const triggerRange = document.createRange();
    triggerRange.setStart(node, lastParens);
    triggerRange.setEnd(node, cursorPos);

    return { query: queryText, range: triggerRange };
  }, []);

  // Handle input events
  const handleInput = useCallback(() => {
    if (!containerRef.current) return;

    const result = findTriggerPattern();
    if (result) {
      setQuery(result.query);
      setTriggerRange(result.range);
      const pos = getCaretCoordinates();
      if (pos) {
        setPosition(pos);
        setIsOpen(true);
      }
    } else {
      setIsOpen(false);
      setQuery("");
      setTriggerRange(null);
    }
  }, [containerRef, findTriggerPattern, getCaretCoordinates]);

  // Insert the block reference
  const insertBlockRef = useCallback(
    (result: BlockResult) => {
      if (!triggerRange) return;

      // Delete the (( and query text
      triggerRange.deleteContents();

      // Create the block-ref element
      const blockRef = document.createElement("block-ref");
      blockRef.setAttribute("data-block-id", result.blockId);
      blockRef.setAttribute("data-page-id", result.pageId);
      blockRef.textContent = result.blockText;

      // Insert the element
      triggerRange.insertNode(blockRef);

      // Move cursor after the ref
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.setStartAfter(blockRef);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      // Trigger input event so editor saves the change
      const inputEvent = new Event("input", { bubbles: true });
      containerRef.current?.dispatchEvent(inputEvent);

      onInsertRef();
      setIsOpen(false);
      setQuery("");
      setTriggerRange(null);
    },
    [triggerRange, containerRef, onInsertRef]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((i) => Math.min(i + 1, filteredBlocks.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          if (filteredBlocks[selectedIndex]) {
            insertBlockRef(filteredBlocks[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          setQuery("");
          setTriggerRange(null);
          break;
        case "Tab":
          e.preventDefault();
          e.stopPropagation();
          if (filteredBlocks[selectedIndex]) {
            insertBlockRef(filteredBlocks[selectedIndex]);
          }
          break;
      }
    },
    [isOpen, filteredBlocks, selectedIndex, insertBlockRef]
  );

  // Set up event listeners
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("input", handleInput);
    container.addEventListener("keydown", handleKeyDown, true);

    return () => {
      container.removeEventListener("input", handleInput);
      container.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [containerRef, handleInput, handleKeyDown]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (isOpen && dropdownRef.current) {
      const selectedItem = dropdownRef.current.querySelector(
        `[data-index="${selectedIndex}"]`
      );
      selectedItem?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, isOpen]);

  if (!isOpen || filteredBlocks.length === 0) return null;

  return (
    <div
      ref={dropdownRef}
      className="block-ref-autocomplete"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex: 1000,
      }}
    >
      <div className="block-ref-autocomplete__header">
        Reference block
      </div>
      <div className="block-ref-autocomplete__list">
        {filteredBlocks.map((result, index) => (
          <div
            key={`${result.pageId}-${result.blockId}`}
            data-index={index}
            className={`block-ref-autocomplete__item ${
              index === selectedIndex ? "block-ref-autocomplete__item--selected" : ""
            }`}
            onClick={() => insertBlockRef(result)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="block-ref-autocomplete__block-text">
              {result.blockText}
            </span>
            <span className="block-ref-autocomplete__page-title">
              {result.pageTitle}
            </span>
          </div>
        ))}
      </div>
      <div className="block-ref-autocomplete__footer">
        <kbd>↑↓</kbd> navigate <kbd>⏎</kbd> select <kbd>esc</kbd> close
      </div>
    </div>
  );
}
