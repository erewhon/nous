// The browser AI stream transport parses the daemon's text/event-stream
// incrementally — chunk boundaries land anywhere, including mid-event.
import { describe, it, expect, vi, beforeEach } from "vitest";

// localStorage polyfill for the node test env (runs before hoisted imports).
vi.hoisted(() => {
  const mem = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  };
});

import { createSseParser, listenAiStream, runBrowserAiStream } from "./aiStream";
import type { StreamEvent } from "../types/ai";

beforeEach(() => {
  localStorage.clear();
});

describe("createSseParser", () => {
  it("parses complete events", () => {
    const seen: string[] = [];
    const p = createSseParser((d) => seen.push(d));
    p.push('data: {"type":"chunk","content":"hi"}\n\n');
    expect(seen).toEqual(['{"type":"chunk","content":"hi"}']);
  });

  it("handles chunk boundaries mid-event", () => {
    const seen: string[] = [];
    const p = createSseParser((d) => seen.push(d));
    p.push('data: {"type":"chu');
    expect(seen).toEqual([]);
    p.push('nk","content":"a"}\n');
    expect(seen).toEqual([]);
    p.push('\ndata: {"type":"done"}\n\n');
    expect(seen).toEqual(['{"type":"chunk","content":"a"}', '{"type":"done"}']);
  });

  it("handles multiple events in one chunk and CRLF", () => {
    const seen: string[] = [];
    const p = createSseParser((d) => seen.push(d));
    p.push('data: {"a":1}\r\n\ndata: {"b":2}\n\n');
    expect(seen).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("ignores comments and non-data fields", () => {
    const seen: string[] = [];
    const p = createSseParser((d) => seen.push(d));
    p.push(': keep-alive\n\nevent: message\ndata: {"x":1}\n\n');
    expect(seen).toEqual(['{"x":1}']);
  });

  it("joins multi-line data fields", () => {
    const seen: string[] = [];
    const p = createSseParser((d) => seen.push(d));
    p.push("data: line1\ndata: line2\n\n");
    expect(seen).toEqual(["line1\nline2"]);
  });
});

describe("runBrowserAiStream", () => {
  function sseResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  it("dispatches parsed events to listeners and resolves at stream end", async () => {
    const events: StreamEvent[] = [];
    const unlisten = await listenAiStream((e) => events.push(e));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          'data: {"type":"chunk","content":"hel',
          'lo"}\n\ndata: {"type":"done","model":"m","tokensUsed":5}\n\n',
        ])
      )
    );

    await runBrowserAiStream({ userMessage: "hi" });
    expect(events).toEqual([
      { type: "chunk", content: "hello" },
      { type: "done", model: "m", tokensUsed: 5 },
    ]);

    unlisten();
    vi.unstubAllGlobals();
  });

  it("dispatches an error event and rejects on HTTP failure", async () => {
    const events: StreamEvent[] = [];
    const unlisten = await listenAiStream((e) => events.push(e));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "AI chat: no provider" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    await expect(runBrowserAiStream({ userMessage: "hi" })).rejects.toThrow(
      "no provider"
    );
    expect(events).toEqual([
      { type: "error", message: "AI chat: no provider" },
    ]);

    unlisten();
    vi.unstubAllGlobals();
  });

  it("sends the Bearer token from localStorage", async () => {
    localStorage.setItem("nous-daemon-api-key", "rw:secret");
    const fetchMock = vi.fn(async () => sseResponse(['data: {"type":"done","model":"m","tokensUsed":0}\n\n']));
    vi.stubGlobal("fetch", fetchMock);

    await runBrowserAiStream({ userMessage: "hi" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/ai/chat-stream");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer rw:secret"
    );

    vi.unstubAllGlobals();
  });
});
