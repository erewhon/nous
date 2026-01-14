import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAIStore, AI_PANEL_CONSTRAINTS } from "../../stores/aiStore";
import { usePageStore } from "../../stores/pageStore";
import { useNotebookStore } from "../../stores/notebookStore";
import {
  aiChatStream,
  createNotebook as apiCreateNotebook,
  createPage as apiCreatePage,
  updatePage as apiUpdatePage,
} from "../../utils/api";
import type { ChatMessage, PageContext, AIAction, CreateNotebookArgs, CreatePageArgs, StreamEvent } from "../../types/ai";
import type { EditorData } from "../../types/page";

interface AIChatPanelProps {
  isOpen?: boolean; // Optional - uses store if not provided
  onClose?: () => void; // Optional - uses store if not provided
  onOpenSettings?: () => void;
}

// Track created items to show in UI
interface CreatedItem {
  type: "notebook" | "page" | "action" | "info";
  name: string;
  notebookName?: string;
}

// Extended message with optional thinking and stats
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
}

export function AIChatPanel({ isOpen: isOpenProp, onClose: onCloseProp, onOpenSettings }: AIChatPanelProps) {
  const [input, setInput] = useState("");
  const [createdItems, setCreatedItems] = useState<CreatedItem[]>([]);
  const [statusText, setStatusText] = useState<string>("");
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
  const [expandedThinking, setExpandedThinking] = useState<Set<number>>(new Set());
  const [isResizing, setIsResizing] = useState<"left" | "top" | "corner" | null>(null);
  const [isDragging, setIsDragging] = useState(false);
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
  } = useAIStore();
  const { selectedPageId, pages, loadPages } = usePageStore();
  const { notebooks, selectedNotebookId, loadNotebooks } = useNotebookStore();

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

  // Execute AI actions (create notebooks/pages)
  const executeActions = useCallback(async (actions: AIAction[]): Promise<CreatedItem[]> => {
    const created: CreatedItem[] = [];
    // Keep track of newly created notebooks (refresh the list once)
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
            const { runActionByName } = await import("../../utils/api");
            const result = await runActionByName(args.action_name, {
              variables: args.variables,
              currentNotebookId: selectedNotebookId || undefined,
            });
            created.push({
              type: "action",
              name: args.action_name,
              notebookName: `${result.stepsCompleted} steps completed`,
            });
            // Reload pages if the action might have created some
            if (selectedNotebookId) {
              await loadPages(selectedNotebookId);
            }
          } catch (error) {
            console.error(`Failed to run action ${args.action_name}:`, error);
          }
        } else if (action.tool === "list_actions") {
          // list_actions is informational - just acknowledge it
          // The AI will format the response based on the tool result
          created.push({
            type: "info",
            name: "Listed available actions",
          });
        } else if (action.tool === "create_page") {
          const args = action.arguments as unknown as CreatePageArgs;

          // Find the target notebook
          let targetNotebookId = selectedNotebookId;
          let targetNotebookName = currentNotebook?.name || "current notebook";

          if (args.notebook_name !== "current") {
            // Look for the notebook by name (in snapshot that includes new notebooks)
            const targetNotebook = notebooksSnapshot.find(
              (n) => n.name.toLowerCase() === args.notebook_name.toLowerCase()
            );
            if (targetNotebook) {
              targetNotebookId = targetNotebook.id;
              targetNotebookName = targetNotebook.name;
            } else {
              // Create the notebook if it doesn't exist
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

          // Create the page
          const newPage = await apiCreatePage(targetNotebookId, args.title);

          // Convert content blocks to EditorData format
          const editorData: EditorData = {
            time: Date.now(),
            version: "2.28.2",
            blocks: args.content_blocks.map((block) => ({
              id: crypto.randomUUID(),
              type: block.type,
              data: block.data as Record<string, unknown>,
            })),
          };

          // Update page with content and optionally tags
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

    // Refresh stores once at the end
    if (needsNotebookRefresh) {
      await loadNotebooks();
    }
    // Reload pages for the current notebook if any pages were created
    if (selectedNotebookId && created.some(c => c.type === "page")) {
      await loadPages(selectedNotebookId);
    }

    return created;
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

  const handleSubmit = async () => {
    if (!input.trim() || conversation.isLoading) return;

    // Mark that we're streaming to prevent useEffect from resetting displayMessages
    isStreamingRef.current = true;

    const userMessage: ChatMessage = {
      role: "user",
      content: input.trim(),
    };

    // Add user message immediately
    addMessage(userMessage);
    setDisplayMessages(prev => [...prev, { role: "user", content: userMessage.content }]);
    setInput("");
    setLoading(true);
    setStatusText("Connecting...");
    setCreatedItems([]); // Clear previous created items

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
        pageContext = {
          pageId: currentPage.id,
          title: currentPage.title,
          content: extractPlainText(currentPage.content),
          tags: currentPage.tags,
          notebookName: currentNotebook?.name,
        };
      }

      // Build available notebooks list
      const availableNotebooks = notebooks.map((n) => ({
        id: n.id,
        name: n.name,
      }));

      // Resolve system prompt with inheritance: page -> notebook -> app
      const resolvedSystemPrompt =
        currentPage?.systemPrompt ||
        currentNotebook?.systemPrompt ||
        settings.systemPrompt ||
        undefined;

      // Start the streaming request - command now waits for completion
      await aiChatStream(userMessage.content, {
        pageContext,
        conversationHistory: conversation.messages.slice(-10),
        availableNotebooks,
        currentNotebookId: selectedNotebookId || undefined,
        providerType: settings.providerType,
        apiKey: settings.apiKey || undefined,
        model: settings.model || undefined,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        systemPrompt: resolvedSystemPrompt,
      });

      const elapsedMs = Date.now() - startTime;
      console.log("[AI Stream] Command completed. elapsedMs:", elapsedMs);
      console.log("[AI Stream] Final values - model:", responseModel, "tokens:", tokensUsed, "content length:", accumulatedContent.length);

      // Execute any pending actions
      if (pendingActions.length > 0) {
        setStatusText("Creating notebooks and pages...");
        const created = await executeActions(pendingActions);
        setCreatedItems(created);
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
              <span
                className="font-semibold"
                style={{ color: "var(--color-text-primary)" }}
              >
                AI Assistant
              </span>
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
          <button
            onClick={onOpenSettings}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Settings"
          >
            <IconSettings />
          </button>
          <button
            onClick={clearConversation}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Clear conversation"
          >
            <IconTrash />
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
      {!settings.apiKey && settings.providerType !== "ollama" && (
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
          <span>Configure your {settings.providerType} API key to get started</span>
        </button>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5">
        {displayMessages.length === 0 && !conversation.isLoading ? (
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
          </div>
        ) : (
          <div className="space-y-5">
            {displayMessages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className="max-w-[85%]">
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
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
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
            {/* Show created items */}
            {createdItems.length > 0 && (
              <div
                className="rounded-xl border p-4"
                style={{
                  backgroundColor: "rgba(166, 227, 161, 0.1)",
                  borderColor: "var(--color-success)",
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <IconCheck style={{ color: "var(--color-success)" }} />
                  <span
                    className="text-sm font-medium"
                    style={{ color: "var(--color-success)" }}
                  >
                    Created {createdItems.length} item{createdItems.length > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="space-y-2">
                  {createdItems.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-sm"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {item.type === "notebook" ? (
                        <IconBook style={{ width: 14, height: 14 }} />
                      ) : (
                        <IconFile style={{ width: 14, height: 14 }} />
                      )}
                      <span>
                        {item.type === "notebook" ? (
                          <>Notebook: <strong style={{ color: "var(--color-text-primary)" }}>{item.name}</strong></>
                        ) : (
                          <>Page: <strong style={{ color: "var(--color-text-primary)" }}>{item.name}</strong> in {item.notebookName}</>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
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
          <div className="flex items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5"
              style={{
                backgroundColor: "rgba(166, 227, 161, 0.2)",
                color: "var(--color-success)",
              }}
            >
              {settings.providerType}
            </span>
            <span>{settings.model || "default"}</span>
          </div>
          <span className="opacity-75">Enter to send</span>
        </div>
      </div>
    </div>
  );
}

// Icons
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
