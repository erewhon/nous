/** A branch in a chat session conversation */
export interface ChatSessionBranch {
  id: string;
  name: string;
  parentBranch: string;       // "main" for root branches
  forkPointIndex: number;     // index in messages array where branch forked
  createdAt: string;
}

/** A full chat session with all messages */
export interface ChatSession {
  id: string;
  title: string;
  messages: SessionMessage[];
  model: string | null;
  notebookContext: string | null;
  createdAt: string;
  updatedAt: string;
  branches?: ChatSessionBranch[];
  currentBranch?: string;     // defaults to "main"
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
  branchId?: string;          // defaults to "main"
}

/** Record of a tool call */
export interface ToolCallRecord {
  tool: string;
  arguments: unknown;
  toolCallId: string;
  result?: string;
  error?: string;
}

/** Response timing and token statistics */
export interface MessageStats {
  elapsedMs: number;
  tokensUsed?: number;
  tokensPerSecond?: number;
  model?: string;
}
