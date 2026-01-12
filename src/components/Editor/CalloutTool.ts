import type {
  BlockTool,
  BlockToolConstructorOptions,
} from "@editorjs/editorjs";

type CalloutType = "info" | "warning" | "tip" | "danger";

interface CalloutData {
  type: CalloutType;
  title: string;
  content: string;
}

interface CalloutConfig {
  titlePlaceholder?: string;
  contentPlaceholder?: string;
}

const CALLOUT_CONFIG: Record<
  CalloutType,
  { icon: string; label: string; color: string }
> = {
  info: { icon: "ℹ️", label: "Info", color: "#3b82f6" },
  warning: { icon: "⚠️", label: "Warning", color: "#f59e0b" },
  tip: { icon: "💡", label: "Tip", color: "#10b981" },
  danger: { icon: "🚨", label: "Danger", color: "#ef4444" },
};

export class CalloutTool implements BlockTool {
  private data: CalloutData;
  private config: CalloutConfig;
  private wrapper: HTMLDivElement | null = null;
  private titleEl: HTMLDivElement | null = null;
  private contentEl: HTMLDivElement | null = null;

  static get toolbox() {
    return {
      title: "Callout",
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
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
      type: false,
      title: {
        b: true,
        i: true,
        a: { href: true },
        code: true,
      },
      content: {
        b: true,
        i: true,
        a: { href: true },
        code: true,
        br: true,
      },
    };
  }

  constructor({
    data,
    config,
  }: BlockToolConstructorOptions<CalloutData, CalloutConfig>) {
    this.config = config || {};
    this.data = {
      type: data.type || "info",
      title: data.title || "",
      content: data.content || "",
    };
  }

  render(): HTMLElement {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("callout-block", `callout-block--${this.data.type}`);

    // Type selector
    const typeSelector = this.createTypeSelector();

    // Header with icon and title
    const header = document.createElement("div");
    header.classList.add("callout-header");

    const icon = document.createElement("span");
    icon.classList.add("callout-icon");
    icon.textContent = CALLOUT_CONFIG[this.data.type].icon;

    this.titleEl = document.createElement("div");
    this.titleEl.classList.add("callout-title");
    this.titleEl.contentEditable = "true";
    this.titleEl.innerHTML = this.data.title;
    this.titleEl.dataset.placeholder =
      this.config.titlePlaceholder || "Callout title (optional)";

    this.titleEl.addEventListener("input", () => {
      this.data.title = this.titleEl!.innerHTML;
    });

    // Prevent Enter from creating new block, insert <br> instead
    this.titleEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // Move focus to content
        this.contentEl?.focus();
      }
    });

    header.appendChild(icon);
    header.appendChild(this.titleEl);

    // Content area
    this.contentEl = document.createElement("div");
    this.contentEl.classList.add("callout-content");
    this.contentEl.contentEditable = "true";
    this.contentEl.innerHTML = this.data.content;
    this.contentEl.dataset.placeholder =
      this.config.contentPlaceholder || "Type callout content...";

    this.contentEl.addEventListener("input", () => {
      this.data.content = this.contentEl!.innerHTML;
    });

    // Handle Shift+Enter for line breaks in content
    this.contentEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        // Allow normal Enter to create new block
      }
    });

    this.wrapper.appendChild(typeSelector);
    this.wrapper.appendChild(header);
    this.wrapper.appendChild(this.contentEl);

    return this.wrapper;
  }

  private createTypeSelector(): HTMLElement {
    const selector = document.createElement("div");
    selector.classList.add("callout-type-selector");

    (Object.keys(CALLOUT_CONFIG) as CalloutType[]).forEach((type) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.classList.add("callout-type-btn");
      if (type === this.data.type) {
        btn.classList.add("callout-type-btn--active");
      }
      btn.textContent = `${CALLOUT_CONFIG[type].icon} ${CALLOUT_CONFIG[type].label}`;

      btn.addEventListener("click", () => {
        this.setType(type);
        // Update active button
        selector.querySelectorAll(".callout-type-btn").forEach((b) => {
          b.classList.remove("callout-type-btn--active");
        });
        btn.classList.add("callout-type-btn--active");
      });

      selector.appendChild(btn);
    });

    return selector;
  }

  private setType(type: CalloutType): void {
    // Remove old type class
    this.wrapper?.classList.remove(`callout-block--${this.data.type}`);

    this.data.type = type;

    // Add new type class
    this.wrapper?.classList.add(`callout-block--${type}`);

    // Update icon
    const iconEl = this.wrapper?.querySelector(".callout-icon");
    if (iconEl) {
      iconEl.textContent = CALLOUT_CONFIG[type].icon;
    }
  }

  save(): CalloutData {
    return {
      type: this.data.type,
      title: this.titleEl?.innerHTML || "",
      content: this.contentEl?.innerHTML || "",
    };
  }

  validate(savedData: CalloutData): boolean {
    // At least content should be present
    return savedData.content.trim() !== "" || savedData.title.trim() !== "";
  }

  renderSettings(): HTMLElement {
    const wrapper = document.createElement("div");

    (Object.keys(CALLOUT_CONFIG) as CalloutType[]).forEach((type) => {
      const item = document.createElement("div");
      item.classList.add("cdx-settings-button");
      if (type === this.data.type) {
        item.classList.add("cdx-settings-button--active");
      }
      item.innerHTML = `${CALLOUT_CONFIG[type].icon} ${CALLOUT_CONFIG[type].label}`;
      item.addEventListener("click", () => {
        this.setType(type);
        // Update settings panel active state
        wrapper.querySelectorAll(".cdx-settings-button").forEach((btn) => {
          btn.classList.remove("cdx-settings-button--active");
        });
        item.classList.add("cdx-settings-button--active");
      });
      wrapper.appendChild(item);
    });

    return wrapper;
  }
}
