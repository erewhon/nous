import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { useAIStore } from "../../stores/aiStore";
import { usePageStore } from "../../stores/pageStore";
import { useNotebookStore } from "../../stores/notebookStore";
import {
  aiChatWithTools,
  createNotebook as apiCreateNotebook,
  createPage as apiCreatePage,
  updatePage as apiUpdatePage,
} from "../../utils/api";
import type { ChatMessage, PageContext, AIAction, CreateNotebookArgs, CreatePageArgs } from "../../types/ai";
import type { EditorData } from "../../types/page";

interface AIChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
}

// Track created items to show in UI
interface CreatedItem {
  type: "notebook" | "page";
  name: string;
  notebookName?: string;
}

export function AIChatPanel({ isOpen, onClose, onOpenSettings }: AIChatPanelProps) {
  const [input, setInput] = useState("");
  const [createdItems, setCreatedItems] = useState<CreatedItem[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { settings, conversation, addMessage, setLoading, clearConversation } =
    useAIStore();
  const { selectedPageId, pages, loadPages } = usePageStore();
  const { notebooks, selectedNotebookId, loadNotebooks } = useNotebookStore();

  // Get current page context
  const currentPage = pages.find((p) => p.id === selectedPageId);
  const currentNotebook = notebooks.find((n) => n.id === selectedNotebookId);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.messages]);

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

  const handleSubmit = async () => {
    if (!input.trim() || conversation.isLoading) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: input.trim(),
    };

    addMessage(userMessage);
    setInput("");
    setLoading(true);
    setCreatedItems([]); // Clear previous created items

    try {
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

      const response = await aiChatWithTools(userMessage.content, {
        pageContext,
        conversationHistory: conversation.messages.slice(-10), // Last 10 messages
        availableNotebooks,
        currentNotebookId: selectedNotebookId || undefined,
        providerType: settings.providerType,
        apiKey: settings.apiKey || undefined,
        model: settings.model || undefined,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
      });

      // Execute any actions returned by the AI
      if (response.actions && response.actions.length > 0) {
        const created = await executeActions(response.actions);
        setCreatedItems(created);
      }

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: response.content,
      };

      addMessage(assistantMessage);
    } catch (error) {
      console.error("AI chat error:", error);
      addMessage({
        role: "assistant",
        content: `Error: ${error instanceof Error ? error.message : "Failed to get response"}`,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex h-[650px] w-[480px] flex-col overflow-hidden rounded-2xl border shadow-2xl"
      style={{
        backgroundColor: "var(--color-bg-panel)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{
          background: "linear-gradient(to right, rgba(139, 92, 246, 0.1), rgba(124, 58, 237, 0.05))",
        }}
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
            <span
              className="font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              AI Assistant
            </span>
            {currentPage && (
              <p
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                Context: {currentPage.title}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
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
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-all"
            style={{ color: "var(--color-text-muted)" }}
            title="Clear conversation"
          >
            <IconTrash />
          </button>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-all"
            style={{ color: "var(--color-text-muted)" }}
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
        {conversation.messages.length === 0 ? (
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
            {conversation.messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className="max-w-[85%] rounded-2xl"
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
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2.5 w-2.5 animate-bounce rounded-full"
                      style={{ backgroundColor: "var(--color-accent)" }}
                    />
                    <div
                      className="h-2.5 w-2.5 animate-bounce rounded-full"
                      style={{ backgroundColor: "var(--color-accent-secondary)", animationDelay: "0.1s" }}
                    />
                    <div
                      className="h-2.5 w-2.5 animate-bounce rounded-full"
                      style={{ backgroundColor: "var(--color-accent-tertiary)", animationDelay: "0.2s" }}
                    />
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
