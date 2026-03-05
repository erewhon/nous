# Nous Plugin Development Guide

Nous supports extending its functionality through Lua and WASM plugins. Plugins can read and write pages, manage goals, capture inbox items, query databases, make HTTP requests, register commands in the Command Palette, and react to events like page creation or goal progress.

This guide covers everything you need to build a Nous plugin.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Quick Start](#2-quick-start)
3. [Manifest Reference](#3-manifest-reference)
4. [Capabilities](#4-capabilities)
5. [Hook Points](#5-hook-points)
6. [Lua API Reference](#6-lua-api-reference)
7. [WASM Plugins](#7-wasm-plugins)
8. [Examples](#8-examples)
9. [Sandboxing & Limits](#9-sandboxing--limits)
10. [Enable / Disable](#10-enable--disable)

---

## 1. Overview

Nous plugins are standalone files placed in the `plugins/` directory inside your library folder. The plugin system supports two runtimes:

- **Lua plugins** (`.lua` files) -- fully supported, with a sandboxed Lua 5.4 VM per plugin.
- **WASM plugins** (`.toml` + `.wasm` file pair) -- supported via the Extism runtime. The host function interface mirrors the Lua API.

Each plugin declares a **manifest** that specifies its identity, the **capabilities** it needs (e.g., reading pages, making HTTP requests), and the **hook points** it registers for (e.g., reacting to page creation, providing Command Palette commands).

Capabilities are enforced at runtime. If a plugin tries to call an API it did not request, the call fails with a permission error.

Plugins are loaded at application startup and can be reloaded individually from Settings without restarting.

---

## 2. Quick Start

Create a file called `hello.lua` in your library's `plugins/` directory:

```lua
--[[ [manifest]
id = "hello-world"
name = "Hello World"
version = "0.1.0"
description = "Logs a message when a page is created"
capabilities = ["page_read"]
hooks = ["on_page_created"]
]]

function on_page_created(input_json)
  local data = nous.json_decode(input_json)
  nous.log_info("Page created: " .. (data.title or "unknown"))
  return nous.json_encode({ ok = true })
end
```

Restart Nous (or reload the plugin from Settings > Plugins). Every time you create a page, you will see the log message in the application logs.

**Key points:**

- The manifest is a TOML block inside a `--[[ [manifest] ... ]]` Lua comment at the top of the file.
- Every hook function receives a single argument: a JSON string.
- Every hook function must return a JSON string.
- Use `nous.json_decode()` and `nous.json_encode()` to convert between Lua tables and JSON strings.
- Use `nous.*` functions to interact with the Nous host API.

---

## 3. Manifest Reference

The manifest declares plugin metadata, requested capabilities, and registered hooks.

### Lua plugins

Embed the manifest as a TOML block in a multi-line Lua comment:

```lua
--[[ [manifest]
id = "my-plugin"
name = "My Plugin"
version = "0.1.0"
description = "What this plugin does"
capabilities = ["page_read", "goals_read"]
hooks = ["on_page_created", "goal_detector"]
]]
```

### WASM plugins

Create a `.toml` file with the same fields. Place it next to the `.wasm` binary with the same base name:

```
plugins/
  my-plugin.toml
  my-plugin.wasm
```

### Fields

| Field           | Type       | Required | Description                                                       |
| --------------- | ---------- | -------- | ----------------------------------------------------------------- |
| `id`            | string     | yes      | Unique identifier, e.g. `"my-plugin"`. Must be unique across all loaded plugins. |
| `name`          | string     | yes      | Human-readable display name.                                       |
| `version`       | string     | yes      | Semver version string, e.g. `"0.1.0"`.                            |
| `description`   | string     | no       | Short description shown in Settings > Plugins.                     |
| `capabilities`  | string[]   | no       | List of capability names. Defaults to none.                        |
| `hooks`         | string[]   | no       | List of hook point names. Defaults to none.                        |
| `is_builtin`    | boolean    | no       | Reserved for built-in plugins. Defaults to `false`.                |

---

## 4. Capabilities

A plugin must declare every capability it needs. Calls to APIs that require an undeclared capability will fail at runtime.

| Capability         | Description                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| `page_read`        | Read pages, notebooks, folders, sections, daily notes.                      |
| `page_write`       | Create, update, delete, move pages. Manage tags. Create folders and daily notes. |
| `database_read`    | List and read databases.                                                    |
| `database_write`   | Create databases, add rows, update rows.                                    |
| `inbox_capture`    | Capture, list, and delete inbox items.                                      |
| `goals_read`       | List goals, get stats, get summary, get progress.                           |
| `goals_write`      | Record goal progress.                                                       |
| `search`           | Full-text search across pages.                                              |
| `command_palette`  | Register commands in the Command Palette.                                   |
| `network`          | Make HTTP requests (with SSRF protection).                                  |
| `energy_read`      | Read energy check-ins and patterns.                                         |
| `energy_write`     | Reserved for future use.                                                    |

**Example:**

```toml
capabilities = ["page_read", "page_write", "inbox_capture", "network"]
```

---

## 5. Hook Points

Hooks determine when your plugin code runs. Declare them in the manifest and implement the corresponding Lua functions.

| Hook                  | Manifest string         | Lua function(s)                             | Description                                       |
| --------------------- | ----------------------- | ------------------------------------------- | ------------------------------------------------- |
| Goal Detector         | `"goal_detector"`       | `detect_goal(input_json)`                   | Called during auto-detection of goal progress.     |
| Action Step           | `"action_step:TYPE"`    | Function name specified in the action config | Called when executing an action step of that type. |
| Command Palette       | `"command_palette"`     | `get_commands(input_json)`, `execute_command(input_json)` | Registers commands in the Command Palette.   |
| Page Created          | `"on_page_created"`     | `on_page_created(input_json)`               | Fired after a page is created.                    |
| Page Updated          | `"on_page_updated"`     | `on_page_updated(input_json)`               | Fired after a page is updated.                    |
| Page Deleted          | `"on_page_deleted"`     | `on_page_deleted(input_json)`               | Fired after a page is deleted (moved to trash).   |
| Inbox Captured        | `"on_inbox_captured"`   | `on_inbox_captured(input_json)`             | Fired after an inbox item is captured.            |
| Goal Progress         | `"on_goal_progress"`    | `on_goal_progress(input_json)`              | Fired after goal progress is recorded.            |

### Hook function signatures

**Goal Detector**

Input:
```json
{
  "goal": { "id": "...", "name": "...", ... },
  "check": { "type": "plugin", "plugin_id": "my-plugin", ... },
  "date": "2025-03-15"
}
```

Return:
```json
{ "completed": true, "value": 42 }
```

**Command Palette -- `get_commands`**

Input: `null` (JSON null)

Return an array of command objects:
```json
[
  {
    "id": "do-something",
    "title": "Do Something",
    "subtitle": "Optional description",
    "keywords": ["do", "something"]
  }
]
```

**Command Palette -- `execute_command`**

Input:
```json
{ "command_id": "do-something" }
```

Return: any JSON value (result is currently discarded by the host).

**Event hooks (on_page_created, on_page_updated, on_page_deleted, on_inbox_captured, on_goal_progress)**

Input: a JSON object containing the relevant entity data (page, inbox item, or goal progress). The exact shape depends on the event.

Return: any JSON value (result is discarded; events are best-effort).

---

## 6. Lua API Reference

All host functions are available on the global `nous` table. Functions that interact with stored data receive and return **JSON strings**. Use `nous.json_decode()` and `nous.json_encode()` to convert.

### JSON Helpers

These are always available, no capability required.

```lua
-- Decode a JSON string into a Lua table
local data = nous.json_decode(json_string)

-- Encode a Lua value (table, string, number, boolean, nil) into a JSON string
local json_string = nous.json_encode(lua_value)
```

### Logging

Always available, no capability required.

```lua
nous.log_info("informational message")
nous.log_warn("warning message")
nous.log_error("error message")
```

Log output appears in the application log with the plugin ID as a prefix.

### Pages (read) -- requires `page_read`

```lua
-- List pages in a notebook
-- Returns: JSON string of pages array
local pages_json = nous.page_list(notebook_id)

-- Get full content of a page
-- Returns: JSON string of the page object
local page_json = nous.page_get(notebook_id, page_id)

-- List all notebooks
-- Returns: JSON string of notebooks array
local notebooks_json = nous.list_notebooks()

-- List sections in a notebook
-- Returns: JSON string of sections array
local sections_json = nous.list_sections(notebook_id)

-- List folders in a notebook
-- Returns: JSON string of folders array
local folders_json = nous.list_folders(notebook_id)
```

### Pages (write) -- requires `page_write`

```lua
-- Create a new page
-- Returns: JSON string with { id, title, notebookId }
local result = nous.page_create(notebook_id, title)

-- Update a page (pass nil to skip a field)
-- title, content, tags_json are all optional (nil to skip)
-- tags_json is a JSON string of a tags array, e.g. '["tag1","tag2"]'
nous.page_update(notebook_id, page_id, title, content, tags_json)

-- Append markdown content to a page
-- Returns: JSON string with { id, title, blocksAdded }
local result = nous.page_append(notebook_id, page_id, markdown_content)

-- Delete a page (move to trash)
-- Returns: JSON string with { deleted: true }
local result = nous.page_delete(notebook_id, page_id)

-- Move a page to a different folder and/or section
-- folder_id and section_id are optional (nil to skip)
-- Returns: JSON string with { id, title, folderId, sectionId }
local result = nous.page_move(notebook_id, page_id, folder_id, section_id)

-- Add or remove tags without replacing all existing tags
-- add_json and remove_json are JSON arrays of tag strings, e.g. '["new-tag"]'
-- Pass nil to skip adding or removing
-- Returns: JSON string with { id, title, tags }
local result = nous.page_manage_tags(notebook_id, page_id, add_json, remove_json)

-- Create a folder
-- parent_id is optional (nil for root-level folder)
-- Returns: JSON string with { id, name }
local result = nous.create_folder(notebook_id, name, parent_id)
```

### Daily Notes -- requires `page_read` for reading, `page_write` for creating

```lua
-- List recent daily notes
-- limit is optional (defaults to 10)
-- Returns: JSON string of daily notes array
local notes_json = nous.daily_note_list(notebook_id, limit)

-- Get daily note for a specific date
-- date is a string in YYYY-MM-DD format
-- Returns: JSON string of the daily note, or JSON null
local note_json = nous.daily_note_get(notebook_id, date_string)

-- Create a daily note for a specific date
-- content is optional markdown text
-- Returns: JSON string with { id, title, dailyNoteDate }
local result = nous.daily_note_create(notebook_id, date_string, content)
```

### Inbox -- requires `inbox_capture`

```lua
-- Capture a new inbox item
-- tags_json is optional; a JSON array of tag strings, e.g. '["tag1","tag2"]'
-- Returns: JSON string with { id, title, capturedAt }
local result = nous.inbox_capture(title, content, tags_json)

-- List inbox items
-- Returns: JSON string of inbox items array
local items_json = nous.inbox_list()

-- Delete an inbox item
-- Returns: JSON string with { id, deleted: true }
local result = nous.inbox_delete(item_id)
```

### Goals (read) -- requires `goals_read`

```lua
-- List all goals
-- Returns: JSON string of goals array
local goals_json = nous.goals_list()

-- Get computed stats for a goal (streaks, completion rate)
-- Returns: JSON string with { goalId, currentStreak, longestStreak, totalCompleted, completionRate }
local stats_json = nous.goal_get_stats(goal_id)

-- Get a summary of all active goals
-- Returns: JSON string with { activeGoals, completedToday, totalStreaks, highestStreak }
local summary_json = nous.goal_get_summary()

-- Get recent progress entries for a goal
-- limit is optional (defaults to 30)
-- Returns: JSON string of progress entries array
local progress_json = nous.goal_get_progress(goal_id, limit)
```

### Goals (write) -- requires `goals_write`

```lua
-- Record goal progress for a date
-- value is optional (numeric, e.g. pages read, commits made)
-- Returns: JSON string with { goalId, date, completed, value }
local result = nous.goal_record_progress(goal_id, date, completed, value)
```

### Database (read) -- requires `database_read`

```lua
-- List databases in a notebook
-- Returns: JSON string of databases array
local dbs_json = nous.database_list(notebook_id)

-- Get full content of a database
-- Returns: JSON string of the database with properties and rows
local db_json = nous.database_get(notebook_id, database_id)
```

### Database (write) -- requires `database_write`

```lua
-- Create a new database
-- properties_json is a JSON array of property definitions
-- Example: '[{"name":"Name","type":"text"},{"name":"Status","type":"select","options":["Todo","Done"]}]'
-- Supported types: text, number, select, multiSelect, checkbox, date, url
-- Returns: JSON string with { id, title, notebookId, propertyCount }
local result = nous.database_create(notebook_id, title, properties_json)

-- Add rows to a database
-- rows_json is a JSON array of row objects, keyed by property name
-- Example: '[{"Name":"Task 1","Status":"Todo"}]'
-- Returns: JSON string with { databaseId, rowsAdded, totalRows }
local result = nous.database_add_rows(notebook_id, database_id, rows_json)

-- Update existing rows in a database
-- updates_json is a JSON array of update objects
-- "row" can be a 0-based index or a row UUID
-- Example: '[{"row":0,"cells":{"Status":"Done"}}]'
-- Returns: JSON string with { databaseId, rowsUpdated }
local result = nous.database_update_rows(notebook_id, database_id, updates_json)
```

### Energy -- requires `energy_read`

```lua
-- Get energy check-ins within a date range
-- All parameters are optional: start_date, end_date (YYYY-MM-DD), limit
-- Returns: JSON string of check-ins array with energyLevel, mood, sleepQuality, focusCapacity, notes
local checkins_json = nous.energy_get_checkins(start_date, end_date, limit)

-- Get computed energy patterns (day-of-week averages, streaks)
-- start_date and end_date are optional (YYYY-MM-DD)
-- Returns: JSON string with dayOfWeekAverages, typicalLowDays, typicalHighDays, etc.
local patterns_json = nous.energy_get_patterns(start_date, end_date)
```

### Search -- requires `search`

```lua
-- Full-text search across pages
-- limit is optional (defaults to 20)
-- Returns: JSON string of search results with pageId, notebookId, title, snippet, tags
local results_json = nous.search(query, limit)
```

### Network -- requires `network`

```lua
-- General HTTP request
-- body, headers_json, and timeout are optional
-- headers_json is a JSON object, e.g. '{"Authorization":"Bearer token"}'
-- timeout is in milliseconds (max 60000)
-- Returns: JSON string with { status, headers, body }
local result = nous.http_request(method, url, body, headers_json, timeout)

-- Convenience: HTTP GET
-- headers_json is optional
-- Returns: JSON string with { status, headers, body }
local result = nous.http_get(url, headers_json)

-- Convenience: HTTP POST
-- headers_json is optional
-- Returns: JSON string with { status, headers, body }
local result = nous.http_post(url, body, headers_json)
```

---

## 7. WASM Plugins

WASM plugins use the Extism runtime. Place two files side by side in the `plugins/` directory:

```
plugins/
  my-plugin.toml    -- manifest
  my-plugin.wasm    -- compiled WASM binary
```

### Manifest file (`my-plugin.toml`)

The TOML file uses the same fields as the Lua manifest header:

```toml
id = "my-plugin"
name = "My Plugin"
version = "0.1.0"
description = "A WASM plugin"
capabilities = ["page_read", "network"]
hooks = ["on_page_created"]
```

### Host functions

The WASM runtime exposes host functions with the same semantics as the Lua `nous.*` API, but named with underscores instead of dots:

| Lua function               | WASM host function            |
| -------------------------- | ----------------------------- |
| `nous.log_info(msg)`       | `nous_log_info(msg)`          |
| `nous.log_warn(msg)`       | `nous_log_warn(msg)`          |
| `nous.log_error(msg)`      | `nous_log_error(msg)`         |
| `nous.page_list(...)`      | `nous_page_list(json)`        |
| `nous.page_get(...)`       | `nous_page_get(json)`         |
| `nous.page_create(...)`    | `nous_page_create(json)`      |
| `nous.page_update(...)`    | `nous_page_update(json)`      |
| `nous.page_append(...)`    | `nous_page_append(json)`      |
| `nous.page_delete(...)`    | `nous_page_delete(json)`      |
| `nous.page_move(...)`      | `nous_page_move(json)`        |
| `nous.page_manage_tags(...)` | `nous_page_manage_tags(json)` |
| `nous.list_notebooks()`    | `nous_list_notebooks(json)`   |
| `nous.list_sections(...)`  | `nous_list_sections(json)`    |
| `nous.list_folders(...)`   | `nous_list_folders(json)`     |
| `nous.create_folder(...)`  | `nous_create_folder(json)`    |
| `nous.daily_note_list(...)` | `nous_daily_note_list(json)` |
| `nous.daily_note_get(...)` | `nous_daily_note_get(json)`   |
| `nous.daily_note_create(...)` | `nous_daily_note_create(json)` |
| `nous.inbox_capture(...)`  | `nous_inbox_capture(json)`    |
| `nous.inbox_list()`        | `nous_inbox_list(json)`       |
| `nous.inbox_delete(...)`   | `nous_inbox_delete(json)`     |
| `nous.goals_list()`        | `nous_goals_list(json)`       |
| `nous.goal_record_progress(...)` | `nous_goal_record_progress(json)` |
| `nous.goal_get_stats(...)` | `nous_goal_get_stats(json)`   |
| `nous.goal_get_summary()`  | `nous_goal_get_summary(json)` |
| `nous.goal_get_progress(...)` | `nous_goal_get_progress(json)` |
| `nous.database_list(...)`  | `nous_database_list(json)`    |
| `nous.database_get(...)`   | `nous_database_get(json)`     |
| `nous.database_create(...)` | `nous_database_create(json)` |
| `nous.database_add_rows(...)` | `nous_database_add_rows(json)` |
| `nous.database_update_rows(...)` | `nous_database_update_rows(json)` |
| `nous.search(...)`         | `nous_search(json)`           |
| `nous.energy_get_checkins(...)` | `nous_energy_get_checkins(json)` |
| `nous.energy_get_patterns(...)` | `nous_energy_get_patterns(json)` |
| `nous.http_request(...)`   | `nous_http_request(json)`     |

WASM host functions receive a single JSON string with named parameters. For example, `nous_page_get` expects:

```json
{ "notebook_id": "...", "page_id": "..." }
```

Exported WASM functions (hook handlers) also receive a JSON string and must return a JSON string, the same as Lua.

---

## 8. Examples

### Example 1: Goal Detector

A plugin that checks whether the user made at least one git commit today by querying a local API.

```lua
--[[ [manifest]
id = "git-commit-detector"
name = "Git Commit Detector"
version = "0.1.0"
description = "Detects goal completion by checking for git commits today"
capabilities = ["goals_read", "network"]
hooks = ["goal_detector"]
]]

function detect_goal(input_json)
  local input = nous.json_decode(input_json)
  local date = input.date  -- e.g. "2025-03-15"

  -- Query a local git-log API (hypothetical)
  local response_json = nous.http_get(
    "http://localhost:9090/api/commits?date=" .. date
  )
  local response = nous.json_decode(response_json)

  if response.status ~= 200 then
    nous.log_warn("Git API returned status " .. tostring(response.status))
    return nous.json_encode({ completed = false, value = 0 })
  end

  local body = nous.json_decode(response.body)
  local count = #body.commits

  return nous.json_encode({
    completed = count > 0,
    value = count
  })
end
```

### Example 2: Command Palette

A plugin that adds a "Quick Capture" command to the Command Palette.

```lua
--[[ [manifest]
id = "quick-capture"
name = "Quick Capture Commands"
version = "0.1.0"
description = "Adds quick capture commands to the Command Palette"
capabilities = ["command_palette", "inbox_capture", "page_read"]
hooks = ["command_palette"]
]]

function get_commands(input_json)
  return nous.json_encode({
    {
      id = "capture-reading-note",
      title = "Capture Reading Note",
      subtitle = "Save a quick note to your inbox tagged 'reading'",
      keywords = { "reading", "note", "capture", "book" }
    },
    {
      id = "list-recent-pages",
      title = "Log Recent Pages",
      subtitle = "Log the titles of the 5 most recently updated pages",
      keywords = { "recent", "pages", "list" }
    }
  })
end

function execute_command(input_json)
  local input = nous.json_decode(input_json)

  if input.command_id == "capture-reading-note" then
    local result = nous.inbox_capture(
      "Reading note",
      "Captured from Quick Capture plugin",
      nous.json_encode({ "reading", "plugin" })
    )
    nous.log_info("Captured reading note: " .. result)
    return nous.json_encode({ ok = true })

  elseif input.command_id == "list-recent-pages" then
    local notebooks_json = nous.list_notebooks()
    local notebooks = nous.json_decode(notebooks_json)
    if #notebooks > 0 then
      local pages_json = nous.page_list(notebooks[1].id)
      local pages = nous.json_decode(pages_json)
      for i = 1, math.min(5, #pages) do
        nous.log_info("Recent page: " .. (pages[i].title or "(untitled)"))
      end
    end
    return nous.json_encode({ ok = true })
  end

  return nous.json_encode({ error = "Unknown command" })
end
```

### Example 3: Page Event Listener with Database Tracking

A plugin that logs page creation events into a database for auditing.

```lua
--[[ [manifest]
id = "page-audit-log"
name = "Page Audit Log"
version = "0.1.0"
description = "Tracks page creation events in a database"
capabilities = ["page_read", "database_read", "database_write"]
hooks = ["on_page_created"]
]]

-- Store the audit database ID after first lookup
local audit_db_id = nil
local notebook_id = nil

function ensure_audit_db()
  if audit_db_id then
    return true
  end

  -- Find the first notebook
  local notebooks = nous.json_decode(nous.list_notebooks())
  if #notebooks == 0 then
    nous.log_warn("No notebooks found")
    return false
  end
  notebook_id = notebooks[1].id

  -- Look for an existing audit database
  local dbs = nous.json_decode(nous.database_list(notebook_id))
  for _, db in ipairs(dbs) do
    if db.title == "Page Audit Log" then
      audit_db_id = db.id
      return true
    end
  end

  -- Create the database if it does not exist
  local props = nous.json_encode({
    { name = "Page Title", type = "text" },
    { name = "Event",      type = "select", options = { "created", "updated", "deleted" } },
    { name = "Date",       type = "date" },
  })

  local result = nous.json_decode(nous.database_create(notebook_id, "Page Audit Log", props))
  audit_db_id = result.id
  nous.log_info("Created audit database: " .. audit_db_id)
  return true
end

function on_page_created(input_json)
  local data = nous.json_decode(input_json)

  if not ensure_audit_db() then
    return nous.json_encode({ ok = false })
  end

  local row = nous.json_encode({
    {
      ["Page Title"] = data.title or "(untitled)",
      ["Event"]      = "created",
      ["Date"]       = os.date and "" or "",  -- date not available in sandbox; use data if provided
    }
  })

  nous.database_add_rows(notebook_id, audit_db_id, row)
  nous.log_info("Audit log: page created - " .. (data.title or "(untitled)"))

  return nous.json_encode({ ok = true })
end
```

---

## 9. Sandboxing & Limits

Plugins run in a restricted environment to protect user data and system resources.

### Lua sandbox

The Lua VM is created with a restricted standard library. Only these modules are available:

| Module       | Available |
| ------------ | --------- |
| `table`      | yes       |
| `string`     | yes       |
| `math`       | yes       |
| `coroutine`  | yes       |
| `utf8`       | yes       |
| `os`         | **no**    |
| `io`         | **no**    |
| `debug`      | **no**    |
| `package`    | **no**    |
| `loadfile`   | **no**    |
| `dofile`     | **no**    |

Plugins cannot read or write files, execute system commands, or load external Lua modules. All interaction with the outside world goes through the `nous.*` API.

### Memory limit

Each Lua plugin VM has a **64 MB** memory limit. If a plugin exceeds this, the VM will error.

### Network restrictions

Plugins with the `network` capability can make HTTP requests, but with these safeguards:

- **SSRF prevention**: Requests to private and loopback IP addresses (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, ::1, fc00::/7, etc.) are blocked. DNS resolution is checked before the request is sent.
- **Timeout**: Maximum 60 seconds per request.
- **Response size**: Maximum 10 MB response body.
- **Redirect limit**: Up to 5 redirects are followed automatically.
- **User-Agent**: All requests are sent with `nous-plugin/1.0` as the User-Agent.

### Data flow

All function arguments and return values are JSON strings. Plugins never receive raw Rust objects or direct memory access to application data.

---

## 10. Enable / Disable

Users can enable or disable individual plugins from **Settings > Plugins** in the Nous app.

- Disabled plugins are skipped during:
  - Event dispatch (page created/updated/deleted, inbox captured, goal progress)
  - Command Palette command collection
  - Goal detection
  - Action step execution
- The list of disabled plugin IDs is persisted in `plugins/disabled.json` inside the library folder.
- Disabling a plugin does not unload it from memory; it simply prevents the host from calling into it.
- Re-enabling a plugin takes effect immediately (no restart required).
- Individual plugins can be reloaded from Settings (re-reads the `.lua` file from disk) without restarting the app.

### File structure

```
{library_path}/
  plugins/
    disabled.json           # ["plugin-id-1", "plugin-id-2"]
    my-plugin.lua           # Lua plugin
    another-plugin.toml     # WASM manifest
    another-plugin.wasm     # WASM binary
```

---

## Appendix: Common Patterns

### Decoding input and encoding output

Every hook function follows the same pattern:

```lua
function my_hook(input_json)
  -- Decode the input
  local input = nous.json_decode(input_json)

  -- Do work...

  -- Return JSON
  return nous.json_encode({ result = "value" })
end
```

### Handling optional parameters

Pass `nil` for optional parameters:

```lua
-- Update only the title, leave content and tags unchanged
nous.page_update(notebook_id, page_id, "New Title", nil, nil)

-- Move to a folder but keep the current section
nous.page_move(notebook_id, page_id, folder_id, nil)
```

### Error handling

Host API calls that fail (e.g., permission denied, not found) will raise a Lua error. You can catch these with `pcall`:

```lua
local ok, result = pcall(function()
  return nous.page_get(notebook_id, page_id)
end)

if not ok then
  nous.log_error("Failed to get page: " .. tostring(result))
  return nous.json_encode({ error = tostring(result) })
end

local page = nous.json_decode(result)
```

### Working with JSON arrays in tags

Tags are passed as JSON arrays of strings:

```lua
-- Add tags
nous.page_manage_tags(
  notebook_id,
  page_id,
  nous.json_encode({ "new-tag", "another-tag" }),  -- add
  nil                                                -- remove (none)
)

-- Remove a tag
nous.page_manage_tags(
  notebook_id,
  page_id,
  nil,                                               -- add (none)
  nous.json_encode({ "old-tag" })                    -- remove
)
```
