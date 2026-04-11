/**
 * Bidirectional format converter: Editor.js ↔ BlockNote.
 *
 * Used during the migration period while the on-disk format remains Editor.js JSON.
 * BlockNote editor loads data via editorJsToBlockNote() and saves via blockNoteToEditorJs().
 *
 * The hardest part is parsing Editor.js HTML inline content (which contains custom elements
 * like <wiki-link> and <block-ref>) into BlockNote's structured inline content nodes.
 */

import type { EditorData, EditorBlock } from "../types/page";

// ─── BlockNote types (simplified for the converter) ─────────────────────────
// We use `any` for the actual BlockNote document type since it depends on the
// schema generics. The editor validates at runtime.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type BNBlock = Record<string, any>;
export type BNInlineContent = Record<string, any>;
export type BNDocument = BNBlock[];
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Editor.js → BlockNote ──────────────────────────────────────────────────

/**
 * Convert an Editor.js document to BlockNote document format.
 */
export function editorJsToBlockNote(data: EditorData): BNDocument {
  const blocks: BNBlock[] = [];
  for (const block of data.blocks) {
    const converted = convertBlock(block);
    // Some blocks expand to multiple (e.g., lists)
    if (Array.isArray(converted)) {
      blocks.push(...converted);
    } else {
      blocks.push(converted);
    }
  }
  return blocks;
}

function convertBlock(block: EditorBlock): BNBlock | BNBlock[] {
  const data = block.data as Record<string, unknown>;

  switch (block.type) {
    case "paragraph":
      return {
        id: block.id,
        type: "paragraph",
        content: parseHtmlToInlineContent((data.text as string) ?? ""),
      };

    case "header":
      return {
        id: block.id,
        type: "heading",
        props: {
          level: Math.min((data.level as number) ?? 2, 3) as 1 | 2 | 3,
        },
        content: parseHtmlToInlineContent((data.text as string) ?? ""),
      };

    case "list":
      return convertList(block);

    case "checklist":
      return convertChecklist(block);

    case "code":
      return {
        id: block.id,
        type: "codeBlock",
        props: { language: (data.language as string) ?? "plaintext" },
        content: [
          { type: "text", text: (data.code as string) ?? "", styles: {} },
        ],
      };

    case "quote":
      return {
        id: block.id,
        type: "quote",
        content: parseHtmlToInlineContent((data.text as string) ?? ""),
      };

    case "delimiter":
      return { id: block.id, type: "delimiter" };

    case "table":
      return convertTable(block);

    case "image":
      return convertImage(block);

    case "callout":
      return {
        id: block.id,
        type: "callout",
        props: { type: (data.type as string) ?? "info" },
        content: parseHtmlToInlineContent((data.content as string) ?? ""),
      };

    case "flashcard":
      return {
        id: block.id,
        type: "flashcard",
        props: {
          front: (data.front as string) ?? "",
          back: (data.back as string) ?? "",
          cardType: (data.cardType as string) ?? "basic",
          deckId: (data.deckId as string) ?? "",
          cardId: (data.cardId as string) ?? "",
        },
      };

    case "database":
      return {
        id: block.id,
        type: "database",
        props: {
          contentJson: data.content ? JSON.stringify(data.content) : "",
        },
      };

    case "liveQuery":
      return {
        id: block.id,
        type: "liveQuery",
        props: {
          configJson: data.config ? JSON.stringify(data.config) : "",
          notebookId: (data.notebookId as string) ?? "",
        },
      };

    case "blockEmbed":
      return {
        id: block.id,
        type: "blockEmbed",
        props: {
          targetBlockId: (data.targetBlockId as string) ?? "",
          targetPageId: (data.targetPageId as string) ?? "",
          notebookId: (data.notebookId as string) ?? "",
        },
      };

    case "embed":
      return {
        id: block.id,
        type: "embed",
        props: {
          embedType: (data.embedType as string) ?? "page",
          pageTitle: (data.pageTitle as string) ?? "",
          pageId: (data.pageId as string) ?? "",
          url: (data.url as string) ?? "",
          isCollapsed: (data.isCollapsed as boolean) ?? false,
          caption: (data.caption as string) ?? "",
          displayMode: (data.displayMode as string) ?? "embed",
        },
      };

    case "pdf":
      return {
        id: block.id,
        type: "pdf",
        props: {
          filename: (data.filename as string) ?? "",
          url: (data.url as string) ?? "",
          originalName: (data.originalName as string) ?? "",
          caption: (data.caption as string) ?? "",
          currentPage: (data.currentPage as number) ?? 1,
          totalPages: (data.totalPages as number) ?? 0,
          displayMode: (data.displayMode as string) ?? "preview",
        },
      };

    case "video":
      return {
        id: block.id,
        type: "video",
        props: {
          filename: (data.filename as string) ?? "",
          url: (data.url as string) ?? "",
          caption: (data.caption as string) ?? "",
          currentTime: (data.currentTime as number) ?? 0,
          displayMode: (data.displayMode as string) ?? "standard",
          transcription: (data.transcription as string) ?? "",
          transcriptionStatus:
            (data.transcriptionStatus as string) ?? "idle",
          showTranscript: (data.showTranscript as boolean) ?? false,
        },
      };

    case "audio":
      return {
        id: block.id,
        type: "audio",
        props: {
          filename: (data.filename as string) ?? "",
          url: (data.url as string) ?? "",
          caption: (data.caption as string) ?? "",
          transcription: (data.transcription as string) ?? "",
          transcriptionStatus:
            (data.transcriptionStatus as string) ?? "idle",
          showTranscript: (data.showTranscript as boolean) ?? false,
          recordedAt: (data.recordedAt as string) ?? "",
        },
      };

    case "drawing":
      return {
        id: block.id,
        type: "drawing",
        props: {
          canvasDataJson: data.canvasData
            ? JSON.stringify(data.canvasData)
            : "",
          width: (data.width as number) ?? 800,
          height: (data.height as number) ?? 400,
          displayMode: (data.displayMode as string) ?? "standard",
          caption: (data.caption as string) ?? "",
        },
      };

    case "columns":
      return convertColumns(block);

    case "plugin":
      return {
        id: block.id,
        type: "plugin",
        props: {
          pluginId: (data.pluginId as string) ?? "",
          blockType: (data.blockType as string) ?? "",
          dataJson: (data.dataJson as string) ?? "{}",
        },
      };

    default:
      // Unknown block type — preserve as paragraph with raw text
      console.warn(`Unknown Editor.js block type: ${block.type}`, data);
      return {
        id: block.id,
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `[Unsupported block: ${block.type}]`,
            styles: {},
          },
        ],
      };
  }
}

// ─── List conversion ────────────────────────────────────────────────────────

function convertList(block: EditorBlock): BNBlock[] {
  const data = block.data as Record<string, unknown>;
  const style = (data.style as string) ?? "unordered";
  const items = (data.items as unknown[]) ?? [];
  const blockType =
    style === "ordered" ? "numberedListItem" : "bulletListItem";

  return flattenListItems(items, blockType, block.id);
}

function flattenListItems(
  items: unknown[],
  blockType: string,
  baseId: string,
  depth = 0,
): BNBlock[] {
  const result: BNBlock[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Record<string, unknown>;
    // Editor.js list items can be { content: string, items: [...] } or just strings
    const text =
      typeof item === "string"
        ? item
        : (item.content as string) ?? (item.text as string) ?? "";
    const children =
      typeof item === "object" ? (item.items as unknown[]) ?? [] : [];

    result.push({
      id: `${baseId}-${depth}-${i}`,
      type: blockType,
      content: parseHtmlToInlineContent(text),
      // BlockNote uses nested children for indentation
      children:
        children.length > 0
          ? flattenListItems(children, blockType, baseId, depth + 1)
          : [],
    });
  }
  return result;
}

function convertChecklist(block: EditorBlock): BNBlock[] {
  const data = block.data as Record<string, unknown>;
  const items = (data.items as unknown[]) ?? [];
  return flattenChecklistItems(items, block.id);
}

function flattenChecklistItems(
  items: unknown[],
  baseId: string,
  depth = 0,
): BNBlock[] {
  const result: BNBlock[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Record<string, unknown>;
    const text = (item.text as string) ?? (item.content as string) ?? "";
    const checked =
      (item.checked as boolean) ??
      (item.meta as Record<string, unknown>)?.checked ??
      false;
    const children =
      typeof item === "object" ? (item.items as unknown[]) ?? [] : [];

    result.push({
      id: `${baseId}-${depth}-${i}`,
      type: "checkListItem",
      props: { checked: !!checked },
      content: parseHtmlToInlineContent(text),
      children:
        children.length > 0
          ? flattenChecklistItems(children, baseId, depth + 1)
          : [],
    });
  }
  return result;
}

// ─── Table conversion ───────────────────────────────────────────────────────

function convertTable(block: EditorBlock): BNBlock {
  const data = block.data as Record<string, unknown>;
  const content = (data.content as string[][]) ?? [];
  const cols = content.length > 0 ? content[0].length : 0;
  const withHeadings = (data.withHeadings as boolean) ?? false;

  return {
    id: block.id,
    type: "table",
    content: {
      type: "tableContent",
      columnWidths: Array(cols).fill(undefined),
      headerRows: withHeadings ? 1 : 0,
      headerCols: 0,
      rows: content.map((row) => ({
        cells: row.map((cell) => parseHtmlToInlineContent(cell)),
      })),
    },
  };
}

// ─── Image conversion ───────────────────────────────────────────────────────

function convertImage(block: EditorBlock): BNBlock {
  const data = block.data as Record<string, unknown>;
  const file = data.file as Record<string, unknown> | undefined;

  return {
    id: block.id,
    type: "image",
    props: {
      url: (file?.url as string) ?? (data.url as string) ?? "",
      caption: (data.caption as string) ?? "",
      previewWidth: (data.width as number) ?? undefined,
    },
  };
}

// ─── Columns conversion ─────────────────────────────────────────────────────

function convertColumns(block: EditorBlock): BNBlock {
  const data = block.data as Record<string, unknown>;
  const columnData = (data.columnData as { blocks: EditorBlock[] }[]) ?? [];

  // Convert to BlockNote XL multi-column format:
  // columnList > column (with width) > child blocks
  return {
    id: block.id,
    type: "columnList",
    children: columnData.map((col, i) => ({
      id: `${block.id}-col-${i}`,
      type: "column",
      props: { width: 1 / columnData.length },
      children: col.blocks.flatMap((b) => {
        const converted = convertBlock(b);
        return Array.isArray(converted) ? converted : [converted];
      }),
    })),
  };
}

// ─── HTML → BlockNote inline content parser ─────────────────────────────────

/**
 * Parse Editor.js HTML inline content to BlockNote structured inline nodes.
 *
 * Editor.js stores inline content as HTML strings:
 *   "Hello <b>world</b> and <wiki-link data-page-title="Foo">Foo</wiki-link>"
 *
 * BlockNote expects structured arrays:
 *   [
 *     { type: "text", text: "Hello ", styles: {} },
 *     { type: "text", text: "world", styles: { bold: true } },
 *     { type: "text", text: " and ", styles: {} },
 *     { type: "wikiLink", props: { pageTitle: "Foo", pageId: "" } },
 *   ]
 */
export function parseHtmlToInlineContent(html: string): BNInlineContent[] {
  if (!html) return [];

  // Fast path: plain text with no HTML tags and no entities
  if (!/</.test(html) && !/&/.test(html)) {
    return [{ type: "text", text: html, styles: {} }];
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;

  const result: BNInlineContent[] = [];
  walkDom(body, {}, result);
  return result;
}

interface StyleState {
  bold?: true;
  italic?: true;
  code?: true;
  underline?: true;
  strike?: true;
  link?: string;
  highlight?: string;
}

function walkDom(
  node: Node,
  styles: StyleState,
  result: BNInlineContent[],
): void {
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]!;

    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (text) {
        // Merge with previous text node if same styles
        const prev = result[result.length - 1];
        if (prev && prev.type === "text" && stylesEqual(prev.styles, styles)) {
          prev.text += text;
        } else {
          result.push({ type: "text", text, styles: { ...styles } });
        }
      }
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();

    // Custom elements
    if (tag === "wiki-link") {
      result.push({
        type: "wikiLink",
        props: {
          pageTitle: el.getAttribute("data-page-title") ?? "",
          pageId: el.getAttribute("data-page-id") ?? "",
        },
        content: undefined,
      });
      continue;
    }

    if (tag === "block-ref") {
      result.push({
        type: "blockRef",
        props: {
          blockId: el.getAttribute("data-block-id") ?? "",
          pageId: el.getAttribute("data-page-id") ?? "",
          text: el.textContent ?? "",
        },
        content: undefined,
      });
      continue;
    }

    // Style-modifying elements
    const newStyles = { ...styles };

    switch (tag) {
      case "b":
      case "strong":
        newStyles.bold = true;
        break;
      case "i":
      case "em":
        newStyles.italic = true;
        break;
      case "code":
        newStyles.code = true;
        break;
      case "u":
        newStyles.underline = true;
        break;
      case "s":
      case "strike":
      case "del":
        newStyles.strike = true;
        break;
      case "a": {
        const href = el.getAttribute("href");
        if (href) {
          // Links in BlockNote are inline content, not styles
          const linkContent: BNInlineContent[] = [];
          walkDom(el, { ...styles }, linkContent);
          // Merge text content for the link
          const linkText = linkContent
            .map((c) => (c.type === "text" ? c.text : ""))
            .join("");
          result.push({
            type: "link",
            href,
            content: [{ type: "text", text: linkText, styles: { ...styles } }],
          });
          continue;
        }
        break;
      }
      case "mark": {
        const color =
          el.getAttribute("data-color") ??
          el.style.backgroundColor ??
          "yellow";
        newStyles.highlight = color;
        break;
      }
      case "br":
        // Preserve line breaks as newlines
        const prev = result[result.length - 1];
        if (prev && prev.type === "text") {
          prev.text += "\n";
        } else {
          result.push({ type: "text", text: "\n", styles: { ...styles } });
        }
        continue;
    }

    walkDom(el, newStyles, result);
  }
}

function stylesEqual(a: StyleState, b: StyleState): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.code === b.code &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.link === b.link &&
    a.highlight === b.highlight
  );
}

// ─── BlockNote → Editor.js ──────────────────────────────────────────────────

/**
 * Convert a BlockNote document back to Editor.js format.
 */
export function blockNoteToEditorJs(document: BNDocument): EditorData {
  const blocks: EditorBlock[] = [];
  let i = 0;

  while (i < document.length) {
    const block = document[i]!;
    const result = convertBlockToEditorJs(block, document, i);
    blocks.push(...result.blocks);
    i = result.nextIndex;
  }

  return {
    time: Date.now(),
    version: "2.31.1",
    blocks,
  };
}

interface ConvertResult {
  blocks: EditorBlock[];
  nextIndex: number;
}

function convertBlockToEditorJs(
  block: BNBlock,
  doc: BNDocument,
  index: number,
): ConvertResult {
  switch (block.type) {
    case "paragraph":
      return {
        blocks: [
          {
            id: block.id ?? generateId(),
            type: "paragraph",
            data: { text: inlineContentToHtml(block.content ?? []) },
          },
        ],
        nextIndex: index + 1,
      };

    case "heading":
      return {
        blocks: [
          {
            id: block.id ?? generateId(),
            type: "header",
            data: {
              text: inlineContentToHtml(block.content ?? []),
              level: block.props?.level ?? 2,
            },
          },
        ],
        nextIndex: index + 1,
      };

    case "bulletListItem":
      return collectListItems(doc, index, "bulletListItem", "unordered");

    case "numberedListItem":
      return collectListItems(doc, index, "numberedListItem", "ordered");

    case "checkListItem":
      return collectChecklistItems(doc, index);

    case "codeBlock":
      return {
        blocks: [
          {
            id: block.id ?? generateId(),
            type: "code",
            data: {
              code: extractPlainText(block.content ?? []),
              language: block.props?.language ?? "plaintext",
            },
          },
        ],
        nextIndex: index + 1,
      };

    case "quote":
      return {
        blocks: [
          {
            id: block.id ?? generateId(),
            type: "quote",
            data: { text: inlineContentToHtml(block.content ?? []) },
          },
        ],
        nextIndex: index + 1,
      };

    case "delimiter":
      return {
        blocks: [
          { id: block.id ?? generateId(), type: "delimiter", data: {} },
        ],
        nextIndex: index + 1,
      };

    case "table":
      return {
        blocks: [
          {
            id: block.id ?? generateId(),
            type: "table",
            data: {
              withHeadings: (block.content?.headerRows ?? 0) > 0,
              content: (block.content?.rows ?? []).map(
                (row: { cells: BNInlineContent[][] }) =>
                  row.cells.map((cell: BNInlineContent[]) =>
                    inlineContentToHtml(cell),
                  ),
              ),
            },
          },
        ],
        nextIndex: index + 1,
      };

    case "image":
      return {
        blocks: [
          {
            id: block.id ?? generateId(),
            type: "image",
            data: {
              file: { url: block.props?.url ?? "" },
              caption: block.props?.caption ?? "",
              width: block.props?.previewWidth,
            },
          },
        ],
        nextIndex: index + 1,
      };

    case "callout":
      return {
        blocks: [
          {
            id: block.id ?? generateId(),
            type: "callout",
            data: {
              type: block.props?.type ?? "info",
              content: inlineContentToHtml(block.content ?? []),
            },
          },
        ],
        nextIndex: index + 1,
      };

    case "flashcard":
      return {
        blocks: [
          {
            id: block.id ?? generateId(),
            type: "flashcard",
            data: {
              front: block.props?.front ?? "",
              back: block.props?.back ?? "",
              cardType: block.props?.cardType ?? "basic",
              deckId: block.props?.deckId ?? "",
              cardId: block.props?.cardId ?? "",
            },
          },
        ],
        nextIndex: index + 1,
      };

    case "database":
      return {
        blocks: [
          {
            id: block.id ?? generateId(),
            type: "database",
            data: {
              content: block.props?.contentJson
                ? JSON.parse(block.props.contentJson)
                : undefined,
            },
          },
        ],
        nextIndex: index + 1,
      };

    case "liveQuery":
      return {
        blocks: [
          {
            id: block.id ?? generateId(),
            type: "liveQuery",
            data: {
              config: block.props?.configJson
                ? JSON.parse(block.props.configJson)
                : undefined,
              notebookId: block.props?.notebookId ?? "",
            },
          },
        ],
        nextIndex: index + 1,
      };

    case "blockEmbed":
      return {
        blocks: [
          {
            id: block.id ?? generateId(),
            type: "blockEmbed",
            data: {
              targetBlockId: block.props?.targetBlockId ?? "",
              targetPageId: block.props?.targetPageId ?? "",
              notebookId: block.props?.notebookId ?? "",
            },
          },
        ],
        nextIndex: index + 1,
      };

    case "embed":
      return {
        blocks: [
          {
            id: block.id ?? generateId(),
            type: "embed",
            data: {
              embedType: block.props?.embedType ?? "page",
              pageTitle: block.props?.pageTitle ?? "",
              pageId: block.props?.pageId ?? "",
              url: block.props?.url ?? "",
              isCollapsed: block.props?.isCollapsed ?? false,
              caption: block.props?.caption ?? "",
              displayMode: block.props?.displayMode ?? "embed",
            },
          },
        ],
        nextIndex: index + 1,
      };

    case "pdf":
      return {
        blocks: [
          {
            id: block.id ?? generateId(),
            type: "pdf",
            data: {
              filename: block.props?.filename ?? "",
              url: block.props?.url ?? "",
              originalName: block.props?.originalName ?? "",
              caption: block.props?.caption ?? "",
              currentPage: block.props?.currentPage ?? 1,
              totalPages: block.props?.totalPages ?? 0,
              displayMode: block.props?.displayMode ?? "preview",
            },
          },
        ],
        nextIndex: index + 1,
      };

    case "video":
      return {
        blocks: [
          {
            id: block.id ?? generateId(),
            type: "video",
            data: {
              filename: block.props?.filename ?? "",
              url: block.props?.url ?? "",
              caption: block.props?.caption ?? "",
              currentTime: block.props?.currentTime ?? 0,
              displayMode: block.props?.displayMode ?? "standard",
              transcription: block.props?.transcription ?? "",
              transcriptionStatus:
                block.props?.transcriptionStatus ?? "idle",
              showTranscript: block.props?.showTranscript ?? false,
            },
          },
        ],
        nextIndex: index + 1,
      };

    case "audio":
      return {
        blocks: [
          {
            id: block.id ?? generateId(),
            type: "audio",
            data: {
              filename: block.props?.filename ?? "",
              url: block.props?.url ?? "",
              caption: block.props?.caption ?? "",
              transcription: block.props?.transcription ?? "",
              transcriptionStatus:
                block.props?.transcriptionStatus ?? "idle",
              showTranscript: block.props?.showTranscript ?? false,
              recordedAt: block.props?.recordedAt ?? "",
            },
          },
        ],
        nextIndex: index + 1,
      };

    case "drawing":
      return {
        blocks: [
          {
            id: block.id ?? generateId(),
            type: "drawing",
            data: {
              canvasData: block.props?.canvasDataJson
                ? JSON.parse(block.props.canvasDataJson)
                : undefined,
              width: block.props?.width ?? 800,
              height: block.props?.height ?? 400,
              displayMode: block.props?.displayMode ?? "standard",
              caption: block.props?.caption ?? "",
            },
          },
        ],
        nextIndex: index + 1,
      };

    case "columnList":
      return {
        blocks: [
          {
            id: block.id ?? generateId(),
            type: "columns",
            data: {
              columns: block.children?.length ?? 2,
              columnData: (block.children ?? []).map(
                (col: BNBlock) => ({
                  blocks: (col.children ?? []).flatMap(
                    (child: BNBlock) => {
                      const r = convertBlockToEditorJs(child, [], 0);
                      return r.blocks;
                    },
                  ),
                }),
              ),
            },
          },
        ],
        nextIndex: index + 1,
      };

    // Skip column blocks (handled by columnList parent)
    case "column":
      return { blocks: [], nextIndex: index + 1 };

    default:
      // Preserve unknown blocks as-is
      return {
        blocks: [
          {
            id: block.id ?? generateId(),
            type: block.type,
            data: block.props ?? {},
          },
        ],
        nextIndex: index + 1,
      };
  }
}

// ─── List item collection ───────────────────────────────────────────────────
// BlockNote stores each list item as a separate block. Editor.js stores them
// as a single block with an items array. We collect consecutive same-type items.

function collectListItems(
  doc: BNDocument,
  startIndex: number,
  blockType: string,
  style: string,
): ConvertResult {
  const items: unknown[] = [];
  let i = startIndex;

  while (i < doc.length && doc[i]!.type === blockType) {
    const block = doc[i]!;
    items.push(blockToListItem(block));
    i++;
  }

  return {
    blocks: [
      {
        id: doc[startIndex]!.id ?? generateId(),
        type: "list",
        data: { style, items },
      },
    ],
    nextIndex: i,
  };
}

function blockToListItem(block: BNBlock): unknown {
  const text = inlineContentToHtml(block.content ?? []);
  const children = (block.children ?? []).map(blockToListItem);
  return { content: text, items: children };
}

function collectChecklistItems(
  doc: BNDocument,
  startIndex: number,
): ConvertResult {
  const items: unknown[] = [];
  let i = startIndex;

  while (i < doc.length && doc[i]!.type === "checkListItem") {
    const block = doc[i]!;
    items.push({
      text: inlineContentToHtml(block.content ?? []),
      checked: block.props?.checked ?? false,
    });
    i++;
  }

  return {
    blocks: [
      {
        id: doc[startIndex]!.id ?? generateId(),
        type: "checklist",
        data: { items },
      },
    ],
    nextIndex: i,
  };
}

// ─── BlockNote inline content → HTML ────────────────────────────────────────

export function inlineContentToHtml(content: BNInlineContent[]): string {
  return content.map(inlineNodeToHtml).join("");
}

function inlineNodeToHtml(node: BNInlineContent): string {
  if (node.type === "text") {
    let html = escapeHtml(node.text ?? "");
    const s = node.styles ?? {};

    if (s.highlight) {
      html = `<mark data-color="${escapeAttr(s.highlight)}" style="background-color: ${escapeAttr(s.highlight)}">${html}</mark>`;
    }
    if (s.code) html = `<code>${html}</code>`;
    if (s.bold) html = `<b>${html}</b>`;
    if (s.italic) html = `<i>${html}</i>`;
    if (s.underline) html = `<u>${html}</u>`;
    if (s.strike) html = `<s>${html}</s>`;

    return html;
  }

  if (node.type === "link") {
    const innerHtml = (node.content ?? []).map(inlineNodeToHtml).join("");
    return `<a href="${escapeAttr(node.href ?? "")}">${innerHtml}</a>`;
  }

  if (node.type === "wikiLink") {
    const p = node.props ?? {};
    return `<wiki-link data-page-title="${escapeAttr(p.pageTitle ?? "")}" data-page-id="${escapeAttr(p.pageId ?? "")}">${escapeHtml(p.pageTitle ?? "")}</wiki-link>`;
  }

  if (node.type === "blockRef") {
    const p = node.props ?? {};
    return `<block-ref data-block-id="${escapeAttr(p.blockId ?? "")}" data-page-id="${escapeAttr(p.pageId ?? "")}">${escapeHtml(p.text ?? "")}</block-ref>`;
  }

  return "";
}

function extractPlainText(content: BNInlineContent[]): string {
  return content
    .map((node) => {
      if (node.type === "text") return node.text ?? "";
      if (node.type === "link")
        return (node.content ?? []).map((c: BNInlineContent) => c.text ?? "").join("");
      if (node.type === "wikiLink") return node.props?.pageTitle ?? "";
      if (node.type === "blockRef") return node.props?.text ?? "";
      return "";
    })
    .join("");
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

let _idCounter = 0;
function generateId(): string {
  return `bn-${Date.now().toString(36)}-${(++_idCounter).toString(36)}`;
}
