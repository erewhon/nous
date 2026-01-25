import { invoke } from "@tauri-apps/api/core";
import type { Notebook, NotebookType } from "../types/notebook";
import type { Page, EditorData, SearchResult, Folder, Section } from "../types/page";
import type {
  SyncConfigInput,
  SyncStatus,
  SyncResult,
  QueueItem,
} from "../types/sync";

// ===== Notebook API =====

export async function listNotebooks(): Promise<Notebook[]> {
  return invoke<Notebook[]>("list_notebooks");
}

export async function getNotebook(notebookId: string): Promise<Notebook> {
  return invoke<Notebook>("get_notebook", { notebookId });
}

export async function createNotebook(
  name: string,
  notebookType?: NotebookType
): Promise<Notebook> {
  return invoke<Notebook>("create_notebook", { name, notebookType });
}

export async function updateNotebook(
  notebookId: string,
  updates: {
    name?: string;
    icon?: string;
    color?: string;
    sectionsEnabled?: boolean;
    archived?: boolean;
    systemPrompt?: string;
    systemPromptMode?: string;
    aiProvider?: string;
    aiModel?: string;
  }
): Promise<Notebook> {
  return invoke<Notebook>("update_notebook", { notebookId, ...updates });
}

export async function deleteNotebook(notebookId: string): Promise<void> {
  return invoke("delete_notebook", { notebookId });
}

export async function reorderNotebooks(notebookIds: string[]): Promise<void> {
  return invoke("reorder_notebooks", { notebookIds });
}

// ===== Page API =====

export async function listPages(
  notebookId: string,
  includeArchived?: boolean
): Promise<Page[]> {
  return invoke<Page[]>("list_pages", { notebookId, includeArchived });
}

export async function getPage(
  notebookId: string,
  pageId: string
): Promise<Page> {
  return invoke<Page>("get_page", { notebookId, pageId });
}

export async function createPage(
  notebookId: string,
  title: string,
  folderId?: string,
  parentPageId?: string,
  sectionId?: string
): Promise<Page> {
  return invoke<Page>("create_page", { notebookId, title, folderId, parentPageId, sectionId });
}

export async function updatePage(
  notebookId: string,
  pageId: string,
  updates: {
    title?: string;
    content?: EditorData;
    tags?: string[];
    systemPrompt?: string;
    systemPromptMode?: string;
    sectionId?: string | null;
    pageType?: "standard" | "markdown" | "pdf" | "jupyter" | "epub" | "calendar" | "chat";
    fileExtension?: string | null;
  },
  commit?: boolean // Whether to create a git commit (default: false, use true for explicit saves)
): Promise<Page> {
  // Tauri automatically converts camelCase to snake_case for command parameters
  const params: Record<string, unknown> = {
    notebookId,
    pageId,
    commit,
  };
  if (updates.title !== undefined) params.title = updates.title;
  if (updates.content !== undefined) params.content = updates.content;
  if (updates.tags !== undefined) params.tags = updates.tags;
  if (updates.systemPrompt !== undefined) params.systemPrompt = updates.systemPrompt;
  if (updates.systemPromptMode !== undefined) params.systemPromptMode = updates.systemPromptMode;
  if (updates.sectionId !== undefined) params.sectionId = updates.sectionId;
  if (updates.pageType !== undefined) params.pageType = updates.pageType;
  if (updates.fileExtension !== undefined) params.fileExtension = updates.fileExtension;

  return invoke<Page>("update_page", params);
}

export async function deletePage(
  notebookId: string,
  pageId: string
): Promise<void> {
  return invoke("delete_page", { notebookId, pageId });
}

export async function permanentDeletePage(
  notebookId: string,
  pageId: string
): Promise<void> {
  return invoke("permanent_delete_page", { notebookId, pageId });
}

export async function restorePage(
  notebookId: string,
  pageId: string
): Promise<Page> {
  return invoke<Page>("restore_page", { notebookId, pageId });
}

export async function listTrash(notebookId: string): Promise<Page[]> {
  return invoke<Page[]>("list_trash", { notebookId });
}

export async function purgeOldTrash(
  notebookId: string,
  days?: number
): Promise<number> {
  return invoke<number>("purge_old_trash", { notebookId, days });
}

export async function movePageToParent(
  notebookId: string,
  pageId: string,
  parentPageId?: string,
  position?: number
): Promise<Page> {
  return invoke<Page>("move_page_to_parent", { notebookId, pageId, parentPageId, position });
}

export async function movePageToNotebook(
  sourceNotebookId: string,
  pageId: string,
  targetNotebookId: string,
  targetFolderId?: string
): Promise<Page> {
  return invoke<Page>("move_page_to_notebook", { sourceNotebookId, pageId, targetNotebookId, targetFolderId });
}

// ===== Folder API =====

export async function listFolders(notebookId: string): Promise<Folder[]> {
  return invoke<Folder[]>("list_folders", { notebookId });
}

export async function getFolder(
  notebookId: string,
  folderId: string
): Promise<Folder> {
  return invoke<Folder>("get_folder", { notebookId, folderId });
}

export async function createFolder(
  notebookId: string,
  name: string,
  parentId?: string,
  sectionId?: string
): Promise<Folder> {
  return invoke<Folder>("create_folder", { notebookId, name, parentId, sectionId });
}

export async function updateFolder(
  notebookId: string,
  folderId: string,
  updates: {
    name?: string;
    parentId?: string | null;
    color?: string | null;
    sectionId?: string | null;
  }
): Promise<Folder> {
  return invoke<Folder>("update_folder", {
    notebookId,
    folderId,
    name: updates.name,
    parentId: updates.parentId !== undefined ? updates.parentId : undefined,
    color: updates.color !== undefined ? updates.color : undefined,
    sectionId: updates.sectionId !== undefined ? updates.sectionId : undefined,
  });
}

export async function deleteFolder(
  notebookId: string,
  folderId: string,
  movePagesTo?: string
): Promise<void> {
  return invoke("delete_folder", { notebookId, folderId, movePagesTo });
}

export async function movePageToFolder(
  notebookId: string,
  pageId: string,
  folderId?: string,
  position?: number
): Promise<Page> {
  return invoke<Page>("move_page_to_folder", {
    notebookId,
    pageId,
    folderId,
    position,
  });
}

export async function archivePage(
  notebookId: string,
  pageId: string
): Promise<Page> {
  return invoke<Page>("archive_page", { notebookId, pageId });
}

export async function unarchivePage(
  notebookId: string,
  pageId: string,
  targetFolderId?: string
): Promise<Page> {
  return invoke<Page>("unarchive_page", {
    notebookId,
    pageId,
    targetFolderId,
  });
}

export async function reorderFolders(
  notebookId: string,
  parentId: string | null,
  folderIds: string[]
): Promise<void> {
  return invoke("reorder_folders", { notebookId, parentId, folderIds });
}

export async function reorderPages(
  notebookId: string,
  folderId: string | null,
  pageIds: string[]
): Promise<void> {
  return invoke("reorder_pages", { notebookId, folderId, pageIds });
}

export async function ensureArchiveFolder(notebookId: string): Promise<Folder> {
  return invoke<Folder>("ensure_archive_folder", { notebookId });
}

// ===== Search API =====

export async function searchPages(
  query: string,
  limit?: number
): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("search_pages", { query, limit });
}

export async function fuzzySearchPages(
  query: string,
  limit?: number
): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("fuzzy_search_pages", { query, limit });
}

export async function rebuildSearchIndex(): Promise<void> {
  return invoke("rebuild_search_index");
}

// ===== AI API =====

import type {
  ChatMessage,
  ChatResponse,
  ChatResponseWithActions,
  NotebookInfo,
  PageContext,
} from "../types/ai";

export async function aiChat(
  messages: ChatMessage[],
  options?: {
    providerType?: string;
    apiKey?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }
): Promise<ChatResponse> {
  return invoke<ChatResponse>("ai_chat", {
    messages,
    providerType: options?.providerType,
    apiKey: options?.apiKey,
    model: options?.model,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
  });
}

export async function aiChatWithContext(
  userMessage: string,
  options?: {
    pageContext?: PageContext;
    conversationHistory?: ChatMessage[];
    providerType?: string;
    apiKey?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }
): Promise<ChatResponse> {
  return invoke<ChatResponse>("ai_chat_with_context", {
    userMessage,
    pageContext: options?.pageContext,
    conversationHistory: options?.conversationHistory,
    providerType: options?.providerType,
    apiKey: options?.apiKey,
    model: options?.model,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
  });
}

export async function aiSummarizePage(
  content: string,
  options?: {
    title?: string;
    maxLength?: number;
    providerType?: string;
    apiKey?: string;
    model?: string;
  }
): Promise<string> {
  return invoke<string>("ai_summarize_page", {
    content,
    title: options?.title,
    maxLength: options?.maxLength,
    providerType: options?.providerType,
    apiKey: options?.apiKey,
    model: options?.model,
  });
}

export async function aiSuggestTags(
  content: string,
  options?: {
    existingTags?: string[];
    providerType?: string;
    apiKey?: string;
    model?: string;
  }
): Promise<string[]> {
  return invoke<string[]>("ai_suggest_tags", {
    content,
    existingTags: options?.existingTags,
    providerType: options?.providerType,
    apiKey: options?.apiKey,
    model: options?.model,
  });
}

export interface PageInfo {
  id: string;
  title: string;
  summary?: string;
}

export interface RelatedPageSuggestion {
  id: string;
  title: string;
  reason: string;
}

export async function aiSuggestRelatedPages(
  content: string,
  title: string,
  availablePages: PageInfo[],
  options?: {
    existingLinks?: string[];
    maxSuggestions?: number;
    providerType?: string;
    apiKey?: string;
    model?: string;
  }
): Promise<RelatedPageSuggestion[]> {
  return invoke<RelatedPageSuggestion[]>("ai_suggest_related_pages", {
    content,
    title,
    availablePages,
    existingLinks: options?.existingLinks,
    maxSuggestions: options?.maxSuggestions,
    providerType: options?.providerType,
    apiKey: options?.apiKey,
    model: options?.model,
  });
}

export interface PageSummaryInput {
  title: string;
  content: string;
  tags: string[];
}

export interface PagesSummaryResult {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  themes: string[];
  pagesCount: number;
  model: string;
  tokensUsed?: number;
}

export async function aiSummarizePages(
  pages: PageSummaryInput[],
  options?: {
    customPrompt?: string;
    summaryStyle?: "concise" | "detailed" | "bullets" | "narrative";
    providerType?: string;
    apiKey?: string;
    model?: string;
  }
): Promise<PagesSummaryResult> {
  return invoke<PagesSummaryResult>("ai_summarize_pages", {
    pages,
    customPrompt: options?.customPrompt,
    summaryStyle: options?.summaryStyle,
    providerType: options?.providerType,
    apiKey: options?.apiKey,
    model: options?.model,
  });
}

export async function aiChatWithTools(
  userMessage: string,
  options?: {
    pageContext?: PageContext;
    conversationHistory?: ChatMessage[];
    availableNotebooks?: NotebookInfo[];
    currentNotebookId?: string;
    providerType?: string;
    apiKey?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }
): Promise<ChatResponseWithActions> {
  return invoke<ChatResponseWithActions>("ai_chat_with_tools", {
    userMessage,
    pageContext: options?.pageContext,
    conversationHistory: options?.conversationHistory,
    availableNotebooks: options?.availableNotebooks,
    currentNotebookId: options?.currentNotebookId,
    providerType: options?.providerType,
    apiKey: options?.apiKey,
    model: options?.model,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
  });
}

export async function aiChatStream(
  userMessage: string,
  options?: {
    pageContext?: PageContext;
    conversationHistory?: ChatMessage[];
    availableNotebooks?: NotebookInfo[];
    currentNotebookId?: string;
    providerType?: string;
    apiKey?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  }
): Promise<void> {
  return invoke("ai_chat_stream", {
    userMessage,
    pageContext: options?.pageContext,
    conversationHistory: options?.conversationHistory,
    availableNotebooks: options?.availableNotebooks,
    currentNotebookId: options?.currentNotebookId,
    providerType: options?.providerType,
    apiKey: options?.apiKey,
    model: options?.model,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    systemPrompt: options?.systemPrompt,
  });
}

// ===== Tag Management API =====

export interface TagInfo {
  name: string;
  count: number;
}

export async function getAllTags(): Promise<TagInfo[]> {
  return invoke<TagInfo[]>("get_all_tags");
}

export async function getNotebookTags(notebookId: string): Promise<TagInfo[]> {
  return invoke<TagInfo[]>("get_notebook_tags", { notebookId });
}

export async function renameTag(
  notebookId: string,
  oldTag: string,
  newTag: string
): Promise<number> {
  return invoke<number>("rename_tag", { notebookId, oldTag, newTag });
}

export async function mergeTags(
  notebookId: string,
  tagsToMerge: string[],
  targetTag: string
): Promise<number> {
  return invoke<number>("merge_tags", { notebookId, tagsToMerge, targetTag });
}

export async function deleteTag(notebookId: string, tag: string): Promise<number> {
  return invoke<number>("delete_tag", { notebookId, tag });
}

// ===== Markdown Import/Export API =====

export async function exportPageToMarkdown(
  notebookId: string,
  pageId: string
): Promise<string> {
  return invoke<string>("export_page_markdown", { notebookId, pageId });
}

export async function importMarkdown(
  notebookId: string,
  markdown: string,
  filename: string
): Promise<Page> {
  return invoke<Page>("import_markdown", { notebookId, markdown, filename });
}

export async function exportPageToFile(
  notebookId: string,
  pageId: string,
  path: string
): Promise<void> {
  return invoke("export_page_to_file", { notebookId, pageId, path });
}

export async function importMarkdownFile(
  notebookId: string,
  path: string
): Promise<Page> {
  return invoke<Page>("import_markdown_file", { notebookId, path });
}

// ===== Web Research API =====

import type {
  SearchResponse,
  ScrapedContent,
  ResearchSummary,
  BrowserTaskResult,
} from "../types/webResearch";

export async function webSearch(
  query: string,
  apiKey: string,
  options?: {
    maxResults?: number;
    searchDepth?: "basic" | "advanced";
    includeAnswer?: boolean;
  }
): Promise<SearchResponse> {
  return invoke<SearchResponse>("web_search", {
    query,
    apiKey,
    maxResults: options?.maxResults,
    searchDepth: options?.searchDepth,
    includeAnswer: options?.includeAnswer,
  });
}

export async function scrapeUrl(url: string): Promise<ScrapedContent> {
  return invoke<ScrapedContent>("scrape_url", { url });
}

export async function summarizeResearch(
  contents: ScrapedContent[],
  query: string,
  options?: {
    providerType?: string;
    apiKey?: string;
    model?: string;
  }
): Promise<ResearchSummary> {
  return invoke<ResearchSummary>("summarize_research", {
    contents,
    query,
    providerType: options?.providerType,
    apiKey: options?.apiKey,
    model: options?.model,
  });
}

// ===== Browser Automation API =====

export async function runBrowserTask(
  task: string,
  providerType: string,
  apiKey: string,
  model: string,
  captureScreenshot = false
): Promise<BrowserTaskResult> {
  return invoke<BrowserTaskResult>("browser_run_task", {
    task,
    providerType,
    apiKey,
    model,
    captureScreenshot,
  });
}

// ===== Backup API =====

export interface BackupInfo {
  path: string;
  version: string;
  createdAt: string;
  notebookId: string;
  notebookName: string;
  pageCount: number;
  assetCount: number;
}

export async function exportNotebookZip(
  notebookId: string,
  outputPath: string
): Promise<BackupInfo> {
  return invoke<BackupInfo>("export_notebook_zip", { notebookId, outputPath });
}

export async function importNotebookZip(zipPath: string): Promise<Notebook> {
  return invoke<Notebook>("import_notebook_zip", { zipPath });
}

export async function getBackupMetadata(zipPath: string): Promise<BackupInfo> {
  return invoke<BackupInfo>("get_backup_metadata", { zipPath });
}

export async function createNotebookBackup(
  notebookId: string
): Promise<BackupInfo> {
  return invoke<BackupInfo>("create_notebook_backup", { notebookId });
}

export async function listBackups(): Promise<BackupInfo[]> {
  return invoke<BackupInfo[]>("list_backups");
}

export async function deleteBackup(backupPath: string): Promise<void> {
  return invoke("delete_backup", { backupPath });
}

// ===== Backup Settings API =====

export type BackupFrequency = "daily" | "weekly" | "monthly";

export interface BackupSettings {
  enabled: boolean;
  frequency: BackupFrequency;
  time: string; // "HH:MM" format
  dayOfWeek?: number; // 0-6 for weekly (Sunday=0)
  dayOfMonth?: number; // 1-31 for monthly
  maxBackupsPerNotebook: number;
  notebookIds: string[]; // empty = all notebooks
  lastBackup?: string; // ISO date string
  nextBackup?: string; // ISO date string
}

export async function getBackupSettings(): Promise<BackupSettings> {
  return invoke<BackupSettings>("get_backup_settings");
}

export async function updateBackupSettings(
  settings: BackupSettings
): Promise<BackupSettings> {
  return invoke<BackupSettings>("update_backup_settings", { settings });
}

export async function runScheduledBackup(): Promise<BackupInfo[]> {
  return invoke<BackupInfo[]>("run_scheduled_backup");
}

// ===== Notion Import API =====

export interface NotionPagePreview {
  title: string;
  path: string;
  hasImages: boolean;
  isDatabaseRow: boolean;
}

export interface NotionImportPreview {
  pageCount: number;
  assetCount: number;
  databaseCount: number;
  databaseRowCount: number;
  nestedDepth: number;
  pages: NotionPagePreview[];
  suggestedName: string;
  warnings: string[];
}

export async function previewNotionExport(
  zipPath: string
): Promise<NotionImportPreview> {
  return invoke<NotionImportPreview>("preview_notion_export", { zipPath });
}

export async function importNotionExport(
  zipPath: string,
  notebookName?: string
): Promise<Notebook> {
  return invoke<Notebook>("import_notion_export", { zipPath, notebookName });
}

// ===== Obsidian Import API =====

export interface ObsidianPagePreview {
  title: string;
  path: string;
  tags: string[];
  hasWikiLinks: boolean;
}

export interface ObsidianImportPreview {
  pageCount: number;
  assetCount: number;
  folderCount: number;
  nestedDepth: number;
  pages: ObsidianPagePreview[];
  suggestedName: string;
  warnings: string[];
  hasObsidianConfig: boolean;
}

export async function previewObsidianVault(
  vaultPath: string
): Promise<ObsidianImportPreview> {
  return invoke<ObsidianImportPreview>("preview_obsidian_vault_cmd", { vaultPath });
}

export async function importObsidianVault(
  vaultPath: string,
  notebookName?: string
): Promise<Notebook> {
  return invoke<Notebook>("import_obsidian_vault_cmd", { vaultPath, notebookName });
}

// ===== Evernote Import API =====

export interface EvernoteNotePreview {
  title: string;
  tags: string[];
  hasAttachments: boolean;
  created: string | null;
}

export interface EvernoteImportPreview {
  noteCount: number;
  resourceCount: number;
  notes: EvernoteNotePreview[];
  suggestedName: string;
  warnings: string[];
}

export async function previewEvernoteEnex(
  enexPath: string
): Promise<EvernoteImportPreview> {
  return invoke<EvernoteImportPreview>("preview_evernote_enex_cmd", { enexPath });
}

export async function importEvernoteEnex(
  enexPath: string,
  notebookName?: string
): Promise<Notebook> {
  return invoke<Notebook>("import_evernote_enex_cmd", { enexPath, notebookName });
}

// ===== Scrivener Import API =====

export interface ScrivenerDocPreview {
  title: string;
  folderPath: string | null;
  hasContent: boolean;
}

export interface ScrivenerImportPreview {
  documentCount: number;
  folderCount: number;
  documents: ScrivenerDocPreview[];
  projectTitle: string;
  warnings: string[];
}

export async function previewScrivenerProject(
  scrivPath: string
): Promise<ScrivenerImportPreview> {
  return invoke<ScrivenerImportPreview>("preview_scrivener_project_cmd", { scrivPath });
}

export async function importScrivenerProject(
  scrivPath: string,
  notebookName?: string
): Promise<Notebook> {
  return invoke<Notebook>("import_scrivener_project_cmd", { scrivPath, notebookName });
}

// ===== Org-mode Import API =====

export interface OrgmodePagePreview {
  title: string;
  path: string;
  tags: string[];
  hasTodos: boolean;
  hasScheduled: boolean;
}

export interface OrgmodeImportPreview {
  pageCount: number;
  assetCount: number;
  folderCount: number;
  nestedDepth: number;
  pages: OrgmodePagePreview[];
  suggestedName: string;
  warnings: string[];
  isSingleFile: boolean;
}

export async function previewOrgmode(
  sourcePath: string
): Promise<OrgmodeImportPreview> {
  return invoke<OrgmodeImportPreview>("preview_orgmode_cmd", { sourcePath });
}

export async function importOrgmode(
  sourcePath: string,
  notebookName?: string
): Promise<Notebook> {
  return invoke<Notebook>("import_orgmode_cmd", { sourcePath, notebookName });
}

// ===== Joplin Import API =====

export interface JoplinNotePreview {
  title: string;
  folderPath: string | null;
  tags: string[];
  hasAttachments: boolean;
  isTodo: boolean;
  created: string | null;
}

export interface JoplinImportPreview {
  noteCount: number;
  folderCount: number;
  tagCount: number;
  resourceCount: number;
  notes: JoplinNotePreview[];
  suggestedName: string;
  warnings: string[];
  isJexArchive: boolean;
}

export async function previewJoplinImport(
  path: string
): Promise<JoplinImportPreview> {
  return invoke<JoplinImportPreview>("preview_joplin_import_cmd", { path });
}

export async function importJoplin(
  path: string,
  notebookName?: string
): Promise<Notebook> {
  return invoke<Notebook>("import_joplin_cmd", { path, notebookName });
}

// ===== Actions API =====

import type {
  Action,
  ActionCategory,
  ActionExecutionResult,
  ActionUpdate,
  ScheduledActionInfo,
} from "../types/action";

export async function listActions(): Promise<Action[]> {
  return invoke<Action[]>("list_actions");
}

export async function getAction(actionId: string): Promise<Action> {
  return invoke<Action>("get_action", { actionId });
}

export async function createAction(
  name: string,
  description: string,
  options?: {
    category?: ActionCategory;
    triggers?: Action["triggers"];
    steps?: Action["steps"];
  }
): Promise<Action> {
  return invoke<Action>("create_action", {
    name,
    description,
    category: options?.category,
    triggers: options?.triggers,
    steps: options?.steps,
  });
}

export async function updateAction(
  actionId: string,
  updates: ActionUpdate
): Promise<Action> {
  return invoke<Action>("update_action", { actionId, updates });
}

export async function deleteAction(actionId: string): Promise<void> {
  return invoke("delete_action", { actionId });
}

export async function runAction(
  actionId: string,
  options?: {
    variables?: Record<string, string>;
    currentNotebookId?: string;
  }
): Promise<ActionExecutionResult> {
  return invoke<ActionExecutionResult>("run_action", {
    actionId,
    variables: options?.variables,
    currentNotebookId: options?.currentNotebookId,
  });
}

export async function runActionByName(
  actionName: string,
  options?: {
    variables?: Record<string, string>;
    currentNotebookId?: string;
  }
): Promise<ActionExecutionResult> {
  return invoke<ActionExecutionResult>("run_action_by_name", {
    actionName,
    variables: options?.variables,
    currentNotebookId: options?.currentNotebookId,
  });
}

export async function findActionsByKeywords(
  input: string
): Promise<Action[]> {
  return invoke<Action[]>("find_actions_by_keywords", { input });
}

export async function getActionsByCategory(
  category: ActionCategory
): Promise<Action[]> {
  return invoke<Action[]>("get_actions_by_category", { category });
}

export async function getScheduledActions(): Promise<ScheduledActionInfo[]> {
  return invoke<ScheduledActionInfo[]>("get_scheduled_actions");
}

export async function setActionEnabled(
  actionId: string,
  enabled: boolean
): Promise<Action> {
  return invoke<Action>("set_action_enabled", { actionId, enabled });
}

// ===== Inbox API =====

import type {
  InboxItem,
  InboxSummary,
  CaptureRequest,
  ApplyActionsRequest,
  ApplyActionsResult,
} from "../types/inbox";
import type {
  Goal,
  GoalProgress,
  GoalStats,
  GoalsSummary,
  CreateGoalRequest,
  UpdateGoalRequest,
} from "../types/goals";

export async function inboxCapture(request: CaptureRequest): Promise<InboxItem> {
  return invoke<InboxItem>("inbox_capture", { request });
}

export async function inboxList(): Promise<InboxItem[]> {
  return invoke<InboxItem[]>("inbox_list");
}

export async function inboxListUnprocessed(): Promise<InboxItem[]> {
  return invoke<InboxItem[]>("inbox_list_unprocessed");
}

export async function inboxSummary(): Promise<InboxSummary> {
  return invoke<InboxSummary>("inbox_summary");
}

export async function inboxClassify(itemIds?: string[]): Promise<InboxItem[]> {
  return invoke<InboxItem[]>("inbox_classify", { itemIds });
}

export async function inboxApplyActions(
  request: ApplyActionsRequest
): Promise<ApplyActionsResult> {
  return invoke<ApplyActionsResult>("inbox_apply_actions", { request });
}

export async function inboxDelete(itemId: string): Promise<void> {
  return invoke("inbox_delete", { itemId });
}

export async function inboxClearProcessed(): Promise<number> {
  return invoke<number>("inbox_clear_processed");
}

// ========== Git Operations ==========

export interface GitStatus {
  is_repo: boolean;
  is_dirty: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  has_remote: boolean;
  remote_url: string | null;
  last_commit: CommitInfo | null;
}

export interface CommitInfo {
  id: string;
  short_id: string;
  message: string;
  author: string;
  timestamp: string;
}

export interface MergeResult {
  success: boolean;
  hasConflicts: boolean;
  conflicts: ConflictInfo[];
  message: string;
}

export interface ConflictInfo {
  path: string;
  ancestorId: string | null;
  ourId: string | null;
  theirId: string | null;
}

export interface ConflictContent {
  path: string;
  ancestor: string | null;
  ours: string | null;
  theirs: string | null;
}

export type ResolutionStrategy = "ours" | "theirs" | "custom";

export async function gitIsEnabled(notebookId: string): Promise<boolean> {
  return invoke<boolean>("git_is_enabled", { notebookId });
}

export async function gitInit(notebookId: string): Promise<void> {
  return invoke("git_init", { notebookId });
}

export async function gitStatus(notebookId: string): Promise<GitStatus> {
  return invoke<GitStatus>("git_status", { notebookId });
}

export async function gitCommit(
  notebookId: string,
  message: string
): Promise<CommitInfo> {
  return invoke<CommitInfo>("git_commit", { notebookId, message });
}

export async function gitHistory(
  notebookId: string,
  pageId?: string,
  limit?: number
): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("git_history", { notebookId, pageId, limit });
}

export async function gitGetPageAtCommit(
  notebookId: string,
  pageId: string,
  commitId: string
): Promise<string> {
  return invoke<string>("git_get_page_at_commit", {
    notebookId,
    pageId,
    commitId,
  });
}

export async function gitDiff(
  notebookId: string,
  pageId: string,
  oldCommitId: string,
  newCommitId: string
): Promise<string> {
  return invoke<string>("git_diff", {
    notebookId,
    pageId,
    oldCommitId,
    newCommitId,
  });
}

export async function gitRestorePage(
  notebookId: string,
  pageId: string,
  commitId: string
): Promise<void> {
  return invoke("git_restore_page", { notebookId, pageId, commitId });
}

export async function gitSetRemote(
  notebookId: string,
  url: string
): Promise<void> {
  return invoke("git_set_remote", { notebookId, url });
}

export async function gitRemoveRemote(notebookId: string): Promise<void> {
  return invoke("git_remove_remote", { notebookId });
}

export async function gitFetch(
  notebookId: string,
  username?: string,
  password?: string
): Promise<void> {
  return invoke("git_fetch", { notebookId, username, password });
}

export async function gitPush(
  notebookId: string,
  username?: string,
  password?: string
): Promise<void> {
  return invoke("git_push", { notebookId, username, password });
}

export async function gitPull(
  notebookId: string,
  username?: string,
  password?: string
): Promise<void> {
  return invoke("git_pull", { notebookId, username, password });
}

export async function gitListBranches(notebookId: string): Promise<string[]> {
  return invoke<string[]>("git_list_branches", { notebookId });
}

export async function gitCurrentBranch(notebookId: string): Promise<string> {
  return invoke<string>("git_current_branch", { notebookId });
}

export async function gitCreateBranch(
  notebookId: string,
  branchName: string
): Promise<void> {
  return invoke("git_create_branch", { notebookId, branchName });
}

export async function gitSwitchBranch(
  notebookId: string,
  branchName: string
): Promise<void> {
  return invoke("git_switch_branch", { notebookId, branchName });
}

export async function gitDeleteBranch(
  notebookId: string,
  branchName: string
): Promise<void> {
  return invoke("git_delete_branch", { notebookId, branchName });
}

export async function gitMergeBranch(
  notebookId: string,
  branchName: string
): Promise<MergeResult> {
  return invoke<MergeResult>("git_merge_branch", { notebookId, branchName });
}

export async function gitIsMerging(notebookId: string): Promise<boolean> {
  return invoke<boolean>("git_is_merging", { notebookId });
}

export async function gitListConflicts(
  notebookId: string
): Promise<ConflictInfo[]> {
  return invoke<ConflictInfo[]>("git_list_conflicts", { notebookId });
}

export async function gitGetConflictContent(
  notebookId: string,
  filePath: string
): Promise<ConflictContent> {
  return invoke<ConflictContent>("git_get_conflict_content", {
    notebookId,
    filePath,
  });
}

export async function gitResolveConflict(
  notebookId: string,
  filePath: string,
  strategy: ResolutionStrategy,
  customContent?: string
): Promise<void> {
  return invoke("git_resolve_conflict", {
    notebookId,
    filePath,
    strategy,
    customContent,
  });
}

export async function gitResolveAllConflicts(
  notebookId: string,
  strategy: ResolutionStrategy
): Promise<void> {
  return invoke("git_resolve_all_conflicts", { notebookId, strategy });
}

export async function gitCommitMerge(
  notebookId: string,
  message?: string
): Promise<CommitInfo> {
  return invoke<CommitInfo>("git_commit_merge", { notebookId, message });
}

export async function gitAbortMerge(notebookId: string): Promise<void> {
  return invoke("git_abort_merge", { notebookId });
}

// ========== External Editor Operations ==========

export interface EditorConfig {
  name: string;
  command: string;
  args: string[];
  wait: boolean;
}

export interface EditSession {
  pageId: string;
  notebookId: string;
  tempPath: string;
  lastModified: string;
  startedAt: string;
}

export async function getExternalEditors(): Promise<EditorConfig[]> {
  return invoke<EditorConfig[]>("get_external_editors");
}

export async function openPageInEditor(
  notebookId: string,
  pageId: string,
  editorConfig?: EditorConfig
): Promise<string> {
  return invoke<string>("open_page_in_editor", {
    notebookId,
    pageId,
    editorConfig,
  });
}

export async function checkExternalChanges(
  pageId: string
): Promise<string | null> {
  return invoke<string | null>("check_external_changes", { pageId });
}

export async function getExternalFileContent(pageId: string): Promise<string> {
  return invoke<string>("get_external_file_content", { pageId });
}

export async function syncFromExternalEditor(
  notebookId: string,
  pageId: string
): Promise<void> {
  return invoke("sync_from_external_editor", { notebookId, pageId });
}

export async function endExternalEditSession(pageId: string): Promise<void> {
  return invoke("end_external_edit_session", { pageId });
}

export async function getExternalEditSession(
  pageId: string
): Promise<EditSession | null> {
  return invoke<EditSession | null>("get_external_edit_session", { pageId });
}

export async function getAllExternalEditSessions(): Promise<EditSession[]> {
  return invoke<EditSession[]>("get_all_external_edit_sessions");
}

export async function cleanupExternalEditSessions(): Promise<void> {
  return invoke("cleanup_external_edit_sessions");
}

// ========== Section Operations ==========

export async function listSections(notebookId: string): Promise<Section[]> {
  return invoke<Section[]>("list_sections", { notebookId });
}

export async function getSection(
  notebookId: string,
  sectionId: string
): Promise<Section> {
  return invoke<Section>("get_section", { notebookId, sectionId });
}

export async function createSection(
  notebookId: string,
  name: string,
  color?: string
): Promise<Section> {
  return invoke<Section>("create_section", { notebookId, name, color });
}

export async function updateSection(
  notebookId: string,
  sectionId: string,
  updates: { name?: string; description?: string | null; color?: string | null; systemPrompt?: string | null; systemPromptMode?: string }
): Promise<Section> {
  return invoke<Section>("update_section", {
    notebookId,
    sectionId,
    ...updates,
  });
}

export async function deleteSection(
  notebookId: string,
  sectionId: string,
  moveItemsTo?: string
): Promise<void> {
  return invoke("delete_section", { notebookId, sectionId, moveItemsTo });
}

export async function reorderSections(
  notebookId: string,
  sectionIds: string[]
): Promise<void> {
  return invoke("reorder_sections", { notebookId, sectionIds });
}

// ========== Cover Page Operations ==========

export async function getCoverPage(notebookId: string): Promise<Page | null> {
  return invoke<Page | null>("get_cover_page", { notebookId });
}

export async function createCoverPage(notebookId: string): Promise<Page> {
  return invoke<Page>("create_cover_page", { notebookId });
}

export async function setCoverPage(
  notebookId: string,
  pageId: string | null
): Promise<Page | null> {
  return invoke<Page | null>("set_cover_page", { notebookId, pageId });
}

// ========== Sync Operations ==========

export async function syncTestConnection(
  serverUrl: string,
  username: string,
  password: string
): Promise<boolean> {
  return invoke<boolean>("sync_test_connection", {
    serverUrl,
    username,
    password,
  });
}

export async function syncConfigure(
  notebookId: string,
  config: SyncConfigInput
): Promise<void> {
  return invoke("sync_configure", { notebookId, config });
}

export async function syncStatus(notebookId: string): Promise<SyncStatus> {
  return invoke<SyncStatus>("sync_status", { notebookId });
}

export async function syncNow(notebookId: string): Promise<SyncResult> {
  return invoke<SyncResult>("sync_now", { notebookId });
}

export async function syncQueueStatus(
  notebookId: string
): Promise<QueueItem[]> {
  return invoke<QueueItem[]>("sync_queue_status", { notebookId });
}

export async function syncDisable(notebookId: string): Promise<void> {
  return invoke("sync_disable", { notebookId });
}

// ===== Document Conversion API (markitdown) =====

export interface DocumentConversionResult {
  content: string;
  sourcePath: string;
  sourceType: string;
  title: string | null;
  wordCount: number;
  error?: string;
}

/**
 * Convert a document to Markdown using markitdown.
 * Supports PDF, Word, Excel, PowerPoint, images, audio, HTML, CSV, JSON, XML, ZIP, EPUB.
 */
export async function convertDocument(
  filePath: string
): Promise<DocumentConversionResult> {
  return invoke<DocumentConversionResult>("convert_document", { filePath });
}

/**
 * Convert multiple documents to Markdown.
 * Returns results for each file, including errors for failed conversions.
 */
export async function convertDocumentsBatch(
  filePaths: string[]
): Promise<DocumentConversionResult[]> {
  return invoke<DocumentConversionResult[]>("convert_documents_batch", {
    filePaths,
  });
}

/**
 * Get list of supported file extensions for document conversion.
 * Returns extensions like ['.pdf', '.docx', '.xlsx', ...].
 */
export async function getSupportedDocumentExtensions(): Promise<string[]> {
  return invoke<string[]>("get_supported_document_extensions");
}

/**
 * Check if a file type is supported for conversion.
 */
export async function isSupportedDocument(filePath: string): Promise<boolean> {
  return invoke<boolean>("is_supported_document", { filePath });
}

// ===== Library API =====

import type { Library, LibraryStats } from "../types/library";

/**
 * List all libraries
 */
export async function listLibraries(): Promise<Library[]> {
  return invoke<Library[]>("list_libraries");
}

/**
 * Get a library by ID
 */
export async function getLibrary(libraryId: string): Promise<Library> {
  return invoke<Library>("get_library", { libraryId });
}

/**
 * Get the current active library
 */
export async function getCurrentLibrary(): Promise<Library> {
  return invoke<Library>("get_current_library");
}

/**
 * Create a new library
 */
export async function createLibrary(
  name: string,
  path: string
): Promise<Library> {
  return invoke<Library>("create_library", { name, path });
}

/**
 * Update a library's metadata
 */
export async function updateLibrary(
  libraryId: string,
  updates: { name?: string; icon?: string; color?: string }
): Promise<Library> {
  return invoke<Library>("update_library", { libraryId, ...updates });
}

/**
 * Delete a library (cannot delete default library)
 */
export async function deleteLibrary(libraryId: string): Promise<void> {
  return invoke("delete_library", { libraryId });
}

/**
 * Switch to a different library
 * This reinitializes storage and search index
 */
export async function switchLibrary(libraryId: string): Promise<Library> {
  return invoke<Library>("switch_library", { libraryId });
}

/**
 * Get statistics for a library
 */
export async function getLibraryStats(libraryId: string): Promise<LibraryStats> {
  return invoke<LibraryStats>("get_library_stats", { libraryId });
}

/**
 * Validate a path for use as a library location
 */
export async function validateLibraryPath(path: string): Promise<boolean> {
  return invoke<boolean>("validate_library_path", { path });
}

/**
 * Open a folder picker dialog for selecting a library location
 */
export async function pickLibraryFolder(): Promise<string | null> {
  return invoke<string | null>("pick_library_folder");
}

/**
 * Move a notebook from one library to another
 */
export async function moveNotebookToLibrary(
  notebookId: string,
  sourceLibraryId: string,
  targetLibraryId: string
): Promise<string> {
  return invoke<string>("move_notebook_to_library", { notebookId, sourceLibraryId, targetLibraryId });
}

// ===== File-Based Page API =====

export interface ImportFileResult {
  page: Page;
  fileType: string;
}

export interface FileContentResponse {
  content: string;
  pageType: string;
  fileExtension: string | null;
}

/**
 * Import a file as a page in a notebook
 */
export async function importFileAsPage(
  notebookId: string,
  filePath: string,
  storageMode: "embedded" | "linked",
  folderId?: string,
  sectionId?: string
): Promise<ImportFileResult> {
  return invoke<ImportFileResult>("import_file_as_page", {
    notebookId,
    filePath,
    storageMode,
    folderId: folderId || null,
    sectionId: sectionId || null,
  });
}

/**
 * Get content of a text-based file page (markdown, calendar)
 */
export async function getFileContent(
  notebookId: string,
  pageId: string
): Promise<FileContentResponse> {
  return invoke<FileContentResponse>("get_file_content", { notebookId, pageId });
}

/**
 * Update content of a text-based file page
 */
export async function updateFileContent(
  notebookId: string,
  pageId: string,
  content: string
): Promise<Page> {
  return invoke<Page>("update_file_content", { notebookId, pageId, content });
}

/**
 * Get the file path for a file-based page
 */
export async function getFilePath(
  notebookId: string,
  pageId: string
): Promise<string> {
  return invoke<string>("get_file_path", { notebookId, pageId });
}

/**
 * Check if a linked file has been modified externally
 */
export async function checkLinkedFileModified(
  notebookId: string,
  pageId: string
): Promise<boolean> {
  return invoke<boolean>("check_linked_file_modified", { notebookId, pageId });
}

/**
 * Mark a linked file as synced (update last_file_sync timestamp)
 */
export async function markLinkedFileSynced(
  notebookId: string,
  pageId: string
): Promise<Page> {
  return invoke<Page>("mark_linked_file_synced", { notebookId, pageId });
}

/**
 * Get list of supported file extensions for import
 */
export async function getSupportedPageExtensions(): Promise<string[]> {
  return invoke<string[]>("get_supported_page_extensions");
}

/**
 * Delete a file-based page
 */
export async function deleteFilePage(
  notebookId: string,
  pageId: string
): Promise<void> {
  return invoke<void>("delete_file_page", { notebookId, pageId });
}

// ===== PDF Annotation API =====

/**
 * PDF highlight rectangle
 */
export interface PDFRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * PDF highlight annotation
 */
export interface PDFHighlight {
  id: string;
  pageNumber: number;
  rects: PDFRect[];
  selectedText: string;
  note?: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * PDF page annotations container
 */
export interface PDFPageAnnotations {
  pageId: string;
  notebookId: string;
  highlights: PDFHighlight[];
  updatedAt: string;
}

/**
 * Get PDF annotations for a page
 */
export async function getPdfAnnotations(
  notebookId: string,
  pageId: string
): Promise<PDFPageAnnotations> {
  return invoke<PDFPageAnnotations>("get_pdf_annotations", { notebookId, pageId });
}

/**
 * Save all PDF annotations for a page
 */
export async function savePdfAnnotations(
  notebookId: string,
  pageId: string,
  highlights: PDFHighlight[]
): Promise<PDFPageAnnotations> {
  return invoke<PDFPageAnnotations>("save_pdf_annotations", { notebookId, pageId, highlights });
}

/**
 * Add a highlight to a PDF page
 */
export async function addPdfHighlight(
  notebookId: string,
  pageId: string,
  highlight: PDFHighlight
): Promise<PDFPageAnnotations> {
  return invoke<PDFPageAnnotations>("add_pdf_highlight", { notebookId, pageId, highlight });
}

/**
 * Update a PDF highlight
 */
export async function updatePdfHighlight(
  notebookId: string,
  pageId: string,
  highlightId: string,
  note?: string,
  color?: string
): Promise<PDFPageAnnotations> {
  return invoke<PDFPageAnnotations>("update_pdf_highlight", { notebookId, pageId, highlightId, note, color });
}

/**
 * Delete a PDF highlight
 */
export async function deletePdfHighlight(
  notebookId: string,
  pageId: string,
  highlightId: string
): Promise<PDFPageAnnotations> {
  return invoke<PDFPageAnnotations>("delete_pdf_highlight", { notebookId, pageId, highlightId });
}

/**
 * Delete all PDF annotations for a page
 */
export async function deletePdfAnnotations(
  notebookId: string,
  pageId: string
): Promise<void> {
  return invoke<void>("delete_pdf_annotations", { notebookId, pageId });
}

// ===== Jupyter Cell Execution =====

/**
 * Output from executing a Jupyter cell
 */
export interface JupyterCellOutput {
  success: boolean;
  outputs: JupyterOutputItem[];
  executionCount: number | null;
}

/**
 * A single output item from Jupyter cell execution
 */
export interface JupyterOutputItem {
  outputType: "stream" | "execute_result" | "display_data" | "error";
  name?: "stdout" | "stderr";
  text?: string | string[];
  data?: Record<string, string | string[]>;
  metadata?: Record<string, unknown>;
  executionCount?: number | null;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

/**
 * Information about the Python execution environment
 */
export interface PythonEnvironmentInfo {
  available: boolean;
  pythonVersion: string;
  packages: string[];
}

/**
 * Execute a Jupyter notebook code cell
 */
export async function executeJupyterCell(
  code: string,
  cellIndex: number
): Promise<JupyterCellOutput> {
  return invoke<JupyterCellOutput>("execute_jupyter_cell", { code, cellIndex });
}

/**
 * Check if Python execution is available
 */
export async function checkPythonExecutionAvailable(): Promise<PythonEnvironmentInfo> {
  return invoke<PythonEnvironmentInfo>("check_python_execution_available");
}

// ===== Window API =====

/**
 * Open a library in a new window
 * If the library is already open in a window, focuses that window instead
 */
export async function openLibraryWindow(libraryId: string): Promise<string> {
  return invoke<string>("open_library_window", { libraryId });
}

/**
 * Close a library window
 */
export async function closeLibraryWindow(libraryId: string): Promise<void> {
  return invoke("close_library_window", { libraryId });
}

/**
 * Check if a library window is currently open
 */
export async function isLibraryWindowOpen(libraryId: string): Promise<boolean> {
  return invoke<boolean>("is_library_window_open", { libraryId });
}

// ===== Goals API =====

/**
 * List all goals (including archived)
 */
export async function listGoals(): Promise<Goal[]> {
  return invoke<Goal[]>("list_goals");
}

/**
 * List active (non-archived) goals
 */
export async function listActiveGoals(): Promise<Goal[]> {
  return invoke<Goal[]>("list_active_goals");
}

/**
 * Get a goal by ID
 */
export async function getGoal(id: string): Promise<Goal> {
  return invoke<Goal>("get_goal", { id });
}

/**
 * Create a new goal
 */
export async function createGoal(request: CreateGoalRequest): Promise<Goal> {
  return invoke<Goal>("create_goal", { request });
}

/**
 * Update an existing goal
 */
export async function updateGoal(id: string, updates: UpdateGoalRequest): Promise<Goal> {
  return invoke<Goal>("update_goal", { id, updates });
}

/**
 * Archive a goal
 */
export async function archiveGoal(id: string): Promise<Goal> {
  return invoke<Goal>("archive_goal", { id });
}

/**
 * Delete a goal
 */
export async function deleteGoal(id: string): Promise<void> {
  return invoke("delete_goal", { id });
}

/**
 * Get statistics for a goal
 */
export async function getGoalStats(id: string): Promise<GoalStats> {
  return invoke<GoalStats>("get_goal_stats", { id });
}

/**
 * Record progress for a goal
 */
export async function recordGoalProgress(
  goalId: string,
  date: string,
  completed: boolean
): Promise<GoalProgress> {
  return invoke<GoalProgress>("record_goal_progress", { goalId, date, completed });
}

/**
 * Get progress for a goal within a date range
 */
export async function getGoalProgress(
  goalId: string,
  startDate: string,
  endDate: string
): Promise<GoalProgress[]> {
  return invoke<GoalProgress[]>("get_goal_progress", { goalId, startDate, endDate });
}

/**
 * Check auto-detected goals for today
 */
export async function checkAutoGoals(): Promise<GoalProgress[]> {
  return invoke<GoalProgress[]>("check_auto_goals");
}

/**
 * Get goals summary
 */
export async function getGoalsSummary(): Promise<GoalsSummary> {
  return invoke<GoalsSummary>("get_goals_summary");
}

/**
 * Toggle goal completion for today
 */
export async function toggleGoalToday(goalId: string): Promise<GoalProgress> {
  return invoke<GoalProgress>("toggle_goal_today", { goalId });
}
