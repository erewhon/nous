import type {
  BlockTool,
  BlockToolConstructorOptions,
} from "@editorjs/editorjs";
import hljs from "highlight.js/lib/core";

// Import common languages
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import html from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import sql from "highlight.js/lib/languages/sql";
import markdown from "highlight.js/lib/languages/markdown";
import yaml from "highlight.js/lib/languages/yaml";

// Register languages
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("go", go);
hljs.registerLanguage("html", html);
hljs.registerLanguage("xml", html);
hljs.registerLanguage("css", css);
hljs.registerLanguage("json", json);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);

const SUPPORTED_LANGUAGES = [
  { value: "plaintext", label: "Plain Text" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "rust", label: "Rust" },
  { value: "go", label: "Go" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "json", label: "JSON" },
  { value: "bash", label: "Bash" },
  { value: "sql", label: "SQL" },
  { value: "markdown", label: "Markdown" },
  { value: "yaml", label: "YAML" },
];

interface CodeBlockData {
  code: string;
  language: string;
}

interface CodeBlockConfig {
  placeholder?: string;
}

export class CodeBlockTool implements BlockTool {
  private data: CodeBlockData;
  private config: CodeBlockConfig;
  private wrapper: HTMLDivElement | null = null;
  private textarea: HTMLTextAreaElement | null = null;
  private languageSelect: HTMLSelectElement | null = null;
  private previewElement: HTMLPreElement | null = null;

  static get toolbox() {
    return {
      title: "Code",
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16,18 22,12 16,6"/><polyline points="8,6 2,12 8,18"/></svg>',
    };
  }

  static get enableLineBreaks() {
    return true;
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get pasteConfig() {
    return {
      tags: ["PRE", "CODE"],
    };
  }

  constructor({
    data,
    config,
  }: BlockToolConstructorOptions<CodeBlockData, CodeBlockConfig>) {
    this.config = config || {};
    this.data = {
      code: data.code || "",
      language: data.language || "plaintext",
    };
  }

  render(): HTMLElement {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("code-block-wrapper");

    // Language selector
    const languageWrapper = document.createElement("div");
    languageWrapper.classList.add("code-block-language");

    this.languageSelect = document.createElement("select");
    SUPPORTED_LANGUAGES.forEach((lang) => {
      const option = document.createElement("option");
      option.value = lang.value;
      option.textContent = lang.label;
      if (lang.value === this.data.language) {
        option.selected = true;
      }
      this.languageSelect!.appendChild(option);
    });

    this.languageSelect.addEventListener("change", () => {
      this.data.language = this.languageSelect!.value;
      this.updateHighlight();
    });

    languageWrapper.appendChild(this.languageSelect);

    // Textarea for editing
    this.textarea = document.createElement("textarea");
    this.textarea.classList.add("code-block-textarea");
    this.textarea.value = this.data.code;
    this.textarea.placeholder =
      this.config.placeholder || "Enter code here...";
    this.textarea.spellcheck = false;

    // Handle tab key
    this.textarea.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const start = this.textarea!.selectionStart;
        const end = this.textarea!.selectionEnd;
        const value = this.textarea!.value;
        this.textarea!.value =
          value.substring(0, start) + "  " + value.substring(end);
        this.textarea!.selectionStart = this.textarea!.selectionEnd = start + 2;
      }
    });

    this.textarea.addEventListener("input", () => {
      this.data.code = this.textarea!.value;
    });

    this.textarea.addEventListener("blur", () => {
      this.updateHighlight();
      // Switch to preview mode if there's code
      if (this.data.code.trim()) {
        this.showPreview();
      }
    });

    // Preview element for highlighted code
    this.previewElement = document.createElement("pre");
    this.previewElement.classList.add("code-block-preview");

    // Click on preview to edit
    this.previewElement.addEventListener("click", () => {
      this.showTextarea();
    });

    this.wrapper.appendChild(languageWrapper);
    this.wrapper.appendChild(this.textarea);
    this.wrapper.appendChild(this.previewElement);

    // Initialize: show preview if we have code, otherwise show textarea
    if (this.data.code.trim()) {
      this.updateHighlight();
      this.showPreview();
    } else {
      this.showTextarea();
    }

    return this.wrapper;
  }

  private showPreview(): void {
    if (this.textarea && this.previewElement) {
      this.textarea.style.display = "none";
      this.previewElement.style.display = "block";
    }
  }

  private showTextarea(): void {
    if (this.textarea && this.previewElement) {
      this.previewElement.style.display = "none";
      this.textarea.style.display = "block";
      this.textarea.focus();
    }
  }

  private updateHighlight(): void {
    if (!this.previewElement || !this.data.code) return;

    const codeEl = document.createElement("code");
    codeEl.textContent = this.data.code;

    if (this.data.language !== "plaintext") {
      try {
        const result = hljs.highlight(this.data.code, {
          language: this.data.language,
        });
        codeEl.innerHTML = result.value;
        codeEl.classList.add(`language-${this.data.language}`, "hljs");
      } catch {
        // If highlighting fails, just use plain text
        codeEl.textContent = this.data.code;
      }
    }

    this.previewElement.innerHTML = "";
    this.previewElement.appendChild(codeEl);
  }

  save(): CodeBlockData {
    return {
      code: this.data.code,
      language: this.data.language,
    };
  }

  validate(savedData: CodeBlockData): boolean {
    return savedData.code.trim() !== "";
  }

  onPaste(event: unknown): void {
    const pasteEvent = event as { detail: { data: HTMLElement } };
    const content = pasteEvent.detail.data;
    const code =
      content.tagName === "PRE"
        ? content.textContent || ""
        : content.textContent || "";

    this.data.code = code;

    // Try to detect language from class
    const codeEl = content.querySelector("code");
    if (codeEl) {
      const langClass = Array.from(codeEl.classList).find(
        (c) => c.startsWith("language-") || c.startsWith("lang-")
      );
      if (langClass) {
        const lang = langClass.replace(/^(language-|lang-)/, "");
        if (SUPPORTED_LANGUAGES.some((l) => l.value === lang)) {
          this.data.language = lang;
        }
      }
    }

    if (this.textarea) {
      this.textarea.value = code;
    }
    if (this.languageSelect) {
      this.languageSelect.value = this.data.language;
    }
  }

  static get sanitize() {
    return {
      code: true,
      language: false,
    };
  }
}
