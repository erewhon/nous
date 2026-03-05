import { useEffect, useState } from "react";
import type { Page } from "../../types/page";
import { useAIStore } from "../../stores/aiStore";
import { useChatSessionStore } from "../../stores/chatSessionStore";
import { ChatEditor } from "../Chat";
import * as api from "../../utils/api";

interface ChatPageRouterProps {
  page: Page;
  notebookId: string;
  className?: string;
}

/**
 * Routes chat pages to the right editor:
 * - ChatSession format (has "messages" key): opens in AIChatPanel
 * - ChatPageContent format (has "cells" key): opens in ChatEditor
 */
export function ChatPageRouter({ page, notebookId, className }: ChatPageRouterProps) {
  const [format, setFormat] = useState<"session" | "cells" | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    const detect = async () => {
      try {
        const result = await api.getFileContent(notebookId, page.id);
        if (cancelled) return;

        if (result.content) {
          const parsed = JSON.parse(result.content);
          if (parsed.messages && Array.isArray(parsed.messages)) {
            // ChatSession format — redirect to AI panel
            setFormat("session");
            useAIStore.getState().openPanel();
            useAIStore.getState().setActiveSessionId(page.id);
            useChatSessionStore.getState().setActiveSessionId(page.id);
            return;
          }
        }
        // Default to cells/ChatEditor format
        setFormat("cells");
      } catch {
        setFormat("cells");
      }
    };
    detect();
    return () => { cancelled = true; };
  }, [page.id, notebookId]);

  if (format === "loading") {
    return (
      <div className={className} style={{ padding: 24, color: "var(--color-text-muted)" }}>
        Loading chat...
      </div>
    );
  }

  if (format === "session") {
    return (
      <div className={className} style={{ padding: 24, color: "var(--color-text-muted)" }}>
        This conversation is open in the AI panel.
      </div>
    );
  }

  return (
    <ChatEditor
      page={page}
      notebookId={notebookId}
      className={className}
    />
  );
}
