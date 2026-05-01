# Nous

Desktop notebook application with AI, databases, collaboration, and publishing. Built with Tauri (Rust + React).

## Architecture

- **Frontend:** React 19 + TypeScript + Vite, BlockNote editor (0.47), Tailwind CSS 4, Zustand state management
- **Desktop shell:** Tauri 2 (Rust), with PyO3 Python bridge for AI operations
- **Cloud API:** Cloudflare Workers (Hono.js), D1 SQLite, R2 storage, JWT auth at api.nous.page
- **Collaboration:** Yjs + PartyKit for real-time sync
- **Storage:** File-based (Editor.js JSON format), file-watching support
- **Python SDK:** `nous-sdk/` — client library (wraps the daemon HTTP API)
- **MCP server:** `nous-py/nous_mcp/` (entrypoint `server.py`, workflow tools in `workflow.py`)

## Key Paths

- `src/` — React frontend
- `src/components/Database/` — Database feature (table, board, gallery, calendar, timeline, chart views)
- `src/types/database.ts` — Database type definitions and view config schemas
- `src/components/` — All UI components
- `src-tauri/src/` — Rust backend (storage, goals, sync, encryption)
- `cloud/` — Cloudflare Workers cloud API
- `collab/` — PartyKit collaboration server
- `nous-sdk/` — Python client SDK
- `nous-py/nous_mcp/` — MCP server (the `mcp__nous__*` tools)

## Build & Dev

- Use **`just`** for builds and dev tasks. Run `just` (no args) to list recipes. Common ones: `just dev` (Tauri dev), `just check` (cargo compile-check), `just typecheck` (tsc), `just test-rust`, `just daemon`, `just build`. Recipes that compile Rust source `setup-python-env.sh` so PYO3/PKG_CONFIG are set correctly — running `cargo` directly without that env will fail with system-library errors.
- Subproject deploys: `just cloud-deploy`, `just collab-deploy`, `just guest-editor-deploy`.
- Release: `just release [--dry-run|--local|<version>]` — wraps `scripts/release.sh`.

## Conventions

- Use pnpm for frontend, cargo for Rust, uv for Python SDK; `npm` (not pnpm) inside `cloud/`, `collab/server/`, `collab/guest-editor/`
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
- To check task status and dependencies, use the **targeted query tools** (NOT `get_database`, which is too large):
  - `mcp__nous__task_summary` — cheapest: task counts by project/status/feature
  - `mcp__nous__query_tasks` — filtered queries with compact rows (by project, feature, status, phase, priority, blocked state)
  - `mcp__nous__get_feature_tasks` — tasks for a project/feature in dependency-resolved execution order
- Update task status via `mcp__nous__update_task_status` — pass the task name (no row-UUID lookup needed). It updates Status + Completed date, syncs page tags, fires the webhook, and optionally appends implementation notes via `notes=`. Same call accepts `external_ref`, `execution_mode`, `model_tier`, `estimate`, `complexity`, `task_type`, `max_files`, `requires_tests` for one-shot field updates. Avoid `mcp__nous__update_database_rows` for tasks — it's the slow path that requires a row-UUID lookup.
- Feature pages in Forge contain the full context: data model, API contracts, edge cases, test plans

Do NOT use `mcp__nous__get_database` on the Project Tasks database — it returns too much data. Use the targeted query tools above.

Do NOT create ad-hoc task tracking internally — all task state lives in Forge.

## MCP Server

The Nous MCP server (`nous-py/nous_mcp/`) exposes ~50 tools for external AI agents covering page CRUD, database CRUD, folder/tag management, inbox, daily notes, goals, energy, spending, planning, and task workflow. Used by Claude Code sessions to read/write Nous content. When modifying MCP tools, maintain backward compatibility with existing agent prompts.

### High-level helpers — reach for these before low-level tools

The MCP exposes both low-level primitives (`update_database_rows`, `update_page`, etc.) and higher-level helpers that wrap common workflows. Agents that go straight for the low-level primitives end up doing manual lookups and rewriting logic that already exists. Default to the helpers:

| If you want to... | Use | Don't reach for |
|---|---|---|
| Mark a task Done / change task status | `update_task_status(task, status, notes=...)` | `update_database_rows` after looking up a row UUID |
| Add or remove a tag on a page | `manage_tags(notebook, page, add=..., remove=...)` | `get_page` → edit tags → `update_page` |
| Edit a single block in a page | `find_block` + `replace_block` / `delete_block` / `insert_after_block` | `update_page` with the whole content rewritten |
| Toggle / add a checklist item | `toggle_checklist_item`, `add_checklist_item` | hand-rolled block edits |
| Create a new task | `create_task(project, title, content, priority, ...)` | `create_page` + `add_database_rows` |
| Create a new project | `create_project(name)` | `create_folder` + manual `Project` select wiring |
| Find what to work on next | `get_next_task(project, feature=...)` | `query_tasks` + manual sort |
| Verify dependency state before starting | `check_dependencies(task)` | parsing `Depends On` cells yourself |

When in doubt, check `nous-py/nous_mcp/server.py` and `nous-py/nous_mcp/workflow.py` for the full registered list — every `@mcp.tool()` is exposed as `mcp__nous__<func_name>`.
