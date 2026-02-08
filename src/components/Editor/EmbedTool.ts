import type {
  BlockTool,
  BlockToolConstructorOptions,
  API,
} from "@editorjs/editorjs";
import { invoke } from "@tauri-apps/api/core";

type EmbedType = "page" | "url";

type DisplayMode = "embed" | "link";

interface EmbedData {
  embedType: EmbedType;
  pageTitle?: string; // For internal page embeds
  pageId?: string; // For internal page embeds (resolved)
  url?: string; // For external URL embeds
  isCollapsed: boolean;
  caption?: string;
  displayMode?: DisplayMode; // Whether to show as embed or link
  width?: number; // Custom width in pixels (for resizing)
}

interface EmbedConfig {
  notebookId?: string;
  pages?: Array<{ id: string; title: string }>;
  onPageClick?: (pageTitle: string) => void;
}

interface PageContent {
  id: string;
  title: string;
  blocks: Array<{
    id: string;
    type: string;
    data: Record<string, unknown>;
  }>;
  pageType?: string;
}

interface UrlContent {
  title: string;
  description: string;
  content: string; // Main text content
  url: string;
  siteName?: string;
  favicon?: string;
}

export class EmbedTool implements BlockTool {
  private api: API;
  private data: EmbedData;
  private config: EmbedConfig;
  private wrapper: HTMLDivElement | null = null;
  private contentWrapper: HTMLDivElement | null = null;
  private isLoading = false;
  private loadedContent: PageContent | UrlContent | null = null;
  private readOnly: boolean;

  static get toolbox() {
    return {
      title: "Embed",
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    };
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get sanitize() {
    return {
      embedType: false,
      pageTitle: false,
      pageId: false,
      url: false,
      isCollapsed: false,
      caption: true,
      displayMode: false,
      width: false,
    };
  }

  constructor({
    data,
    config,
    api,
    readOnly,
  }: BlockToolConstructorOptions<EmbedData, EmbedConfig>) {
    this.api = api;
    this.config = config || {};
    this.readOnly = readOnly || false;
    this.data = {
      embedType: data.embedType || "page",
      pageTitle: data.pageTitle || "",
      pageId: data.pageId || "",
      url: data.url || "",
      isCollapsed: data.isCollapsed ?? false,
      caption: data.caption || "",
      displayMode: data.displayMode || "embed",
      width: data.width,
    };
  }

  render(): HTMLElement {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("embed-block");

    // Apply custom width if set
    if (this.data.width) {
      this.wrapper.style.width = `${this.data.width}px`;
    }

    if (!this.data.pageTitle && !this.data.url) {
      // Show input for creating new embed
      this.renderInputMode();
    } else if (this.data.displayMode === "link") {
      // Show as simple link
      this.renderLinkMode();
    } else {
      // Show embedded content
      this.renderEmbedMode();
    }

    return this.wrapper;
  }

  private renderLinkMode(): void {
    if (!this.wrapper) return;

    this.wrapper.innerHTML = "";
    this.wrapper.classList.add("embed-block--link");

    const linkWrapper = document.createElement("div");
    linkWrapper.classList.add("embed-link-wrapper");

    const icon = document.createElement("span");
    icon.classList.add("embed-link-icon");
    icon.innerHTML = this.data.embedType === "page"
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14,2 14,8 20,8"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

    const link = document.createElement("a");
    link.classList.add("embed-link");

    if (this.data.embedType === "page") {
      link.textContent = this.data.pageTitle || "Untitled Page";
      link.href = "#";
      link.addEventListener("click", (e) => {
        e.preventDefault();
        if (this.data.pageTitle && this.config.onPageClick) {
          this.config.onPageClick(this.data.pageTitle);
        }
      });
    } else {
      link.textContent = this.data.url || "Unknown URL";
      link.href = this.data.url || "#";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }

    linkWrapper.appendChild(icon);
    linkWrapper.appendChild(link);

    // Add toggle to embed button if not readonly
    if (!this.readOnly) {
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.classList.add("embed-mode-toggle");
      toggleBtn.title = "Convert to embed";
      toggleBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.data.displayMode = "embed";
        this.render();
        this.wrapper!.replaceWith(this.render());
      });
      linkWrapper.appendChild(toggleBtn);
    }

    this.wrapper.appendChild(linkWrapper);
  }

  private renderInputMode(): void {
    if (!this.wrapper) return;

    this.wrapper.innerHTML = "";
    this.wrapper.classList.add("embed-block--input");

    const inputContainer = document.createElement("div");
    inputContainer.classList.add("embed-input-container");

    // Type selector tabs
    const tabs = document.createElement("div");
    tabs.classList.add("embed-tabs");

    const pageTab = document.createElement("button");
    pageTab.type = "button";
    pageTab.classList.add("embed-tab");
    if (this.data.embedType === "page") pageTab.classList.add("embed-tab--active");
    pageTab.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
        <polyline points="14,2 14,8 20,8"/>
      </svg>
      Page
    `;

    const urlTab = document.createElement("button");
    urlTab.type = "button";
    urlTab.classList.add("embed-tab");
    if (this.data.embedType === "url") urlTab.classList.add("embed-tab--active");
    urlTab.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>
      URL
    `;

    pageTab.addEventListener("click", () => {
      this.data.embedType = "page";
      this.renderInputMode();
    });

    urlTab.addEventListener("click", () => {
      this.data.embedType = "url";
      this.renderInputMode();
    });

    tabs.appendChild(pageTab);
    tabs.appendChild(urlTab);

    // Input field
    const inputWrapper = document.createElement("div");
    inputWrapper.classList.add("embed-input-wrapper");

    const input = document.createElement("input");
    input.type = "text";
    input.classList.add("embed-input");
    input.placeholder = this.data.embedType === "page"
      ? "Enter page title to embed..."
      : "Enter URL to embed...";
    input.value = this.data.embedType === "page" ? (this.data.pageTitle || "") : (this.data.url || "");

    // Page autocomplete dropdown
    let autocompleteDropdown: HTMLDivElement | null = null;

    if (this.data.embedType === "page" && this.config.pages) {
      autocompleteDropdown = document.createElement("div");
      autocompleteDropdown.classList.add("embed-autocomplete");
      autocompleteDropdown.style.display = "none";

      input.addEventListener("input", () => {
        const query = input.value.toLowerCase();
        if (!query || !this.config.pages) {
          autocompleteDropdown!.style.display = "none";
          return;
        }

        const matches = this.config.pages.filter(p =>
          p.title.toLowerCase().includes(query)
        ).slice(0, 8);

        if (matches.length === 0) {
          autocompleteDropdown!.style.display = "none";
          return;
        }

        autocompleteDropdown!.innerHTML = "";
        matches.forEach(page => {
          const item = document.createElement("div");
          item.classList.add("embed-autocomplete-item");
          item.textContent = page.title;
          item.addEventListener("click", () => {
            input.value = page.title;
            this.data.pageTitle = page.title;
            this.data.pageId = page.id;
            autocompleteDropdown!.style.display = "none";
          });
          autocompleteDropdown!.appendChild(item);
        });
        autocompleteDropdown!.style.display = "block";
      });

      input.addEventListener("blur", () => {
        // Delay to allow click on dropdown
        setTimeout(() => {
          if (autocompleteDropdown) autocompleteDropdown.style.display = "none";
        }, 200);
      });
    }

    // Embed button
    const embedBtn = document.createElement("button");
    embedBtn.type = "button";
    embedBtn.classList.add("embed-btn");
    embedBtn.textContent = "Embed";
    embedBtn.addEventListener("click", () => {
      if (this.data.embedType === "page") {
        this.data.pageTitle = input.value;
        // Try to find page ID
        const page = this.config.pages?.find(p =>
          p.title.toLowerCase() === input.value.toLowerCase()
        );
        if (page) {
          this.data.pageId = page.id;
        }
      } else {
        this.data.url = input.value;
      }
      if (this.data.pageTitle || this.data.url) {
        this.renderEmbedMode();
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        embedBtn.click();
      }
    });

    inputWrapper.appendChild(input);
    if (autocompleteDropdown) {
      inputWrapper.appendChild(autocompleteDropdown);
    }

    inputContainer.appendChild(tabs);
    inputContainer.appendChild(inputWrapper);
    inputContainer.appendChild(embedBtn);

    this.wrapper.appendChild(inputContainer);
  }

  private renderEmbedMode(): void {
    if (!this.wrapper) return;

    this.wrapper.innerHTML = "";
    this.wrapper.classList.remove("embed-block--input");
    this.wrapper.classList.remove("embed-block--link");
    this.wrapper.classList.add("embed-block--loaded");
    if (this.data.isCollapsed) {
      this.wrapper.classList.add("embed-block--collapsed");
    } else {
      this.wrapper.classList.remove("embed-block--collapsed");
    }

    // Check if this is a YouTube URL
    const youtubeInfo = this.data.embedType === "url" ? this.parseYouTubeUrl(this.data.url) : null;

    // Header
    const header = document.createElement("div");
    header.classList.add("embed-header");

    // Toggle button
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.classList.add("embed-toggle");
    toggleBtn.innerHTML = this.data.isCollapsed
      ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>'
      : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
    toggleBtn.addEventListener("click", () => {
      this.data.isCollapsed = !this.data.isCollapsed;
      this.renderEmbedMode();
    });

    // Icon based on type
    const icon = document.createElement("span");
    icon.classList.add("embed-icon");
    if (youtubeInfo) {
      icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/></svg>';
    } else {
      icon.innerHTML = this.data.embedType === "page"
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14,2 14,8 20,8"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
    }

    // Title
    const title = document.createElement("span");
    title.classList.add("embed-title");
    if (youtubeInfo) {
      title.textContent = "YouTube Video";
    } else {
      title.textContent = this.data.embedType === "page"
        ? this.data.pageTitle || "Untitled"
        : this.data.url || "Unknown URL";
    }

    // Make title clickable for pages
    if (this.data.embedType === "page" && this.data.pageTitle && this.config.onPageClick) {
      title.classList.add("embed-title--clickable");
      title.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.data.pageTitle && this.config.onPageClick) {
          this.config.onPageClick(this.data.pageTitle);
        }
      });
    }

    // Actions
    const actions = document.createElement("div");
    actions.classList.add("embed-actions");

    if (!this.readOnly) {
      // Toggle to link mode button
      const linkModeBtn = document.createElement("button");
      linkModeBtn.type = "button";
      linkModeBtn.classList.add("embed-action-btn");
      linkModeBtn.title = "Convert to link";
      linkModeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
      linkModeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.data.displayMode = "link";
        const newElement = this.render();
        this.wrapper!.replaceWith(newElement);
        this.wrapper = newElement as HTMLDivElement;
      });

      // Refresh button
      const refreshBtn = document.createElement("button");
      refreshBtn.type = "button";
      refreshBtn.classList.add("embed-action-btn");
      refreshBtn.title = "Refresh";
      refreshBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
      refreshBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.loadedContent = null;
        this.loadContent();
      });

      // Remove button
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.classList.add("embed-action-btn");
      removeBtn.title = "Remove embed";
      removeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.api.blocks.delete(this.api.blocks.getCurrentBlockIndex());
      });

      actions.appendChild(linkModeBtn);
      actions.appendChild(refreshBtn);
      actions.appendChild(removeBtn);
    }

    header.appendChild(toggleBtn);
    header.appendChild(icon);
    header.appendChild(title);
    header.appendChild(actions);

    // Content wrapper
    this.contentWrapper = document.createElement("div");
    this.contentWrapper.classList.add("embed-content");
    if (this.data.isCollapsed) {
      this.contentWrapper.style.display = "none";
    }

    this.wrapper.appendChild(header);
    this.wrapper.appendChild(this.contentWrapper);

    // Add resize handle if not readonly
    if (!this.readOnly) {
      const resizeHandle = document.createElement("div");
      resizeHandle.classList.add("embed-resize-handle");
      this.setupResizeHandle(resizeHandle);
      this.wrapper.appendChild(resizeHandle);
    }

    // Load content if not collapsed - use requestAnimationFrame to ensure DOM is ready
    if (!this.data.isCollapsed) {
      // For YouTube, render immediately without loading external content
      if (youtubeInfo) {
        this.renderYouTubeEmbed(youtubeInfo);
      } else {
        // Use a more robust approach to ensure the wrapper is in the DOM
        this.scheduleContentLoad();
      }
    }
  }

  private scheduleContentLoad(): void {
    // Try multiple times with increasing delays to handle various rendering scenarios
    const attempts = [0, 50, 150, 300];
    let attemptIndex = 0;

    const tryLoad = () => {
      // Check if wrapper is in the document
      if (this.wrapper && document.body.contains(this.wrapper)) {
        this.loadContent();
      } else if (attemptIndex < attempts.length - 1) {
        // Schedule next attempt
        attemptIndex++;
        setTimeout(tryLoad, attempts[attemptIndex]);
      } else {
        // Final fallback - just try to load anyway
        this.loadContent();
      }
    };

    // Start with requestAnimationFrame then first delay
    requestAnimationFrame(() => {
      setTimeout(tryLoad, attempts[0]);
    });
  }

  private parseYouTubeUrl(url?: string): { videoId: string; timestamp?: number } | null {
    if (!url) return null;

    // Match various YouTube URL formats
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        // Extract timestamp if present
        const timestampMatch = url.match(/[?&]t=(\d+)/);
        return {
          videoId: match[1],
          timestamp: timestampMatch ? parseInt(timestampMatch[1]) : undefined,
        };
      }
    }
    return null;
  }

  private renderYouTubeEmbed(info: { videoId: string; timestamp?: number }): void {
    if (!this.contentWrapper) return;

    const youtubeWrapper = document.createElement("div");
    youtubeWrapper.classList.add("embed-youtube");

    // Create iframe for YouTube embed
    const iframe = document.createElement("iframe");
    let src = `https://www.youtube.com/embed/${info.videoId}`;
    if (info.timestamp) {
      src += `?start=${info.timestamp}`;
    }
    iframe.src = src;
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.classList.add("embed-youtube-iframe");

    youtubeWrapper.appendChild(iframe);
    this.contentWrapper.appendChild(youtubeWrapper);
  }

  private setupResizeHandle(handle: HTMLElement): void {
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    const onMouseDown = (e: MouseEvent) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = this.wrapper?.offsetWidth || 400;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing || !this.wrapper) return;
      const diff = e.clientX - startX;
      const newWidth = Math.max(200, Math.min(startWidth + diff, 1200)); // Min 200px, max 1200px
      this.wrapper.style.width = `${newWidth}px`;
      this.data.width = newWidth;
    };

    const onMouseUp = () => {
      isResizing = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    handle.addEventListener("mousedown", onMouseDown);
  }

  private async loadContent(): Promise<void> {
    if (!this.contentWrapper || this.isLoading) return;

    // Check if we already have loaded content
    if (this.loadedContent) {
      this.renderContent();
      return;
    }

    this.isLoading = true;
    this.contentWrapper.innerHTML = `
      <div class="embed-loading">
        <div class="embed-spinner"></div>
        <span>Loading...</span>
      </div>
    `;

    try {
      if (this.data.embedType === "page") {
        await this.loadPageContent();
      } else {
        await this.loadUrlContent();
      }
      this.renderContent();
    } catch (error) {
      console.error("Failed to load embed content:", error);
      this.contentWrapper.innerHTML = `
        <div class="embed-error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>Failed to load content</span>
        </div>
      `;
    } finally {
      this.isLoading = false;
    }
  }

  private async loadPageContent(): Promise<void> {
    if (!this.config.notebookId) {
      throw new Error("Notebook ID not available");
    }

    // Try to get page by ID first, then by title
    let pageId = this.data.pageId;

    if (!pageId && this.data.pageTitle) {
      const page = this.config.pages?.find(p =>
        p.title.toLowerCase() === this.data.pageTitle?.toLowerCase()
      );
      if (page) {
        pageId = page.id;
        this.data.pageId = page.id;
      }
    }

    if (!pageId) {
      throw new Error("Page not found");
    }

    const content = await invoke<PageContent>("get_page_content", {
      notebookId: this.config.notebookId,
      pageId,
    });

    this.loadedContent = content;
  }

  private async loadUrlContent(): Promise<void> {
    if (!this.data.url) {
      throw new Error("URL not provided");
    }

    const content = await invoke<UrlContent>("fetch_url_content", {
      url: this.data.url,
    });

    this.loadedContent = content;
  }

  private renderContent(): void {
    if (!this.contentWrapper || !this.loadedContent) return;

    this.contentWrapper.innerHTML = "";

    if (this.data.embedType === "page") {
      this.renderPageContent(this.loadedContent as PageContent);
    } else {
      this.renderUrlContent(this.loadedContent as UrlContent);
    }
  }

  private renderPageContent(content: PageContent): void {
    if (!this.contentWrapper) return;

    const pageContent = document.createElement("div");
    pageContent.classList.add("embed-page-content");

    // Render blocks (simplified - just show text content)
    content.blocks.forEach(block => {
      const blockEl = document.createElement("div");
      blockEl.classList.add("embed-block-item", `embed-block-item--${block.type}`);

      // Render based on block type
      switch (block.type) {
        case "header":
          const level = (block.data.level as number) || 2;
          blockEl.innerHTML = `<h${level}>${block.data.text || ""}</h${level}>`;
          break;
        case "paragraph":
          blockEl.innerHTML = `<p>${block.data.text || ""}</p>`;
          break;
        case "list":
          const items = (block.data.items as Array<string | { content?: string; items?: unknown[] }>) || [];
          const listType = block.data.style === "ordered" ? "ol" : "ul";
          const renderListItems = (listItems: Array<string | { content?: string; items?: unknown[] }>): string => {
            return listItems.map(item => {
              const text = typeof item === "string" ? item : item.content || "";
              const children = typeof item === "object" && Array.isArray(item.items) && item.items.length > 0
                ? `<${listType}>${renderListItems(item.items as Array<string | { content?: string; items?: unknown[] }>)}</${listType}>`
                : "";
              return `<li>${text}${children}</li>`;
            }).join("");
          };
          blockEl.innerHTML = `<${listType}>${renderListItems(items)}</${listType}>`;
          break;
        case "checklist":
          const checkItems = (block.data.items as Array<{ text: string; checked: boolean }>) || [];
          blockEl.innerHTML = `<ul class="embed-checklist">${checkItems.map(item =>
            `<li class="${item.checked ? 'checked' : ''}"><span class="checkbox">${item.checked ? '☑' : '☐'}</span> ${item.text}</li>`
          ).join("")}</ul>`;
          break;
        case "quote":
          blockEl.innerHTML = `<blockquote>${block.data.text || ""}<cite>${block.data.caption || ""}</cite></blockquote>`;
          break;
        case "code":
          blockEl.innerHTML = `<pre><code>${this.escapeHtml(String(block.data.code || ""))}</code></pre>`;
          break;
        case "callout":
          blockEl.innerHTML = `<div class="embed-callout embed-callout--${block.data.type || 'info'}">${block.data.title ? `<strong>${block.data.title}</strong>` : ""}${block.data.content || ""}</div>`;
          break;
        case "delimiter":
          blockEl.innerHTML = `<hr/>`;
          break;
        default:
          // For other blocks, try to extract text
          if (block.data.text) {
            blockEl.innerHTML = `<p>${block.data.text}</p>`;
          }
      }

      if (blockEl.innerHTML) {
        pageContent.appendChild(blockEl);
      }
    });

    // If no content rendered, show empty state
    if (!pageContent.hasChildNodes()) {
      pageContent.innerHTML = '<p class="embed-empty">This page is empty</p>';
    }

    this.contentWrapper.appendChild(pageContent);
  }

  private renderUrlContent(content: UrlContent): void {
    if (!this.contentWrapper) return;

    const urlContent = document.createElement("div");
    urlContent.classList.add("embed-url-content");

    // Site info header
    const siteInfo = document.createElement("div");
    siteInfo.classList.add("embed-site-info");

    if (content.favicon) {
      const favicon = document.createElement("img");
      favicon.src = content.favicon;
      favicon.classList.add("embed-favicon");
      favicon.alt = "";
      siteInfo.appendChild(favicon);
    }

    if (content.siteName) {
      const siteName = document.createElement("span");
      siteName.classList.add("embed-site-name");
      siteName.textContent = content.siteName;
      siteInfo.appendChild(siteName);
    }

    // Title
    if (content.title) {
      const title = document.createElement("h4");
      title.classList.add("embed-url-title");
      title.textContent = content.title;
      urlContent.appendChild(title);
    }

    // Description
    if (content.description) {
      const desc = document.createElement("p");
      desc.classList.add("embed-url-description");
      desc.textContent = content.description;
      urlContent.appendChild(desc);
    }

    // Main content (truncated)
    if (content.content) {
      const mainContent = document.createElement("div");
      mainContent.classList.add("embed-url-main-content");
      // Truncate to ~500 chars
      const truncated = content.content.length > 500
        ? content.content.substring(0, 500) + "..."
        : content.content;
      mainContent.textContent = truncated;
      urlContent.appendChild(mainContent);
    }

    // Link to original
    const linkWrapper = document.createElement("div");
    linkWrapper.classList.add("embed-url-link");
    const link = document.createElement("a");
    link.href = content.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open original →";
    linkWrapper.appendChild(link);
    urlContent.appendChild(linkWrapper);

    if (siteInfo.hasChildNodes()) {
      this.contentWrapper.appendChild(siteInfo);
    }
    this.contentWrapper.appendChild(urlContent);
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  save(): EmbedData {
    return {
      embedType: this.data.embedType,
      pageTitle: this.data.pageTitle,
      pageId: this.data.pageId,
      url: this.data.url,
      isCollapsed: this.data.isCollapsed,
      caption: this.data.caption,
      displayMode: this.data.displayMode,
      width: this.data.width,
    };
  }

  validate(savedData: EmbedData): boolean {
    return !!(savedData.pageTitle || savedData.url);
  }

  renderSettings(): HTMLElement {
    const wrapper = document.createElement("div");

    // Toggle display mode (embed vs link)
    const displayModeBtn = document.createElement("div");
    displayModeBtn.classList.add("cdx-settings-button");
    const isLinkMode = this.data.displayMode === "link";
    if (isLinkMode) {
      displayModeBtn.classList.add("cdx-settings-button--active");
    }
    displayModeBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>
      ${isLinkMode ? "Show as Embed" : "Show as Link"}
    `;
    displayModeBtn.addEventListener("click", () => {
      this.data.displayMode = this.data.displayMode === "link" ? "embed" : "link";
      const newElement = this.render();
      this.wrapper!.replaceWith(newElement);
      this.wrapper = newElement as HTMLDivElement;
      displayModeBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
        ${this.data.displayMode === "link" ? "Show as Embed" : "Show as Link"}
      `;
      displayModeBtn.classList.toggle("cdx-settings-button--active", this.data.displayMode === "link");
    });

    // Toggle collapse setting (only relevant for embed mode)
    const collapseBtn = document.createElement("div");
    collapseBtn.classList.add("cdx-settings-button");
    if (this.data.isCollapsed) {
      collapseBtn.classList.add("cdx-settings-button--active");
    }
    collapseBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <line x1="9" y1="3" x2="9" y2="21"/>
      </svg>
      ${this.data.isCollapsed ? "Expand" : "Collapse"}
    `;
    collapseBtn.addEventListener("click", () => {
      this.data.isCollapsed = !this.data.isCollapsed;
      if (this.data.displayMode !== "link") {
        this.renderEmbedMode();
      }
      collapseBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="9" y1="3" x2="9" y2="21"/>
        </svg>
        ${this.data.isCollapsed ? "Expand" : "Collapse"}
      `;
      collapseBtn.classList.toggle("cdx-settings-button--active", this.data.isCollapsed);
    });

    // Reset width button
    const resetWidthBtn = document.createElement("div");
    resetWidthBtn.classList.add("cdx-settings-button");
    resetWidthBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="4" width="20" height="16" rx="2"/>
        <path d="M9 4v16"/>
        <path d="M15 4v16"/>
      </svg>
      Reset Width
    `;
    resetWidthBtn.addEventListener("click", () => {
      this.data.width = undefined;
      if (this.wrapper) {
        this.wrapper.style.width = "";
      }
    });

    wrapper.appendChild(displayModeBtn);
    wrapper.appendChild(collapseBtn);
    wrapper.appendChild(resetWidthBtn);

    return wrapper;
  }

  /**
   * Create an embed block from a wiki link
   */
  static createFromWikiLink(pageTitle: string): EmbedData {
    return {
      embedType: "page",
      pageTitle,
      isCollapsed: false,
    };
  }

  /**
   * Create an embed block from a URL
   */
  static createFromUrl(url: string): EmbedData {
    return {
      embedType: "url",
      url,
      isCollapsed: false,
    };
  }
}
