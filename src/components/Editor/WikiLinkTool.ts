import type { InlineTool, API } from "@editorjs/editorjs";

interface WikiLinkToolConfig {
  onLinkClick?: (pageTitle: string) => void;
  searchPages?: (query: string) => Promise<Array<{ id: string; title: string }>>;
}

/**
 * WikiLink Inline Tool for Editor.js
 * Creates [[wiki-style links]] for Zettelkasten bi-directional linking
 */
export class WikiLinkTool implements InlineTool {
  private api: API;
  private button: HTMLButtonElement | null = null;
  private config: WikiLinkToolConfig;
  private _state: boolean = false;

  static get isInline() {
    return true;
  }

  static get sanitize() {
    return {
      "wiki-link": {
        "data-page-id": true,
        "data-page-title": true,
      },
    };
  }

  static get title() {
    return "Wiki Link";
  }

  constructor({ api, config }: { api: API; config?: WikiLinkToolConfig }) {
    this.api = api;
    this.config = config || {};
  }

  render(): HTMLButtonElement {
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>
    `;
    this.button.classList.add("ce-inline-tool");

    return this.button;
  }

  surround(range: Range): void {
    if (this._state) {
      // Unwrap existing link
      this.unwrap(range);
    } else {
      // Wrap selection in wiki link
      this.wrap(range);
    }
  }

  private wrap(range: Range): void {
    const selectedText = range.extractContents();
    const text = selectedText.textContent || "";

    const wikiLink = document.createElement("wiki-link");
    wikiLink.setAttribute("data-page-title", text);
    wikiLink.classList.add("wiki-link");
    wikiLink.style.cssText = `
      color: var(--color-accent);
      text-decoration: underline;
      text-decoration-style: dotted;
      cursor: pointer;
    `;

    // Display format: [[title]]
    wikiLink.textContent = `[[${text}]]`;

    wikiLink.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pageTitle = wikiLink.getAttribute("data-page-title");
      if (pageTitle && this.config.onLinkClick) {
        this.config.onLinkClick(pageTitle);
      }
    });

    range.insertNode(wikiLink);
    this.api.selection.expandToTag(wikiLink);
  }

  private unwrap(_range: Range): void {
    const wikiLink = this.api.selection.findParentTag("WIKI-LINK");
    if (!wikiLink) return;

    const text = wikiLink.textContent?.replace(/^\[\[|\]\]$/g, "") || "";
    const textNode = document.createTextNode(text);

    wikiLink.parentNode?.replaceChild(textNode, wikiLink);
  }

  checkState(): boolean {
    const wikiLink = this.api.selection.findParentTag("WIKI-LINK");
    this._state = !!wikiLink;

    if (this.button) {
      this.button.classList.toggle("ce-inline-tool--active", this._state);
    }

    return this._state;
  }

  get shortcut() {
    return "CMD+SHIFT+K";
  }

  /**
   * Extract wiki links from Editor.js blocks
   */
  static extractLinks(blocks: Array<{ type: string; data: Record<string, unknown> }>): string[] {
    const links: string[] = [];
    const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;

    for (const block of blocks) {
      // Check paragraph text
      if (block.type === "paragraph" && typeof block.data.text === "string") {
        let match;
        while ((match = wikiLinkRegex.exec(block.data.text)) !== null) {
          links.push(match[1]);
        }
      }

      // Check header text
      if (block.type === "header" && typeof block.data.text === "string") {
        let match;
        while ((match = wikiLinkRegex.exec(block.data.text)) !== null) {
          links.push(match[1]);
        }
      }

      // Check list items
      if (block.type === "list" && Array.isArray(block.data.items)) {
        for (const item of block.data.items) {
          if (typeof item === "string") {
            let match;
            while ((match = wikiLinkRegex.exec(item)) !== null) {
              links.push(match[1]);
            }
          }
        }
      }
    }

    return [...new Set(links)]; // Remove duplicates
  }

  /**
   * Mark wiki links as broken if their target page doesn't exist
   * Handles both simple titles and path syntax (e.g., "Parent/Child")
   */
  static markBrokenLinks(
    container: HTMLElement,
    existingPageTitles: string[]
  ): void {
    const links = container.querySelectorAll("wiki-link");
    const titlesLower = existingPageTitles.map((t) => t.toLowerCase());

    links.forEach((link) => {
      const title = link.getAttribute("data-page-title");
      if (!title) {
        link.classList.add("broken");
        return;
      }

      // For path syntax, check if the final part exists
      // (full path validation would require page hierarchy data)
      const titleToCheck = title.includes("/")
        ? title.split("/").pop()?.trim() || title
        : title;

      const exists = titlesLower.includes(titleToCheck.toLowerCase());
      link.classList.toggle("broken", !exists);
    });
  }
}
