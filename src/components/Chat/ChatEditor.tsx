import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import "katex/dist/katex.min.css";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Page, EditorData } from "../../types/page";
import type { StreamEvent, ChatMessage, AIAction, CreateNotebookArgs, CreatePageArgs } from "../../types/ai";
import {
  type ChatCell,
  type ChatPageContent,
  type ChatSettings,
  createChatCell,
  createBranch,
  createDefaultChatContent,
  buildConversationHistory,
  getCellsForBranch,
} from "../../types/chat";
import * as api from "../../utils/api";
import {
  createNotebook as apiCreateNotebook,
  createPage as apiCreatePage,
  updatePage as apiUpdatePage,
  runBrowserTask,
} from "../../utils/api";
import { useAIStore } from "../../stores/aiStore";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { OutputRenderer, apiOutputToJupyterOutput } from "../shared/OutputRenderer";
import { useThemeStore } from "../../stores/themeStore";
import type { JupyterCellOutput } from "../../utils/api";

// Track created items to show in UI
interface CreatedItem {
  type: "notebook" | "page" | "action" | "info" | "browser";
  name: string;
  notebookName?: string;
  browserResult?: string;
}

interface ChatEditorProps {
  page: Page;
  notebookId: string;
  className?: string;
}

export function ChatEditor({ page, notebookId, className = "" }: ChatEditorProps) {
  const [content, setContent] = useState<ChatPageContent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [runningCellId, setRunningCellId] = useState<string | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set());
  const [collapsedCells, setCollapsedCells] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showBranchSelector, setShowBranchSelector] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const branchSelectorRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [createdItems, setCreatedItems] = useState<CreatedItem[]>([]);
  const [pythonAvailable, setPythonAvailable] = useState<boolean | null>(null);
  const [executingBlocks, setExecutingBlocks] = useState<Set<string>>(new Set());
  const resolvedMode = useThemeStore((state) => state.resolvedMode);
  const isDark = resolvedMode === "dark";

  const { settings, getActiveProviderType, getActiveApiKey, getActiveModel, getProviderForModel, getProviderConfig } = useAIStore();
  const { notebooks, selectedNotebookId, loadNotebooks } = useNotebookStore();
  const { loadPages } = usePageStore();
  const currentNotebook = notebooks.find((n) => n.id === selectedNotebookId);

  // Load chat content
  useEffect(() => {
    const loadContent = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await api.getFileContent(notebookId, page.id);
        if (result.content) {
          const parsed = JSON.parse(result.content) as ChatPageContent;
          setContent(parsed);
        } else {
          // Create default content for new chat page
          setContent(createDefaultChatContent());
        }
      } catch (err) {
        // If file doesn't exist or is empty, create default content
        if (String(err).includes("not found") || String(err).includes("empty")) {
          setContent(createDefaultChatContent());
        } else {
          setError(err instanceof Error ? err.message : "Failed to load content");
          console.error("Failed to load chat content:", err);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadContent();
  }, [notebookId, page.id]);

  // Check Python availability
  useEffect(() => {
    api.checkPythonExecutionAvailable()
      .then((info) => setPythonAvailable(info.available))
      .catch(() => setPythonAvailable(false));
  }, []);

  // Auto-save with debounce
  const saveContent = useCallback(
    async (newContent: ChatPageContent) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        setIsSaving(true);
        try {
          await api.updateFileContent(notebookId, page.id, JSON.stringify(newContent, null, 2));
          setLastSaved(new Date());
        } catch (err) {
          console.error("Failed to save chat:", err);
        } finally {
          setIsSaving(false);
        }
      }, 1000);
    },
    [notebookId, page.id]
  );

  // Update content and trigger save
  const updateContent = useCallback(
    (updater: (prev: ChatPageContent) => ChatPageContent) => {
      setContent((prev) => {
        if (!prev) return prev;
        const updated = updater(prev);
        saveContent(updated);
        return updated;
      });
    },
    [saveContent]
  );

  // Update a specific cell
  const updateCell = useCallback(
    (cellId: string, updates: Partial<ChatCell>) => {
      updateContent((prev) => ({
        ...prev,
        cells: prev.cells.map((cell) =>
          cell.id === cellId ? { ...cell, ...updates, updatedAt: new Date().toISOString() } : cell
        ),
      }));
    },
    [updateContent]
  );

  // Add a new cell (in current branch)
  const addCell = useCallback(
    (type: "prompt" | "markdown", afterCellId?: string) => {
      if (!content) return "";
      const currentBranch = content.currentBranch || "main";
      const newCell = createChatCell(type, "", currentBranch);
      updateContent((prev) => {
        const idx = afterCellId ? prev.cells.findIndex((c) => c.id === afterCellId) : prev.cells.length - 1;
        const newCells = [...prev.cells];
        newCells.splice(idx + 1, 0, newCell);
        return { ...prev, cells: newCells };
      });
      return newCell.id;
    },
    [content, updateContent]
  );

  // Delete a cell
  const deleteCell = useCallback(
    (cellId: string) => {
      updateContent((prev) => ({
        ...prev,
        cells: prev.cells.filter((c) => c.id !== cellId),
      }));
    },
    [updateContent]
  );

  // Move cell up or down
  const moveCell = useCallback(
    (cellId: string, direction: "up" | "down") => {
      updateContent((prev) => {
        const idx = prev.cells.findIndex((c) => c.id === cellId);
        if (idx === -1) return prev;
        if (direction === "up" && idx === 0) return prev;
        if (direction === "down" && idx === prev.cells.length - 1) return prev;

        const newCells = [...prev.cells];
        const swapIdx = direction === "up" ? idx - 1 : idx + 1;
        [newCells[idx], newCells[swapIdx]] = [newCells[swapIdx], newCells[idx]];
        return { ...prev, cells: newCells };
      });
    },
    [updateContent]
  );

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [content?.cells.length, runningCellId]);

  // Template variables definition
  const templateVariables = [
    { name: "date", description: "Current date", example: "January 23, 2026" },
    { name: "time", description: "Current time", example: "3:45 PM" },
    { name: "datetime", description: "Date and time", example: "1/23/2026, 3:45:00 PM" },
    { name: "page_title", description: "This page's title", example: page.title },
    { name: "selection", description: "Selected text", example: "(selected text)" },
  ];

  // Process template variables in text
  const processTemplateVariables = useCallback(
    (text: string): string => {
      const now = new Date();
      const selection = window.getSelection()?.toString() || "";

      return text
        .replace(/\{\{date\}\}/gi, now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }))
        .replace(/\{\{time\}\}/gi, now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }))
        .replace(/\{\{datetime\}\}/gi, now.toLocaleString())
        .replace(/\{\{page_title\}\}/gi, page.title)
        .replace(/\{\{selection\}\}/gi, selection);
    },
    [page.title]
  );

  // Execute AI actions (create notebooks/pages)
  const executeActions = useCallback(async (actions: AIAction[]): Promise<CreatedItem[]> => {
    const created: CreatedItem[] = [];
    let needsNotebookRefresh = false;
    let notebooksSnapshot = [...notebooks];

    for (const action of actions) {
      try {
        if (action.tool === "create_notebook") {
          const args = action.arguments as unknown as CreateNotebookArgs;
          const newNotebook = await apiCreateNotebook(args.name);
          notebooksSnapshot.push(newNotebook);
          needsNotebookRefresh = true;
          created.push({ type: "notebook", name: args.name });
        } else if (action.tool === "run_action") {
          const args = action.arguments as unknown as { action_name: string; variables?: Record<string, string> };
          try {
            const result = await api.runActionByName(args.action_name, {
              variables: args.variables,
              currentNotebookId: selectedNotebookId || undefined,
            });
            created.push({
              type: "action",
              name: args.action_name,
              notebookName: `${result.stepsCompleted} steps completed`,
            });
            if (selectedNotebookId) {
              await loadPages(selectedNotebookId);
            }
          } catch (error) {
            console.error(`Failed to run action ${args.action_name}:`, error);
          }
        } else if (action.tool === "list_actions") {
          created.push({
            type: "info",
            name: "Listed available actions",
          });
        } else if (action.tool === "browse_web") {
          const args = action.arguments as unknown as { task: string; capture_screenshot?: boolean };
          try {
            const activeApiKey = getActiveApiKey();
            if (!activeApiKey) {
              created.push({
                type: "browser",
                name: "Browser task",
                browserResult: "Error: No API key configured for AI provider",
              });
              continue;
            }
            const result = await runBrowserTask(
              args.task,
              getActiveProviderType(),
              activeApiKey,
              getActiveModel(),
              args.capture_screenshot ?? false
            );
            if (result.success) {
              created.push({
                type: "browser",
                name: "Browser task completed",
                browserResult: result.content,
              });
            } else {
              created.push({
                type: "browser",
                name: "Browser task failed",
                browserResult: result.error || "Unknown error",
              });
            }
          } catch (error) {
            console.error("Browser automation error:", error);
            created.push({
              type: "browser",
              name: "Browser task error",
              browserResult: String(error),
            });
          }
        } else if (action.tool === "create_page") {
          const args = action.arguments as unknown as CreatePageArgs;

          let targetNotebookId = selectedNotebookId;
          let targetNotebookName = currentNotebook?.name || "current notebook";

          if (args.notebook_name !== "current") {
            const targetNotebook = notebooksSnapshot.find(
              (n) => n.name.toLowerCase() === args.notebook_name.toLowerCase()
            );
            if (targetNotebook) {
              targetNotebookId = targetNotebook.id;
              targetNotebookName = targetNotebook.name;
            } else {
              const newNotebook = await apiCreateNotebook(args.notebook_name);
              notebooksSnapshot.push(newNotebook);
              needsNotebookRefresh = true;
              targetNotebookId = newNotebook.id;
              targetNotebookName = newNotebook.name;
              created.push({ type: "notebook", name: args.notebook_name });
            }
          }

          if (!targetNotebookId) {
            console.error("No target notebook found for page creation");
            continue;
          }

          const newPage = await apiCreatePage(targetNotebookId, args.title);

          const editorData: EditorData = {
            time: Date.now(),
            version: "2.28.2",
            blocks: args.content_blocks.map((block) => ({
              id: crypto.randomUUID(),
              type: block.type,
              data: block.data as Record<string, unknown>,
            })),
          };

          const updates: { content: EditorData; tags?: string[] } = { content: editorData };
          if (args.tags && args.tags.length > 0) {
            updates.tags = args.tags;
          }
          await apiUpdatePage(targetNotebookId, newPage.id, updates);

          created.push({
            type: "page",
            name: args.title,
            notebookName: targetNotebookName,
          });
        }
      } catch (error) {
        console.error(`Failed to execute action ${action.tool}:`, error);
      }
    }

    if (needsNotebookRefresh) {
      await loadNotebooks();
    }
    if (selectedNotebookId && created.some(c => c.type === "page")) {
      await loadPages(selectedNotebookId);
    }

    return created;
  }, [selectedNotebookId, currentNotebook, notebooks, loadNotebooks, loadPages, getActiveApiKey, getActiveProviderType, getActiveModel]);

  // Execute a prompt cell
  const executePrompt = useCallback(
    async (promptCellId: string) => {
      if (!content || runningCellId) return;

      const promptCell = content.cells.find((c) => c.id === promptCellId);
      if (!promptCell || promptCell.type !== "prompt" || !promptCell.content.trim()) return;

      const promptIndex = content.cells.findIndex((c) => c.id === promptCellId);

      // Create or find existing response cell
      let responseCellId: string;
      const existingResponseIndex = content.cells.findIndex(
        (c, i) => i > promptIndex && c.type === "response" && c.parentPromptId === promptCellId
      );

      if (existingResponseIndex !== -1) {
        responseCellId = content.cells[existingResponseIndex].id;
        // Reset existing response cell
        updateCell(responseCellId, {
          content: "",
          status: "running",
          error: undefined,
          thinking: undefined,
          stats: undefined,
          codeOutputs: undefined,
          codeEdits: undefined,
        });
      } else {
        // Create new response cell in same branch as prompt
        const promptBranch = promptCell.branchId || "main";
        const responseCell = createChatCell("response", "", promptBranch);
        responseCell.parentPromptId = promptCellId;
        responseCell.status = "running";
        responseCellId = responseCell.id;

        updateContent((prev) => {
          const newCells = [...prev.cells];
          newCells.splice(promptIndex + 1, 0, responseCell);
          return { ...prev, cells: newCells };
        });
      }

      // Update prompt cell status
      updateCell(promptCellId, { status: "running" });
      setRunningCellId(responseCellId);

      const startTime = Date.now();
      let accumulatedContent = "";
      let accumulatedThinking = "";
      let responseModel = "";
      let tokensUsed = 0;
      let unlisten: UnlistenFn | null = null;
      const pendingActions: AIAction[] = [];

      try {
        // Set up event listener for streaming
        unlisten = await listen<StreamEvent>("ai-stream", (event) => {
          const data = event.payload;

          switch (data.type) {
            case "chunk":
              accumulatedContent += data.content;
              updateCell(responseCellId, { content: accumulatedContent });
              break;

            case "thinking":
              accumulatedThinking += data.content;
              updateCell(responseCellId, { thinking: accumulatedThinking });
              break;

            case "action":
              // Collect actions to execute after stream completes
              pendingActions.push({
                tool: data.tool,
                arguments: data.arguments,
                toolCallId: data.toolCallId,
              });
              break;

            case "done":
              responseModel = data.model;
              tokensUsed = data.tokensUsed;
              break;

            case "error":
              console.error("Stream error:", data.message);
              updateCell(responseCellId, {
                content: `Error: ${data.message}`,
                status: "error",
                error: data.message,
              });
              break;
          }
        });

        // Build conversation history using visible cells for current branch
        const branchCells = getCellsForBranch(
          content.cells,
          content.branches || [],
          content.currentBranch || "main"
        );
        const history = buildConversationHistory(
          branchCells,
          promptCellId,
          content.settings.maxContextCells
        );

        // Get model configuration
        const model = promptCell.model || content.settings.defaultModel || settings.defaultModel;
        const systemPrompt =
          promptCell.systemPrompt || content.settings.defaultSystemPrompt || currentNotebook?.systemPrompt;

        // Resolve the correct provider for the selected model
        const resolvedProvider = model ? getProviderForModel(model) : getActiveProviderType();
        const resolvedProviderConfig = getProviderConfig(resolvedProvider);

        // Process template variables in the prompt
        const processedPrompt = processTemplateVariables(promptCell.content);

        // Make API call
        await api.aiChatStream(processedPrompt, {
          conversationHistory: history as ChatMessage[],
          providerType: resolvedProvider,
          apiKey: resolvedProviderConfig?.apiKey || undefined,
          model: model || undefined,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          systemPrompt: systemPrompt,
        });

        // Execute any pending actions (create pages, notebooks, etc.)
        if (pendingActions.length > 0) {
          const created = await executeActions(pendingActions);
          setCreatedItems(created);
        }

        const elapsedMs = Date.now() - startTime;
        const tokensPerSecond =
          tokensUsed && elapsedMs > 0 ? Math.round((tokensUsed / elapsedMs) * 1000) : undefined;

        // Update cells with final status
        updateCell(promptCellId, { status: "complete" });
        updateCell(responseCellId, {
          content: accumulatedContent,
          status: "complete",
          thinking: accumulatedThinking || undefined,
          stats: {
            elapsedMs,
            tokensUsed: tokensUsed || undefined,
            tokensPerSecond,
            model: responseModel || model || "unknown",
          },
        });
      } catch (error) {
        console.error("AI chat error:", error);
        updateCell(promptCellId, { status: "error", error: String(error) });
        updateCell(responseCellId, {
          status: "error",
          error: error instanceof Error ? error.message : "Failed to get response",
        });
      } finally {
        if (unlisten) {
          unlisten();
        }
        setRunningCellId(null);
      }
    },
    [
      content,
      runningCellId,
      updateCell,
      updateContent,
      settings,
      currentNotebook,
      getActiveProviderType,
      getProviderForModel,
      getProviderConfig,
      processTemplateVariables,
      executeActions,
    ]
  );

  // Execute a code block within a response cell
  const executeCodeBlock = useCallback(
    async (cellId: string, blockIndex: number, code: string) => {
      const key = `${cellId}:${blockIndex}`;
      setExecutingBlocks((prev) => new Set(prev).add(key));

      try {
        const result: JupyterCellOutput = await api.executeJupyterCell(code, blockIndex);
        updateCell(cellId, {
          codeOutputs: {
            ...(content?.cells.find((c) => c.id === cellId)?.codeOutputs || {}),
            [String(blockIndex)]: result,
          },
        });
      } catch (err) {
        updateCell(cellId, {
          codeOutputs: {
            ...(content?.cells.find((c) => c.id === cellId)?.codeOutputs || {}),
            [String(blockIndex)]: {
              success: false,
              outputs: [
                {
                  outputType: "error" as const,
                  ename: "ExecutionError",
                  evalue: err instanceof Error ? err.message : "Unknown error",
                  traceback: [],
                },
              ],
              executionCount: null,
            },
          },
        });
      } finally {
        setExecutingBlocks((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [content, updateCell]
  );

  // Update code edit for a specific block in a cell
  const updateCodeEdit = useCallback(
    (cellId: string, blockIndex: string, code: string) => {
      const cell = content?.cells.find((c) => c.id === cellId);
      if (!cell) return;
      const originalEdits = cell.codeEdits || {};
      updateCell(cellId, {
        codeEdits: {
          ...originalEdits,
          [blockIndex]: code,
        },
      });
    },
    [content, updateCell]
  );

  // Toggle thinking expansion
  const toggleThinking = (cellId: string) => {
    setExpandedThinking((prev) => {
      const next = new Set(prev);
      if (next.has(cellId)) {
        next.delete(cellId);
      } else {
        next.add(cellId);
      }
      return next;
    });
  };

  // Toggle cell collapse
  const toggleCollapse = (cellId: string) => {
    setCollapsedCells((prev) => {
      const next = new Set(prev);
      if (next.has(cellId)) {
        next.delete(cellId);
      } else {
        next.add(cellId);
      }
      return next;
    });
  };

  // Get visible cells for current branch
  const visibleCells = useMemo(() => {
    if (!content) return [];
    return getCellsForBranch(content.cells, content.branches || [], content.currentBranch || "main");
  }, [content]);

  // Collapse all visible cells
  const collapseAll = useCallback(() => {
    if (visibleCells.length > 0) {
      setCollapsedCells(new Set(visibleCells.map((c) => c.id)));
    }
  }, [visibleCells]);

  // Expand all cells
  const expandAll = useCallback(() => {
    setCollapsedCells(new Set());
  }, []);

  // Switch to a different branch
  const switchBranch = useCallback(
    (branchId: string) => {
      updateContent((prev) => ({
        ...prev,
        currentBranch: branchId,
      }));
    },
    [updateContent]
  );

  // Create a new branch from a cell
  const createBranchFromCell = useCallback(
    (cellId: string, branchName?: string) => {
      if (!content) return;

      const cell = content.cells.find((c) => c.id === cellId);
      if (!cell || cell.type !== "prompt") return;

      const currentBranch = content.currentBranch || "main";
      const branchCount = content.branches?.length || 0;
      const name = branchName || `Branch ${branchCount + 1}`;

      const newBranch = createBranch(name, currentBranch, cellId);

      // Create a copy of the prompt cell for the new branch
      const newPromptCell = createChatCell("prompt", cell.content, newBranch.id);

      updateContent((prev) => ({
        ...prev,
        branches: [...(prev.branches || []), newBranch],
        cells: [...prev.cells, newPromptCell],
        currentBranch: newBranch.id,
      }));
    },
    [content, updateContent]
  );

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handle drag end for cell reordering
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id && content) {
        const oldIndex = content.cells.findIndex((c) => c.id === active.id);
        const newIndex = content.cells.findIndex((c) => c.id === over.id);

        if (oldIndex !== -1 && newIndex !== -1) {
          updateContent((prev) => ({
            ...prev,
            cells: arrayMove(prev.cells, oldIndex, newIndex),
          }));
        }
      }
    },
    [content, updateContent]
  );

  // Convert chat content to markdown
  const chatToMarkdown = useCallback((): string => {
    if (!content) return "";

    const lines: string[] = [];
    lines.push(`# ${page.title}`);
    lines.push("");
    lines.push(`*Exported from AI Chat on ${new Date().toLocaleString()}*`);
    lines.push("");
    lines.push("---");
    lines.push("");

    for (const cell of content.cells) {
      if (cell.type === "prompt") {
        lines.push("## User");
        lines.push("");
        lines.push(cell.content);
        lines.push("");
      } else if (cell.type === "response") {
        lines.push("## Assistant");
        if (cell.stats?.model) {
          lines.push(`*Model: ${cell.stats.model}*`);
        }
        lines.push("");
        lines.push(cell.content);
        lines.push("");
      } else if (cell.type === "markdown") {
        lines.push(cell.content);
        lines.push("");
      }
    }

    return lines.join("\n");
  }, [content, page.title]);

  // Export to markdown file
  const exportToMarkdown = useCallback(async () => {
    const markdown = chatToMarkdown();
    const defaultName = `${page.title.replace(/[^a-zA-Z0-9]/g, "_")}.md`;

    try {
      const filePath = await save({
        defaultPath: defaultName,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });

      if (filePath) {
        await writeTextFile(filePath, markdown);
      }
    } catch (err) {
      console.error("Failed to export chat:", err);
    }

    setShowExportMenu(false);
  }, [chatToMarkdown, page.title]);

  // Copy to clipboard as markdown
  const copyAsMarkdown = useCallback(async () => {
    const markdown = chatToMarkdown();
    await navigator.clipboard.writeText(markdown);
    setShowExportMenu(false);
  }, [chatToMarkdown]);

  // Update settings
  const updateSettings = useCallback(
    (updates: Partial<ChatSettings>) => {
      updateContent((prev) => ({
        ...prev,
        settings: { ...prev.settings, ...updates },
      }));
    },
    [updateContent]
  );

  // Close export menu on click outside
  useEffect(() => {
    if (!showExportMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showExportMenu]);

  // Close branch selector on click outside
  useEffect(() => {
    if (!showBranchSelector) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (branchSelectorRef.current && !branchSelectorRef.current.contains(e.target as Node)) {
        setShowBranchSelector(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showBranchSelector]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-64 ${className}`}>
        <div className="text-center">
          <div
            className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto mb-2"
            style={{ borderColor: "var(--color-accent)" }}
          />
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            Loading chat...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-64 ${className}`}>
        <div className="text-center" style={{ color: "var(--color-error)" }}>
          <p className="font-medium">Failed to load content</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!content) return null;

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
        }}
      >
        <div className="flex items-center space-x-4">
          <span
            className="text-xs font-medium uppercase tracking-wide"
            style={{ color: "var(--color-text-muted)" }}
          >
            AI Chat
          </span>
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {visibleCells.length} cell{visibleCells.length !== 1 ? "s" : ""}
          </span>
          {/* Branch selector */}
          {(content.branches?.length || 0) > 0 && (
            <div className="relative" ref={branchSelectorRef}>
              <button
                onClick={() => setShowBranchSelector(!showBranchSelector)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-colors hover:bg-[--color-bg-tertiary] ${showBranchSelector ? "bg-[--color-bg-tertiary]" : ""}`}
                style={{ color: "var(--color-text-secondary)" }}
              >
                <IconBranch />
                <span className="font-medium">
                  {content.currentBranch === "main"
                    ? "main"
                    : content.branches?.find((b) => b.id === content.currentBranch)?.name || "main"}
                </span>
                <IconChevronDown />
              </button>
              {showBranchSelector && (
                <div
                  className="absolute left-0 top-full mt-1 z-50 rounded-lg border shadow-lg overflow-hidden min-w-[180px]"
                  style={{
                    backgroundColor: "var(--color-bg-secondary)",
                    borderColor: "var(--color-border)",
                  }}
                >
                  <div
                    className="px-3 py-2 border-b text-xs font-medium"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    Switch Branch
                  </div>
                  {/* Main branch */}
                  <button
                    onClick={() => {
                      switchBranch("main");
                      setShowBranchSelector(false);
                    }}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors hover:bg-[--color-bg-tertiary] ${content.currentBranch === "main" ? "bg-[--color-bg-tertiary]" : ""}`}
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    <span className="flex-1">main</span>
                    {content.currentBranch === "main" && (
                      <span style={{ color: "var(--color-accent)" }}>✓</span>
                    )}
                  </button>
                  {/* Other branches */}
                  {content.branches?.map((branch) => (
                    <button
                      key={branch.id}
                      onClick={() => {
                        switchBranch(branch.id);
                        setShowBranchSelector(false);
                      }}
                      className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors hover:bg-[--color-bg-tertiary] ${content.currentBranch === branch.id ? "bg-[--color-bg-tertiary]" : ""}`}
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      <span className="flex-1">{branch.name}</span>
                      {content.currentBranch === branch.id && (
                        <span style={{ color: "var(--color-accent)" }}>✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center space-x-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
          {isSaving && <span className="animate-pulse">Saving...</span>}
          {lastSaved && !isSaving && <span>Saved at {lastSaved.toLocaleTimeString()}</span>}
          <button
            onClick={collapseAll}
            className="p-1.5 rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            title="Collapse all cells"
          >
            <IconCollapseAll />
          </button>
          <button
            onClick={expandAll}
            className="p-1.5 rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            title="Expand all cells"
          >
            <IconExpandAll />
          </button>
          <button
            onClick={() => {
              setShowSearch(!showSearch);
              if (!showSearch) {
                setTimeout(() => searchInputRef.current?.focus(), 0);
              }
            }}
            className={`p-1.5 rounded-lg transition-colors hover:bg-[--color-bg-tertiary] ${showSearch ? "bg-[--color-bg-tertiary]" : ""}`}
            title="Search in chat (Cmd+F)"
          >
            <IconSearch />
          </button>
          {/* Export dropdown */}
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className={`p-1.5 rounded-lg transition-colors hover:bg-[--color-bg-tertiary] ${showExportMenu ? "bg-[--color-bg-tertiary]" : ""}`}
              title="Export chat"
            >
              <IconExport />
            </button>
            {showExportMenu && (
              <div
                className="absolute right-0 top-full mt-1 z-50 rounded-lg border shadow-lg overflow-hidden min-w-[160px]"
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  borderColor: "var(--color-border)",
                }}
              >
                <button
                  onClick={exportToMarkdown}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors hover:bg-[--color-bg-tertiary]"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  <IconDownload />
                  Save as Markdown
                </button>
                <button
                  onClick={copyAsMarkdown}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors hover:bg-[--color-bg-tertiary]"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  <IconCopy />
                  Copy as Markdown
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1.5 rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            title="Chat settings"
          >
            <IconSettings />
          </button>
        </div>
      </div>

      {/* Search bar */}
      {showSearch && (
        <SearchBar
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onClose={() => {
            setShowSearch(false);
            setSearchQuery("");
          }}
          matchCount={
            searchQuery.trim()
              ? content.cells.filter((c) =>
                  c.content.toLowerCase().includes(searchQuery.toLowerCase())
                ).length
              : 0
          }
          inputRef={searchInputRef}
        />
      )}

      {/* Settings panel */}
      {showSettings && (
        <ChatSettingsPanel
          settings={content.settings}
          onUpdate={updateSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Created Items Notification */}
      {createdItems.length > 0 && (
        <div
          className="mx-4 mt-4 rounded-lg border p-3"
          style={{
            backgroundColor: "rgba(34, 197, 94, 0.1)",
            borderColor: "var(--color-success, #22c55e)",
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span style={{ color: "var(--color-success, #22c55e)" }}>Created {createdItems.length} item{createdItems.length !== 1 ? "s" : ""}</span>
              <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                {createdItems.map((item, i) => (
                  <span key={i}>
                    {i > 0 && ", "}
                    {item.type === "page" ? `Page: ${item.name}` :
                     item.type === "notebook" ? `Notebook: ${item.name}` :
                     item.type === "action" ? `Action: ${item.name}` : item.name}
                  </span>
                ))}
              </span>
            </div>
            <button
              onClick={() => setCreatedItems([])}
              className="p-1 rounded hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-text-muted)" }}
            >
              <IconX />
            </button>
          </div>
        </div>
      )}

      {/* Cells */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={visibleCells.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            {visibleCells.map((cell, index) => (
              <SortableCellRenderer
                key={cell.id}
                cell={cell}
                index={index}
                isRunning={runningCellId === cell.id}
                isExpanded={expandedThinking.has(cell.id)}
                isCollapsed={collapsedCells.has(cell.id)}
                searchQuery={searchQuery}
                templateVariables={cell.type === "prompt" ? templateVariables : undefined}
                pythonAvailable={pythonAvailable}
                executingBlocks={executingBlocks}
                isDark={isDark}
                onUpdateContent={(newContent) => updateCell(cell.id, { content: newContent })}
                onExecute={() => executePrompt(cell.id)}
                onRegenerate={
                  cell.type === "response" && cell.parentPromptId
                    ? () => executePrompt(cell.parentPromptId!)
                    : undefined
                }
                onBranch={cell.type === "prompt" ? () => createBranchFromCell(cell.id) : undefined}
                onDelete={() => deleteCell(cell.id)}
                onMoveUp={() => moveCell(cell.id, "up")}
                onMoveDown={() => moveCell(cell.id, "down")}
                onToggleThinking={() => toggleThinking(cell.id)}
                onToggleCollapse={() => toggleCollapse(cell.id)}
                onAddCellAfter={(type) => addCell(type, cell.id)}
                onExecuteCodeBlock={executeCodeBlock}
                onUpdateCodeEdit={updateCodeEdit}
                canMoveUp={index > 0}
                canMoveDown={index < visibleCells.length - 1}
                canDelete={visibleCells.length > 1}
              />
            ))}
          </SortableContext>
        </DndContext>
        <div ref={messagesEndRef} />

        {/* Add cell button */}
        <div className="flex justify-center pt-2">
          <AddCellButton onAdd={addCell} />
        </div>
      </div>
    </div>
  );
}

// Template variable type
interface TemplateVariable {
  name: string;
  description: string;
  example: string;
}

// Sortable cell wrapper
interface SortableCellRendererProps {
  cell: ChatCell;
  index: number;
  isRunning: boolean;
  isExpanded: boolean;
  isCollapsed: boolean;
  searchQuery: string;
  templateVariables?: TemplateVariable[];
  pythonAvailable: boolean | null;
  executingBlocks: Set<string>;
  isDark: boolean;
  onUpdateContent: (content: string) => void;
  onExecute: () => void;
  onRegenerate?: () => void;
  onBranch?: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleThinking: () => void;
  onToggleCollapse: () => void;
  onAddCellAfter: (type: "prompt" | "markdown") => void;
  onExecuteCodeBlock: (cellId: string, blockIndex: number, code: string) => void;
  onUpdateCodeEdit: (cellId: string, blockIndex: string, code: string) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
}

function SortableCellRenderer(props: SortableCellRendererProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.cell.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <CellRenderer
        {...props}
        dragHandleProps={{ attributes, listeners }}
        isDragging={isDragging}
      />
    </div>
  );
}

// Cell renderer component
interface CellRendererProps {
  cell: ChatCell;
  index: number;
  isRunning: boolean;
  isExpanded: boolean;
  isCollapsed: boolean;
  searchQuery: string;
  templateVariables?: TemplateVariable[];
  pythonAvailable: boolean | null;
  executingBlocks: Set<string>;
  isDark: boolean;
  onUpdateContent: (content: string) => void;
  onExecute: () => void;
  onRegenerate?: () => void;
  onBranch?: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleThinking: () => void;
  onToggleCollapse: () => void;
  onAddCellAfter: (type: "prompt" | "markdown") => void;
  onExecuteCodeBlock: (cellId: string, blockIndex: number, code: string) => void;
  onUpdateCodeEdit: (cellId: string, blockIndex: string, code: string) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  dragHandleProps?: {
    attributes: React.HTMLAttributes<HTMLElement>;
    listeners: Record<string, unknown> | undefined;
  };
  isDragging?: boolean;
}

function CellRenderer({
  cell,
  isRunning,
  isExpanded,
  isCollapsed,
  searchQuery,
  templateVariables,
  pythonAvailable,
  executingBlocks,
  isDark,
  onUpdateContent,
  onExecute,
  onRegenerate,
  onBranch,
  onDelete,
  onMoveUp,
  onMoveDown,
  onToggleThinking,
  onToggleCollapse,
  onExecuteCodeBlock,
  onUpdateCodeEdit,
  canMoveUp,
  canMoveDown,
  canDelete,
  dragHandleProps,
}: CellRendererProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showVariablePicker, setShowVariablePicker] = useState(false);
  const variablePickerRef = useRef<HTMLDivElement>(null);
  const codeBlockIndexRef = useRef(0);
  const [editingBlockIndex, setEditingBlockIndex] = useState<number | null>(null);
  const [editingCode, setEditingCode] = useState("");

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [cell.content]);

  // Close variable picker on click outside
  useEffect(() => {
    if (!showVariablePicker) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (variablePickerRef.current && !variablePickerRef.current.contains(e.target as Node)) {
        setShowVariablePicker(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showVariablePicker]);

  // Insert variable at cursor position
  const insertVariable = useCallback(
    (variableName: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = cell.content;
      const variableText = `{{${variableName}}}`;

      const newContent = text.slice(0, start) + variableText + text.slice(end);
      onUpdateContent(newContent);

      // Set cursor position after inserted variable
      setTimeout(() => {
        textarea.focus();
        const newPos = start + variableText.length;
        textarea.setSelectionRange(newPos, newPos);
      }, 0);

      setShowVariablePicker(false);
    },
    [cell.content, onUpdateContent]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (cell.type === "prompt") {
        onExecute();
      }
    }
  };

  // Highlight search matches in text
  const highlightText = (text: string): React.ReactNode => {
    if (!searchQuery.trim()) return text;

    const query = searchQuery.toLowerCase();
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let lowerText = text.toLowerCase();
    let matchIndex = lowerText.indexOf(query);

    while (matchIndex !== -1) {
      // Add text before match
      if (matchIndex > lastIndex) {
        parts.push(text.slice(lastIndex, matchIndex));
      }
      // Add highlighted match
      parts.push(
        <mark
          key={matchIndex}
          className="rounded px-0.5"
          style={{ backgroundColor: "rgba(250, 204, 21, 0.4)" }}
        >
          {text.slice(matchIndex, matchIndex + query.length)}
        </mark>
      );
      lastIndex = matchIndex + query.length;
      matchIndex = lowerText.indexOf(query, lastIndex);
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  };

  const getBorderColor = () => {
    if (cell.type === "prompt") return "var(--color-accent)";
    if (cell.type === "response") return "var(--color-success, #22c55e)";
    return "var(--color-text-muted)";
  };

  const hasSearchMatch =
    searchQuery.trim() && cell.content.toLowerCase().includes(searchQuery.toLowerCase());

  return (
    <div
      className={`rounded-xl border overflow-hidden transition-all ${isRunning ? "opacity-80" : ""}`}
      style={{
        borderColor: hasSearchMatch ? "rgba(250, 204, 21, 0.6)" : "var(--color-border)",
        borderLeftWidth: "3px",
        borderLeftColor: getBorderColor(),
        backgroundColor: hasSearchMatch
          ? "rgba(250, 204, 21, 0.05)"
          : cell.type === "response"
            ? "var(--color-bg-secondary)"
            : "var(--color-bg-primary)",
        boxShadow: hasSearchMatch ? "0 0 0 1px rgba(250, 204, 21, 0.3)" : undefined,
      }}
    >
      {/* Cell header */}
      <div
        className="group/header flex items-center justify-between px-3 py-2 border-b"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-tertiary)",
        }}
      >
        <div className="flex items-center gap-2">
          {/* Drag handle */}
          {dragHandleProps && (
            <span
              {...dragHandleProps.attributes}
              {...(dragHandleProps.listeners as React.HTMLAttributes<HTMLSpanElement>)}
              className="flex h-5 w-4 cursor-grab items-center justify-center rounded opacity-0 group-hover/header:opacity-100 transition-opacity hover:bg-[--color-bg-elevated]"
              style={{ color: "var(--color-text-muted)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <IconGrip />
            </span>
          )}
          <span
            className="text-xs font-medium uppercase"
            style={{ color: cell.type === "prompt" ? "var(--color-accent)" : "var(--color-text-muted)" }}
          >
            {cell.type}
          </span>
          {cell.status === "running" && (
            <span className="flex items-center gap-1 text-xs" style={{ color: "var(--color-accent)" }}>
              <span className="animate-pulse">Running...</span>
            </span>
          )}
          {cell.status === "error" && (
            <span className="text-xs" style={{ color: "var(--color-error)" }}>
              Error
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Cell actions */}
          {cell.type === "prompt" && templateVariables && templateVariables.length > 0 && (
            <div className="relative" ref={variablePickerRef}>
              <button
                onClick={() => setShowVariablePicker(!showVariablePicker)}
                className={`p-1 rounded transition-colors hover:bg-[--color-bg-elevated] ${showVariablePicker ? "bg-[--color-bg-elevated]" : ""}`}
                style={{ color: "var(--color-text-muted)" }}
                title="Insert template variable"
              >
                <IconVariable />
              </button>
              {showVariablePicker && (
                <div
                  className="absolute right-0 top-full mt-1 z-50 rounded-lg border shadow-lg overflow-hidden min-w-[220px]"
                  style={{
                    backgroundColor: "var(--color-bg-secondary)",
                    borderColor: "var(--color-border)",
                  }}
                >
                  <div
                    className="px-3 py-2 border-b text-xs font-medium"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    Insert Variable
                  </div>
                  {templateVariables.map((variable) => (
                    <button
                      key={variable.name}
                      onClick={() => insertVariable(variable.name)}
                      className="flex flex-col w-full px-3 py-2 text-left transition-colors hover:bg-[--color-bg-tertiary]"
                    >
                      <div className="flex items-center gap-2">
                        <code
                          className="text-xs px-1 py-0.5 rounded"
                          style={{
                            backgroundColor: "var(--color-bg-tertiary)",
                            color: "var(--color-accent)",
                          }}
                        >
                          {`{{${variable.name}}}`}
                        </code>
                      </div>
                      <span
                        className="text-xs mt-0.5"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {variable.description} - e.g. "{variable.example}"
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {cell.type === "prompt" && (
            <button
              onClick={onExecute}
              disabled={isRunning || !cell.content.trim()}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors disabled:opacity-50"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
              }}
              title="Run (Shift+Enter)"
            >
              <IconPlay />
              Run
            </button>
          )}
          {cell.type === "prompt" && onBranch && (
            <button
              onClick={onBranch}
              className="p-1 rounded transition-colors hover:bg-[--color-bg-elevated]"
              style={{ color: "var(--color-text-muted)" }}
              title="Create branch from this prompt"
            >
              <IconBranch />
            </button>
          )}
          {cell.type === "response" && cell.thinking && (
            <button
              onClick={onToggleThinking}
              className="p-1 rounded transition-colors hover:bg-[--color-bg-elevated]"
              style={{ color: "var(--color-accent)" }}
              title="Show thinking"
            >
              <IconBrain />
            </button>
          )}
          <button
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="p-1 rounded transition-colors hover:bg-[--color-bg-elevated] disabled:opacity-30"
            style={{ color: "var(--color-text-muted)" }}
            title="Move up"
          >
            <IconChevronUp />
          </button>
          <button
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="p-1 rounded transition-colors hover:bg-[--color-bg-elevated] disabled:opacity-30"
            style={{ color: "var(--color-text-muted)" }}
            title="Move down"
          >
            <IconChevronDown />
          </button>
          <button
            onClick={onToggleCollapse}
            className="p-1 rounded transition-colors hover:bg-[--color-bg-elevated]"
            style={{ color: "var(--color-text-muted)" }}
            title={isCollapsed ? "Expand cell" : "Collapse cell"}
          >
            {isCollapsed ? <IconChevronRight /> : <IconChevronDown2 />}
          </button>
          {canDelete && (
            <button
              onClick={onDelete}
              className="p-1 rounded transition-colors hover:bg-[--color-bg-elevated]"
              style={{ color: "var(--color-text-muted)" }}
              title="Delete cell"
            >
              <IconTrash />
            </button>
          )}
        </div>
      </div>

      {/* Collapsed preview */}
      {isCollapsed ? (
        <div
          className="px-3 py-2 cursor-pointer"
          onClick={onToggleCollapse}
          title="Click to expand"
        >
          <p
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            {highlightText(
              (cell.content.split("\n")[0].slice(0, 100) || "(empty)") +
                (cell.content.length > 100 ? "..." : "")
            )}
          </p>
        </div>
      ) : (
        <>
          {/* Thinking section */}
          {cell.thinking && isExpanded && (
            <div
              className="px-3 py-2 text-xs border-b"
              style={{
                backgroundColor: "rgba(139, 92, 246, 0.05)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-secondary)",
              }}
            >
              <pre className="whitespace-pre-wrap font-mono">{cell.thinking}</pre>
            </div>
          )}

          {/* Cell content */}
          <div className="p-3">
            {cell.type === "response" ? (
              <div className="prose prose-sm max-w-none" style={{ color: "var(--color-text-primary)" }}>
                {isRunning && !cell.content ? (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <div
                        className="h-2 w-2 animate-bounce rounded-full"
                        style={{ backgroundColor: "var(--color-accent)" }}
                      />
                      <div
                        className="h-2 w-2 animate-bounce rounded-full"
                        style={{ backgroundColor: "var(--color-accent)", animationDelay: "0.1s" }}
                      />
                      <div
                        className="h-2 w-2 animate-bounce rounded-full"
                        style={{ backgroundColor: "var(--color-accent)", animationDelay: "0.2s" }}
                      />
                    </div>
                  </div>
                ) : (
                  (() => {
                    // Reset code block index counter before each render
                    codeBlockIndexRef.current = 0;
                    return (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex, rehypeRaw]}
                        components={{
                          h1: ({ children }) => (
                            <h1 className="text-2xl font-bold mt-4 mb-2" style={{ color: "var(--color-text-primary)" }}>{children}</h1>
                          ),
                          h2: ({ children }) => (
                            <h2 className="text-xl font-bold mt-3 mb-2" style={{ color: "var(--color-text-primary)" }}>{children}</h2>
                          ),
                          h3: ({ children }) => (
                            <h3 className="text-lg font-semibold mt-3 mb-1" style={{ color: "var(--color-text-primary)" }}>{children}</h3>
                          ),
                          h4: ({ children }) => (
                            <h4 className="text-base font-semibold mt-2 mb-1" style={{ color: "var(--color-text-primary)" }}>{children}</h4>
                          ),
                          p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                          ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
                          ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>,
                          li: ({ children }) => <li className="ml-2">{children}</li>,
                          a: ({ href, children }) => (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline hover:no-underline"
                              style={{ color: "var(--color-accent)" }}
                            >
                              {children}
                            </a>
                          ),
                          blockquote: ({ children }) => (
                            <blockquote
                              className="border-l-4 pl-4 my-2 italic"
                              style={{
                                borderColor: "var(--color-accent)",
                                color: "var(--color-text-secondary)",
                              }}
                            >
                              {children}
                            </blockquote>
                          ),
                          table: ({ children }) => (
                            <div className="overflow-x-auto my-4">
                              <table className="min-w-full border-collapse" style={{ borderColor: "var(--color-border)" }}>
                                {children}
                              </table>
                            </div>
                          ),
                          thead: ({ children }) => (
                            <thead style={{ backgroundColor: "var(--color-bg-tertiary)" }}>{children}</thead>
                          ),
                          th: ({ children }) => (
                            <th className="border px-3 py-2 text-left font-semibold" style={{ borderColor: "var(--color-border)" }}>
                              {children}
                            </th>
                          ),
                          td: ({ children }) => (
                            <td className="border px-3 py-2" style={{ borderColor: "var(--color-border)" }}>
                              {children}
                            </td>
                          ),
                          hr: () => <hr className="my-4" style={{ borderColor: "var(--color-border)" }} />,
                          img: ({ src, alt }) => (
                            <img src={src} alt={alt || ""} className="max-w-full my-2 rounded" />
                          ),
                          input: ({ checked }) => (
                            <input type="checkbox" checked={checked} disabled className="mr-2" />
                          ),
                          del: ({ children }) => (
                            <del style={{ color: "var(--color-text-muted)" }}>{children}</del>
                          ),
                          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                          pre: ({ children }) => <>{children}</>,
                          code: ({ children, className }) => {
                            const isBlock = className?.includes("language-");
                            if (!isBlock) {
                              return (
                                <code
                                  className="rounded px-1 py-0.5 text-xs font-mono"
                                  style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                                >
                                  {children}
                                </code>
                              );
                            }

                            const lang = className?.replace("language-", "") || "";
                            const isPython = /^(python|py|python3)$/i.test(lang);
                            const blockIndex = codeBlockIndexRef.current++;
                            const blockIndexStr = String(blockIndex);
                            const originalCode = String(children).replace(/\n$/, "");
                            const codeText = cell.codeEdits?.[blockIndexStr] ?? originalCode;
                            const isEdited = cell.codeEdits?.[blockIndexStr] !== undefined;
                            const execKey = `${cell.id}:${blockIndex}`;
                            const isExecuting = executingBlocks.has(execKey);
                            const isEditing = editingBlockIndex === blockIndex;
                            const blockOutput = cell.codeOutputs?.[blockIndexStr] as
                              | JupyterCellOutput
                              | undefined;

                            return (
                              <div className="my-2">
                                <div className="group/codeblock relative">
                                  {isEditing ? (
                                    <textarea
                                      autoFocus
                                      value={editingCode}
                                      onChange={(e) => setEditingCode(e.target.value)}
                                      onBlur={() => {
                                        const trimmed = editingCode;
                                        if (trimmed !== originalCode) {
                                          onUpdateCodeEdit(cell.id, blockIndexStr, trimmed);
                                        } else if (isEdited) {
                                          // Reverted to original — clear the edit
                                          onUpdateCodeEdit(cell.id, blockIndexStr, originalCode);
                                        }
                                        setEditingBlockIndex(null);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Escape") {
                                          (e.target as HTMLTextAreaElement).blur();
                                        }
                                        if (e.key === "Tab") {
                                          e.preventDefault();
                                          const target = e.target as HTMLTextAreaElement;
                                          const start = target.selectionStart;
                                          const end = target.selectionEnd;
                                          const newCode = editingCode.slice(0, start) + "    " + editingCode.slice(end);
                                          setEditingCode(newCode);
                                          setTimeout(() => {
                                            target.selectionStart = target.selectionEnd = start + 4;
                                          }, 0);
                                        }
                                      }}
                                      className="w-full overflow-x-auto rounded-lg p-3 text-xs font-mono outline-none resize-none"
                                      style={{
                                        backgroundColor: "var(--color-bg-tertiary)",
                                        color: "var(--color-text-primary)",
                                        minHeight: "60px",
                                        border: "1px solid var(--color-accent)",
                                      }}
                                      spellCheck={false}
                                    />
                                  ) : (
                                    <pre
                                      className="overflow-x-auto rounded-lg p-3 text-xs"
                                      style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                                    >
                                      <code>{isEdited ? codeText : children}</code>
                                    </pre>
                                  )}
                                  {isEdited && !isEditing && (
                                    <span
                                      className="absolute top-2 left-3 text-xs italic"
                                      style={{ color: "var(--color-text-muted)" }}
                                    >
                                      (edited)
                                    </span>
                                  )}
                                  {!isEditing && cell.status !== "running" && (
                                    <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover/codeblock:opacity-100 transition-all">
                                      <button
                                        onClick={() => {
                                          setEditingBlockIndex(blockIndex);
                                          setEditingCode(codeText);
                                        }}
                                        className="flex items-center gap-1 px-2 py-1 rounded text-xs"
                                        style={{
                                          backgroundColor: "var(--color-bg-elevated)",
                                          color: "var(--color-text-secondary)",
                                        }}
                                        title="Edit code"
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                        </svg>
                                        Edit
                                      </button>
                                      {isPython && pythonAvailable && (
                                        <button
                                          onClick={() => onExecuteCodeBlock(cell.id, blockIndex, codeText)}
                                          disabled={isExecuting}
                                          className="flex items-center gap-1 px-2 py-1 rounded text-xs"
                                          style={{
                                            backgroundColor: isExecuting
                                              ? "var(--color-bg-tertiary)"
                                              : "var(--color-accent)",
                                            color: isExecuting ? "var(--color-text-muted)" : "white",
                                            cursor: isExecuting ? "not-allowed" : "pointer",
                                          }}
                                          title={isExecuting ? "Running..." : "Run code"}
                                        >
                                          {isExecuting ? (
                                            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                            </svg>
                                          ) : (
                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                                              <polygon points="5 3 19 12 5 21 5 3" />
                                            </svg>
                                          )}
                                          {isExecuting ? "Running" : "Run"}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                                {blockOutput && blockOutput.outputs && blockOutput.outputs.length > 0 && (
                                  <div
                                    className="rounded-b-lg border border-t-0 overflow-hidden"
                                    style={{ borderColor: "var(--color-border)" }}
                                  >
                                    {blockOutput.outputs.map((item, i) => (
                                      <OutputRenderer
                                        key={i}
                                        output={apiOutputToJupyterOutput(item)}
                                        isDark={isDark}
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          },
                        }}
                      >
                        {cell.content}
                      </ReactMarkdown>
                    );
                  })()
                )}
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                value={cell.content}
                onChange={(e) => onUpdateContent(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={cell.type === "prompt" ? "Enter your prompt..." : "Enter markdown notes..."}
                className="w-full resize-none bg-transparent outline-none text-sm"
                style={{
                  color: "var(--color-text-primary)",
                  minHeight: "60px",
                }}
              />
            )}
          </div>
        </>
      )}

      {/* Stats footer for response cells */}
      {!isCollapsed && cell.type === "response" && cell.stats && cell.status === "complete" && (
        <div
          className="flex items-center gap-3 px-3 py-2 border-t text-xs"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          <span>{(cell.stats.elapsedMs / 1000).toFixed(1)}s</span>
          {cell.stats.tokensUsed && <span>{cell.stats.tokensUsed} tokens</span>}
          {cell.stats.tokensPerSecond && <span>{cell.stats.tokensPerSecond} tok/s</span>}
          <span
            className="rounded-full px-2 py-0.5"
            style={{ backgroundColor: "var(--color-bg-tertiary)" }}
          >
            {cell.stats.model}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {onRegenerate && (
              <button
                onClick={onRegenerate}
                disabled={isRunning}
                className="p-1 rounded hover:bg-[--color-bg-tertiary] disabled:opacity-50"
                title="Regenerate response"
              >
                <IconRefresh />
              </button>
            )}
            <button
              onClick={() => navigator.clipboard.writeText(cell.content)}
              className="p-1 rounded hover:bg-[--color-bg-tertiary]"
              title="Copy to clipboard"
            >
              <IconCopy />
            </button>
          </div>
        </div>
      )}

      {/* Error footer with retry button */}
      {!isCollapsed && cell.type === "response" && cell.status === "error" && onRegenerate && (
        <div
          className="flex items-center justify-between px-3 py-2 border-t text-xs"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "rgba(239, 68, 68, 0.05)",
          }}
        >
          <span style={{ color: "var(--color-error)" }}>
            {cell.error || "Failed to generate response"}
          </span>
          <button
            onClick={onRegenerate}
            disabled={isRunning}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors disabled:opacity-50 hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <IconRefresh />
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

// Add cell button
interface AddCellButtonProps {
  onAdd: (type: "prompt" | "markdown", afterCellId?: string) => void;
}

function AddCellButton({ onAdd }: AddCellButtonProps) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          color: "var(--color-text-secondary)",
          border: "1px dashed var(--color-border)",
        }}
      >
        <IconPlus />
        Add Cell
      </button>
      {showMenu && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 rounded-lg border shadow-lg overflow-hidden"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          <button
            onClick={() => {
              onAdd("prompt");
              setShowMenu(false);
            }}
            className="flex items-center gap-2 w-full px-4 py-2 text-sm transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-primary)" }}
          >
            <span style={{ color: "var(--color-accent)" }}>Prompt</span>
          </button>
          <button
            onClick={() => {
              onAdd("markdown");
              setShowMenu(false);
            }}
            className="flex items-center gap-2 w-full px-4 py-2 text-sm transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-primary)" }}
          >
            <span style={{ color: "var(--color-text-muted)" }}>Markdown</span>
          </button>
        </div>
      )}
    </div>
  );
}

// Settings panel
interface ChatSettingsPanelProps {
  settings: ChatSettings;
  onUpdate: (updates: Partial<ChatSettings>) => void;
  onClose: () => void;
}

function ChatSettingsPanel({ settings, onUpdate, onClose }: ChatSettingsPanelProps) {
  const { getEnabledModels } = useAIStore();
  const enabledModels = getEnabledModels();

  return (
    <div
      className="border-b px-4 py-3"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-bg-secondary)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
          Chat Settings
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[--color-bg-tertiary]"
          style={{ color: "var(--color-text-muted)" }}
        >
          <IconX />
        </button>
      </div>

      <div className="space-y-3">
        {/* Default model */}
        <div>
          <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>
            Default Model
          </label>
          <select
            value={settings.defaultModel || ""}
            onChange={(e) => onUpdate({ defaultModel: e.target.value || undefined })}
            className="w-full rounded-lg border px-3 py-1.5 text-sm outline-none"
            style={{
              backgroundColor: "var(--color-bg-primary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          >
            <option value="">Use default</option>
            {enabledModels.map(({ provider, model }) => (
              <option key={`${provider}-${model.id}`} value={model.id}>
                {provider}: {model.name}
              </option>
            ))}
          </select>
        </div>

        {/* System prompt */}
        <div>
          <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>
            System Prompt
          </label>
          <textarea
            value={settings.defaultSystemPrompt || ""}
            onChange={(e) => onUpdate({ defaultSystemPrompt: e.target.value || undefined })}
            placeholder="Optional system prompt for all prompts in this chat..."
            rows={2}
            className="w-full rounded-lg border px-3 py-1.5 text-sm outline-none resize-none"
            style={{
              backgroundColor: "var(--color-bg-primary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
        </div>

        {/* Max context cells */}
        <div>
          <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>
            Max Context Cells: {settings.maxContextCells}
          </label>
          <input
            type="range"
            min="1"
            max="20"
            value={settings.maxContextCells}
            onChange={(e) => onUpdate({ maxContextCells: parseInt(e.target.value) })}
            className="w-full"
          />
        </div>
      </div>
    </div>
  );
}

// Search bar component
interface SearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  matchCount: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

function SearchBar({ query, onQueryChange, onClose, matchCount, inputRef }: SearchBarProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 border-b"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-bg-secondary)",
      }}
    >
      <IconSearch />
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search in chat..."
        className="flex-1 bg-transparent text-sm outline-none"
        style={{ color: "var(--color-text-primary)" }}
      />
      {query.trim() && (
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {matchCount} {matchCount === 1 ? "match" : "matches"}
        </span>
      )}
      <button
        onClick={onClose}
        className="p-1 rounded hover:bg-[--color-bg-tertiary]"
        style={{ color: "var(--color-text-muted)" }}
        title="Close search"
      >
        <IconX />
      </button>
    </div>
  );
}

// Icons
function IconExport() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function IconGrip() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="8"
      height="12"
      viewBox="0 0 8 12"
      fill="currentColor"
    >
      <circle cx="2" cy="2" r="1.2" />
      <circle cx="6" cy="2" r="1.2" />
      <circle cx="2" cy="6" r="1.2" />
      <circle cx="6" cy="6" r="1.2" />
      <circle cx="2" cy="10" r="1.2" />
      <circle cx="6" cy="10" r="1.2" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function IconBrain() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  );
}

function IconChevronUp() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function IconChevronDown2() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconCollapseAll() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m7 20 5-5 5 5" />
      <path d="m7 4 5 5 5-5" />
    </svg>
  );
}

function IconExpandAll() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

function IconX() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function IconVariable() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 21s-4-3-4-9 4-9 4-9" />
      <path d="M16 3s4 3 4 9-4 9-4 9" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function IconBranch() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  );
}
