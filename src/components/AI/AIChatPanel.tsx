import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { useAIStore } from "../../stores/aiStore";
import { usePageStore } from "../../stores/pageStore";
import { useNotebookStore } from "../../stores/notebookStore";
import { aiChatWithContext } from "../../utils/api";
import { AISettingsPanel } from "./AISettingsPanel";
import type { ChatMessage, PageContext } from "../../types/ai";

interface AIChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AIChatPanel({ isOpen, onClose }: AIChatPanelProps) {
  const [input, setInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { settings, conversation, addMessage, setLoading, clearConversation } =
    useAIStore();
  const { selectedPageId, pages } = usePageStore();
  const { notebooks, selectedNotebookId } = useNotebookStore();

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

  const handleSubmit = async () => {
    if (!input.trim() || conversation.isLoading) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: input.trim(),
    };

    addMessage(userMessage);
    setInput("");
    setLoading(true);

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

      const response = await aiChatWithContext(userMessage.content, {
        pageContext,
        conversationHistory: conversation.messages.slice(-10), // Last 10 messages
        providerType: settings.providerType,
        apiKey: settings.apiKey || undefined,
        model: settings.model || undefined,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
      });

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
    <div className="fixed bottom-4 right-4 z-50 flex h-[600px] w-[440px] flex-col overflow-hidden rounded-xl border border-[--color-border] bg-[--color-bg-secondary] shadow-2xl backdrop-blur-none">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[--color-border] px-4 py-3">
        <div className="flex items-center gap-2">
          <IconSparkles />
          <span className="font-medium text-[--color-text-primary]">
            AI Assistant
          </span>
          {currentPage && (
            <span className="rounded bg-[--color-bg-tertiary] px-2 py-0.5 text-xs text-[--color-text-muted]">
              {currentPage.title}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings(true)}
            className="rounded p-1 text-[--color-text-muted] hover:bg-[--color-bg-tertiary] hover:text-[--color-text-primary]"
            title="Settings"
          >
            <IconSettings />
          </button>
          <button
            onClick={clearConversation}
            className="rounded p-1 text-[--color-text-muted] hover:bg-[--color-bg-tertiary] hover:text-[--color-text-primary]"
            title="Clear conversation"
          >
            <IconTrash />
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-[--color-text-muted] hover:bg-[--color-bg-tertiary] hover:text-[--color-text-primary]"
          >
            <IconX />
          </button>
        </div>
      </div>

      {/* Settings hint if no API key */}
      {!settings.apiKey && settings.providerType !== "ollama" && (
        <button
          onClick={() => setShowSettings(true)}
          className="w-full border-b border-[--color-border] bg-amber-500/10 px-4 py-2 text-left text-xs text-amber-500 hover:bg-amber-500/20"
        >
          No API key configured. Click to set your {settings.providerType} API key.
        </button>
      )}

      {/* Settings Panel */}
      <AISettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {conversation.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-[--color-text-muted]">
            <IconSparkles className="mb-2 h-8 w-8 opacity-50" />
            <p className="text-sm">Ask me anything about your notes!</p>
            {currentPage && (
              <p className="mt-1 text-xs">
                I have context from "{currentPage.title}"
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {conversation.messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[90%] rounded-lg px-4 py-3 ${
                    msg.role === "user"
                      ? "bg-[--color-accent] text-white"
                      : "bg-[--color-bg-tertiary] text-[--color-text-primary]"
                  }`}
                >
                  {msg.role === "user" ? (
                    <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                  ) : (
                    <div className="prose prose-sm prose-invert max-w-none">
                      <ReactMarkdown
                        components={{
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="mb-2 ml-4 list-disc last:mb-0">{children}</ul>,
                          ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal last:mb-0">{children}</ol>,
                          li: ({ children }) => <li className="mb-1">{children}</li>,
                          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                          code: ({ children }) => (
                            <code className="rounded bg-black/20 px-1 py-0.5 text-xs">{children}</code>
                          ),
                          pre: ({ children }) => (
                            <pre className="my-2 overflow-x-auto rounded bg-black/20 p-2 text-xs">{children}</pre>
                          ),
                          h1: ({ children }) => <h1 className="mb-2 text-base font-bold">{children}</h1>,
                          h2: ({ children }) => <h2 className="mb-2 text-sm font-bold">{children}</h2>,
                          h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
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
                <div className="rounded-lg bg-[--color-bg-tertiary] px-3 py-2">
                  <div className="flex items-center gap-1">
                    <div className="h-2 w-2 animate-bounce rounded-full bg-[--color-text-muted]" />
                    <div className="h-2 w-2 animate-bounce rounded-full bg-[--color-text-muted] [animation-delay:0.1s]" />
                    <div className="h-2 w-2 animate-bounce rounded-full bg-[--color-text-muted] [animation-delay:0.2s]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-[--color-border] p-3">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question..."
            rows={1}
            className="flex-1 resize-none rounded-lg border border-[--color-border] bg-[--color-bg-primary] px-3 py-2 text-sm text-[--color-text-primary] placeholder-[--color-text-muted] outline-none focus:border-[--color-accent]"
            style={{ minHeight: "40px", maxHeight: "100px" }}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || conversation.isLoading}
            className="rounded-lg bg-[--color-accent] px-3 py-2 text-white transition-opacity disabled:opacity-50"
          >
            <IconSend />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-[--color-text-muted]">
          <span>
            {settings.providerType} • {settings.model || "default model"}
          </span>
          <span>Enter to send, Shift+Enter for newline</span>
        </div>
      </div>
    </div>
  );
}

// Icons
function IconSparkles({ className }: { className?: string }) {
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
      className={className}
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
