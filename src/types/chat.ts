import { z } from "zod";

// Chat cell status
export const ChatCellStatusSchema = z.enum(["idle", "running", "complete", "error"]);
export type ChatCellStatus = z.infer<typeof ChatCellStatusSchema>;

// Chat cell type
export const ChatCellTypeSchema = z.enum(["prompt", "response", "markdown"]);
export type ChatCellType = z.infer<typeof ChatCellTypeSchema>;

// Response statistics
export const ChatStatsSchema = z.object({
  elapsedMs: z.number(),
  tokensUsed: z.number().optional(),
  tokensPerSecond: z.number().optional(),
  model: z.string(),
});
export type ChatStats = z.infer<typeof ChatStatsSchema>;

// Chat cell schema
export const ChatCellSchema = z.object({
  id: z.string().uuid(),
  type: ChatCellTypeSchema,
  content: z.string(),
  status: ChatCellStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // For prompt cells - model override
  model: z.string().optional(),
  // For prompt cells - system prompt override
  systemPrompt: z.string().optional(),
  // For response cells - links to parent prompt
  parentPromptId: z.string().uuid().optional(),
  // For response cells - execution stats
  stats: ChatStatsSchema.optional(),
  // For response cells - extended thinking content
  thinking: z.string().optional(),
  // For response/prompt cells - error message
  error: z.string().optional(),
});
export type ChatCell = z.infer<typeof ChatCellSchema>;

// Chat page settings
export const ChatSettingsSchema = z.object({
  defaultModel: z.string().optional(),
  defaultSystemPrompt: z.string().optional(),
  includePageContext: z.boolean().default(false),
  maxContextCells: z.number().default(10),
});
export type ChatSettings = z.infer<typeof ChatSettingsSchema>;

// Chat page content (stored in .chat file)
export const ChatPageContentSchema = z.object({
  version: z.literal(1),
  cells: z.array(ChatCellSchema),
  settings: ChatSettingsSchema,
});
export type ChatPageContent = z.infer<typeof ChatPageContentSchema>;

// Helper to create a new chat cell
export function createChatCell(type: ChatCellType, content: string = ""): ChatCell {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type,
    content,
    status: "idle",
    createdAt: now,
    updatedAt: now,
  };
}

// Helper to create default chat page content
export function createDefaultChatContent(): ChatPageContent {
  return {
    version: 1,
    cells: [createChatCell("prompt", "")],
    settings: {
      includePageContext: false,
      maxContextCells: 10,
    },
  };
}

// Helper to build conversation history for AI calls
export function buildConversationHistory(
  cells: ChatCell[],
  currentIndex: number,
  maxCells: number
): Array<{ role: "user" | "assistant"; content: string }> {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Get cells before current index
  const cellsBefore = cells.slice(0, currentIndex);

  // Filter to only complete prompt/response pairs
  const relevantCells: ChatCell[] = [];
  for (const cell of cellsBefore) {
    if ((cell.type === "prompt" || cell.type === "response") && cell.status === "complete") {
      relevantCells.push(cell);
    }
  }

  // Take the last N cells based on maxContextCells
  const contextCells = relevantCells.slice(-maxCells * 2);

  for (const cell of contextCells) {
    if (cell.type === "prompt") {
      history.push({ role: "user", content: cell.content });
    } else if (cell.type === "response") {
      history.push({ role: "assistant", content: cell.content });
    }
  }

  return history;
}
