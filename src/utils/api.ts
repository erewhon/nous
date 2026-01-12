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

import type { ChatMessage, ChatResponse, PageContext } from "../types/ai";

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
