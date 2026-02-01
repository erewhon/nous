import type { InlineTool, API } from "@editorjs/editorjs";

export interface HighlighterColor {
  name: string;
  color: string;
}

export const HIGHLIGHTER_COLORS: HighlighterColor[] = [
  { name: "yellow", color: "rgba(250, 204, 21, 0.4)" },
  { name: "green", color: "rgba(74, 222, 128, 0.4)" },
  { name: "blue", color: "rgba(96, 165, 250, 0.4)" },
  { name: "pink", color: "rgba(244, 114, 182, 0.4)" },
  { name: "orange", color: "rgba(251, 146, 60, 0.4)" },
  { name: "purple", color: "rgba(192, 132, 252, 0.4)" },
];

/**
 * Highlighter Inline Tool for Editor.js
 * Provides multi-color text highlighting like a highlighter pen
 */
export class HighlighterTool implements InlineTool {
  private api: API;
  private button: HTMLButtonElement | null = null;
  private colorPicker: HTMLDivElement | null = null;
  private _state: boolean = false;
  private currentColor: string = "yellow";

  static get isInline() {
    return true;
  }

  static get sanitize() {
    return {
      mark: {
        class: true,
        "data-color": true,
      },
    };
  }

  static get title() {
    return "Highlighter";
  }

  constructor({ api }: { api: API }) {
    this.api = api;
  }

  render(): HTMLButtonElement {
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m9 11-6 6v3h9l3-3"/>
        <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>
      </svg>
    `;
    this.button.classList.add("ce-inline-tool", "highlighter-tool");

    // Create color picker dropdown
    this.colorPicker = this.createColorPicker();
    document.body.appendChild(this.colorPicker);

    // Toggle color picker on click
    this.button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleColorPicker();
    });

    // Close color picker when clicking outside
    document.addEventListener("click", (e) => {
      if (
        this.colorPicker &&
        !this.colorPicker.contains(e.target as Node) &&
        !this.button?.contains(e.target as Node)
      ) {
        this.hideColorPicker();
      }
    });

    return this.button;
  }

  private createColorPicker(): HTMLDivElement {
    const picker = document.createElement("div");
    picker.className = "highlighter-color-picker";
    picker.style.cssText = `
      position: fixed;
      display: none;
      background: var(--color-bg-secondary);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 10000;
      gap: 6px;
    `;

    // Add color swatches
    const swatchContainer = document.createElement("div");
    swatchContainer.style.cssText = `
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      max-width: 140px;
    `;

    HIGHLIGHTER_COLORS.forEach((colorObj) => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "highlighter-swatch";
      swatch.setAttribute("data-color", colorObj.name);
      swatch.title = colorObj.name.charAt(0).toUpperCase() + colorObj.name.slice(1);
      swatch.style.cssText = `
        width: 24px;
        height: 24px;
        border-radius: 4px;
        border: 2px solid transparent;
        background-color: ${colorObj.color};
        cursor: pointer;
        transition: border-color 0.15s, transform 0.15s;
      `;

      swatch.addEventListener("mouseenter", () => {
        swatch.style.transform = "scale(1.1)";
      });
      swatch.addEventListener("mouseleave", () => {
        swatch.style.transform = "scale(1)";
      });

      swatch.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.currentColor = colorObj.name;
        this.applyHighlight();
        this.hideColorPicker();
      });

      swatchContainer.appendChild(swatch);
    });

    // Add remove highlight button
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "highlighter-remove";
    removeBtn.title = "Remove highlight";
    removeBtn.style.cssText = `
      width: 24px;
      height: 24px;
      border-radius: 4px;
      border: 2px solid var(--color-border);
      background: var(--color-bg-tertiary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-text-muted);
      transition: border-color 0.15s, transform 0.15s;
    `;
    removeBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    `;

    removeBtn.addEventListener("mouseenter", () => {
      removeBtn.style.transform = "scale(1.1)";
    });
    removeBtn.addEventListener("mouseleave", () => {
      removeBtn.style.transform = "scale(1)";
    });

    removeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.removeHighlight();
      this.hideColorPicker();
    });

    swatchContainer.appendChild(removeBtn);
    picker.appendChild(swatchContainer);

    return picker;
  }

  private toggleColorPicker(): void {
    if (!this.colorPicker || !this.button) return;

    const isVisible = this.colorPicker.style.display !== "none";

    if (isVisible) {
      this.hideColorPicker();
    } else {
      this.showColorPicker();
    }
  }

  private showColorPicker(): void {
    if (!this.colorPicker || !this.button) return;

    const buttonRect = this.button.getBoundingClientRect();
    this.colorPicker.style.display = "block";
    this.colorPicker.style.left = `${buttonRect.left}px`;
    this.colorPicker.style.top = `${buttonRect.bottom + 8}px`;

    // Update active swatch
    const swatches = this.colorPicker.querySelectorAll(".highlighter-swatch");
    swatches.forEach((swatch) => {
      const color = swatch.getAttribute("data-color");
      (swatch as HTMLElement).style.borderColor =
        color === this.currentColor ? "var(--color-accent)" : "transparent";
    });
  }

  private hideColorPicker(): void {
    if (this.colorPicker) {
      this.colorPicker.style.display = "none";
    }
  }

  private applyHighlight(): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return;

    // Check if we're inside an existing highlight
    const existingMark = this.api.selection.findParentTag("MARK");
    if (existingMark) {
      // Update the color of existing highlight
      existingMark.setAttribute("data-color", this.currentColor);
      existingMark.className = `cdx-highlighter cdx-highlighter--${this.currentColor}`;
      return;
    }

    // Create new highlight
    const selectedContent = range.extractContents();
    const mark = document.createElement("mark");
    mark.className = `cdx-highlighter cdx-highlighter--${this.currentColor}`;
    mark.setAttribute("data-color", this.currentColor);
    mark.appendChild(selectedContent);

    range.insertNode(mark);
    this.api.selection.expandToTag(mark);
  }

  private removeHighlight(): void {
    const mark = this.api.selection.findParentTag("MARK");
    if (!mark) return;

    const textContent = mark.textContent || "";
    const textNode = document.createTextNode(textContent);
    mark.parentNode?.replaceChild(textNode, mark);
  }

  surround(range: Range): void {
    // This is called when shortcut is used
    if (this._state) {
      this.removeHighlight();
    } else {
      // Store range for later use
      const selection = window.getSelection();
      if (selection && !range.collapsed) {
        selection.removeAllRanges();
        selection.addRange(range);
        this.applyHighlight();
      }
    }
  }

  checkState(): boolean {
    const mark = this.api.selection.findParentTag("MARK");
    this._state = !!mark;

    if (this.button) {
      this.button.classList.toggle("ce-inline-tool--active", this._state);
    }

    // Update current color if we're in a highlight
    if (mark) {
      const color = mark.getAttribute("data-color");
      if (color) {
        this.currentColor = color;
      }
    }

    return this._state;
  }

  get shortcut() {
    return "CMD+SHIFT+H";
  }

  // Clean up when tool is destroyed
  destroy(): void {
    if (this.colorPicker && this.colorPicker.parentNode) {
      this.colorPicker.parentNode.removeChild(this.colorPicker);
    }
  }
}
