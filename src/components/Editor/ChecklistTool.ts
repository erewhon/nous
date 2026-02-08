import type {
  BlockTool,
  BlockToolConstructorOptions,
  BlockAPI,
} from "@editorjs/editorjs";
import { crumb } from "../../utils/breadcrumbs";

interface ChecklistItem {
  text: string;
  checked: boolean;
}

interface ChecklistData {
  items: ChecklistItem[];
}

interface ChecklistConfig {
  placeholder?: string;
}

export class ChecklistTool implements BlockTool {
  private data: ChecklistData;
  private config: ChecklistConfig;
  private block: BlockAPI;
  private wrapper: HTMLDivElement | null = null;
  private itemsContainer: HTMLDivElement | null = null;
  private draggedItem: HTMLElement | null = null;
  private draggedIndex: number = -1;
  private placeholder: HTMLElement | null = null;
  private readOnly: boolean;
  private instanceId: string;
  private styleEl: HTMLStyleElement | null = null;

  static get toolbox() {
    return {
      title: "Checklist",
      icon: '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 5h9M3 10h9M12.5 5.5l-2 2-1-1M12.5 10.5l-2 2-1-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    };
  }

  static get enableLineBreaks() {
    return true;
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get sanitize() {
    return {
      items: {
        text: {
          b: true,
          i: true,
          a: { href: true },
          code: true,
        },
        checked: false,
      },
    };
  }

  static get conversionConfig() {
    return {
      export: (data: ChecklistData): string => {
        return data.items
          .map((item) => `${item.checked ? "[x]" : "[ ]"} ${item.text}`)
          .join("\n");
      },
      import: (content: string): ChecklistData => {
        const lines = content.split("\n");
        const items = lines.map((line) => {
          const checkedMatch = line.match(/^\[([xX ])\]\s*/);
          if (checkedMatch) {
            return {
              text: line.replace(/^\[[xX ]\]\s*/, ""),
              checked: checkedMatch[1].toLowerCase() === "x",
            };
          }
          return { text: line, checked: false };
        });
        return { items };
      },
    };
  }

  constructor({
    data,
    config,
    readOnly,
    block,
  }: BlockToolConstructorOptions<ChecklistData, ChecklistConfig>) {
    this.config = config || {};
    this.readOnly = readOnly || false;
    this.block = block;
    this.instanceId = `checklist-${crypto.randomUUID().slice(0, 8)}`;
    // Deep-copy items to avoid sharing mutable references with the Zustand
    // store (or Editor.js internals).  Without this, splice/reorder
    // diverges from text edits and produces phantom reverts.
    this.data = {
      items:
        data.items && data.items.length > 0
          ? data.items.map((item) => ({ text: item.text, checked: item.checked }))
          : [{ text: "", checked: false }],
    };
  }

  render(): HTMLElement {
    // Clean up previous style tag if re-rendering
    this.styleEl?.remove();

    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("cdx-checklist");
    this.wrapper.id = this.instanceId;

    this.itemsContainer = document.createElement("div");
    this.itemsContainer.classList.add("cdx-checklist__items");
    this.wrapper.appendChild(this.itemsContainer);

    // Create <style> tag in <head> — OUTSIDE the editor container.
    // Checked state styling is driven entirely by CSS to avoid DOM mutations
    // inside the editor that freeze WebKitGTK's rendering pipeline.
    this.styleEl = document.createElement("style");
    this.styleEl.id = `style-${this.instanceId}`;
    document.head.appendChild(this.styleEl);

    // Render all items
    this.data.items.forEach((item, index) => {
      this.createItem(item, index);
    });

    // Generate initial CSS for checked items
    this.updateCheckedStyles();

    return this.wrapper;
  }

  private createItem(item: ChecklistItem, index: number): HTMLElement {
    const itemEl = document.createElement("div");
    itemEl.classList.add("cdx-checklist__item");
    // NOTE: Do NOT add cdx-checklist__item--checked here.
    // Checked styling is driven entirely by a <style> tag in <head> to avoid
    // DOM mutations inside the editor that freeze WebKitGTK's rendering pipeline.
    itemEl.dataset.index = String(index);

    // Drag handle
    if (!this.readOnly) {
      const dragHandle = document.createElement("div");
      dragHandle.classList.add("cdx-checklist__item-drag-handle");
      dragHandle.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
        <circle cx="3" cy="2" r="1.5"/>
        <circle cx="9" cy="2" r="1.5"/>
        <circle cx="3" cy="6" r="1.5"/>
        <circle cx="9" cy="6" r="1.5"/>
        <circle cx="3" cy="10" r="1.5"/>
        <circle cx="9" cy="10" r="1.5"/>
      </svg>`;
      dragHandle.draggable = true;

      // Drag events
      dragHandle.addEventListener("mousedown", () => {
        itemEl.draggable = true;
      });

      itemEl.addEventListener("dragstart", (e) => this.handleDragStart(e, itemEl, index));
      itemEl.addEventListener("dragend", (e) => this.handleDragEnd(e, itemEl));
      itemEl.addEventListener("dragover", (e) => this.handleDragOver(e, itemEl));
      itemEl.addEventListener("dragleave", (e) => this.handleDragLeave(e, itemEl));
      itemEl.addEventListener("drop", (e) => this.handleDrop(e, itemEl));

      itemEl.appendChild(dragHandle);
    }

    // Checkbox
    const checkbox = document.createElement("div");
    checkbox.classList.add("cdx-checklist__item-checkbox");
    // NOTE: Do NOT add cdx-checklist__item-checkbox--checked here.
    // Checked styling is driven by CSS in <head>.

    if (!this.readOnly) {
      checkbox.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleItem(itemEl, index);
      });
    }

    itemEl.appendChild(checkbox);

    // Text content
    const textEl = document.createElement("div");
    textEl.classList.add("cdx-checklist__item-text");
    textEl.contentEditable = this.readOnly ? "false" : "true";
    textEl.innerHTML = item.text;
    textEl.dataset.placeholder = this.config.placeholder || "Add item";

    if (!this.readOnly) {
      textEl.addEventListener("input", () => {
        this.data.items[index].text = textEl.innerHTML;
      });

      textEl.addEventListener("keydown", (e) => this.handleKeydown(e, index, textEl));
    }

    itemEl.appendChild(textEl);

    this.itemsContainer?.appendChild(itemEl);

    return itemEl;
  }

  private toggleItem(_itemEl: HTMLElement, index: number): void {
    crumb(`checklist:toggle:start:idx=${index}`);
    const isChecked = !this.data.items[index].checked;
    this.data.items[index].checked = isChecked;

    // Update visual state via CSS (proven safe — doesn't freeze)
    this.updateCheckedStyles();

    // DO NOT trigger any save pipeline here. editor.save() does a full
    // synchronous DOM traversal of ALL blocks, which forces a layout reflow
    // while pending style changes are queued — freezing WebKitGTK for 6+ seconds.
    //
    // Checkbox state changes are persisted by:
    //   1. The next text edit (triggers normal auto-save via editor.save(),
    //      which calls ChecklistTool.save() → reads this.data.items)
    //   2. Ctrl+S (explicit save)
    //   3. Page switch (onUnmountSave calls editor.save())
    crumb(`checklist:toggle:done:idx=${index}:checked=${isChecked}`);
  }

  /**
   * Generate CSS rules for checked items. The <style> tag is in <head>,
   * outside the editor container, so updates never trigger Editor.js's
   * MutationObserver.
   *
   * IMPORTANT: Only target non-contenteditable elements (checkbox).
   * Styling the .cdx-checklist__item-text (which is contentEditable="true")
   * causes WebKitGTK to freeze during style recalculation — even via CSS.
   * The checkbox visual alone (accent background + checkmark) is sufficient
   * to indicate checked state.
   */
  private updateCheckedStyles(): void {
    if (!this.styleEl) return;
    const id = CSS.escape(this.instanceId);
    const rules: string[] = [];

    this.data.items.forEach((item, index) => {
      if (item.checked) {
        const nth = index + 1; // nth-child is 1-based
        // Checkbox only (non-contenteditable): accent background + checkmark
        rules.push(
          `#${id} .cdx-checklist__item:nth-child(${nth}) .cdx-checklist__item-checkbox {` +
            `background-color: var(--color-accent) !important;` +
            `border-color: var(--color-accent) !important;` +
            `}`
        );
        rules.push(
          `#${id} .cdx-checklist__item:nth-child(${nth}) .cdx-checklist__item-checkbox::after {` +
            `content: '';` +
            `display: block;` +
            `width: 100%;` +
            `height: 100%;` +
            `background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E");` +
            `background-size: 70%;` +
            `background-position: center;` +
            `background-repeat: no-repeat;` +
            `}`
        );
        // Text: strikethrough + muted (safe — the freeze was caused by
        // editor.save() forcing layout reflow, not by CSS changes)
        rules.push(
          `#${id} .cdx-checklist__item:nth-child(${nth}) .cdx-checklist__item-text {` +
            `text-decoration: line-through;` +
            `color: var(--color-text-muted);` +
            `}`
        );
      }
    });

    this.styleEl.textContent = rules.join("\n");
  }

  private rerenderItems(): void {
    if (!this.itemsContainer) return;

    // Clear and re-render
    this.itemsContainer.innerHTML = "";
    this.data.items.forEach((item, index) => {
      this.createItem(item, index);
    });

    // Regenerate CSS for checked items
    this.updateCheckedStyles();

    // Explicitly notify Editor.js that the block data changed.
    // Editor.js's MutationObserver may not detect innerHTML-based rebuilds
    // as user edits, so onChange wouldn't fire without this.
    this.block?.dispatchChange();

    // Backup: dispatch a custom DOM event for the editor wrapper to catch.
    // dispatchChange() relies on Editor.js's internal batching which does
    // not reliably propagate to onChange for programmatic DOM rebuilds
    // (innerHTML clear + recreate).  The wrapper listens for this event
    // and triggers a save directly, ensuring deletions and reorders persist.
    this.wrapper?.dispatchEvent(
      new CustomEvent("checklist-structural-change", { bubbles: true })
    );
  }

  private handleKeydown(e: KeyboardEvent, index: number, textEl: HTMLElement): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();

      // Get cursor position to split text
      const selection = window.getSelection();
      let textAfterCursor = "";

      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(textEl);
        preCaretRange.setEnd(range.endContainer, range.endOffset);

        // Get text after cursor
        const afterRange = range.cloneRange();
        afterRange.selectNodeContents(textEl);
        afterRange.setStart(range.endContainer, range.endOffset);
        const afterFragment = afterRange.cloneContents();
        const tempDiv = document.createElement("div");
        tempDiv.appendChild(afterFragment);
        textAfterCursor = tempDiv.innerHTML;

        // Remove text after cursor from current item
        afterRange.deleteContents();
        this.data.items[index].text = textEl.innerHTML;
      }

      // Insert new item after current
      const newItem: ChecklistItem = { text: textAfterCursor, checked: false };
      this.data.items.splice(index + 1, 0, newItem);
      this.rerenderItems();

      // Focus new item
      setTimeout(() => {
        const items = this.itemsContainer?.querySelectorAll(".cdx-checklist__item-text");
        const newTextEl = items?.[index + 1] as HTMLElement;
        if (newTextEl) {
          newTextEl.focus();
          // Move cursor to start
          const range = document.createRange();
          range.selectNodeContents(newTextEl);
          range.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      }, 0);
    } else if (e.key === "Backspace" && this.isCaretAtStart(textEl)) {
      if (index > 0 || this.data.items.length > 1) {
        e.preventDefault();

        if (index === 0) {
          // First item - just clear if it's empty and there are more items
          if (textEl.innerHTML === "" && this.data.items.length > 1) {
            this.data.items.splice(0, 1);
            this.rerenderItems();
            // Focus first item
            setTimeout(() => {
              const firstText = this.itemsContainer?.querySelector(
                ".cdx-checklist__item-text"
              ) as HTMLElement;
              firstText?.focus();
            }, 0);
          }
        } else {
          // Merge with previous item
          const prevItemData = this.data.items[index - 1];
          const prevTextLength = prevItemData.text.length;
          prevItemData.text += textEl.innerHTML;
          this.data.items.splice(index, 1);
          this.rerenderItems();

          // Focus previous item and place cursor at merge point
          setTimeout(() => {
            const items = this.itemsContainer?.querySelectorAll(
              ".cdx-checklist__item-text"
            );
            const prevTextEl = items?.[index - 1] as HTMLElement;
            if (prevTextEl) {
              prevTextEl.focus();
              this.setCursorPosition(prevTextEl, prevTextLength);
            }
          }, 0);
        }
      }
    }
  }

  private isCaretAtStart(element: HTMLElement): boolean {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;

    const range = selection.getRangeAt(0);
    if (!range.collapsed) return false;

    // Check if caret is at the very start
    const preCaretRange = document.createRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    return preCaretRange.toString().length === 0;
  }

  private setCursorPosition(element: HTMLElement, position: number): void {
    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    let charCount = 0;
    let found = false;

    const traverse = (node: Node): boolean => {
      if (node.nodeType === Node.TEXT_NODE) {
        const textLength = node.textContent?.length || 0;
        if (charCount + textLength >= position) {
          range.setStart(node, position - charCount);
          range.collapse(true);
          found = true;
          return true;
        }
        charCount += textLength;
      } else {
        for (const child of Array.from(node.childNodes)) {
          if (traverse(child)) return true;
        }
      }
      return false;
    };

    traverse(element);

    if (!found) {
      // Position at end if not found
      range.selectNodeContents(element);
      range.collapse(false);
    }

    selection.removeAllRanges();
    selection.addRange(range);
  }

  // Drag and drop handlers
  private handleDragStart(e: DragEvent, itemEl: HTMLElement, index: number): void {
    this.draggedItem = itemEl;
    this.draggedIndex = index;

    itemEl.classList.add("cdx-checklist__item--dragging");

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    }

    // Create placeholder
    this.placeholder = document.createElement("div");
    this.placeholder.classList.add("cdx-checklist__item-placeholder");
  }

  private handleDragEnd(_e: DragEvent, itemEl: HTMLElement): void {
    itemEl.classList.remove("cdx-checklist__item--dragging");
    itemEl.draggable = false;

    // Remove placeholder
    this.placeholder?.remove();
    this.placeholder = null;

    // Remove drag-over class from all items
    this.itemsContainer?.querySelectorAll(".cdx-checklist__item--drag-over").forEach((el) => {
      el.classList.remove("cdx-checklist__item--drag-over");
    });

    this.draggedItem = null;
    this.draggedIndex = -1;
  }

  private handleDragOver(e: DragEvent, itemEl: HTMLElement): void {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }

    if (itemEl === this.draggedItem) return;

    itemEl.classList.add("cdx-checklist__item--drag-over");
  }

  private handleDragLeave(_e: DragEvent, itemEl: HTMLElement): void {
    itemEl.classList.remove("cdx-checklist__item--drag-over");
  }

  private handleDrop(e: DragEvent, itemEl: HTMLElement): void {
    e.preventDefault();
    itemEl.classList.remove("cdx-checklist__item--drag-over");

    const dropIndex = parseInt(itemEl.dataset.index || "0", 10);

    if (this.draggedIndex === -1 || this.draggedIndex === dropIndex) return;

    // Reorder items
    const [movedItem] = this.data.items.splice(this.draggedIndex, 1);
    this.data.items.splice(dropIndex, 0, movedItem);

    this.rerenderItems();
  }

  save(): ChecklistData {
    // Read text from the DOM (external code like Vim "dd" may manipulate it)
    // but read checked state from this.data.items (canonical source of truth).
    const items: ChecklistItem[] = [];

    if (this.itemsContainer) {
      const itemEls = this.itemsContainer.querySelectorAll(".cdx-checklist__item");
      itemEls.forEach((itemEl, idx) => {
        const textEl = itemEl.querySelector(".cdx-checklist__item-text");
        const text = textEl?.innerHTML ?? "";
        const checked = this.data.items[idx]?.checked ?? false;
        if (text.trim() !== "") {
          items.push({ text, checked });
        }
      });
    }

    // Fall back to internal data if DOM not available (shouldn't happen)
    if (items.length === 0 && this.data.items.length > 0) {
      const filtered = this.data.items
        .filter((item) => item.text.trim() !== "")
        .map((item) => ({ text: item.text, checked: item.checked }));
      if (filtered.length > 0) {
        return { items: filtered };
      }
    }

    return {
      items: items.length > 0 ? items : [{ text: "", checked: false }],
    };
  }

  validate(savedData: ChecklistData): boolean {
    return savedData.items && savedData.items.length > 0;
  }
}
