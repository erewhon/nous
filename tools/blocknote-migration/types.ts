/**
 * Minimal type definitions for the migration script.
 * No zod dependency — just the shapes needed for reading/writing page JSON.
 */

export interface EditorBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface EditorData {
  time?: number;
  version?: string;
  blocks: EditorBlock[];
}

export interface PageJson {
  id: string;
  notebookId: string;
  title: string;
  content: EditorData;
  tags?: string[];
  pageType?: string;
  folderId?: string | null;
  sectionId?: string | null;
  isArchived?: boolean;
  isDailyNote?: boolean;
  dailyNoteDate?: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface NotebookJson {
  id: string;
  name: string;
  encryptionConfig?: {
    enabled: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface LibraryEntry {
  id: string;
  name: string;
  path: string;
  isDefault?: boolean;
  [key: string]: unknown;
}

export interface MigrationReport {
  timestamp: string;
  libraries: string[];
  backupPath: string | null;
  pages: {
    total: number;
    converted: number;
    skipped: number;
    alreadyMigrated: number;
    empty: number;
    nonStandard: number;
    failed: number;
  };
  blockTypeCounts: Record<string, number>;
  textMismatches: Array<{
    pageId: string;
    pageTitle: string;
    notebookPath: string;
    before: string;
    after: string;
  }>;
  cleanedUp: {
    crdtFiles: number;
    snapshotDirs: number;
  };
  failures: Array<{
    pageId: string;
    pageTitle: string;
    path: string;
    error: string;
  }>;
}
