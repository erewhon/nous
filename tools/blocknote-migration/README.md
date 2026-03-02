# Nous EditorJS → BlockNote Migration

Standalone migration script that converts Nous page files from EditorJS JSON format to BlockNote JSON format.

## Prerequisites

- Node.js 18+
- pnpm (or npm)

## Install

```bash
cd tools/blocknote-migration
pnpm install
```

## Usage

```bash
# Dry run (preview without writing)
pnpm migrate:dry

# Migrate default data directory (~/.local/share/nous)
pnpm migrate

# Migrate specific data directory
pnpm migrate --data-dir /path/to/nous

# Migrate a single library directly
pnpm migrate --library-path /path/to/library

# Skip backup (for re-runs after backup exists)
pnpm migrate --skip-backup

# Keep snapshot dirs as .bak instead of deleting
pnpm migrate --keep-snapshots

# Verbose logging
pnpm migrate -v

# Direct with npx
npx tsx migrate.ts --data-dir /path/to/nous
```

## What it does

1. **Discovers** all libraries and notebooks from `libraries.json`
2. **Backs up** all notebook directories to `migration-backups/{timestamp}/`
3. **Converts** each standard page from EditorJS to BlockNote format
4. **Verifies** text fidelity by comparing extracted plain text before/after
5. **Cleans up** CRDT sync files and snapshot directories (incompatible with new format)
6. **Reports** results with block type counts, mismatches, and failures

## Safety features

- **Re-runnable**: Pages with `version.startsWith("blocknote")` are skipped
- **Atomic writes**: Uses `.json.tmp` → rename pattern (same as Nous backend)
- **Backup first**: Full recursive copy of notebooks before any changes
- **Dry run**: Preview everything without touching files
- **Non-destructive**: Non-standard page types (markdown, pdf, etc.) are never touched
- **Encrypted notebooks**: Detected and skipped with a warning

## Format change

The `content.version` field changes from `"2.28.0"` (or similar) to `"blocknote-0.47.0"`. The Rust backend uses this to determine which format parser to use.

## Important

Do NOT run this script until the Rust backend (Phase 3) has been updated to understand the BlockNote format. The script is built and tested now but deployed later.
