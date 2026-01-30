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
  // For response cells - code block execution outputs (keyed by block index)
  codeOutputs: z.record(z.string(), z.any()).optional(),
  // For response cells - edited code blocks (keyed by block index string)
  codeEdits: z.record(z.string(), z.string()).optional(),
  // Branch this cell belongs to (default: "main")
  branchId: z.string().default("main"),
});
export type ChatCell = z.infer<typeof ChatCellSchema>;

// Chat branch schema
export const ChatBranchSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentBranch: z.string(), // ID of parent branch ("main" for root branches)
  forkPointCellId: z.string().uuid(), // Cell ID where branch was created
  createdAt: z.string().datetime(),
});
export type ChatBranch = z.infer<typeof ChatBranchSchema>;

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
  // Branch support
  branches: z.array(ChatBranchSchema).default([]),
  currentBranch: z.string().default("main"),
});
export type ChatPageContent = z.infer<typeof ChatPageContentSchema>;

// Helper to create a new chat cell
export function createChatCell(type: ChatCellType, content: string = "", branchId: string = "main"): ChatCell {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type,
    content,
    status: "idle",
    createdAt: now,
    updatedAt: now,
    branchId,
  };
}

// Helper to create a new branch
export function createBranch(name: string, parentBranch: string, forkPointCellId: string): ChatBranch {
  return {
    id: crypto.randomUUID(),
    name,
    parentBranch,
    forkPointCellId,
    createdAt: new Date().toISOString(),
  };
}

// Get the lineage of a branch (from current branch back to main)
export function getBranchLineage(branches: ChatBranch[], branchId: string): string[] {
  const lineage: string[] = [branchId];

  if (branchId === "main") return lineage;

  let currentId = branchId;
  while (currentId !== "main") {
    const branch = branches.find(b => b.id === currentId);
    if (!branch) break;
    lineage.push(branch.parentBranch);
    currentId = branch.parentBranch;
  }

  return lineage;
}

// Get cells visible in a branch (respecting fork points)
export function getCellsForBranch(
  cells: ChatCell[],
  branches: ChatBranch[],
  currentBranch: string
): ChatCell[] {
  if (currentBranch === "main") {
    return cells.filter(c => (c.branchId || "main") === "main");
  }

  const lineage = getBranchLineage(branches, currentBranch);
  const result: ChatCell[] = [];

  // Build a map of fork points for each branch
  const forkPoints = new Map<string, string>();
  for (const branch of branches) {
    forkPoints.set(branch.id, branch.forkPointCellId);
  }

  // For each branch in lineage (from main to current), collect cells
  // Stop at fork point when moving to child branch
  const reversedLineage = [...lineage].reverse(); // main -> ... -> current

  for (let i = 0; i < reversedLineage.length; i++) {
    const branchId = reversedLineage[i];
    const nextBranchId = reversedLineage[i + 1];
    const forkPointId = nextBranchId ? forkPoints.get(nextBranchId) : undefined;

    const branchCells = cells.filter(c => (c.branchId || "main") === branchId);

    for (const cell of branchCells) {
      result.push(cell);
      // If this is the fork point for the next branch, stop here for this branch
      if (forkPointId && cell.id === forkPointId) {
        break;
      }
    }
  }

  return result;
}

// Helper to create default chat page content
export function createDefaultChatContent(): ChatPageContent {
  return {
    version: 1,
    cells: [createChatCell("prompt", "", "main")],
    settings: {
      includePageContext: false,
      maxContextCells: 10,
    },
    branches: [],
    currentBranch: "main",
  };
}

// Helper to build conversation history for AI calls
// Takes visible cells (already filtered by branch) and the current cell ID
export function buildConversationHistory(
  visibleCells: ChatCell[],
  currentCellId: string,
  maxCells: number
): Array<{ role: "user" | "assistant"; content: string }> {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Find current cell index
  const currentIndex = visibleCells.findIndex(c => c.id === currentCellId);
  if (currentIndex === -1) return history;

  // Get cells before current index
  const cellsBefore = visibleCells.slice(0, currentIndex);

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
