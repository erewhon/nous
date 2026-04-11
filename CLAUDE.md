# Nous

Desktop notebook application with AI, databases, collaboration, and publishing. Built with Tauri (Rust + React).

## Architecture

- **Frontend:** React 19 + TypeScript + Vite, BlockNote editor (0.47), Tailwind CSS 4, Zustand state management
- **Desktop shell:** Tauri 2 (Rust), with PyO3 Python bridge for AI operations
- **Cloud API:** Cloudflare Workers (Hono.js), D1 SQLite, R2 storage, JWT auth at api.nous.page
- **Collaboration:** Yjs + PartyKit for real-time sync
- **Storage:** File-based (Editor.js JSON format), file-watching support
- **Python SDK:** `nous-sdk/` — MCP server, CLI tool

## Key Paths

- `src/` — React frontend
- `src/components/Database/` — Database feature (table, board, gallery, calendar, timeline, chart views)
- `src/types/database.ts` — Database type definitions and view config schemas
- `src/components/` — All UI components
- `src-tauri/src/` — Rust backend (storage, goals, sync, encryption)
- `cloud/` — Cloudflare Workers cloud API
- `collab/` — PartyKit collaboration server
- `nous-sdk/` — Python SDK and MCP server

## Conventions

- Use pnpm for frontend, cargo for Rust, uv for Python SDK
- Database views: each view type has a config schema in `database.ts` and a component in `Database/`
- Editor uses BlockNote (Editor.js compatible) — blocks have id, type, data
- Page types: standard, markdown, pdf, jupyter, epub, calendar, chat, canvas, database, html
- System prompt hierarchy: app → notebook → section → page (override or concatenate mode)
- Tags are nested (slash-separated), stored as arrays on pages
- File storage: atomic writes (temp + rename), operation log (JSONL with hash chain)

## Version Control

- Uses **jj** (Jujutsu), not git. Use `jj` commands for all VCS operations.

## Testing Standards

- **Frontend:** Use Vitest + React Testing Library for component tests. Focus on complex interactive components: database views, editors, multi-step flows.
- **E2E:** Playwright for critical user flows. Existing UI tests serve as reference.
- **Rust backend:** Use `#[cfg(test)]` module tests for storage, sync, encryption logic.
- **Python SDK:** pytest for MCP server tools, CLI commands, API client.
- **Database features:** Test view config handling, cell value updates, relation/rollup computation, filter/sort logic. These are the most complex parts of the codebase.
- **What not to test:** Simple display components, theme/styling, static pages.
- **Tests must pass** before a task is considered done.

## Task Management

Task specs and feature specs live in the **Forge** notebook in Nous. When working on a task:

- Use `mcp__nous__get_page` to read the task spec from Forge (e.g., "Task: MCP Server Writes Through Daemon API")
- Use `mcp__nous__get_database` on the "Project Tasks" database in Forge to see status and dependencies
- Update task status via `mcp__nous__update_database_rows` in the Project Tasks database (not internal task tools)
- Feature pages in Forge contain the full context: data model, API contracts, edge cases, test plans

Do NOT create ad-hoc task tracking internally — all task state lives in Forge.

## MCP Server

The Nous MCP server (`nous-sdk/`) exposes 17+ tools for external AI agents:
- Page CRUD, database CRUD, folder/tag management, inbox, daily notes, goals
- Used by Claude Code sessions to read/write Nous content
- When modifying MCP tools, maintain backward compatibility with existing agent prompts
