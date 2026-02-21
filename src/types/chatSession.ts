/** A full chat session with all messages */
export interface ChatSession {
  id: string;
  title: string;
  messages: SessionMessage[];
  model: string | null;
  notebookContext: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight summary for listing sessions */
export interface ChatSessionSummary {
  id: string;
  title: string;
  model: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A single message in a session */
export interface SessionMessage {
  role: "system" | "user" | "assistant";
  content: string;
  thinking?: string;
  toolCalls?: ToolCallRecord[];
  stats?: MessageStats;
  timestamp: string;
}

/** Record of a tool call */
export interface ToolCallRecord {
  tool: string;
  arguments: unknown;
  toolCallId: string;
  result?: string;
}

/** Response timing and token statistics */
export interface MessageStats {
  elapsedMs: number;
  tokensUsed?: number;
  tokensPerSecond?: number;
  model?: string;
}
