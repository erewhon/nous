// Platform-neutral AI stream subscription.
//
// Desktop: streaming AI responses arrive as Tauri "ai-stream" events while
// the ai_chat_stream invoke blocks until completion. Browser: the daemon's
// POST /api/ai/chat-stream returns the same StreamEvent objects over SSE
// (see the AI section of bin/cli/api.rs) — runBrowserAiStream reads the
// response body and feeds this module's local listener bus so consumers
// keep the exact listen-then-start shape they use on desktop.

import { isTauri } from "./platform";
import { getDaemonBaseUrl, getStoredDaemonApiKey } from "./daemonConfig";
import type { StreamEvent } from "../types/ai";

export type AiStreamHandler = (event: StreamEvent) => void;

const browserListeners = new Set<AiStreamHandler>();

/**
 * Subscribe to AI stream events. Returns an unlisten function.
 * Tauri: wraps listen("ai-stream"); browser: local bus fed by the SSE
 * reader in runBrowserAiStream (started via api.aiChatStream).
 */
export async function listenAiStream(
  handler: AiStreamHandler
): Promise<() => void> {
  if (isTauri()) {
    const { listen } = await import("../platform/event");
    return listen<StreamEvent>("ai-stream", (event) => handler(event.payload));
  }
  browserListeners.add(handler);
  return () => {
    browserListeners.delete(handler);
  };
}

function dispatch(event: StreamEvent): void {
  for (const handler of browserListeners) {
    try {
      handler(event);
    } catch (err) {
      console.error("[ai-stream] handler error:", err);
    }
  }
}

/**
 * Incremental text/event-stream parser. Events are separated by a blank
 * line; each `data:` line carries a payload chunk. Exported for tests.
 */
export function createSseParser(onData: (data: string) => void) {
  let buffer = "";
  return {
    push(chunk: string): void {
      buffer += chunk;
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLines = rawEvent
          .split("\n")
          .map((l) => l.replace(/\r$/, ""))
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""));
        if (dataLines.length > 0) {
          onData(dataLines.join("\n"));
        }
      }
    },
  };
}

/**
 * Browser transport for aiChatStream: POST the request to the daemon's
 * SSE endpoint and dispatch each StreamEvent to listenAiStream handlers.
 * Resolves when the stream ends (after done/error), mirroring the desktop
 * invoke which blocks until completion.
 */
export async function runBrowserAiStream(body: unknown): Promise<void> {
  const key = getStoredDaemonApiKey();
  const resp = await fetch(`${getDaemonBaseUrl()}/api/ai/chat-stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok || !resp.body) {
    let message = `AI stream failed: HTTP ${resp.status}`;
    try {
      const errBody = await resp.json();
      if (errBody?.error) message = errBody.error;
    } catch {
      // non-JSON error body
    }
    // Surface through the stream too so UIs relying only on events recover.
    dispatch({ type: "error", message } as StreamEvent);
    throw new Error(message);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser((data) => {
    try {
      dispatch(JSON.parse(data) as StreamEvent);
    } catch {
      console.warn("[ai-stream] Unparseable SSE data:", data.slice(0, 200));
    }
  });

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
}
