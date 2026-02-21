import { useState, useCallback, useRef, useEffect } from "react";

interface SuggestionItem {
  name: string;
  category: "column" | "function";
  hint: string; // type badge for columns, signature for functions
}

const FUNCTION_SIGNATURES: Record<string, string> = {
  if: "if(cond, then, else)",
  concat: "concat(a, b, ...)",
  length: "length(text)",
  lower: "lower(text)",
  upper: "upper(text)",
  contains: "contains(text, search)",
  replace: "replace(text, search, with)",
  trim: "trim(text)",
  abs: "abs(n)",
  round: "round(n, decimals?)",
  floor: "floor(n)",
  ceil: "ceil(n)",
  min: "min(a, b)",
  max: "max(a, b)",
  sqrt: "sqrt(n)",
  pow: "pow(base, exp)",
  now: "now()",
  dateAdd: "dateAdd(date, n, unit)",
  dateDiff: "dateDiff(a, b, unit)",
  toNumber: "toNumber(val)",
  toString: "toString(val)",
  empty: "empty(val)",
};

const ALL_FUNCTIONS = Object.keys(FUNCTION_SIGNATURES);

function extractPartialWord(text: string, cursorPos: number): { word: string; startPos: number } {
  const stopChars = new Set(["+", "-", "*", "/", "=", "<", ">", "!", "&", "|", "(", ")", ",", " ", "\t", "\n"]);
  let start = cursorPos;
  while (start > 0 && !stopChars.has(text[start - 1])) {
    start--;
  }
  return { word: text.slice(start, cursorPos), startPos: start };
}

export function useFormulaAutocomplete(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  columns: { name: string; type: string }[],
  expression: string,
  onExpressionChange: (newExpr: string, cursorPos: number) => void,
) {
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [dropdownItems, setDropdownItems] = useState<SuggestionItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dismissTimeoutRef = useRef<number | null>(null);

  const computeSuggestions = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;

    const cursorPos = ta.selectionStart;
    const { word } = extractPartialWord(expression, cursorPos);

    if (!word) {
      setDropdownVisible(false);
      return;
    }

    const lowerWord = word.toLowerCase();
    const items: SuggestionItem[] = [];

    // Columns first
    for (const col of columns) {
      if (col.name.toLowerCase().startsWith(lowerWord)) {
        items.push({ name: col.name, category: "column", hint: col.type });
      }
    }

    // Functions second
    for (const fn of ALL_FUNCTIONS) {
      if (fn.toLowerCase().startsWith(lowerWord)) {
        items.push({ name: fn, category: "function", hint: FUNCTION_SIGNATURES[fn] });
      }
    }

    if (items.length === 0) {
      setDropdownVisible(false);
      return;
    }

    setDropdownItems(items);
    setSelectedIndex(0);
    setDropdownVisible(true);
  }, [textareaRef, expression, columns]);

  const acceptSuggestion = useCallback(
    (item: SuggestionItem) => {
      const ta = textareaRef.current;
      if (!ta) return;

      const cursorPos = ta.selectionStart;
      const { startPos } = extractPartialWord(expression, cursorPos);

      let insertText: string;
      let newCursorPos: number;

      if (item.category === "column") {
        // Wrap in backticks if name contains spaces
        insertText = /\s/.test(item.name) ? `\`${item.name}\`` : item.name;
        newCursorPos = startPos + insertText.length;
      } else {
        // Function: append () with cursor between parens
        insertText = item.name + "()";
        newCursorPos = startPos + item.name.length + 1; // between ( and )
      }

      const newExpr = expression.slice(0, startPos) + insertText + expression.slice(cursorPos);
      onExpressionChange(newExpr, newCursorPos);
      setDropdownVisible(false);
    },
    [textareaRef, expression, onExpressionChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!dropdownVisible) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % dropdownItems.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + dropdownItems.length) % dropdownItems.length);
          break;
        case "Tab":
        case "Enter":
          e.preventDefault();
          if (dropdownItems[selectedIndex]) {
            acceptSuggestion(dropdownItems[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setDropdownVisible(false);
          break;
      }
    },
    [dropdownVisible, dropdownItems, selectedIndex, acceptSuggestion],
  );

  const handleInput = useCallback(() => {
    // Defer to let the textarea value update
    requestAnimationFrame(computeSuggestions);
  }, [computeSuggestions]);

  const dismiss = useCallback(() => {
    // Delay so click-to-select on dropdown item fires first
    dismissTimeoutRef.current = window.setTimeout(() => {
      setDropdownVisible(false);
    }, 150);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (dismissTimeoutRef.current != null) {
        clearTimeout(dismissTimeoutRef.current);
      }
    };
  }, []);

  return {
    dropdownVisible,
    dropdownItems,
    selectedIndex,
    handleKeyDown,
    handleInput,
    dismiss,
    acceptSuggestion,
  };
}

export function FormulaDropdown({
  items,
  selectedIndex,
  onSelect,
}: {
  items: SuggestionItem[];
  selectedIndex: number;
  onSelect: (item: SuggestionItem) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const el = container.querySelector(".db-formula-dropdown-item.selected") as HTMLElement;
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Group items by category
  const columnItems = items.filter((i) => i.category === "column");
  const functionItems = items.filter((i) => i.category === "function");

  return (
    <div className="db-formula-dropdown" ref={listRef}>
      {columnItems.length > 0 && (
        <>
          <div className="db-formula-dropdown-category">Columns</div>
          {columnItems.map((item, i) => {
            const globalIndex = i;
            return (
              <div
                key={`col-${item.name}`}
                className={`db-formula-dropdown-item${globalIndex === selectedIndex ? " selected" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevent textarea blur
                  onSelect(item);
                }}
              >
                <span className="db-formula-dropdown-item-name">{item.name}</span>
                <span className="db-formula-dropdown-item-hint">{item.hint}</span>
              </div>
            );
          })}
        </>
      )}
      {functionItems.length > 0 && (
        <>
          <div className="db-formula-dropdown-category">Functions</div>
          {functionItems.map((item, i) => {
            const globalIndex = columnItems.length + i;
            return (
              <div
                key={`fn-${item.name}`}
                className={`db-formula-dropdown-item${globalIndex === selectedIndex ? " selected" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevent textarea blur
                  onSelect(item);
                }}
              >
                <span className="db-formula-dropdown-item-name">{item.name}</span>
                <span className="db-formula-dropdown-item-hint">{item.hint}</span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
