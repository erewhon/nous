import { useState, useEffect, useCallback, useRef } from "react";

interface WikiLinkAutocompleteProps {
  containerRef: React.RefObject<HTMLElement | null>;
  pages: Array<{ id: string; title: string }>;
  onInsertLink: (pageTitle: string) => void;
}

interface DropdownPosition {
  top: number;
  left: number;
}

export function WikiLinkAutocomplete({
  containerRef,
  pages,
  onInsertLink,
}: WikiLinkAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<DropdownPosition>({ top: 0, left: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [triggerRange, setTriggerRange] = useState<Range | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Filter pages based on query
  const filteredPages = pages.filter((page) =>
    page.title.toLowerCase().includes(query.toLowerCase())
  );

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

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

  // Find [[ pattern in text before cursor
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

    // Find the last [[ that isn't closed
    const lastBrackets = textBeforeCursor.lastIndexOf("[[");
    if (lastBrackets === -1) return null;

    // Check if there's a ]] between the [[ and cursor
    const afterBrackets = textBeforeCursor.slice(lastBrackets + 2);
    if (afterBrackets.includes("]]")) return null;

    // Get the query text after [[
    const queryText = afterBrackets;

    // Create a range that spans from [[ to cursor
    const triggerRange = document.createRange();
    triggerRange.setStart(node, lastBrackets);
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

  // Insert the wiki link
  const insertLink = useCallback(
    (pageTitle: string) => {
      if (!triggerRange) return;

      // Delete the [[ and query text
      triggerRange.deleteContents();

      // Create the wiki-link element
      const wikiLink = document.createElement("wiki-link");
      wikiLink.setAttribute("data-page-title", pageTitle);
      wikiLink.classList.add("wiki-link");
      wikiLink.style.cssText = `
        color: var(--color-accent);
        text-decoration: underline;
        text-decoration-style: dotted;
        cursor: pointer;
      `;
      wikiLink.textContent = `[[${pageTitle}]]`;

      // Insert the element
      triggerRange.insertNode(wikiLink);

      // Move cursor after the link
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.setStartAfter(wikiLink);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      // Trigger input event so editor saves the change
      const inputEvent = new Event("input", { bubbles: true });
      containerRef.current?.dispatchEvent(inputEvent);

      onInsertLink(pageTitle);
      setIsOpen(false);
      setQuery("");
      setTriggerRange(null);
    },
    [triggerRange, containerRef, onInsertLink]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((i) => Math.min(i + 1, filteredPages.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          if (filteredPages[selectedIndex]) {
            insertLink(filteredPages[selectedIndex].title);
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
          if (filteredPages[selectedIndex]) {
            insertLink(filteredPages[selectedIndex].title);
          }
          break;
      }
    },
    [isOpen, filteredPages, selectedIndex, insertLink]
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

  if (!isOpen || filteredPages.length === 0) return null;

  return (
    <div
      ref={dropdownRef}
      className="wiki-link-autocomplete"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex: 1000,
      }}
    >
      <div className="wiki-link-autocomplete__header">
        Link to page
      </div>
      <div className="wiki-link-autocomplete__list">
        {filteredPages.slice(0, 10).map((page, index) => (
          <div
            key={page.id}
            data-index={index}
            className={`wiki-link-autocomplete__item ${
              index === selectedIndex ? "wiki-link-autocomplete__item--selected" : ""
            }`}
            onClick={() => insertLink(page.title)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <svg
              className="wiki-link-autocomplete__icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="wiki-link-autocomplete__title">{page.title}</span>
          </div>
        ))}
      </div>
      <div className="wiki-link-autocomplete__footer">
        <kbd>↑↓</kbd> navigate <kbd>⏎</kbd> select <kbd>esc</kbd> close
      </div>
    </div>
  );
}
