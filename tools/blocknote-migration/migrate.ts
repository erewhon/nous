#!/usr/bin/env tsx
/**
 * EditorJS → BlockNote migration script for Nous notebooks.
 *
 * Converts the on-disk page format from EditorJS JSON to BlockNote JSON.
 * Designed to be run standalone on any machine with Node.js.
 *
 * Usage:
 *   pnpm migrate                          # migrate default data dir
 *   pnpm migrate --data-dir /path/to/nous # migrate specific data dir
 *   pnpm migrate --dry-run                # preview without writing
 *   npx tsx migrate.ts --help             # show help
 */

import { parseArgs } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";

import { editorJsToBlockNote } from "./converter.js";
import {
  extractTextFromEditorJS,
  extractTextFromBlockNote,
  compareText,
} from "./verify.js";
import type {
  PageJson,
  NotebookJson,
  LibraryEntry,
  MigrationReport,
} from "./types.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const BLOCKNOTE_VERSION = "blocknote-0.47.0";
const NON_STANDARD_PAGE_TYPES = [
  "markdown",
  "pdf",
  "jupyter",
  "epub",
  "calendar",
  "chat",
  "canvas",
  "database",
  "html",
];

// ─── CLI argument parsing ───────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    "data-dir": { type: "string", short: "d" },
    "library-path": { type: "string", short: "l" },
    "dry-run": { type: "boolean", default: false },
    "skip-backup": { type: "boolean", default: false },
    "keep-snapshots": { type: "boolean", default: false },
    verbose: { type: "boolean", short: "v", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

if (args.help) {
  console.log(`
Nous EditorJS → BlockNote Migration Tool

Usage:
  pnpm migrate [options] [data-dir]
  npx tsx migrate.ts [options] [data-dir]

Options:
  -d, --data-dir <path>      Nous data directory (default: ~/.local/share/nous)
  -l, --library-path <path>  Convert a single library directly
      --dry-run              Report what would happen without writing
      --skip-backup          Skip backup step (for re-runs)
      --keep-snapshots       Rename snapshots to .bak/ instead of deleting
  -v, --verbose              Log every page conversion
  -h, --help                 Show this help message

Examples:
  pnpm migrate                                    # default location
  pnpm migrate --data-dir ~/Documents/nous-data   # custom data dir
  pnpm migrate --library-path ~/Documents/MyLib    # single library
  pnpm migrate --dry-run                           # preview changes
`);
  process.exit(0);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(msg);
}

function verbose(msg: string): void {
  if (args.verbose) console.log(`  ${msg}`);
}

function warn(msg: string): void {
  console.log(`⚠ ${msg}`);
}

function error(msg: string): void {
  console.error(`ERROR: ${msg}`);
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function readJson<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function deleteDirRecursive(dirPath: string): void {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

// ─── Types for discovery ────────────────────────────────────────────────────

interface DiscoveredPage {
  path: string;
  pageJson: PageJson;
  notebookPath: string;
  classification:
    | "standard"
    | "non-standard"
    | "empty"
    | "already-migrated"
    | "encrypted";
}

interface NotebookInfo {
  path: string;
  id: string;
  name: string;
  encrypted: boolean;
}

// ─── Step 1: Discovery ──────────────────────────────────────────────────────

function discoverLibraries(dataDir: string): string[] {
  const librariesPath = path.join(dataDir, "libraries.json");
  if (!fs.existsSync(librariesPath)) {
    // Single-library mode: dataDir is the library
    if (fs.existsSync(path.join(dataDir, "notebooks"))) {
      return [dataDir];
    }
    error(`No libraries.json found at ${librariesPath}`);
    process.exit(1);
  }

  const libraries = readJson<LibraryEntry[]>(librariesPath);
  return libraries.map((lib) => lib.path);
}

function discoverNotebooks(libraryPath: string): NotebookInfo[] {
  const notebooksDir = path.join(libraryPath, "notebooks");
  if (!fs.existsSync(notebooksDir)) return [];

  const entries = fs.readdirSync(notebooksDir, { withFileTypes: true });
  const notebooks: NotebookInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nbPath = path.join(notebooksDir, entry.name);
    const nbJsonPath = path.join(nbPath, "notebook.json");

    if (!fs.existsSync(nbJsonPath)) continue;

    try {
      const nbJson = readJson<NotebookJson>(nbJsonPath);
      const encrypted = nbJson.encryptionConfig?.enabled === true;
      notebooks.push({
        path: nbPath,
        id: nbJson.id ?? entry.name,
        name: nbJson.name ?? entry.name,
        encrypted,
      });
    } catch {
      warn(`Could not read ${nbJsonPath}, skipping notebook`);
    }
  }

  return notebooks;
}

function recoverTmpFiles(notebookPath: string): number {
  const pagesDir = path.join(notebookPath, "pages");
  if (!fs.existsSync(pagesDir)) return 0;

  let recovered = 0;
  const entries = fs.readdirSync(pagesDir);

  for (const entry of entries) {
    if (!entry.endsWith(".json.tmp")) continue;

    const tmpPath = path.join(pagesDir, entry);
    const jsonPath = path.join(pagesDir, entry.replace(".json.tmp", ".json"));

    if (fs.existsSync(jsonPath)) {
      // Both exist — delete the tmp (the .json is authoritative)
      fs.unlinkSync(tmpPath);
      verbose(`Deleted orphan tmp: ${entry}`);
    } else {
      // Only tmp exists — recover it
      fs.renameSync(tmpPath, jsonPath);
      verbose(`Recovered tmp file: ${entry} → ${entry.replace(".tmp", "")}`);
      recovered++;
    }
  }

  return recovered;
}

function discoverPages(notebookPath: string, encrypted: boolean): DiscoveredPage[] {
  const pagesDir = path.join(notebookPath, "pages");
  if (!fs.existsSync(pagesDir)) return [];

  const entries = fs.readdirSync(pagesDir).filter((e) => e.endsWith(".json"));
  const pages: DiscoveredPage[] = [];

  for (const entry of entries) {
    const pagePath = path.join(pagesDir, entry);

    try {
      const pageJson = readJson<PageJson>(pagePath);
      let classification: DiscoveredPage["classification"];

      if (encrypted) {
        classification = "encrypted";
      } else if (
        pageJson.pageType &&
        NON_STANDARD_PAGE_TYPES.includes(pageJson.pageType)
      ) {
        classification = "non-standard";
      } else if (
        pageJson.content?.version?.startsWith("blocknote")
      ) {
        classification = "already-migrated";
      } else if (
        !pageJson.content?.blocks ||
        pageJson.content.blocks.length === 0
      ) {
        classification = "empty";
      } else {
        classification = "standard";
      }

      pages.push({
        path: pagePath,
        pageJson,
        notebookPath,
        classification,
      });
    } catch (e: unknown) {
      warn(`Could not read page ${pagePath}: ${e}`);
    }
  }

  return pages;
}

// ─── Step 2: Backup ─────────────────────────────────────────────────────────

function createBackup(
  dataDir: string,
  libraryPaths: string[],
  dryRun: boolean,
): string | null {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(dataDir, "migration-backups", timestamp);

  if (dryRun) {
    log(`Would create backup at: ${backupDir}`);
    return backupDir;
  }

  log(`Creating backup at: ${backupDir}`);
  fs.mkdirSync(backupDir, { recursive: true });

  for (const libPath of libraryPaths) {
    const notebooksDir = path.join(libPath, "notebooks");
    if (!fs.existsSync(notebooksDir)) continue;

    // Use library basename for backup sub-path
    const libName = path.basename(libPath);
    const destDir = path.join(backupDir, libName, "notebooks");
    copyDirRecursive(notebooksDir, destDir);
    log(`  Backed up: ${notebooksDir}`);
  }

  // Write manifest
  const manifest = {
    timestamp,
    tool: "@nous-tools/blocknote-migration",
    version: "1.0.0",
    sourceFormat: "editorjs",
    targetFormat: BLOCKNOTE_VERSION,
    libraries: libraryPaths,
  };
  writeJsonAtomic(path.join(backupDir, "migration-manifest.json"), manifest);

  // Verify backup exists and has content
  const backupSize = getDirSize(backupDir);
  if (backupSize === 0) {
    error("Backup appears empty — aborting");
    process.exit(1);
  }

  log(`  Backup size: ${formatBytes(backupSize)}`);
  return backupDir;
}

function getDirSize(dirPath: string): number {
  let size = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(entryPath);
    } else {
      size += fs.statSync(entryPath).size;
    }
  }
  return size;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Step 3: Convert pages ──────────────────────────────────────────────────

interface ConversionResult {
  converted: number;
  skipped: number;
  alreadyMigrated: number;
  empty: number;
  nonStandard: number;
  encrypted: number;
  failed: number;
  blockTypeCounts: Record<string, number>;
  textMismatches: MigrationReport["textMismatches"];
  failures: MigrationReport["failures"];
}

function convertPages(
  pages: DiscoveredPage[],
  dryRun: boolean,
): ConversionResult {
  const result: ConversionResult = {
    converted: 0,
    skipped: 0,
    alreadyMigrated: 0,
    empty: 0,
    nonStandard: 0,
    encrypted: 0,
    failed: 0,
    blockTypeCounts: {},
    textMismatches: [],
    failures: [],
  };

  for (const page of pages) {
    switch (page.classification) {
      case "already-migrated":
        result.alreadyMigrated++;
        verbose(`Skip (already migrated): ${page.pageJson.title}`);
        continue;

      case "non-standard":
        result.nonStandard++;
        verbose(
          `Skip (${page.pageJson.pageType}): ${page.pageJson.title}`,
        );
        continue;

      case "encrypted":
        result.encrypted++;
        verbose(`Skip (encrypted notebook): ${page.pageJson.title}`);
        continue;

      case "empty":
        // Update version marker even for empty pages
        if (!dryRun) {
          const updated = { ...page.pageJson };
          updated.content = {
            time: page.pageJson.content?.time ?? Date.now(),
            version: BLOCKNOTE_VERSION,
            blocks: [],
          };
          writeJsonAtomic(page.path, updated);
        }
        result.empty++;
        verbose(`Empty (version updated): ${page.pageJson.title}`);
        continue;

      case "standard":
        break;
    }

    // Convert standard page
    try {
      const editorData = page.pageJson.content;

      // Count block types
      for (const block of editorData.blocks) {
        result.blockTypeCounts[block.type] =
          (result.blockTypeCounts[block.type] ?? 0) + 1;
      }

      // Extract "before" text
      const beforeText = extractTextFromEditorJS(editorData.blocks);

      // Convert
      const bnBlocks = editorJsToBlockNote(editorData);

      // Extract "after" text and compare
      const afterText = extractTextFromBlockNote(bnBlocks);
      const textMatch = compareText(beforeText, afterText);

      if (!textMatch) {
        result.textMismatches.push({
          pageId: page.pageJson.id,
          pageTitle: page.pageJson.title,
          notebookPath: page.notebookPath,
          before: beforeText.slice(0, 200),
          after: afterText.slice(0, 200),
        });
        verbose(
          `Text mismatch: ${page.pageJson.title} (will still convert)`,
        );
      }

      if (!dryRun) {
        // Build updated page JSON
        const updated = { ...page.pageJson };
        updated.content = {
          time: editorData.time ?? Date.now(),
          version: BLOCKNOTE_VERSION,
          blocks: bnBlocks,
        } as any;

        writeJsonAtomic(page.path, updated);
      }

      result.converted++;
      verbose(`Converted: ${page.pageJson.title} (${editorData.blocks.length} blocks → ${bnBlocks.length} blocks)`);
    } catch (e: unknown) {
      result.failed++;
      const errMsg = e instanceof Error ? e.message : String(e);
      result.failures.push({
        pageId: page.pageJson.id,
        pageTitle: page.pageJson.title,
        path: page.path,
        error: errMsg,
      });
      warn(`Failed: ${page.pageJson.title} — ${errMsg}`);
    }
  }

  return result;
}

// ─── Step 4: Cleanup ancillary files ────────────────────────────────────────

interface CleanupResult {
  crdtFiles: number;
  snapshotDirs: number;
}

function cleanupAncillaryFiles(
  notebookPaths: string[],
  dryRun: boolean,
  keepSnapshots: boolean,
): CleanupResult {
  const result: CleanupResult = { crdtFiles: 0, snapshotDirs: 0 };

  for (const nbPath of notebookPaths) {
    // Delete CRDT files
    const syncPagesDir = path.join(nbPath, "sync", "pages");
    if (fs.existsSync(syncPagesDir)) {
      const crdtFiles = fs
        .readdirSync(syncPagesDir)
        .filter((f) => f.endsWith(".crdt"));
      for (const file of crdtFiles) {
        const filePath = path.join(syncPagesDir, file);
        if (!dryRun) {
          fs.unlinkSync(filePath);
        }
        result.crdtFiles++;
      }
    }

    // Handle snapshot directories
    const pagesDir = path.join(nbPath, "pages");
    if (!fs.existsSync(pagesDir)) continue;

    const snapshotDirs = fs
      .readdirSync(pagesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.endsWith(".snapshots"));

    for (const dir of snapshotDirs) {
      const dirPath = path.join(pagesDir, dir.name);
      if (!dryRun) {
        if (keepSnapshots) {
          const bakPath = dirPath.replace(".snapshots", ".snapshots.bak");
          fs.renameSync(dirPath, bakPath);
          verbose(`Renamed snapshot dir: ${dir.name} → ${dir.name}.bak`);
        } else {
          deleteDirRecursive(dirPath);
          verbose(`Deleted snapshot dir: ${dir.name}`);
        }
      }
      result.snapshotDirs++;
    }
  }

  return result;
}

// ─── Step 5: Report ─────────────────────────────────────────────────────────

function writeReport(
  dataDir: string,
  report: MigrationReport,
  dryRun: boolean,
): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(
    dataDir,
    `migration-report-${timestamp}.json`,
  );

  if (!dryRun) {
    writeJsonAtomic(reportPath, report);
    log(`\nReport written to: ${reportPath}`);
  }

  // Print summary
  log("\n═══════════════════════════════════════════");
  log(dryRun ? "  DRY RUN SUMMARY" : "  MIGRATION SUMMARY");
  log("═══════════════════════════════════════════");
  log(`  Pages converted:        ${report.pages.converted}`);
  log(`  Pages skipped (non-std): ${report.pages.nonStandard}`);
  log(`  Pages already migrated: ${report.pages.alreadyMigrated}`);
  log(`  Empty pages (updated):  ${report.pages.empty}`);
  log(`  Failed:                 ${report.pages.failed}`);
  log(`  Total:                  ${report.pages.total}`);

  if (Object.keys(report.blockTypeCounts).length > 0) {
    log("\n  Block types converted:");
    const sorted = Object.entries(report.blockTypeCounts).sort(
      (a, b) => b[1] - a[1],
    );
    for (const [type, count] of sorted) {
      log(`    ${type}: ${count}`);
    }
  }

  if (report.textMismatches.length > 0) {
    log(
      `\n  Text fidelity mismatches: ${report.textMismatches.length} (review in report)`,
    );
  }

  if (report.cleanedUp.crdtFiles > 0 || report.cleanedUp.snapshotDirs > 0) {
    log("\n  Cleanup:");
    log(`    CRDT files deleted:    ${report.cleanedUp.crdtFiles}`);
    log(`    Snapshot dirs cleaned: ${report.cleanedUp.snapshotDirs}`);
  }

  if (report.failures.length > 0) {
    log("\n  FAILURES:");
    for (const f of report.failures) {
      log(`    ${f.pageTitle}: ${f.error}`);
    }
  }

  if (report.backupPath) {
    log(`\n  Backup: ${report.backupPath}`);
  }

  log("═══════════════════════════════════════════\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dryRun = args["dry-run"] ?? false;
  const skipBackup = args["skip-backup"] ?? false;
  const keepSnapshots = args["keep-snapshots"] ?? false;

  // Resolve data directory
  let dataDir: string;
  if (args["library-path"]) {
    dataDir = path.resolve(args["library-path"]);
  } else if (args["data-dir"]) {
    dataDir = path.resolve(args["data-dir"]);
  } else {
    dataDir = path.join(os.homedir(), ".local", "share", "nous");
  }

  log(`\nNous EditorJS → BlockNote Migration${dryRun ? " (DRY RUN)" : ""}`);
  log(`Data directory: ${dataDir}\n`);

  if (!fs.existsSync(dataDir)) {
    error(`Data directory does not exist: ${dataDir}`);
    process.exit(1);
  }

  // ── Step 1: Discovery ──
  log("Step 1: Discovering libraries and pages...");

  let libraryPaths: string[];
  if (args["library-path"]) {
    libraryPaths = [dataDir];
  } else {
    libraryPaths = discoverLibraries(dataDir);
  }

  log(`  Found ${libraryPaths.length} library(ies)`);

  const allPages: DiscoveredPage[] = [];
  const allNotebookPaths: string[] = [];
  let totalRecovered = 0;

  for (const libPath of libraryPaths) {
    if (!fs.existsSync(libPath)) {
      warn(`Library path does not exist: ${libPath}`);
      continue;
    }

    const notebooks = discoverNotebooks(libPath);
    log(`  Library: ${libPath} (${notebooks.length} notebooks)`);

    for (const nb of notebooks) {
      if (nb.encrypted) {
        warn(`  Skipping encrypted notebook: ${nb.name}`);
      }

      // Recover tmp files
      totalRecovered += recoverTmpFiles(nb.path);

      // Discover pages
      const pages = discoverPages(nb.path, nb.encrypted);
      allPages.push(...pages);
      allNotebookPaths.push(nb.path);

      const counts = {
        standard: pages.filter((p) => p.classification === "standard").length,
        nonStandard: pages.filter((p) => p.classification === "non-standard").length,
        empty: pages.filter((p) => p.classification === "empty").length,
        migrated: pages.filter((p) => p.classification === "already-migrated").length,
        encrypted: pages.filter((p) => p.classification === "encrypted").length,
      };

      verbose(
        `    ${nb.name}: ${pages.length} pages (${counts.standard} to convert, ${counts.migrated} already done, ${counts.nonStandard} non-std, ${counts.empty} empty)`,
      );
    }
  }

  if (totalRecovered > 0) {
    log(`  Recovered ${totalRecovered} tmp file(s)`);
  }

  const toConvert = allPages.filter((p) => p.classification === "standard");
  const toUpdateEmpty = allPages.filter((p) => p.classification === "empty");

  log(
    `\n  Summary: ${allPages.length} total pages, ${toConvert.length} to convert, ${toUpdateEmpty.length} empty to update`,
  );

  if (toConvert.length === 0 && toUpdateEmpty.length === 0) {
    log("\n  Nothing to do — all pages are already migrated or non-standard.");
    process.exit(0);
  }

  // Confirm
  if (!dryRun) {
    const answer = await prompt(
      `\nProceed with migration of ${toConvert.length + toUpdateEmpty.length} pages? [y/N] `,
    );
    if (answer !== "y" && answer !== "yes") {
      log("Aborted.");
      process.exit(0);
    }
  }

  // ── Step 2: Backup ──
  let backupPath: string | null = null;
  if (!skipBackup) {
    log("\nStep 2: Creating backup...");
    backupPath = createBackup(
      args["library-path"] ? path.dirname(dataDir) : dataDir,
      libraryPaths,
      dryRun,
    );
  } else {
    log("\nStep 2: Backup skipped (--skip-backup)");
  }

  // ── Step 3: Convert ──
  log("\nStep 3: Converting pages...");
  const convResult = convertPages(allPages, dryRun);

  // ── Step 4: Cleanup ──
  log("\nStep 4: Cleaning up ancillary files...");
  const cleanupResult = cleanupAncillaryFiles(
    allNotebookPaths,
    dryRun,
    keepSnapshots,
  );

  // ── Step 5: Report ──
  const report: MigrationReport = {
    timestamp: new Date().toISOString(),
    libraries: libraryPaths,
    backupPath,
    pages: {
      total: allPages.length,
      converted: convResult.converted,
      skipped: convResult.skipped,
      alreadyMigrated: convResult.alreadyMigrated,
      empty: convResult.empty,
      nonStandard: convResult.nonStandard,
      failed: convResult.failed,
    },
    blockTypeCounts: convResult.blockTypeCounts,
    textMismatches: convResult.textMismatches,
    cleanedUp: cleanupResult,
    failures: convResult.failures,
  };

  writeReport(
    args["library-path"] ? path.dirname(dataDir) : dataDir,
    report,
    dryRun,
  );
}

main().catch((e: unknown) => {
  error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
