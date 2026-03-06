/**
 * BlockNoteEditor — drop-in replacement for BlockEditor.tsx.
 *
 * Uses the same props/ref interface so EditorPaneContent can swap between
 * old (Editor.js) and new (BlockNote) editors via a feature flag.
 *
 * Key differences from BlockEditor:
 * - No more editor.save() DOM traversal — BlockNote maintains state as data
 * - No more isRenderingRef/isSavingRef/suppressRemote guard dance
 * - No more MutationObserver workarounds
 * - Format conversion happens at the boundary (load/save)
 */
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./blocknote-checklist-sort.css";

import { combineByGroup } from "@blocknote/core";
import { en as defaultDictionary } from "@blocknote/core/locales";
import type { CollaborationOptions } from "../../collab/CollabProvider";
import { BlockNoteView } from "@blocknote/mantine";
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import {
  getMultiColumnSlashMenuItems,
  locales as multiColumnLocales,
  multiColumnDropCursor,
} from "@blocknote/xl-multi-column";
import {
  memo,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";

import { blocksToYXmlFragment } from "@blocknote/core/yjs";
import { schema } from "./schema";
import {
  editorJsToBlockNote,
  blockNoteToEditorJs,
  type BNDocument,
} from "../../utils/blockFormatConverter";
import { useThemeStore } from "../../stores/themeStore";
import { useVimStore } from "../../stores/vimStore";
import { VimExtension } from "./vim";
import { VimModeIndicator } from "./VimModeIndicator";
import { useBlockNoteHeaderCollapse } from "./useBlockNoteHeaderCollapse";
import { useChecklistSort } from "./useChecklistSort";
import { useBlockAttribution } from "../../hooks/useBlockAttribution";
import { getCollabProvider } from "../../collab/collabStore";
import type { EditorData } from "../../types/page";
import { usePluginStore } from "../../stores/pluginStore";

// ─── Types ──────────────────────────────────────────────────────────────────

interface BlockNoteEditorProps {
  initialData?: EditorData;
  onChange?: (data?: EditorData) => void;
  onSave?: (data: EditorData) => void;
  onExplicitSave?: (data: EditorData) => void;
  onLinkClick?: (pageTitle: string) => void;
  onBlockRefClick?: (blockId: string, pageId: string) => void;
  readOnly?: boolean;
  className?: string;
  notebookId?: string;
  pageId?: string;
  paneId?: string;
  pages?: Array<{ id: string; title: string }>;
  /** BlockNote native collaboration options. When set, initialContent is ignored. */
  collaboration?: CollaborationOptions;
  /** True after initial Yjs sync with server completes. Used to trigger content seeding. */
  collabSynced?: boolean;
}

export interface BlockNoteEditorRef {
  render: (data: EditorData) => void;
  save: () => Promise<EditorData | null>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function filterItems(
  items: DefaultReactSuggestionItem[],
  query: string,
): DefaultReactSuggestionItem[] {
  if (!query) return items;
  const lower = query.toLowerCase();
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(lower) ||
      item.aliases?.some((a) => a.toLowerCase().includes(lower)) ||
      item.group?.toLowerCase().includes(lower),
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export const BlockNoteEditor = memo(
  forwardRef<BlockNoteEditorRef, BlockNoteEditorProps>(
    function BlockNoteEditor(
      {
        initialData,
        onChange,
        onSave,
        onExplicitSave,
        onLinkClick,
        onBlockRefClick,
        readOnly = false,
        className = "",
        pageId,
        collaboration,
        collabSynced,
      },
      ref,
    ) {
      // Store callbacks in refs to avoid stale closures
      const onChangeRef = useRef(onChange);
      const onSaveRef = useRef(onSave);
      const onExplicitSaveRef = useRef(onExplicitSave);
      const onLinkClickRef = useRef(onLinkClick);
      const onBlockRefClickRef = useRef(onBlockRefClick);

      useEffect(() => {
        onChangeRef.current = onChange;
      }, [onChange]);
      useEffect(() => {
        onSaveRef.current = onSave;
      }, [onSave]);
      useEffect(() => {
        onExplicitSaveRef.current = onExplicitSave;
      }, [onExplicitSave]);
      useEffect(() => {
        onLinkClickRef.current = onLinkClick;
      }, [onLinkClick]);
      useEffect(() => {
        onBlockRefClickRef.current = onBlockRefClick;
      }, [onBlockRefClick]);

      // Convert initial EditorJS data to BlockNote format
      const initialContent = useMemo((): BNDocument | undefined => {
        if (!initialData?.blocks?.length) return undefined;
        try {
          return editorJsToBlockNote(initialData);
        } catch (e) {
          console.error("Failed to convert EditorJS data to BlockNote:", e);
          return undefined;
        }
      }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally only on mount

      // Theme
      const resolvedMode = useThemeStore((s) => s.resolvedMode);

      // Merge default dictionary with multi-column translations
      const dictionary = useMemo(
        () => ({ ...defaultDictionary, multi_column: multiColumnLocales.en }),
        [],
      );

      // ─── Vim extension ────────────────────────────────────────────
      // Always registered; checks enabled() on every keydown so toggling
      // the keymap setting doesn't require editor recreation.
      const editorKeymap = useThemeStore((s) => s.settings.editorKeymap);
      const editorKeymapRef = useRef(editorKeymap);
      editorKeymapRef.current = editorKeymap;

      const vimSetMode = useVimStore((s) => s.setMode);
      const vimSetPendingKeys = useVimStore((s) => s.setPendingKeys);

      const vimExtension = useMemo(
        () =>
          VimExtension({
            enabled: () =>
              editorKeymapRef.current === "vim" && !readOnly,
            onModeChange: vimSetMode,
            onPendingKeysChange: vimSetPendingKeys,
          }),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- stable refs, create once
        [],
      );

      // Create BlockNote editor
      // When collaboration is active, don't pass initialContent — Yjs doc is the source of truth
      const editor = useCreateBlockNote({
        schema,
        initialContent: collaboration ? undefined : initialContent,
        collaboration,
        dropCursor: multiColumnDropCursor,
        dictionary,
        extensions: [vimExtension],
      });

      // ─── Seed Yjs fragment with page content after initial sync ─────
      // When starting a new collab session, the Y.XmlFragment is empty.
      // After the provider syncs with the server (which also has an empty doc
      // for new sessions), we populate the fragment with the page's content.
      // This goes through y-prosemirror and syncs to all connected clients.
      const initialDataRef = useRef(initialData);
      useEffect(() => {
        if (!collaboration || !collabSynced) return;
        // Only seed if the fragment is empty (new session, no prior server state)
        if (collaboration.fragment.length > 0) return;
        if (!initialDataRef.current?.blocks?.length) return;

        try {
          const bnBlocks = editorJsToBlockNote(initialDataRef.current);
          blocksToYXmlFragment(editor, bnBlocks as any, collaboration.fragment);
        } catch (e) {
          console.error("Failed to seed collab content:", e);
        }
      }, [collaboration, collabSynced, editor]);

      // ─── Auto-save timer ────────────────────────────────────────────
      const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
      const isDirtyRef = useRef(false);

      const performSave = useCallback(() => {
        if (!isDirtyRef.current) return;
        isDirtyRef.current = false;

        const doc = editor.document;
        const editorJsData = blockNoteToEditorJs(doc);
        onSaveRef.current?.(editorJsData);
      }, [editor]);

      // Safety-net save on unmount
      useEffect(() => {
        return () => {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          if (isDirtyRef.current) {
            const doc = editor.document;
            const editorJsData = blockNoteToEditorJs(doc);
            onSaveRef.current?.(editorJsData);
          }
        };
      }, [editor]);

      // Editor change handler — debounced save
      const handleEditorChange = useCallback(() => {
        isDirtyRef.current = true;

        // Reset debounce timer
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(performSave, 2000);

        // Notify parent for undo history capture (without data — BlockNote
        // tracks its own state, parent captures on next save)
        onChangeRef.current?.();
      }, [performSave]);

      // ─── Ctrl+S explicit save ───────────────────────────────────────
      useEffect(() => {
        const handler = (e: KeyboardEvent) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            isDirtyRef.current = false;
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

            const doc = editor.document;
            const editorJsData = blockNoteToEditorJs(doc);
            onExplicitSaveRef.current?.(editorJsData);
          }
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
      }, [editor]);

      // ─── Click handler for wiki-links and block-refs ────────────────
      useEffect(() => {
        const handler = (e: MouseEvent) => {
          const target = e.target as HTMLElement;

          // Wiki-link click
          const wikiLink = target.closest(".bn-wiki-link");
          if (wikiLink) {
            e.preventDefault();
            const pageTitle = wikiLink.getAttribute("data-page-title");
            if (pageTitle) onLinkClickRef.current?.(pageTitle);
            return;
          }

          // Block-ref click
          const blockRef = target.closest(".bn-block-ref");
          if (blockRef) {
            e.preventDefault();
            const blockId = blockRef.getAttribute("data-block-id") ?? "";
            const refPageId = blockRef.getAttribute("data-page-id") ?? "";
            if (blockId) onBlockRefClickRef.current?.(blockId, refPageId);
          }
        };

        document.addEventListener("click", handler);
        return () => document.removeEventListener("click", handler);
      }, []);

      // ─── Imperative handle for parent (undo/redo, collab) ──────────
      useImperativeHandle(
        ref,
        () => ({
          render: (data: EditorData) => {
            // Convert and replace editor content (for undo/redo and remote changes)
            try {
              const bnDoc = editorJsToBlockNote(data);
              editor.replaceBlocks(editor.document, bnDoc);
            } catch (e) {
              console.error("Failed to render EditorJS data in BlockNote:", e);
            }
          },
          save: async () => {
            isDirtyRef.current = false;
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            const doc = editor.document;
            return blockNoteToEditorJs(doc);
          },
        }),
        [editor],
      );

      // ─── Header collapse ────────────────────────────────────────────
      const wrapperRef = useRef<HTMLDivElement>(null);
      useBlockNoteHeaderCollapse({
        containerRef: wrapperRef,
        enabled: !readOnly,
      });

      // ─── Checklist sort (checked items to bottom of run) ───────────
      useChecklistSort(editor);

      // ─── Block attribution (collab hover tooltips) ─────────────────
      const provider = pageId ? getCollabProvider(pageId) : null;
      useBlockAttribution({
        containerRef: wrapperRef,
        provider,
        enabled: !!collaboration && !!provider,
      });

      // Track attribution when blocks are edited during collab
      const providerRef = useRef(provider);
      providerRef.current = provider;
      useEffect(() => {
        if (!collaboration || !providerRef.current) return;
        const p = providerRef.current;
        // Listen to local Yjs doc changes to track attribution
        const handleYjsUpdate = (_update: Uint8Array, origin: unknown) => {
          // Only track local changes (origin is the provider for remote changes)
          if (origin === p.provider) return;
          // Get cursor block from editor
          const cursor = editor.getTextCursorPosition();
          if (cursor?.block?.id) {
            p.setBlockAttribution(cursor.block.id, { name: "Owner", color: "#3b82f6" });
          }
        };
        p.doc.on("update", handleYjsUpdate);
        return () => { p.doc.off("update", handleYjsUpdate); };
      }, [collaboration, editor]);

      // ─── Plugin block types for slash menu ─────────────────────────
      const pluginBlockTypes = usePluginStore((s) => s.blockTypes);
      const fetchBlockTypes = usePluginStore((s) => s.fetchBlockTypes);

      useEffect(() => {
        fetchBlockTypes();
      }, [fetchBlockTypes]);

      // ─── Slash menu with multi-column items + plugin blocks ───────
      const getSlashMenuItems = useMemo(() => {
        const pluginItems: DefaultReactSuggestionItem[] = pluginBlockTypes.map(
          (bt) => ({
            title: bt.label,
            onItemClick: () => {
              editor.insertBlocks(
                [
                  {
                    type: "plugin" as const,
                    props: {
                      pluginId: bt.pluginId,
                      blockType: bt.blockType,
                      dataJson: "{}",
                    },
                  },
                ],
                editor.getTextCursorPosition().block,
                "after",
              );
            },
            aliases: [bt.blockType],
            group: "Plugins",
          }),
        );

        return async (query: string) =>
          filterItems(
            combineByGroup(
              getDefaultReactSlashMenuItems(editor),
              getMultiColumnSlashMenuItems(editor),
              pluginItems,
            ),
            query,
          );
      }, [editor, pluginBlockTypes]);

      // ─── Vim mode indicator state ──────────────────────────────────
      const vimMode = useVimStore((s) => s.mode);
      const vimPendingKeys = useVimStore((s) => s.pendingKeys);
      const isVimEnabled = editorKeymap === "vim" && !readOnly;

      return (
        <div
          ref={wrapperRef}
          className={`bn-editor-wrapper ${className}`}
          data-page-id={pageId}
        >
          <BlockNoteView
            editor={editor}
            editable={!readOnly}
            onChange={handleEditorChange}
            slashMenu={false}
            theme={resolvedMode === "dark" ? "dark" : "light"}
          >
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={getSlashMenuItems}
            />
          </BlockNoteView>
          {isVimEnabled && (
            <div className="pointer-events-none fixed bottom-16 left-4 z-50">
              <VimModeIndicator
                mode={vimMode}
                pendingKeys={vimPendingKeys}
              />
            </div>
          )}
        </div>
      );
    },
  ),
);
