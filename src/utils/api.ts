import { invoke } from "@tauri-apps/api/core";
import type { Notebook, NotebookType } from "../types/notebook";
import type { Page, EditorData, SearchResult } from "../types/page";

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
  updates: { name?: string; icon?: string; color?: string }
): Promise<Notebook> {
  return invoke<Notebook>("update_notebook", { notebookId, ...updates });
}

export async function deleteNotebook(notebookId: string): Promise<void> {
  return invoke("delete_notebook", { notebookId });
}

// ===== Page API =====

export async function listPages(notebookId: string): Promise<Page[]> {
  return invoke<Page[]>("list_pages", { notebookId });
}

export async function getPage(
  notebookId: string,
  pageId: string
): Promise<Page> {
  return invoke<Page>("get_page", { notebookId, pageId });
}

export async function createPage(
  notebookId: string,
  title: string
): Promise<Page> {
  return invoke<Page>("create_page", { notebookId, title });
}

export async function updatePage(
  notebookId: string,
  pageId: string,
  updates: { title?: string; content?: EditorData; tags?: string[] }
): Promise<Page> {
  return invoke<Page>("update_page", { notebookId, pageId, ...updates });
}

export async function deletePage(
  notebookId: string,
  pageId: string
): Promise<void> {
  return invoke("delete_page", { notebookId, pageId });
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
