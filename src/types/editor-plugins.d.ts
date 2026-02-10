/* eslint-disable @typescript-eslint/no-explicit-any */

declare module "@editorjs/header" {
  import { BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";

  interface HeaderConfig {
    placeholder?: string;
    levels?: number[];
    defaultLevel?: number;
  }

  interface HeaderData {
    text: string;
    level: number;
  }

  export default class Header implements BlockTool {
    constructor(config: BlockToolConstructorOptions<HeaderData, HeaderConfig>);
    render(): HTMLElement;
    save(block: HTMLElement): HeaderData;
    static get toolbox(): { title: string; icon: string };
  }
}

declare module "@editorjs/list" {
  import { BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";

  interface ListConfig {
    defaultStyle?: "ordered" | "unordered";
  }

  interface NestedListItem {
    content: string;
    items: NestedListItem[];
  }

  interface ListData {
    style: "ordered" | "unordered";
    items: NestedListItem[];
  }

  export default class List implements BlockTool {
    constructor(config: BlockToolConstructorOptions<ListData, ListConfig>);
    render(): HTMLElement;
    save(block: HTMLElement): ListData;
    static get toolbox(): { title: string; icon: string };
  }
}

declare module "@editorjs/code" {
  import { BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";

  interface CodeData {
    code: string;
  }

  export default class Code implements BlockTool {
    constructor(config: BlockToolConstructorOptions<CodeData, object>);
    render(): HTMLElement;
    save(block: HTMLElement): CodeData;
    static get toolbox(): { title: string; icon: string };
  }
}

declare module "@editorjs/quote" {
  import { BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";

  interface QuoteData {
    text: string;
    caption: string;
    alignment: "left" | "center";
  }

  export default class Quote implements BlockTool {
    constructor(config: BlockToolConstructorOptions<QuoteData, object>);
    render(): HTMLElement;
    save(block: HTMLElement): QuoteData;
    static get toolbox(): { title: string; icon: string };
  }
}

declare module "@editorjs/marker" {
  import { InlineTool } from "@editorjs/editorjs";

  export default class Marker implements InlineTool {
    render(): HTMLElement;
    surround(range: Range): void;
    checkState(): boolean;
    static get isInline(): boolean;
  }
}

declare module "@editorjs/inline-code" {
  import { InlineTool } from "@editorjs/editorjs";

  export default class InlineCode implements InlineTool {
    render(): HTMLElement;
    surround(range: Range): void;
    checkState(): boolean;
    static get isInline(): boolean;
  }
}

declare module "@editorjs/delimiter" {
  import { BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";

  export default class Delimiter implements BlockTool {
    constructor(config: BlockToolConstructorOptions<object, object>);
    render(): HTMLElement;
    save(): object;
    static get toolbox(): { title: string; icon: string };
  }
}
