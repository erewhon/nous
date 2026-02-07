import { useState, useEffect, useRef, useCallback } from "react";
import { aiChatStream } from "../../utils/api";
import { listen } from "@tauri-apps/api/event";
import { useAIStore } from "../../stores/aiStore";
import type { StreamEvent } from "../../types/ai";

interface AIAssistToolbarProps {
  containerRef: React.RefObject<HTMLElement | null>;
}

type ToolbarState = "idle" | "toolbar" | "processing" | "result";

interface Position {
  top: number;
  left: number;
}

const AI_ACTIONS = [
  {
    label: "Summarize",
    icon: "📝",
    prompt: "Summarize the following text concisely. Return only the summary.",
  },
  {
    label: "Expand",
    icon: "📖",
    prompt:
      "Expand and elaborate on the following text. Return only the expanded text.",
  },
  {
    label: "Translate",
    icon: "🌐",
    prompt:
      "Translate the following text to English. If already English, translate to Spanish. Return only the translation.",
  },
  {
    label: "Fix Grammar",
    icon: "✏️",
    prompt:
      "Fix grammar, spelling, and punctuation. Return only the corrected text.",
  },
  {
    label: "Change Tone",
    icon: "🎭",
    prompt:
      "Rewrite in a more professional tone. Return only the rewritten text.",
  },
] as const;

export function AIAssistToolbar({ containerRef }: AIAssistToolbarProps) {
  const [state, setState] = useState<ToolbarState>("idle");
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 });
  const [selectedText, setSelectedText] = useState("");
  const [resultText, setResultText] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const savedRangeRef = useRef<Range | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  const getActiveProviderType = useAIStore(
    (s) => s.getActiveProviderType
  );
  const getActiveApiKey = useAIStore((s) => s.getActiveApiKey);
  const getActiveModel = useAIStore((s) => s.getActiveModel);

  const hide = useCallback(() => {
    setState("idle");
    setSelectedText("");
    setResultText("");
    setStreamingText("");
    savedRangeRef.current = null;
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
  }, []);

  // Listen for mouseup to detect text selection
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = () => {
      // Small delay to let selection finalize
      setTimeout(() => {
        if (state === "processing" || state === "result") return;

        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) {
          if (state === "toolbar") hide();
          return;
        }

        const text = selection.toString().trim();
        if (!text) {
          if (state === "toolbar") hide();
          return;
        }

        // Make sure selection is inside our container
        const range = selection.getRangeAt(0);
        if (!container.contains(range.commonAncestorContainer)) {
          return;
        }

        const rect = range.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        setSelectedText(text);
        savedRangeRef.current = range.cloneRange();
        setPosition({
          top: rect.top - containerRect.top - 48,
          left:
            rect.left -
            containerRect.left +
            rect.width / 2,
        });
        setState("toolbar");
      }, 10);
    };

    container.addEventListener("mouseup", handleMouseUp);
    return () => container.removeEventListener("mouseup", handleMouseUp);
  }, [containerRef, state, hide]);

  // Escape key and click-outside to dismiss
  useEffect(() => {
    if (state === "idle") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        hide();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (
        toolbarRef.current &&
        !toolbarRef.current.contains(e.target as Node)
      ) {
        // Don't dismiss during processing/result on clicks inside the editor
        if (state === "processing" || state === "result") return;
        hide();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [state, hide]);

  const handleAction = useCallback(
    async (systemPrompt: string) => {
      if (!selectedText) return;

      setState("processing");
      setStreamingText("");
      setResultText("");

      let accumulated = "";

      // Listen for stream events
      const unlisten = await listen<StreamEvent>("ai-stream", (event) => {
        const data = event.payload;
        if (data.type === "chunk") {
          accumulated += data.content;
          setStreamingText(accumulated);
        } else if (data.type === "done") {
          setResultText(accumulated);
          setState("result");
        } else if (data.type === "error") {
          setResultText(`Error: ${data.message}`);
          setState("result");
        }
      });

      unlistenRef.current = unlisten;

      try {
        await aiChatStream(selectedText, {
          systemPrompt,
          providerType: getActiveProviderType(),
          apiKey: getActiveApiKey(),
          model: getActiveModel(),
          temperature: 0.3,
        });
      } catch (err) {
        setResultText(`Error: ${err instanceof Error ? err.message : String(err)}`);
        setState("result");
      }
    },
    [selectedText, getActiveProviderType, getActiveApiKey, getActiveModel]
  );

  const handleReplace = useCallback(() => {
    const range = savedRangeRef.current;
    if (!range || !resultText) {
      hide();
      return;
    }

    try {
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      range.deleteContents();
      range.insertNode(document.createTextNode(resultText));

      // Trigger input event so Editor.js picks up the change
      containerRef.current?.dispatchEvent(
        new Event("input", { bubbles: true })
      );
    } catch {
      // Range may be invalid if editor content changed
    }
    hide();
  }, [resultText, hide, containerRef]);

  const handleCopy = useCallback(() => {
    if (resultText) {
      navigator.clipboard.writeText(resultText);
    }
    hide();
  }, [resultText, hide]);

  if (state === "idle") return null;

  return (
    <div
      ref={toolbarRef}
      style={{
        position: "absolute",
        top: position.top,
        left: position.left,
        transform: "translateX(-50%)",
        zIndex: 10002,
      }}
    >
      {state === "toolbar" && (
        <div
          style={{
            display: "flex",
            gap: "2px",
            padding: "4px",
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border)",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
        >
          {AI_ACTIONS.map((action) => (
            <button
              key={action.label}
              onClick={() => handleAction(action.prompt)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                padding: "4px 8px",
                border: "none",
                background: "transparent",
                color: "var(--color-text-primary)",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "12px",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background =
                  "var(--color-bg-tertiary)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
              title={action.label}
            >
              <span>{action.icon}</span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}

      {state === "processing" && (
        <div
          style={{
            padding: "12px 16px",
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border)",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            maxWidth: "400px",
            minWidth: "200px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "8px",
              fontSize: "12px",
              color: "var(--color-text-muted)",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: "12px",
                height: "12px",
                border: "2px solid var(--color-accent)",
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "ai-assist-spin 0.8s linear infinite",
              }}
            />
            Processing...
          </div>
          {streamingText && (
            <div
              style={{
                fontSize: "13px",
                color: "var(--color-text-primary)",
                lineHeight: 1.5,
                maxHeight: "200px",
                overflow: "auto",
              }}
            >
              {streamingText}
            </div>
          )}
        </div>
      )}

      {state === "result" && (
        <div
          style={{
            padding: "12px 16px",
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border)",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            maxWidth: "400px",
            minWidth: "200px",
          }}
        >
          <div
            style={{
              fontSize: "13px",
              color: "var(--color-text-primary)",
              lineHeight: 1.5,
              maxHeight: "200px",
              overflow: "auto",
              marginBottom: "8px",
            }}
          >
            {resultText}
          </div>
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              onClick={handleReplace}
              style={{
                padding: "4px 12px",
                background: "var(--color-accent)",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              Replace
            </button>
            <button
              onClick={handleCopy}
              style={{
                padding: "4px 12px",
                background: "var(--color-bg-tertiary)",
                color: "var(--color-text-primary)",
                border: "1px solid var(--color-border)",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              Copy
            </button>
            <button
              onClick={hide}
              style={{
                padding: "4px 12px",
                background: "var(--color-bg-tertiary)",
                color: "var(--color-text-muted)",
                border: "1px solid var(--color-border)",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes ai-assist-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
