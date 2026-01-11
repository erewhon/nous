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
