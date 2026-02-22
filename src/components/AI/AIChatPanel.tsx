import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAIStore, AI_PANEL_CONSTRAINTS } from "../../stores/aiStore";
import { usePageStore } from "../../stores/pageStore";
import { useNotebookStore } from "../../stores/notebookStore";
import { useSectionStore } from "../../stores/sectionStore";
import { useRAGStore } from "../../stores/ragStore";
import { useInboxStore } from "../../stores/inboxStore";
import { useChatSessionStore } from "../../stores/chatSessionStore";
import type { SemanticSearchResult } from "../../types/rag";
import type { ChatSession, ChatSessionBranch, SessionMessage, ToolCallRecord } from "../../types/chatSession";
import { useToastStore } from "../../stores/toastStore";
import {
  aiChatStream,
  createNotebook as apiCreateNotebook,
  createPage as apiCreatePage,
  updatePage as apiUpdatePage,
  runBrowserTask,
} from "../../utils/api";
import type { ChatMessage, PageContext, AIAction, CreateNotebookArgs, CreatePageArgs, StreamEvent } from "../../types/ai";
import type { EditorData } from "../../types/page";

interface AIChatPanelProps {
  isOpen?: boolean; // Optional - uses store if not provided
  onClose?: () => void; // Optional - uses store if not provided
  onOpenSettings?: () => void;
}

// Tool call status tracking
type ToolCallStatus = "pending" | "executing" | "success" | "error";

interface DisplayToolCall {
  toolCallId: string;
  tool: string;
  arguments: unknown;
  status: ToolCallStatus;
  result?: string;
  error?: string;
}

// Extended message with optional thinking, stats, and tool calls
interface DisplayMessage {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  stats?: {
    elapsedMs: number;
    tokensUsed?: number;
    tokensPerSecond?: number;
    model?: string;
  };
  toolCalls?: DisplayToolCall[];
}

export function AIChatPanel({ isOpen: isOpenProp, onClose: onCloseProp, onOpenSettings }: AIChatPanelProps) {
  const [input, setInput] = useState("");
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set());
  const [statusText, setStatusText] = useState<string>("");
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
  const [expandedThinking, setExpandedThinking] = useState<Set<number>>(new Set());
  const [isResizing, setIsResizing] = useState<"left" | "top" | "corner" | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [chatModelOverride, setChatModelOverride] = useState<string | null>(null);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [ragContext, setRagContext] = useState<SemanticSearchResult[]>([]);
  const [showRagContext, setShowRagContext] = useState(false);
  const [showSessionList, setShowSessionList] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [showBranchSelector, setShowBranchSelector] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const currentSessionRef = useRef<ChatSession | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isStreamingRef = useRef(false); // Track if we're currently streaming
  const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; panelX: number; panelY: number } | null>(null);

  const {
    settings,
    panel,
    conversation,
    addMessage,
    setLoading,
    clearConversation,
    togglePin,
    closePanel,
    lockContext,
    unlockContext,
    setPanelSize,
    resetPanelSize,
    setPanelPosition,
    resetPanelPosition,
    toggleDetached,
    getEnabledModels,
    getProviderForModel,
    getProviderConfig,
    setPendingPrompt,
    setActiveSessionId,
  } = useAIStore();
  const {
    sessions,
    loadSessions,
    createSession: createChatSession,
    loadSession: loadChatSession,
    saveSession: saveChatSession,
    deleteSession: deleteChatSession,
    renameSession,
  } = useChatSessionStore();
  const { selectedPageId, pages, loadPages, updatePageContent, createPage, createSubpage } = usePageStore();
  const { notebooks, selectedNotebookId, loadNotebooks } = useNotebookStore();
  const { sections } = useSectionStore();
  const { quickCapture } = useInboxStore();
  const {
    isConfigured: ragConfigured,
    settings: ragSettings,
    getContext: getRagContext
  } = useRAGStore();
  const toast = useToastStore();

  // Use props if provided, otherwise use store state
  const isOpen = isOpenProp !== undefined ? isOpenProp : panel.isOpen;
  const handleClose = onCloseProp || closePanel;

  // Sync display messages with conversation messages (but not during streaming)
  useEffect(() => {
    // Skip sync during streaming to avoid resetting our temporary assistant message
    if (isStreamingRef.current) {
      return;
    }
    // Only add messages from store that don't have thinking/stats (they'll be added via handleSubmit)
    const storeMessages = conversation.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));
    // Preserve thinking and stats from display messages
    setDisplayMessages(prev => {
      if (storeMessages.length === 0) return [];
      return storeMessages.map((msg, i) => ({
        ...msg,
        thinking: prev[i]?.thinking,
        stats: prev[i]?.stats,
      }));
    });
  }, [conversation.messages]);

  // Get current page context (or locked context if pinned)
  const currentPage = panel.lockedContext
    ? pages.find((p) => p.id === panel.lockedContext?.pageId)
    : pages.find((p) => p.id === selectedPageId);
  const currentNotebook = panel.lockedContext
    ? notebooks.find((n) => n.id === panel.lockedContext?.notebookId)
    : notebooks.find((n) => n.id === selectedNotebookId);
  // Get current section based on page's sectionId
  const currentSection = currentPage?.sectionId
    ? sections.find((s) => s.id === currentPage.sectionId)
    : undefined;

  // Reset chat model override when notebook changes (so notebook/section/page defaults take effect)
  const effectiveNotebookId = currentNotebook?.id;
  useEffect(() => {
    setChatModelOverride(null);
  }, [effectiveNotebookId]);

  // Validate defaultModel against enabled models — fall back to first enabled if stale
  const enabledModels = getEnabledModels();
  const effectiveDefaultModel = useMemo(() => {
    const isDefaultEnabled = enabledModels.some((m) => m.model.id === settings.defaultModel);
    if (isDefaultEnabled) return settings.defaultModel;
    return enabledModels[0]?.model.id || settings.defaultModel;
  }, [settings.defaultModel, enabledModels]);

  // Handle locking context to current page
  const handleLockContext = useCallback(() => {
    if (currentPage && currentNotebook) {
      lockContext({
        pageId: currentPage.id,
        pageTitle: currentPage.title,
        notebookId: currentNotebook.id,
        notebookName: currentNotebook.name,
      });
    }
  }, [currentPage, currentNotebook, lockContext]);

  // Resize handlers
  const handleResizeStart = useCallback((edge: "left" | "top" | "corner") => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(edge);
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: panel.size.width,
      height: panel.size.height,
    };
  }, [panel.size.width, panel.size.height]);

  // Handle resize mouse move
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeStartRef.current) return;

      const { x: startX, y: startY, width: startWidth, height: startHeight } = resizeStartRef.current;

      let newWidth = startWidth;
      let newHeight = startHeight;

      // Since panel is positioned at bottom-right, dragging left edge increases width
      if (isResizing === "left" || isResizing === "corner") {
        newWidth = startWidth + (startX - e.clientX);
      }
      // Dragging top edge increases height
      if (isResizing === "top" || isResizing === "corner") {
        newHeight = startHeight + (startY - e.clientY);
      }

      setPanelSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      setIsResizing(null);
      resizeStartRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, setPanelSize]);

  // Drag handlers for moving the panel (only when detached)
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // Only allow dragging when detached
    if (!panel.isDetached) return;

    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);

    // Get current position (or calculate from default bottom-right)
    const currentX = panel.position?.x ?? window.innerWidth - panel.size.width - 24;
    const currentY = panel.position?.y ?? window.innerHeight - panel.size.height - 24;

    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panelX: currentX,
      panelY: currentY,
    };
  }, [panel.isDetached, panel.position, panel.size.width, panel.size.height]);

  // Handle drag mouse move
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;

      const { x: startX, y: startY, panelX, panelY } = dragStartRef.current;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      // Calculate new position with bounds checking
      const maxX = window.innerWidth - panel.size.width - 10;
      const maxY = window.innerHeight - panel.size.height - 10;

      const newX = Math.min(Math.max(10, panelX + deltaX), maxX);
      const newY = Math.min(Math.max(10, panelY + deltaY), maxY);

      setPanelPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, panel.size.width, panel.size.height, setPanelPosition]);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!showBranchSelector && !showExportMenu) return;
    const handleClick = () => {
      setShowBranchSelector(false);
      setShowExportMenu(false);
    };
    // Delay to avoid closing on the same click that opened it
    const timer = setTimeout(() => {
      document.addEventListener("click", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClick);
    };
  }, [showBranchSelector, showExportMenu]);

  // Scroll to bottom when messages change or loading state changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages, conversation.isLoading]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Load session list when panel opens
  useEffect(() => {
    if (isOpen) {
      loadSessions();
    }
  }, [isOpen, loadSessions]);

  // Auto-resume active session on panel open
  useEffect(() => {
    if (isOpen && panel.activeSessionId && !currentSessionRef.current && !isStreamingRef.current) {
      loadChatSession(panel.activeSessionId).then((session) => {
        currentSessionRef.current = session;
        // Restore display messages from session
        const restored: DisplayMessage[] = session.messages.map((m) => ({
          role: m.role as DisplayMessage["role"],
          content: m.content,
          thinking: m.thinking,
          stats: m.stats ? {
            elapsedMs: m.stats.elapsedMs,
            tokensUsed: m.stats.tokensUsed,
            tokensPerSecond: m.stats.tokensPerSecond,
            model: m.stats.model,
          } : undefined,
          toolCalls: m.toolCalls?.map(tc => ({
            toolCallId: tc.toolCallId,
            tool: tc.tool,
            arguments: tc.arguments,
            status: (tc.error ? "error" : "success") as ToolCallStatus,
            result: tc.result,
            error: tc.error,
          })),
        }));
        setDisplayMessages(restored);
        // Restore conversation store messages (for history sent to AI)
        const storeMessages: ChatMessage[] = session.messages.map((m) => ({
          role: m.role as ChatMessage["role"],
          content: m.content,
        }));
        // We need to set these without triggering additional effects
        isStreamingRef.current = true;
        storeMessages.forEach((m) => addMessage(m));
        setTimeout(() => { isStreamingRef.current = false; }, 50);
        setShowSessionList(false);
      }).catch((err) => {
        console.warn("Failed to resume session:", err);
        setActiveSessionId(null);
      });
    }
  }, [isOpen, panel.activeSessionId]);

  // Auto-submit pending prompt when panel opens
  useEffect(() => {
    if (isOpen && conversation.pendingPrompt && !conversation.isLoading) {
      const prompt = conversation.pendingPrompt;
      setPendingPrompt(null); // Clear immediately to prevent re-triggering
      setInput(prompt);
      // Trigger submit after a short delay to ensure UI is ready
      setTimeout(() => {
        // Set the input and trigger handleSubmit manually
        const submitBtn = document.querySelector("[data-ai-submit-btn]") as HTMLButtonElement;
        if (submitBtn) {
          submitBtn.click();
        }
      }, 100);
    }
  }, [isOpen, conversation.pendingPrompt, conversation.isLoading, setPendingPrompt]);

  // Extract plain text from Editor.js content
  const extractPlainText = useCallback((content: { blocks: Array<{ type: string; data: Record<string, unknown> }> }): string => {
    return content.blocks
      .map((block) => {
        if (block.type === "paragraph" || block.type === "header") {
          const text = block.data.text as string | undefined;
          return text?.replace(/<[^>]*>/g, "") || "";
        }
        if (block.type === "list") {
          const items = block.data.items as string[] | undefined;
          return items?.map((item) => item.replace(/<[^>]*>/g, "")).join("\n") || "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }, []);

  // Convert inline markdown to HTML for Editor.js
  const convertInlineMarkdown = useCallback((text: string): string => {
    let result = text;

    // Bold: **text** or __text__
    result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    result = result.replace(/__(.+?)__/g, "<b>$1</b>");

    // Italic: *text* or _text_ (but not inside words)
    result = result.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, "<i>$1</i>");
    result = result.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, "<i>$1</i>");

    // Inline code: `code`
    result = result.replace(/`([^`]+?)`/g, "<code>$1</code>");

    // Links: [text](url)
    result = result.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, '<a href="$2">$1</a>');

    // Strikethrough: ~~text~~
    result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");

    return result;
  }, []);

  // Convert markdown text to Editor.js blocks
  const markdownToBlocks = useCallback((markdown: string): Array<{ id: string; type: string; data: Record<string, unknown> }> => {
    const blocks: Array<{ id: string; type: string; data: Record<string, unknown> }> = [];
    const lines = markdown.split("\n");
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Skip empty lines
      if (!line.trim()) {
        i++;
        continue;
      }

      // Headers
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        const level = Math.min(headerMatch[1].length, 6);
        blocks.push({
          id: crypto.randomUUID(),
          type: "header",
          data: { text: convertInlineMarkdown(headerMatch[2]), level },
        });
        i++;
        continue;
      }

      // Unordered list (collect consecutive items)
      if (line.match(/^[-*+]\s+/)) {
        const items: string[] = [];
        while (i < lines.length && lines[i].match(/^[-*+]\s+/)) {
          items.push(convertInlineMarkdown(lines[i].replace(/^[-*+]\s+/, "")));
          i++;
        }
        blocks.push({
          id: crypto.randomUUID(),
          type: "list",
          data: { style: "unordered", items },
        });
        continue;
      }

      // Ordered list (collect consecutive items)
      if (line.match(/^\d+\.\s+/)) {
        const items: string[] = [];
        while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
          items.push(convertInlineMarkdown(lines[i].replace(/^\d+\.\s+/, "")));
          i++;
        }
        blocks.push({
          id: crypto.randomUUID(),
          type: "list",
          data: { style: "ordered", items },
        });
        continue;
      }

      // Code block
      if (line.startsWith("```")) {
        const lang = line.slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith("```")) {
          codeLines.push(lines[i]);
          i++;
        }
        blocks.push({
          id: crypto.randomUUID(),
          type: "code",
          data: { code: codeLines.join("\n"), language: lang || "plaintext" },
        });
        i++; // Skip closing ```
        continue;
      }

      // Blockquote (collect consecutive lines)
      if (line.startsWith("> ")) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].startsWith("> ")) {
          quoteLines.push(lines[i].slice(2));
          i++;
        }
        blocks.push({
          id: crypto.randomUUID(),
          type: "quote",
          data: { text: convertInlineMarkdown(quoteLines.join("\n")), caption: "" },
        });
        continue;
      }

      // Regular paragraph - convert inline markdown to HTML
      blocks.push({
        id: crypto.randomUUID(),
        type: "paragraph",
        data: { text: convertInlineMarkdown(line) },
      });
      i++;
    }

    return blocks;
  }, [convertInlineMarkdown]);

  // Append AI response to the current page
  const handleAppendToPage = useCallback(async (content: string) => {
    if (!currentPage || !selectedNotebookId) return;

    // Convert markdown to blocks
    const newBlocks = markdownToBlocks(content);

    // Get existing blocks and append new ones
    const existingBlocks = currentPage.content?.blocks || [];
    const updatedContent: EditorData = {
      time: Date.now(),
      version: "2.28.2",
      blocks: [...existingBlocks, ...newBlocks],
    };

    await updatePageContent(selectedNotebookId, currentPage.id, updatedContent);

    // Reload pages to refresh the view
    await loadPages(selectedNotebookId);

    toast.success(`Appended to "${currentPage.title}"`);
  }, [currentPage, selectedNotebookId, markdownToBlocks, updatePageContent, loadPages, toast]);

  // Create a new page with the AI response
  const handleCreateNewPage = useCallback(async (content: string) => {
    if (!selectedNotebookId) return;

    // Generate a title from the first line or heading
    const firstLine = content.split("\n").find(l => l.trim());
    let title = "AI Response";
    if (firstLine) {
      // Remove markdown header syntax if present
      title = firstLine.replace(/^#+\s*/, "").slice(0, 50);
      if (title.length === 50) title += "...";
    }

    // Create the page
    const newPage = await createPage(selectedNotebookId, title);
    if (!newPage) return;

    // Convert markdown to blocks and update the page
    const blocks = markdownToBlocks(content);
    const pageContent: EditorData = {
      time: Date.now(),
      version: "2.28.2",
      blocks,
    };

    await updatePageContent(selectedNotebookId, newPage.id, pageContent);

    // Reload pages
    await loadPages(selectedNotebookId);

    toast.success(`Created page "${title}"`);
  }, [selectedNotebookId, markdownToBlocks, createPage, updatePageContent, loadPages, toast]);

  // Create a subpage under the current page with the AI response
  const handleCreateSubpage = useCallback(async (content: string) => {
    if (!selectedNotebookId || !currentPage) return;

    // Generate a title from the first line or heading
    const firstLine = content.split("\n").find(l => l.trim());
    let title = "AI Response";
    if (firstLine) {
      // Remove markdown header syntax if present
      title = firstLine.replace(/^#+\s*/, "").slice(0, 50);
      if (title.length === 50) title += "...";
    }

    // Create the subpage
    const newPage = await createSubpage(selectedNotebookId, currentPage.id, title);
    if (!newPage) return;

    // Convert markdown to blocks and update the page
    const blocks = markdownToBlocks(content);
    const pageContent: EditorData = {
      time: Date.now(),
      version: "2.28.2",
      blocks,
    };

    await updatePageContent(selectedNotebookId, newPage.id, pageContent);

    // Reload pages
    await loadPages(selectedNotebookId);

    toast.success(`Created subpage "${title}" under "${currentPage.title}"`);
  }, [selectedNotebookId, currentPage, markdownToBlocks, createSubpage, updatePageContent, loadPages, toast]);

  // Execute AI actions (create notebooks/pages) with per-action progress reporting
  const executeActions = useCallback(async (
    actions: AIAction[],
    onProgress?: (toolCallId: string, status: ToolCallStatus, result?: string, error?: string) => void,
  ): Promise<ToolCallRecord[]> => {
    const records: ToolCallRecord[] = [];
    let needsNotebookRefresh = false;
    let notebooksSnapshot = [...notebooks];

    for (const action of actions) {
      const record: ToolCallRecord = {
        tool: action.tool,
        arguments: action.arguments,
        toolCallId: action.toolCallId,
      };
      onProgress?.(action.toolCallId, "executing");

      try {
        if (action.tool === "create_notebook") {
          const args = action.arguments as unknown as CreateNotebookArgs;
          const newNotebook = await apiCreateNotebook(args.name);
          notebooksSnapshot.push(newNotebook);
          needsNotebookRefresh = true;
          record.result = `Created notebook "${args.name}"`;
        } else if (action.tool === "run_action") {
          const args = action.arguments as unknown as { action_name: string; variables?: Record<string, string> };
          const { runActionByName } = await import("../../utils/api");
          const result = await runActionByName(args.action_name, {
            variables: args.variables,
            currentNotebookId: selectedNotebookId || undefined,
          });
          record.result = `Ran action "${args.action_name}" (${result.stepsCompleted} steps)`;
          if (selectedNotebookId) {
            await loadPages(selectedNotebookId);
          }
        } else if (action.tool === "list_actions") {
          record.result = "Listed available actions";
        } else if (action.tool === "browse_web") {
          const args = action.arguments as unknown as { task: string; capture_screenshot?: boolean };
          const { getActiveProviderType, getActiveApiKey, getActiveModel } = useAIStore.getState();
          const activeApiKey = getActiveApiKey();
          if (!activeApiKey) {
            throw new Error("No API key configured for AI provider");
          }
          const result = await runBrowserTask(
            args.task,
            getActiveProviderType(),
            activeApiKey,
            getActiveModel(),
            args.capture_screenshot ?? false
          );
          if (result.success) {
            record.result = result.content || "Browser task completed";
          } else {
            throw new Error(result.error || "Browser task failed");
          }
        } else if (action.tool.startsWith("nous_")) {
          record.result = `${action.tool} completed`;
          if (
            selectedNotebookId &&
            !action.tool.startsWith("nous_list") &&
            !action.tool.startsWith("nous_get") &&
            !action.tool.startsWith("nous_search")
          ) {
            await loadPages(selectedNotebookId);
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
            }
          }

          if (!targetNotebookId) {
            throw new Error("No target notebook found for page creation");
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
          record.result = `Created page "${args.title}" in ${targetNotebookName}`;
        }

        onProgress?.(action.toolCallId, "success", record.result);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`Failed to execute action ${action.tool}:`, error);
        record.error = errMsg;
        onProgress?.(action.toolCallId, "error", undefined, errMsg);
      }
      records.push(record);
    }

    // Refresh stores once at the end
    if (needsNotebookRefresh) {
      await loadNotebooks();
    }
    if (selectedNotebookId && records.some(r => r.tool === "create_page" && !r.error)) {
      await loadPages(selectedNotebookId);
    }

    return records;
  }, [selectedNotebookId, currentNotebook, notebooks, loadNotebooks, loadPages]);

  // Toggle thinking expansion
  const toggleThinking = (index: number) => {
    setExpandedThinking(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Helper to persist current session state
  const persistSession = useCallback(async (session: ChatSession) => {
    try {
      session.updatedAt = new Date().toISOString();
      await saveChatSession(session);
    } catch (err) {
      console.warn("Failed to persist session:", err);
    }
  }, [saveChatSession]);

  // --- Branch helpers ---
  const getSessionBranchLineage = useCallback((branches: ChatSessionBranch[], branchId: string): string[] => {
    const lineage: string[] = [branchId];
    if (branchId === "main") return lineage;
    let currentId = branchId;
    while (currentId !== "main") {
      const branch = branches.find(b => b.id === currentId);
      if (!branch) break;
      lineage.push(branch.parentBranch);
      currentId = branch.parentBranch;
    }
    return lineage;
  }, []);

  const getMessagesForBranch = useCallback((
    messages: SessionMessage[],
    branches: ChatSessionBranch[],
    currentBranch: string
  ): SessionMessage[] => {
    if (currentBranch === "main") {
      return messages.filter(m => (m.branchId || "main") === "main");
    }

    const lineage = getSessionBranchLineage(branches, currentBranch);
    const reversedLineage = [...lineage].reverse(); // main -> ... -> current

    // Build a map of fork points for each branch (keyed by branch id)
    const forkPoints = new Map<string, number>();
    for (const branch of branches) {
      forkPoints.set(branch.id, branch.forkPointIndex);
    }

    const result: SessionMessage[] = [];

    for (let i = 0; i < reversedLineage.length; i++) {
      const branchId = reversedLineage[i];
      const nextBranchId = reversedLineage[i + 1];
      // forkPointIndex is the message index (within display) where the next branch forks
      const forkPointIdx = nextBranchId !== undefined ? forkPoints.get(nextBranchId) : undefined;

      // Collect messages belonging to this branch, stopping at fork point
      const branchMsgs = messages.filter(m => (m.branchId || "main") === branchId);
      if (forkPointIdx !== undefined) {
        // Include messages up to and including the fork point
        result.push(...branchMsgs.slice(0, forkPointIdx + 1));
      } else {
        result.push(...branchMsgs);
      }
    }

    return result;
  }, [getSessionBranchLineage]);

  // Get visible display messages (filtered by branch)
  const visibleDisplayMessages = useMemo(() => {
    const session = currentSessionRef.current;
    if (!session || !session.branches?.length) {
      // No branches, show all messages
      return displayMessages;
    }
    const currentBranch = session.currentBranch || "main";
    if (currentBranch === "main" && !session.messages.some(m => m.branchId && m.branchId !== "main")) {
      return displayMessages;
    }
    // Filter display messages to match the branch-visible session messages
    const visibleSessionMsgs = getMessagesForBranch(session.messages, session.branches, currentBranch);
    // Map by index — display messages parallel session messages
    const visibleIndices = new Set<number>();
    let sessionIdx = 0;
    for (let i = 0; i < session.messages.length && sessionIdx < visibleSessionMsgs.length; i++) {
      if (session.messages[i] === visibleSessionMsgs[sessionIdx]) {
        visibleIndices.add(i);
        sessionIdx++;
      }
    }
    return displayMessages.filter((_, i) => visibleIndices.has(i));
  }, [displayMessages, currentSessionRef.current?.currentBranch, currentSessionRef.current?.branches, currentSessionRef.current?.messages, getMessagesForBranch]);

  const handleCreateBranch = useCallback((messageIndex: number) => {
    const session = currentSessionRef.current;
    if (!session) return;

    const branches = session.branches || [];
    const branchNum = branches.length + 1;
    const newBranch: ChatSessionBranch = {
      id: crypto.randomUUID(),
      name: `Branch ${branchNum}`,
      parentBranch: session.currentBranch || "main",
      forkPointIndex: messageIndex,
      createdAt: new Date().toISOString(),
    };

    session.branches = [...branches, newBranch];
    session.currentBranch = newBranch.id;
    persistSession(session);
    // Force re-render
    setDisplayMessages(prev => [...prev]);
  }, [persistSession]);

  const handleSwitchBranch = useCallback((branchId: string) => {
    const session = currentSessionRef.current;
    if (!session) return;
    session.currentBranch = branchId;
    persistSession(session);
    setShowBranchSelector(false);
    // Force re-render
    setDisplayMessages(prev => [...prev]);
  }, [persistSession]);

  // --- Export helper ---
  const exportSessionToMarkdown = useCallback((session: ChatSession): string => {
    const lines: string[] = [];
    lines.push(`# ${session.title}`);
    lines.push(`Model: ${session.model || "default"} | Created: ${new Date(session.createdAt).toLocaleString()}`);
    lines.push("---");
    lines.push("");

    for (const msg of session.messages) {
      if (msg.role === "user") {
        lines.push(`**User:** ${msg.content}`);
      } else if (msg.role === "assistant") {
        lines.push(`**Assistant:** ${msg.content}`);
        if (msg.thinking) {
          lines.push(`> *Thinking: ${msg.thinking.slice(0, 200)}${msg.thinking.length > 200 ? "..." : ""}*`);
        }
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          const args = typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments);
          const result = tc.error ? `Error: ${tc.error}` : tc.result || "done";
          lines.push(`**Tool:** ${tc.tool}(${args.slice(0, 100)}) → ${result.slice(0, 200)}`);
        }
      }
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    return lines.join("\n");
  }, []);

  const handleExportCopy = useCallback(() => {
    const session = currentSessionRef.current;
    if (!session) return;
    const md = exportSessionToMarkdown(session);
    navigator.clipboard.writeText(md);
    toast.success("Copied session to clipboard");
    setShowExportMenu(false);
  }, [exportSessionToMarkdown, toast]);

  const handleExportDownload = useCallback(() => {
    const session = currentSessionRef.current;
    if (!session) return;
    const md = exportSessionToMarkdown(session);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${session.title.replace(/[^a-z0-9]/gi, "_").slice(0, 50)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  }, [exportSessionToMarkdown]);

  const handleSubmit = async () => {
    if (!input.trim() || conversation.isLoading) return;

    // Mark that we're streaming to prevent useEffect from resetting displayMessages
    isStreamingRef.current = true;

    const userMessage: ChatMessage = {
      role: "user",
      content: input.trim(),
    };

    // Auto-create session if none exists
    let session = currentSessionRef.current;
    if (!session) {
      const title = userMessage.content.slice(0, 80);
      try {
        session = await createChatSession(title);
        currentSessionRef.current = session;
        setActiveSessionId(session.id);
      } catch (err) {
        console.warn("Failed to create session:", err);
      }
    }

    // Add user message to session
    if (session) {
      const currentBranch = session.currentBranch || "main";
      const userSessionMsg: SessionMessage = {
        role: "user",
        content: userMessage.content,
        timestamp: new Date().toISOString(),
        branchId: currentBranch !== "main" ? currentBranch : undefined,
      };
      session.messages.push(userSessionMsg);
      persistSession(session);
    }

    // Add user message immediately
    addMessage(userMessage);
    setDisplayMessages(prev => [...prev, { role: "user", content: userMessage.content }]);
    setInput("");
    setLoading(true);
    setRagContext([]); // Clear previous RAG context

    // Fetch RAG context if enabled
    let fetchedRagContext: SemanticSearchResult[] = [];
    if (ragConfigured && ragSettings.ragEnabled) {
      setStatusText("Searching relevant content...");
      try {
        // Use current notebook if context is locked, otherwise search all notebooks
        const searchNotebookId = panel.lockedContext?.notebookId || selectedNotebookId || undefined;
        fetchedRagContext = await getRagContext(userMessage.content, searchNotebookId, 5);
        setRagContext(fetchedRagContext);
      } catch (error) {
        console.warn("Failed to fetch RAG context:", error);
      }
    }

    setStatusText("Connecting...");

    const startTime = Date.now();

    // Track accumulated content and actions for this response
    let accumulatedContent = "";
    let accumulatedThinking = "";
    let pendingActions: AIAction[] = [];
    let responseModel = "";
    let tokensUsed = 0;
    let unlisten: UnlistenFn | null = null;

    // Add an empty assistant message that we'll update as chunks arrive
    const assistantMsgIndex = displayMessages.length + 1; // +1 because we just added user message
    setDisplayMessages(prev => [...prev, { role: "assistant", content: "" }]);

    try {
      // Set up event listener for streaming events
      unlisten = await listen<StreamEvent>("ai-stream", (event) => {
        const data = event.payload;
        console.log("[AI Stream] Received event:", data.type, data);

        switch (data.type) {
          case "chunk":
            accumulatedContent += data.content;
            setStatusText("Receiving response...");
            // Update the assistant message with accumulated content
            setDisplayMessages(prev => {
              const newMessages = [...prev];
              if (newMessages[assistantMsgIndex]) {
                newMessages[assistantMsgIndex] = {
                  ...newMessages[assistantMsgIndex],
                  content: accumulatedContent,
                };
              }
              return newMessages;
            });
            break;

          case "thinking":
            accumulatedThinking += data.content;
            setStatusText("Thinking...");
            // Update thinking content
            setDisplayMessages(prev => {
              const newMessages = [...prev];
              if (newMessages[assistantMsgIndex]) {
                newMessages[assistantMsgIndex] = {
                  ...newMessages[assistantMsgIndex],
                  thinking: accumulatedThinking,
                };
              }
              return newMessages;
            });
            break;

          case "action":
            setStatusText("Executing actions...");
            pendingActions.push({
              tool: data.tool,
              arguments: data.arguments,
              toolCallId: data.toolCallId,
            });
            // Add pending tool call card to the assistant message
            setDisplayMessages(prev => {
              const newMessages = [...prev];
              if (newMessages[assistantMsgIndex]) {
                const existingCalls = newMessages[assistantMsgIndex].toolCalls || [];
                newMessages[assistantMsgIndex] = {
                  ...newMessages[assistantMsgIndex],
                  toolCalls: [...existingCalls, {
                    toolCallId: data.toolCallId,
                    tool: data.tool,
                    arguments: data.arguments,
                    status: "pending",
                  }],
                };
              }
              return newMessages;
            });
            break;

          case "done":
            console.log("[AI Stream] Done event - model:", data.model, "tokens:", data.tokensUsed);
            responseModel = data.model;
            tokensUsed = data.tokensUsed;
            break;

          case "error":
            console.error("Stream error:", data.message);
            setDisplayMessages(prev => {
              const newMessages = [...prev];
              if (newMessages[assistantMsgIndex]) {
                newMessages[assistantMsgIndex] = {
                  ...newMessages[assistantMsgIndex],
                  content: `Error: ${data.message}`,
                };
              }
              return newMessages;
            });
            break;
        }
      });
      console.log("[AI Stream] Event listener set up");

      // Build page context if a page is selected
      let pageContext: PageContext | undefined;
      if (currentPage) {
        try {
          pageContext = {
            pageId: currentPage.id,
            title: currentPage.title,
            content: currentPage.content?.blocks ? extractPlainText(currentPage.content) : "",
            tags: currentPage.tags,
            notebookName: currentNotebook?.name,
          };
        } catch (e) {
          console.warn("Failed to build page context:", e);
          pageContext = {
            pageId: currentPage.id,
            title: currentPage.title,
            content: "",
            tags: currentPage.tags,
            notebookName: currentNotebook?.name,
          };
        }
      }

      // Build available notebooks list
      const availableNotebooks = notebooks.map((n) => ({
        id: n.id,
        name: n.name,
      }));

      // Resolve system prompt with inheritance and concatenation support
      // Hierarchy: page -> section -> notebook -> app
      // Each level can either override higher-level prompts or concatenate with them
      const resolveSystemPrompt = (): string | undefined => {
        const promptParts: string[] = [];

        // Start with app default (always included as base if nothing overrides)
        const appPrompt = settings.systemPrompt;

        // Check notebook level
        const notebookPrompt = currentNotebook?.systemPrompt;
        const notebookMode = currentNotebook?.systemPromptMode || "override";

        // Check section level
        const sectionPrompt = currentSection?.systemPrompt;
        const sectionMode = currentSection?.systemPromptMode || "override";

        // Check page level
        const pagePrompt = currentPage?.systemPrompt;
        const pageMode = currentPage?.systemPromptMode || "override";

        // Build prompt from top (app) to bottom (page)
        // Each level either overrides or concatenates

        // Start with app default
        if (appPrompt) {
          promptParts.push(appPrompt);
        }

        // Notebook level
        if (notebookPrompt) {
          if (notebookMode === "override") {
            // Clear previous and use only notebook prompt
            promptParts.length = 0;
            promptParts.push(notebookPrompt);
          } else {
            // Concatenate with previous
            promptParts.push(notebookPrompt);
          }
        }

        // Section level
        if (sectionPrompt) {
          if (sectionMode === "override") {
            // Clear previous and use only section prompt
            promptParts.length = 0;
            promptParts.push(sectionPrompt);
          } else {
            // Concatenate with previous
            promptParts.push(sectionPrompt);
          }
        }

        // Page level
        if (pagePrompt) {
          if (pageMode === "override") {
            // Clear previous and use only page prompt
            promptParts.length = 0;
            promptParts.push(pagePrompt);
          } else {
            // Concatenate with previous
            promptParts.push(pagePrompt);
          }
        }

        return promptParts.length > 0 ? promptParts.join("\n\n") : undefined;
      };

      let resolvedSystemPrompt = resolveSystemPrompt();

      // Append RAG context to system prompt if we have relevant chunks
      if (fetchedRagContext.length > 0) {
        const ragContextText = fetchedRagContext
          .map((chunk, i) => `[${i + 1}] "${chunk.title}" (score: ${chunk.score.toFixed(2)}):\n${chunk.content}`)
          .join("\n\n");
        const ragSection = `\n\n## Relevant Context from Other Notes\nThe following excerpts from the user's notes may be relevant to their question:\n\n${ragContextText}\n\nUse this context to provide more informed and accurate responses. If the context is not relevant to the user's question, you may ignore it.`;
        resolvedSystemPrompt = (resolvedSystemPrompt || "") + ragSection;
      }

      // Resolve model with inheritance: chat override > page > section > notebook > app default
      const resolveModel = (): string => {
        if (chatModelOverride) return chatModelOverride;
        if (currentPage?.aiModel) return currentPage.aiModel;
        if (currentSection?.aiModel) return currentSection.aiModel;
        if (currentNotebook?.aiModel) return currentNotebook.aiModel;
        return effectiveDefaultModel;
      };

      const resolvedModel = resolveModel();

      // Resolve the provider from the model being sent
      const resolvedProvider = getProviderForModel(resolvedModel);
      const resolvedProviderConfig = getProviderConfig(resolvedProvider);

      // Start the streaming request - command now waits for completion
      await aiChatStream(userMessage.content, {
        pageContext,
        conversationHistory: (() => {
          // If on a branch, use branch-filtered messages for context
          const session = currentSessionRef.current;
          if (session?.branches?.length && session.currentBranch && session.currentBranch !== "main") {
            const branchMsgs = getMessagesForBranch(session.messages, session.branches, session.currentBranch);
            return branchMsgs.slice(-settings.maxContextMessages).map(m => ({
              role: m.role as ChatMessage["role"],
              content: m.content,
            }));
          }
          return conversation.messages.slice(-settings.maxContextMessages);
        })(),
        availableNotebooks,
        currentNotebookId: selectedNotebookId || undefined,
        providerType: resolvedProvider,
        apiKey: resolvedProviderConfig?.apiKey || undefined,
        baseUrl: resolvedProviderConfig?.baseUrl || undefined,
        model: resolvedModel || undefined,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        systemPrompt: resolvedSystemPrompt,
      });

      const elapsedMs = Date.now() - startTime;
      console.log("[AI Stream] Command completed. elapsedMs:", elapsedMs);
      console.log("[AI Stream] Final values - model:", responseModel, "tokens:", tokensUsed, "content length:", accumulatedContent.length);

      // Execute any pending actions with per-card progress
      let actionRecords: ToolCallRecord[] = [];
      if (pendingActions.length > 0) {
        setStatusText("Creating notebooks and pages...");
        const onProgress = (toolCallId: string, status: ToolCallStatus, result?: string, error?: string) => {
          setDisplayMessages(prev => {
            const newMessages = [...prev];
            if (newMessages[assistantMsgIndex]) {
              const tcs = newMessages[assistantMsgIndex].toolCalls?.map(tc =>
                tc.toolCallId === toolCallId ? { ...tc, status, result, error } : tc
              );
              newMessages[assistantMsgIndex] = { ...newMessages[assistantMsgIndex], toolCalls: tcs };
            }
            return newMessages;
          });
        };
        actionRecords = await executeActions(pendingActions, onProgress);
      }

      // Add final message to conversation store
      if (accumulatedContent) {
        addMessage({
          role: "assistant",
          content: accumulatedContent,
        });
      }

      // Update final stats
      const tokensPerSecond = tokensUsed && elapsedMs > 0
        ? Math.round((tokensUsed / elapsedMs) * 1000)
        : undefined;

      console.log("[AI Stream] Setting stats - elapsedMs:", elapsedMs, "tokensUsed:", tokensUsed, "tokensPerSecond:", tokensPerSecond, "model:", responseModel);

      setDisplayMessages(prev => {
        const newMessages = [...prev];
        console.log("[AI Stream] Updating message at index:", assistantMsgIndex, "total messages:", newMessages.length);
        if (newMessages[assistantMsgIndex]) {
          newMessages[assistantMsgIndex] = {
            ...newMessages[assistantMsgIndex],
            content: accumulatedContent,
            thinking: accumulatedThinking || undefined,
            stats: {
              elapsedMs,
              tokensUsed: tokensUsed || undefined,
              tokensPerSecond,
              model: responseModel || undefined,
            },
          };
        } else {
          console.log("[AI Stream] ERROR: No message at index", assistantMsgIndex);
        }
        return newMessages;
      });

      // Save assistant message to session
      if (currentSessionRef.current && accumulatedContent) {
        const currentBranch = currentSessionRef.current.currentBranch || "main";
        const assistantSessionMsg: SessionMessage = {
          role: "assistant",
          content: accumulatedContent,
          thinking: accumulatedThinking || undefined,
          toolCalls: actionRecords.length > 0 ? actionRecords : undefined,
          stats: {
            elapsedMs,
            tokensUsed: tokensUsed || undefined,
            tokensPerSecond: tokensPerSecond || undefined,
            model: responseModel || undefined,
          },
          timestamp: new Date().toISOString(),
          branchId: currentBranch !== "main" ? currentBranch : undefined,
        };
        currentSessionRef.current.messages.push(assistantSessionMsg);
        if (responseModel) {
          currentSessionRef.current.model = responseModel;
        }
        persistSession(currentSessionRef.current);
      }
    } catch (error) {
      console.error("AI chat error:", error);
      const elapsedMs = Date.now() - startTime;
      const errorMessage = `Error: ${error instanceof Error ? error.message : "Failed to get response"}`;
      addMessage({
        role: "assistant",
        content: errorMessage,
      });
      setDisplayMessages(prev => {
        const newMessages = [...prev];
        if (newMessages[assistantMsgIndex]) {
          newMessages[assistantMsgIndex] = {
            ...newMessages[assistantMsgIndex],
            content: errorMessage,
            stats: { elapsedMs },
          };
        }
        return newMessages;
      });
    } finally {
      // Clean up the event listener
      if (unlisten) {
        unlisten();
      }
      setLoading(false);
      setStatusText("");
      isStreamingRef.current = false; // Allow useEffect to sync again
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      handleClose();
    }
  };

  if (!isOpen) return null;

  // Calculate panel position styles
  const getPanelPositionStyle = () => {
    if (panel.isDetached && panel.position) {
      // Custom position when detached
      return {
        left: `${panel.position.x}px`,
        top: `${panel.position.y}px`,
        bottom: "auto",
        right: "auto",
      };
    }
    // Default bottom-right position
    return {
      bottom: "24px",
      right: "24px",
      left: "auto",
      top: "auto",
    };
  };

  return (
    <div
      ref={panelRef}
      className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border shadow-2xl"
      style={{
        backgroundColor: "var(--color-bg-panel)",
        borderColor: "var(--color-border)",
        width: `${panel.size.width}px`,
        height: `${panel.size.height}px`,
        minWidth: `${AI_PANEL_CONSTRAINTS.minWidth}px`,
        minHeight: `${AI_PANEL_CONSTRAINTS.minHeight}px`,
        maxWidth: `${AI_PANEL_CONSTRAINTS.maxWidth}px`,
        maxHeight: `${AI_PANEL_CONSTRAINTS.maxHeight}px`,
        ...getPanelPositionStyle(),
      }}
    >
      {/* Resize handles */}
      {/* Left edge */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-violet-500/30 transition-colors"
        onMouseDown={handleResizeStart("left")}
        style={{ zIndex: 10 }}
      />
      {/* Top edge */}
      <div
        className="absolute left-0 right-0 top-0 h-1 cursor-ns-resize hover:bg-violet-500/30 transition-colors"
        onMouseDown={handleResizeStart("top")}
        style={{ zIndex: 10 }}
      />
      {/* Top-left corner */}
      <div
        className="absolute left-0 top-0 w-3 h-3 cursor-nwse-resize hover:bg-violet-500/50 transition-colors rounded-tl-2xl"
        onMouseDown={handleResizeStart("corner")}
        style={{ zIndex: 11 }}
      />
      {/* Resize indicator when resizing */}
      {isResizing && (
        <div
          className="absolute inset-0 bg-violet-500/5 pointer-events-none"
          style={{ zIndex: 5 }}
        />
      )}

      {/* Drag indicator when dragging */}
      {isDragging && (
        <div
          className="absolute inset-0 bg-violet-500/10 pointer-events-none"
          style={{ zIndex: 5 }}
        />
      )}

      {/* Header - draggable when detached */}
      <div
        className={`flex items-center justify-between px-5 py-4 ${panel.isDetached ? "cursor-move" : ""}`}
        style={{
          background: "linear-gradient(to right, rgba(139, 92, 246, 0.1), rgba(124, 58, 237, 0.05))",
        }}
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-3">
          {/* Back to sessions button */}
          {(currentSessionRef.current || displayMessages.length > 0) && (
            <button
              onClick={() => {
                setShowSessionList(true);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-text-muted)" }}
              title="Session history"
            >
              <IconList />
            </button>
          )}
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{
              background: "linear-gradient(to bottom right, var(--color-accent), var(--color-accent-tertiary))",
            }}
          >
            <IconSparkles style={{ color: "white" }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              {currentSessionRef.current && editingTitle ? (
                <input
                  autoFocus
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  onBlur={() => {
                    if (titleInput.trim() && currentSessionRef.current) {
                      currentSessionRef.current.title = titleInput.trim();
                      renameSession(currentSessionRef.current.id, titleInput.trim());
                    }
                    setEditingTitle(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingTitle(false);
                  }}
                  className="font-semibold bg-transparent border-b outline-none text-sm"
                  style={{
                    color: "var(--color-text-primary)",
                    borderColor: "var(--color-accent)",
                    width: "160px",
                  }}
                />
              ) : (
              <span
                className="font-semibold cursor-pointer"
                style={{ color: "var(--color-text-primary)" }}
                onClick={() => {
                  if (currentSessionRef.current) {
                    setTitleInput(currentSessionRef.current.title);
                    setEditingTitle(true);
                  }
                }}
                title={currentSessionRef.current ? "Click to rename" : undefined}
              >
                {currentSessionRef.current ? currentSessionRef.current.title : "AI Assistant"}
              </span>
              )}
              {/* Branch indicator + selector */}
              {currentSessionRef.current?.branches?.length ? (
                <div className="relative">
                  <button
                    onClick={() => setShowBranchSelector(!showBranchSelector)}
                    className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:opacity-80"
                    style={{
                      backgroundColor: (currentSessionRef.current.currentBranch || "main") !== "main"
                        ? "rgba(249, 115, 22, 0.2)"
                        : "rgba(139, 92, 246, 0.1)",
                      color: (currentSessionRef.current.currentBranch || "main") !== "main"
                        ? "var(--color-warning)"
                        : "var(--color-text-muted)",
                    }}
                    title="Switch branch"
                  >
                    <IconBranch style={{ width: 9, height: 9 }} />
                    {(() => {
                      const cb = currentSessionRef.current.currentBranch || "main";
                      if (cb === "main") return "main";
                      const branch = currentSessionRef.current.branches?.find(b => b.id === cb);
                      return branch?.name || cb;
                    })()}
                    <IconChevron style={{ width: 8, height: 8, transform: showBranchSelector ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }} />
                  </button>
                  {showBranchSelector && (
                    <div
                      className="absolute top-full left-0 mt-1 min-w-[140px] rounded-lg border p-1 shadow-lg z-50"
                      style={{
                        backgroundColor: "var(--color-bg-secondary)",
                        borderColor: "var(--color-border)",
                      }}
                    >
                      <button
                        onClick={() => handleSwitchBranch("main")}
                        className="w-full rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-[--color-bg-tertiary] flex items-center justify-between"
                        style={{
                          color: (currentSessionRef.current.currentBranch || "main") === "main" ? "var(--color-accent)" : "var(--color-text-primary)",
                        }}
                      >
                        <span>main</span>
                        {(currentSessionRef.current.currentBranch || "main") === "main" && <IconCheck style={{ width: 10, height: 10 }} />}
                      </button>
                      {currentSessionRef.current.branches?.map(b => (
                        <button
                          key={b.id}
                          onClick={() => handleSwitchBranch(b.id)}
                          className="w-full rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-[--color-bg-tertiary] flex items-center justify-between"
                          style={{
                            color: currentSessionRef.current?.currentBranch === b.id ? "var(--color-accent)" : "var(--color-text-primary)",
                          }}
                        >
                          <span>{b.name}</span>
                          {currentSessionRef.current?.currentBranch === b.id && <IconCheck style={{ width: 10, height: 10 }} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
              {panel.isPinned && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: "rgba(139, 92, 246, 0.2)",
                    color: "var(--color-accent)",
                  }}
                >
                  Pinned
                </span>
              )}
              {panel.isDetached && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: "rgba(124, 58, 237, 0.2)",
                    color: "var(--color-accent-secondary)",
                  }}
                >
                  Floating
                </span>
              )}
            </div>
            {currentPage && (
              <p
                className="text-xs flex items-center gap-1"
                style={{ color: "var(--color-text-muted)" }}
              >
                {panel.lockedContext && (
                  <span style={{ color: "var(--color-accent)" }}>Locked:</span>
                )}
                {panel.lockedContext ? panel.lockedContext.pageTitle : currentPage.title}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Context lock button - only show when a page is selected */}
          {currentPage && (
            <button
              onClick={panel.lockedContext ? unlockContext : handleLockContext}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-[--color-bg-tertiary]"
              style={{
                color: panel.lockedContext ? "var(--color-accent)" : "var(--color-text-muted)",
              }}
              title={panel.lockedContext ? "Unlock context (follow current page)" : "Lock context to this page"}
            >
              <IconLock filled={!!panel.lockedContext} />
            </button>
          )}
          {/* Pin button */}
          <button
            onClick={togglePin}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-[--color-bg-tertiary]"
            style={{
              color: panel.isPinned ? "var(--color-accent)" : "var(--color-text-muted)",
            }}
            title={panel.isPinned ? "Unpin panel" : "Pin panel (keep open)"}
          >
            <IconPin filled={panel.isPinned} />
          </button>
          {/* Detach/attach toggle button */}
          <button
            onClick={toggleDetached}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-[--color-bg-tertiary]"
            style={{
              color: panel.isDetached ? "var(--color-accent)" : "var(--color-text-muted)",
            }}
            title={panel.isDetached ? "Attach to corner (snap back)" : "Detach (enable dragging)"}
          >
            <IconDetach detached={panel.isDetached} />
          </button>
          {/* Reset position button - only show when detached and has custom position */}
          {panel.isDetached && panel.position && (
            <button
              onClick={resetPanelPosition}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-text-muted)" }}
              title="Reset position"
            >
              <IconTarget />
            </button>
          )}
          {/* Reset size button - only show if size has changed */}
          {(panel.size.width !== AI_PANEL_CONSTRAINTS.defaultWidth ||
            panel.size.height !== AI_PANEL_CONSTRAINTS.defaultHeight) && (
            <button
              onClick={resetPanelSize}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-text-muted)" }}
              title="Reset panel size"
            >
              <IconResize />
            </button>
          )}
          {/* Export button */}
          {currentSessionRef.current && (
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-[--color-bg-tertiary]"
                style={{ color: "var(--color-text-muted)" }}
                title="Export conversation"
              >
                <IconExport />
              </button>
              {showExportMenu && (
                <div
                  className="absolute top-full right-0 mt-1 min-w-[160px] rounded-lg border p-1 shadow-lg z-50"
                  style={{
                    backgroundColor: "var(--color-bg-secondary)",
                    borderColor: "var(--color-border)",
                  }}
                >
                  <button
                    onClick={handleExportCopy}
                    className="w-full rounded px-3 py-2 text-left text-xs transition-colors hover:bg-[--color-bg-tertiary]"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    Copy to clipboard
                  </button>
                  <button
                    onClick={handleExportDownload}
                    className="w-full rounded px-3 py-2 text-left text-xs transition-colors hover:bg-[--color-bg-tertiary]"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    Download as .md
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            onClick={onOpenSettings}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Settings"
          >
            <IconSettings />
          </button>
          <button
            onClick={() => {
              clearConversation();
              currentSessionRef.current = null;
              setDisplayMessages([]);
              setShowSessionList(false);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="New conversation"
          >
            <IconPlus />
          </button>
          <button
            onClick={handleClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title={panel.isPinned ? "Close (panel is pinned)" : "Close"}
          >
            <IconX />
          </button>
        </div>
      </div>

      {/* Settings hint if no API key */}
      {(() => {
        const activeModel = chatModelOverride || currentPage?.aiModel || currentSection?.aiModel || currentNotebook?.aiModel || effectiveDefaultModel;
        const activeProvider = getProviderForModel(activeModel);
        const activeProviderConfig = getProviderConfig(activeProvider);
        const needsKey = activeProvider !== "ollama" && activeProvider !== "lmstudio" && !activeProviderConfig?.apiKey;
        return needsKey ? (
          <button
            onClick={onOpenSettings}
            className="flex w-full items-center gap-2 border-b px-5 py-3 text-left text-sm transition-all hover:bg-[--color-bg-tertiary]"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "rgba(249, 226, 175, 0.1)",
              color: "var(--color-warning)",
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>Configure your {activeProvider} API key to get started</span>
          </button>
        ) : null;
      })()}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5">
        {showSessionList ? (
          /* Session list view */
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-4">
              <h3
                className="font-semibold text-sm"
                style={{ color: "var(--color-text-primary)" }}
              >
                Conversations
              </h3>
              <button
                onClick={() => {
                  clearConversation();
                  currentSessionRef.current = null;
                  setDisplayMessages([]);
                  setShowSessionList(false);
                }}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors"
                style={{
                  background: "linear-gradient(to right, var(--color-accent), var(--color-accent-secondary))",
                  color: "white",
                }}
              >
                <IconPlus />
                New
              </button>
            </div>
            {sessions.length === 0 ? (
              <div
                className="text-center py-8 text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                No conversations yet
              </div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className="group flex items-center gap-3 rounded-xl p-3 cursor-pointer transition-colors hover:bg-[--color-bg-tertiary]"
                  style={{
                    backgroundColor: s.id === panel.activeSessionId ? "rgba(139, 92, 246, 0.1)" : undefined,
                    border: "1px solid var(--color-border)",
                  }}
                  onClick={async () => {
                    try {
                      const loaded = await loadChatSession(s.id);
                      currentSessionRef.current = loaded;
                      setActiveSessionId(loaded.id);
                      const restored: DisplayMessage[] = loaded.messages.map((m) => ({
                        role: m.role as DisplayMessage["role"],
                        content: m.content,
                        thinking: m.thinking,
                        stats: m.stats ? {
                          elapsedMs: m.stats.elapsedMs,
                          tokensUsed: m.stats.tokensUsed,
                          tokensPerSecond: m.stats.tokensPerSecond,
                          model: m.stats.model,
                        } : undefined,
                        toolCalls: m.toolCalls?.map(tc => ({
                          toolCallId: tc.toolCallId,
                          tool: tc.tool,
                          arguments: tc.arguments,
                          status: (tc.error ? "error" : "success") as ToolCallStatus,
                          result: tc.result,
                          error: tc.error,
                        })),
                      }));
                      isStreamingRef.current = true;
                      // Clear and re-add to conversation store
                      clearConversation();
                      setActiveSessionId(loaded.id);
                      loaded.messages.forEach((m) => addMessage({
                        role: m.role as ChatMessage["role"],
                        content: m.content,
                      }));
                      setDisplayMessages(restored);
                      setTimeout(() => { isStreamingRef.current = false; }, 50);
                      setShowSessionList(false);
                    } catch (err) {
                      console.error("Failed to load session:", err);
                    }
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-sm font-medium truncate"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      {s.title}
                    </div>
                    <div
                      className="text-xs mt-0.5 flex items-center gap-2"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      <span>{s.messageCount} messages</span>
                      <span>{formatRelativeTime(s.updatedAt)}</span>
                    </div>
                  </div>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      await deleteChatSession(s.id);
                      if (currentSessionRef.current?.id === s.id) {
                        currentSessionRef.current = null;
                        clearConversation();
                        setDisplayMessages([]);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 flex h-7 w-7 items-center justify-center rounded-lg transition-all hover:bg-[--color-bg-secondary]"
                    style={{ color: "var(--color-text-muted)" }}
                    title="Delete conversation"
                  >
                    <IconTrash />
                  </button>
                </div>
              ))
            )}
            {/* Back to current conversation */}
            {currentSessionRef.current && (
              <button
                onClick={() => setShowSessionList(false)}
                className="w-full mt-3 rounded-lg px-3 py-2 text-xs text-center transition-colors hover:bg-[--color-bg-tertiary]"
                style={{ color: "var(--color-text-muted)" }}
              >
                Back to current conversation
              </button>
            )}
          </div>
        ) : visibleDisplayMessages.length === 0 && !conversation.isLoading ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
            >
              <IconSparkles style={{ width: 32, height: 32, color: "var(--color-accent)" }} />
            </div>
            <h3
              className="mb-2 font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              How can I help?
            </h3>
            <p
              className="text-sm max-w-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              Ask me anything about your notes, get summaries, or brainstorm ideas.
            </p>
            {currentPage && (
              <p
                className="mt-3 rounded-full px-4 py-1.5 text-xs"
                style={{
                  backgroundColor: "rgba(139, 92, 246, 0.1)",
                  color: "var(--color-accent)",
                }}
              >
                Context loaded from "{currentPage.title}"
              </p>
            )}
            {sessions.length > 0 && (
              <button
                onClick={() => setShowSessionList(true)}
                className="mt-4 flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                style={{
                  color: "var(--color-text-muted)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <IconList />
                View past conversations ({sessions.length})
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {visibleDisplayMessages.map((msg, i) => (
              <div
                key={i}
                className={`group/msg relative flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className="max-w-[85%]">
                  {/* Branch button on user messages */}
                  {msg.role === "user" && currentSessionRef.current && (
                    <div className="flex justify-end mb-1">
                      <button
                        onClick={() => handleCreateBranch(i)}
                        className="opacity-0 group-hover/msg:opacity-100 flex items-center gap-1 text-xs rounded px-1.5 py-0.5 transition-opacity"
                        style={{
                          color: "var(--color-text-muted)",
                        }}
                        title="Branch from here"
                      >
                        <IconBranch style={{ width: 10, height: 10 }} />
                        Branch
                      </button>
                    </div>
                  )}
                  {/* Thinking section (collapsible) */}
                  {msg.thinking && (
                    <div className="mb-2">
                      <button
                        onClick={() => toggleThinking(i)}
                        className="flex items-center gap-2 text-xs rounded-lg px-3 py-1.5 transition-all"
                        style={{
                          backgroundColor: "rgba(139, 92, 246, 0.1)",
                          color: "var(--color-accent)",
                        }}
                      >
                        <IconBrain style={{ width: 12, height: 12 }} />
                        <span>Thinking</span>
                        <IconChevron
                          style={{
                            width: 12,
                            height: 12,
                            transform: expandedThinking.has(i) ? "rotate(180deg)" : "rotate(0deg)",
                            transition: "transform 0.2s",
                          }}
                        />
                      </button>
                      {expandedThinking.has(i) && (
                        <div
                          className="mt-2 rounded-xl p-3 text-xs overflow-auto max-h-64"
                          style={{
                            backgroundColor: "rgba(139, 92, 246, 0.05)",
                            border: "1px solid rgba(139, 92, 246, 0.2)",
                            color: "var(--color-text-secondary)",
                          }}
                        >
                          <pre className="whitespace-pre-wrap font-mono">{msg.thinking}</pre>
                        </div>
                      )}
                    </div>
                  )}
                  <div
                    className="rounded-2xl"
                    style={
                      msg.role === "user"
                        ? {
                            background: "linear-gradient(to bottom right, var(--color-accent), var(--color-accent-secondary))",
                            color: "white",
                            padding: "12px 16px",
                            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                          }
                        : {
                            backgroundColor: "var(--color-bg-secondary)",
                            color: "var(--color-text-primary)",
                            padding: "16px",
                            border: "1px solid var(--color-border)",
                          }
                    }
                  >
                    {msg.role === "user" ? (
                      <div className="flex items-start gap-2">
                        <p className="whitespace-pre-wrap text-sm leading-relaxed flex-1">{msg.content}</p>
                        <button
                          onClick={() => navigator.clipboard.writeText(msg.content)}
                          className="flex-shrink-0 p-1 rounded transition-opacity opacity-50 hover:opacity-100"
                          style={{ color: "rgba(255, 255, 255, 0.9)" }}
                          title="Copy to clipboard"
                        >
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
                        </button>
                      </div>
                    ) : (
                      <div
                        className="prose prose-sm prose-invert max-w-none"
                        style={{ color: "var(--color-text-primary)" }}
                      >
                        <ReactMarkdown
                          components={{
                            p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
                            ul: ({ children }) => <ul className="mb-3 ml-4 list-disc last:mb-0 space-y-1">{children}</ul>,
                            ol: ({ children }) => <ol className="mb-3 ml-4 list-decimal last:mb-0 space-y-1">{children}</ol>,
                            li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                            strong: ({ children }) => <strong style={{ fontWeight: 600, color: "var(--color-accent)" }}>{children}</strong>,
                            code: ({ children }) => (
                              <code
                                className="rounded-md px-1.5 py-0.5 text-xs font-mono"
                                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                              >
                                {children}
                              </code>
                            ),
                            pre: ({ children }) => (
                              <pre
                                className="my-3 overflow-x-auto rounded-xl p-4 text-xs"
                                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                              >
                                {children}
                              </pre>
                            ),
                            h1: ({ children }) => <h1 className="mb-3 text-base font-bold" style={{ color: "var(--color-text-primary)" }}>{children}</h1>,
                            h2: ({ children }) => <h2 className="mb-2 text-sm font-bold" style={{ color: "var(--color-text-primary)" }}>{children}</h2>,
                            h3: ({ children }) => <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>{children}</h3>,
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                  {/* Tool call cards */}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {msg.toolCalls.map(tc => (
                        <ToolCallCard
                          key={tc.toolCallId}
                          tc={tc}
                          expanded={expandedToolCalls.has(tc.toolCallId)}
                          onToggle={() => {
                            setExpandedToolCalls(prev => {
                              const next = new Set(prev);
                              if (next.has(tc.toolCallId)) next.delete(tc.toolCallId);
                              else next.add(tc.toolCallId);
                              return next;
                            });
                          }}
                        />
                      ))}
                    </div>
                  )}
                  {/* Stats for assistant messages */}
                  {msg.role === "assistant" && msg.stats && (
                    <div
                      className="mt-2 flex flex-wrap items-center gap-2 text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      <span className="flex items-center gap-1">
                        <IconClock style={{ width: 10, height: 10 }} />
                        {(msg.stats.elapsedMs / 1000).toFixed(1)}s
                      </span>
                      {msg.stats.tokensUsed && (
                        <span className="flex items-center gap-1">
                          <IconHash style={{ width: 10, height: 10 }} />
                          {msg.stats.tokensUsed} tokens
                        </span>
                      )}
                      {msg.stats.tokensPerSecond && (
                        <span className="flex items-center gap-1">
                          <IconZap style={{ width: 10, height: 10 }} />
                          {msg.stats.tokensPerSecond} tok/s
                        </span>
                      )}
                      {msg.stats.model && (
                        <span
                          className="rounded-full px-2 py-0.5"
                          style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                        >
                          {msg.stats.model}
                        </span>
                      )}
                    </div>
                  )}
                  {/* Action buttons for assistant messages */}
                  {msg.role === "assistant" && msg.content && (
                    <div className="mt-3 flex items-center gap-2">
                      {currentPage && selectedNotebookId && (
                        <button
                          onClick={() => handleAppendToPage(msg.content)}
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:opacity-80"
                          style={{
                            backgroundColor: "var(--color-bg-tertiary)",
                            color: "var(--color-text-secondary)",
                          }}
                          title={`Append to "${currentPage.title}"`}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                          Append to Page
                        </button>
                      )}
                      {selectedNotebookId && (
                        <button
                          onClick={() => handleCreateNewPage(msg.content)}
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:opacity-80"
                          style={{
                            backgroundColor: "var(--color-bg-tertiary)",
                            color: "var(--color-text-secondary)",
                          }}
                          title="Create new page with this content"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="12" y1="18" x2="12" y2="12" />
                            <line x1="9" y1="15" x2="15" y2="15" />
                          </svg>
                          New Page
                        </button>
                      )}
                      {currentPage && selectedNotebookId && (
                        <button
                          onClick={() => handleCreateSubpage(msg.content)}
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:opacity-80"
                          style={{
                            backgroundColor: "var(--color-bg-tertiary)",
                            color: "var(--color-text-secondary)",
                          }}
                          title={`Create subpage under "${currentPage.title}"`}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                            <polyline points="14 2 14 8 20 8" />
                            <path d="M9 15h6" />
                            <path d="M12 18v-6" />
                            <path d="M9 9l3 3 3-3" />
                          </svg>
                          Subpage
                        </button>
                      )}
                      <button
                        onClick={() => navigator.clipboard.writeText(msg.content)}
                        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:opacity-80"
                        style={{
                          backgroundColor: "var(--color-bg-tertiary)",
                          color: "var(--color-text-secondary)",
                        }}
                        title="Copy to clipboard"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
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
                        Copy
                      </button>
                      <button
                        onClick={async () => {
                          const title = msg.content.split("\n")[0].replace(/^#+\s*/, "").slice(0, 100) || "AI Response";
                          await quickCapture(title, msg.content, ["ai-chat"]);
                        }}
                        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:opacity-80"
                        style={{
                          backgroundColor: "var(--color-bg-tertiary)",
                          color: "var(--color-text-secondary)",
                        }}
                        title="Send to Inbox"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                        </svg>
                        Inbox
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {conversation.isLoading && (
              <div className="flex justify-start">
                <div
                  className="rounded-2xl border p-4"
                  style={{
                    backgroundColor: "var(--color-bg-secondary)",
                    borderColor: "var(--color-border)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="h-2 w-2 animate-bounce rounded-full"
                        style={{ backgroundColor: "var(--color-accent)" }}
                      />
                      <div
                        className="h-2 w-2 animate-bounce rounded-full"
                        style={{ backgroundColor: "var(--color-accent-secondary)", animationDelay: "0.1s" }}
                      />
                      <div
                        className="h-2 w-2 animate-bounce rounded-full"
                        style={{ backgroundColor: "var(--color-accent-tertiary)", animationDelay: "0.2s" }}
                      />
                    </div>
                    {statusText && (
                      <span
                        className="text-sm"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {statusText}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
            {/* Show RAG context */}
            {ragContext.length > 0 && (
              <div
                className="rounded-xl border p-4"
                style={{
                  backgroundColor: "rgba(139, 92, 246, 0.05)",
                  borderColor: "rgba(139, 92, 246, 0.2)",
                }}
              >
                <button
                  onClick={() => setShowRagContext(!showRagContext)}
                  className="flex items-center gap-2 w-full text-left"
                >
                  <IconBrain style={{ width: 14, height: 14, color: "var(--color-accent)" }} />
                  <span
                    className="text-sm font-medium flex-1"
                    style={{ color: "var(--color-accent)" }}
                  >
                    {ragContext.length} relevant chunk{ragContext.length > 1 ? "s" : ""} found
                  </span>
                  <IconChevron
                    style={{
                      width: 12,
                      height: 12,
                      color: "var(--color-accent)",
                      transform: showRagContext ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.2s",
                    }}
                  />
                </button>
                {showRagContext && (
                  <div className="mt-3 space-y-2">
                    {ragContext.map((chunk) => (
                      <div
                        key={chunk.chunkId}
                        className="rounded-lg p-3"
                        style={{
                          backgroundColor: "var(--color-bg-secondary)",
                          border: "1px solid var(--color-border)",
                        }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span
                            className="text-xs font-medium"
                            style={{ color: "var(--color-text-primary)" }}
                          >
                            {chunk.title}
                          </span>
                          <span
                            className="text-xs rounded-full px-2 py-0.5"
                            style={{
                              backgroundColor: "rgba(139, 92, 246, 0.1)",
                              color: "var(--color-accent)",
                            }}
                          >
                            {(chunk.score * 100).toFixed(0)}% match
                          </span>
                        </div>
                        <p
                          className="text-xs leading-relaxed line-clamp-3"
                          style={{ color: "var(--color-text-secondary)" }}
                        >
                          {chunk.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div
        className="border-t p-4"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "rgba(30, 30, 46, 0.5)",
        }}
      >
        <div className="flex gap-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything..."
            rows={1}
            className="flex-1 resize-none rounded-xl border px-4 py-3 text-sm outline-none transition-all"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
              minHeight: "48px",
              maxHeight: "120px",
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || conversation.isLoading}
            data-ai-submit-btn
            className="flex h-12 w-12 items-center justify-center rounded-xl text-white shadow-md transition-all disabled:opacity-50"
            style={{
              background: "linear-gradient(to bottom right, var(--color-accent), var(--color-accent-secondary))",
            }}
          >
            <IconSend />
          </button>
        </div>
        <div
          className="mt-3 flex items-center justify-between text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          <div className="relative">
            <button
              onClick={() => setShowModelSelector(!showModelSelector)}
              className="flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-[--color-bg-tertiary]"
            >
              <span
                className="rounded-full px-2 py-0.5"
                style={{
                  backgroundColor: "rgba(166, 227, 161, 0.2)",
                  color: "var(--color-success)",
                }}
              >
                {getProviderForModel(chatModelOverride || currentPage?.aiModel || currentSection?.aiModel || currentNotebook?.aiModel || effectiveDefaultModel)}
              </span>
              <span>
                {chatModelOverride || currentPage?.aiModel || currentSection?.aiModel || currentNotebook?.aiModel || effectiveDefaultModel || "default"}
              </span>
              {(chatModelOverride || currentPage?.aiModel || currentSection?.aiModel || currentNotebook?.aiModel) && (
                <span
                  className="rounded px-1 py-0.5"
                  style={{
                    backgroundColor: "rgba(139, 92, 246, 0.2)",
                    color: "var(--color-accent)",
                    fontSize: "9px",
                  }}
                >
                  {chatModelOverride ? "chat" : currentPage?.aiModel ? "page" : currentSection?.aiModel ? "section" : "notebook"}
                </span>
              )}
              <IconChevron
                style={{
                  width: 12,
                  height: 12,
                  transform: showModelSelector ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s",
                }}
              />
            </button>
            {/* Model selector dropdown */}
            {showModelSelector && (
              <div
                className="absolute bottom-full left-0 mb-2 min-w-[200px] rounded-lg border p-2 shadow-lg"
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  borderColor: "var(--color-border)",
                }}
              >
                {/* Clear override option */}
                {chatModelOverride && (
                  <button
                    onClick={() => {
                      setChatModelOverride(null);
                      setShowModelSelector(false);
                    }}
                    className="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-[--color-bg-tertiary]"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Use default (clear override)
                  </button>
                )}
                {/* Group models by provider */}
                {(() => {
                  const enabledModels = getEnabledModels();
                  const grouped = enabledModels.reduce((acc, { provider, model }) => {
                    if (!acc[provider]) acc[provider] = [];
                    acc[provider].push(model);
                    return acc;
                  }, {} as Record<string, typeof enabledModels[0]["model"][]>);

                  return Object.entries(grouped).map(([provider, models]) => (
                    <div key={provider} className="mt-2 first:mt-0">
                      <div
                        className="px-3 py-1 text-xs font-medium uppercase"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {provider}
                      </div>
                      {models.map((model) => {
                        const isActive = chatModelOverride === model.id ||
                          (!chatModelOverride && model.id === (currentPage?.aiModel || currentSection?.aiModel || currentNotebook?.aiModel || effectiveDefaultModel));
                        return (
                          <button
                            key={model.id}
                            onClick={() => {
                              setChatModelOverride(model.id);
                              setShowModelSelector(false);
                            }}
                            className="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-[--color-bg-tertiary]"
                            style={{
                              color: isActive ? "var(--color-accent)" : "var(--color-text-primary)",
                              backgroundColor: isActive ? "rgba(139, 92, 246, 0.1)" : undefined,
                            }}
                          >
                            {model.name}
                          </button>
                        );
                      })}
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* RAG status indicator */}
            {ragConfigured && ragSettings.ragEnabled && (
              <span
                className="flex items-center gap-1 rounded-full px-2 py-0.5"
                style={{
                  backgroundColor: "rgba(139, 92, 246, 0.2)",
                  color: "var(--color-accent)",
                }}
                title="Semantic search enabled - relevant notes will be included in context"
              >
                <IconBrain style={{ width: 10, height: 10 }} />
                RAG
              </span>
            )}
            <span className="opacity-75">Enter to send</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helpers
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// Icons
function IconList() {
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
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
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
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconSparkles({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
      <path d="M19 13l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" />
    </svg>
  );
}

function IconX() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
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

function IconSend() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
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

function IconCheck({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconBook({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}

function IconFile({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14,2 14,8 20,8" />
    </svg>
  );
}

function IconGlobe({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

function IconBrain({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  );
}

function IconChevron({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function IconClock({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconHash({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <line x1="4" x2="20" y1="9" y2="9" />
      <line x1="4" x2="20" y1="15" y2="15" />
      <line x1="10" x2="8" y1="3" y2="21" />
      <line x1="16" x2="14" y1="3" y2="21" />
    </svg>
  );
}

function IconZap({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function IconPin({ filled }: { filled?: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" x2="12" y1="17" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  );
}

function IconLock({ filled }: { filled?: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function IconResize() {
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
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="M21 3l-7 7" />
      <path d="M3 21l7-7" />
    </svg>
  );
}

function IconDetach({ detached }: { detached?: boolean }) {
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
      {detached ? (
        // Arrows pointing inward (attach/dock)
        <>
          <path d="M9 3h6" />
          <path d="M9 21h6" />
          <path d="M3 9v6" />
          <path d="M21 9v6" />
          <path d="M9 9L4 4" />
          <path d="M15 9l5-5" />
          <path d="M9 15l-5 5" />
          <path d="M15 15l5 5" />
        </>
      ) : (
        // Arrows pointing outward (detach/float)
        <>
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
          <path d="M3 16v3a2 2 0 0 0 2 2h3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </>
      )}
    </svg>
  );
}

function IconTarget() {
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
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function IconSpinner() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="animate-spin"
      style={{ color: "var(--color-accent)" }}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function IconBranch({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

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
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function IconXSmall() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--color-error)" }}
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

// Tool call display helpers
function truncateJson(obj: unknown): string {
  const s = JSON.stringify(obj);
  return s && s.length > 60 ? s.slice(0, 60) + "..." : s || "";
}

function getToolCallDisplay(tc: DisplayToolCall): { icon: React.ReactNode; label: string; summary: string } {
  const args = tc.arguments as Record<string, unknown> | null;
  switch (tc.tool) {
    case "create_notebook":
      return { icon: <IconBook style={{ width: 12, height: 12 }} />, label: "Create Notebook", summary: String(args?.name || "") };
    case "create_page":
      return { icon: <IconFile style={{ width: 12, height: 12 }} />, label: "Create Page", summary: String(args?.title || "") };
    case "run_action":
      return { icon: <IconZap style={{ width: 12, height: 12 }} />, label: "Run Action", summary: String(args?.action_name || "") };
    case "list_actions":
      return { icon: <IconList />, label: "List Actions", summary: "" };
    case "browse_web":
      return { icon: <IconGlobe style={{ width: 12, height: 12 }} />, label: "Browse Web", summary: String(args?.task || "").slice(0, 60) };
    default:
      if (tc.tool.startsWith("nous_")) {
        const toolLabel = tc.tool.replace("nous_", "").replace(/_/g, " ");
        return { icon: <IconSparkles style={{ width: 12, height: 12 }} />, label: toolLabel, summary: truncateJson(args) };
      }
      return { icon: <IconZap style={{ width: 12, height: 12 }} />, label: tc.tool, summary: truncateJson(args) };
  }
}

function ToolCallCard({ tc, expanded, onToggle }: { tc: DisplayToolCall; expanded: boolean; onToggle: () => void }) {
  const display = getToolCallDisplay(tc);

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{
        borderColor: tc.status === "error" ? "var(--color-error, #f38ba8)" : "var(--color-border)",
        backgroundColor: "var(--color-bg-tertiary)",
      }}
    >
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover:opacity-80 transition-opacity"
      >
        {tc.status === "pending" && (
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: "var(--color-text-muted)" }}
          />
        )}
        {tc.status === "executing" && <IconSpinner />}
        {tc.status === "success" && <IconCheck style={{ width: 12, height: 12, color: "var(--color-success)" }} />}
        {tc.status === "error" && <IconXSmall />}
        {display.icon}
        <span className="font-medium" style={{ color: "var(--color-text-primary)" }}>
          {display.label}
        </span>
        {display.summary && (
          <span className="flex-1 truncate" style={{ color: "var(--color-text-muted)" }}>
            {display.summary}
          </span>
        )}
        <IconChevron
          style={{
            width: 10,
            height: 10,
            flexShrink: 0,
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
          }}
        />
      </button>
      {(tc.result || tc.error) && (
        <div
          className="px-3 pb-2 text-xs"
          style={{ color: tc.status === "error" ? "var(--color-error, #f38ba8)" : "var(--color-success)" }}
        >
          {tc.error || tc.result}
        </div>
      )}
      {expanded && (
        <div
          className="px-3 pb-2 text-xs border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          <pre
            className="whitespace-pre-wrap font-mono overflow-auto max-h-32 mt-2"
            style={{ color: "var(--color-text-muted)" }}
          >
            {JSON.stringify(tc.arguments, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
