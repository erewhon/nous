# Nous Daemon HTTP API

Base URL: `http://127.0.0.1:7667`

All responses are JSON. Success: `{"data": ...}`. Error: `{"error": "message"}` with appropriate HTTP status.

All IDs are UUIDs. Dates are `YYYY-MM-DD` strings.

## Endpoints

### GET /api/status

Returns daemon health.

```json
{"data": {"status": "running", "pid": 12345, "uptime_secs": 3600}}
```

### GET /api/notebooks

List all notebooks in the current library.

```json
{"data": [{"id": "uuid", "name": "My Notebook", ...}]}
```

### GET /api/notebooks/:notebook_id/pages

List all pages in a notebook.

```json
{"data": [{"id": "uuid", "title": "Page Title", "tags": ["tag1"], ...}]}
```

### GET /api/notebooks/:notebook_id/pages/:page_id

Get a single page with full content.

Returns 404 if not found.

### POST /api/notebooks/:notebook_id/pages

Create a new page.

Request body:
```json
{
  "title": "Page Title",
  "content": "Optional plain text. Double newlines become separate paragraphs.",
  "blocks": [{"type": "paragraph", "data": {"text": "Structured block"}}],
  "tags": ["optional", "tags"],
  "folder_id": "optional-uuid"
}
```

Only `title` is required. `blocks` takes priority over `content` if both are provided. Returns 201 on success.

### PUT /api/notebooks/:notebook_id/pages/:page_id

Update an existing page. All fields are optional; only provided fields are changed.

Request body:
```json
{
  "title": "New Title",
  "content": "Replaces all content with paragraph blocks.",
  "blocks": [{"type": "header", "data": {"text": "Title", "level": 2}}],
  "tags": ["replaces", "all", "tags"]
}
```

`blocks` takes priority over `content` if both are provided.

### POST /api/notebooks/:notebook_id/pages/:page_id/append

Append content to an existing page. Either `content` or `blocks` is required.

Request body (plain text):
```json
{"content": "Text to append.\n\nSecond paragraph."}
```

Request body (structured blocks):
```json
{"blocks": [{"type": "paragraph", "data": {"text": "First block"}}, {"type": "checklist", "data": {"items": [{"text": "Todo item", "checked": false}]}}]}
```

`blocks` takes priority over `content` if both are provided.

### GET /api/notebooks/:notebook_id/daily-notes/:date

Get the daily note for a date (YYYY-MM-DD). Returns 404 if no daily note exists for that date.

### POST /api/notebooks/:notebook_id/daily-notes/:date

Get or create the daily note for a date. Returns the existing note if one exists, otherwise creates it.

Request body (optional):
```json
{"template_id": "optional-template-uuid"}
```

### GET /api/inbox

List all inbox items.

### POST /api/inbox

Capture a new inbox item. Returns 201 on success.

Request body:
```json
{
  "title": "Inbox item title",
  "content": "Optional text content",
  "tags": ["optional", "tags"]
}
```

Only `title` is required.

### GET /api/goals

List all active goals with inline stats (streaks, completion rate).

```json
{"data": [{"goal": {"id": "uuid", "name": "Daily coding", "frequency": "Daily", ...}, "stats": {"goalId": "uuid", "currentStreak": 5, "longestStreak": 12, "totalCompleted": 45, "completionRate": 0.83}}]}
```

### GET /api/goals/summary

Overview of all active goals.

```json
{"data": {"activeGoals": 3, "completedToday": 1, "totalStreaks": 12, "highestStreak": 7}}
```

### GET /api/goals/:goal_id

Get a single goal with stats. Returns 404 if not found.

```json
{"data": {"goal": {...}, "stats": {...}}}
```

### GET /api/goals/:goal_id/progress

Get progress entries for a goal. Optional query params: `?start=2025-01-01&end=2025-01-31` or `?days=30`.

```json
{"data": [{"goalId": "uuid", "date": "2025-01-15", "completed": true, "autoDetected": false, "value": null}]}
```

### POST /api/goals/:goal_id/progress

Record progress for a goal. Returns 201 on success.

Request body:
```json
{
  "date": "2025-01-15",
  "completed": true,
  "value": 3
}
```

Only `date` is required. `completed` defaults to true. `value` is optional (for auto-detected goals).

### GET /api/energy/checkins

List energy check-ins. Optional query params: `?start=2025-01-01&end=2025-01-31`.

```json
{"data": [{"id": "uuid", "date": "2025-01-15", "energyLevel": 4, "mood": 3, "sleepQuality": 3, "focusCapacity": ["DeepWork"], "notes": "Felt good"}]}
```

### GET /api/energy/patterns

Get computed energy patterns. Optional query params: `?start=2025-01-01&end=2025-01-31`. Defaults to last 90 days.

```json
{"data": {"dayOfWeekAverages": {"monday": 3.5, "tuesday": 4.0}, "moodDayOfWeekAverages": {"monday": 3.0}, "currentStreak": 5, "typicalLowDays": ["monday"], "typicalHighDays": ["saturday"]}}
```

### GET /api/search

Search pages across all notebooks (or a specific notebook). Returns a list of `SearchResult` objects.

Query params:
- `q` (required) — search string
- `notebook_id` (optional) — limit to one notebook
- `limit` (optional, default 20)
- `fuzzy` (optional) — accepted for parity with `fuzzySearchPages`; current matching is case-insensitive substring regardless of this flag. A real edit-distance backend is a follow-up.

Response:

```json
{"data": [{
  "pageId": "uuid",
  "notebookId": "uuid",
  "notebookName": "My Notebook",
  "title": "Page Title",
  "snippet": "...matched text with surrounding context...",
  "score": 1.0,
  "pageType": "standard",
  "tags": ["tag1"]
}]}
```

`score` is `1.0` for title hits, `0.5` for content-only hits (synthetic — daemon does not compute Tantivy-style relevance).

### POST /api/sync/trigger

Trigger WebDAV sync for all notebooks that have sync enabled. Returns the count of notebooks synced.

```json
{"data": {"synced_notebooks": 2}}
```

## Folders

### GET /api/notebooks/:notebook_id/folders

List all folders in a notebook.

### POST /api/notebooks/:notebook_id/folders

Create a folder. Emits `folder.created`.

```json
{"name": "Folder Name", "parent_id": "optional-uuid", "section_id": "optional-uuid"}
```

### PUT /api/notebooks/:notebook_id/folders/:folder_id

Update a folder. All fields optional. `parent_id`, `color`, and `section_id` use triple-state semantics: omit to leave unchanged, `null` to clear, value to set. Emits `folder.updated`.

```json
{"name": "New Name", "parent_id": null, "color": "#ff0000", "section_id": "uuid"}
```

### DELETE /api/notebooks/:notebook_id/folders/:folder_id

Delete a folder. Optional query param `?move_pages_to=<folder_id>` relocates the folder's pages; otherwise pages move to root. Emits `folder.deleted`.

### POST /api/notebooks/:notebook_id/folders/:folder_id/archive

Archive a folder and all descendants + pages. Emits `folder.archived`.

### POST /api/notebooks/:notebook_id/folders/:folder_id/unarchive

Unarchive a folder and all descendants + pages. Emits `folder.unarchived`.

### POST /api/notebooks/:notebook_id/folders/reorder

Reorder folders within a parent.

```json
{"parent_id": "optional-uuid-or-null-for-root", "folder_ids": ["uuid1", "uuid2"]}
```

Emits `folder.reordered`.

## Sections

### GET /api/notebooks/:notebook_id/sections

List all sections in a notebook.

### POST /api/notebooks/:notebook_id/sections

Create a section. Emits `section.created`.

```json
{"name": "Section Name", "color": "#optional"}
```

### PUT /api/notebooks/:notebook_id/sections/:section_id

Update a section. `description`, `color`, and `system_prompt` use triple-state semantics. Emits `section.updated`.

```json
{
  "name": "New Name",
  "description": "Optional description (null to clear)",
  "color": "#ff0000",
  "system_prompt": "AI system prompt for this section",
  "system_prompt_mode": "override",
  "page_sort_by": "title"
}
```

`system_prompt_mode` is `"override"` or `"concatenate"`. `page_sort_by` empty string clears.

### DELETE /api/notebooks/:notebook_id/sections/:section_id

Delete a section. Optional query param `?move_items_to=<section_id>` relocates items; otherwise items become section-less. Emits `section.deleted`.

### POST /api/notebooks/:notebook_id/sections/reorder

Reorder sections.

```json
{"section_ids": ["uuid1", "uuid2"]}
```

Emits `section.reordered`.

## Page Operations

### POST /api/notebooks/:notebook_id/pages/:page_id/archive

Archive a page. Emits `page.archived`.

### POST /api/notebooks/:notebook_id/pages/:page_id/unarchive

Unarchive a page. Optional `target_folder_id` overrides the original folder.

```json
{"target_folder_id": "optional-uuid"}
```

Emits `page.unarchived`.

### POST /api/notebooks/:notebook_id/pages/reorder

Reorder pages within a folder.

```json
{"folder_id": "optional-uuid-or-null-for-root", "page_ids": ["uuid1", "uuid2"]}
```

Emits `page.reordered`.

### PUT /api/notebooks/:notebook_id/pages/:page_id/tags

Replace a page's tags. Emits `page.tags.updated`.

```json
{"tags": ["tag1", "tag2"]}
```

### POST /api/notebooks/:notebook_id/pages/:page_id/move

Move a page to a different folder and/or section. Empty string clears.

```json
{"folder_id": "uuid-or-empty", "section_id": "uuid-or-empty"}
```

Emits `page.moved`.

## Tags

### GET /api/notebooks/:notebook_id/tags

List all tags in a notebook with usage counts.

```json
{"data": [{"name": "work", "count": 12}, {"name": "todo", "count": 5}]}
```

### POST /api/notebooks/:notebook_id/tags/:tag/rename

Rename a tag across all pages in the notebook. Emits `tag.renamed`.

```json
{"new_name": "new-tag-name"}
```

Returns `{"data": {"pagesUpdated": <n>}}`.

### POST /api/notebooks/:notebook_id/tags/merge

Merge multiple tags into one. All occurrences of any tag in `from` are replaced with `into`. Emits `tag.merged`.

```json
{"from": ["old-tag-1", "old-tag-2"], "into": "target-tag"}
```

### DELETE /api/notebooks/:notebook_id/tags/:tag

Remove a tag from all pages in the notebook. Emits `tag.deleted`.

## WebSocket Events

Connect to `ws://127.0.0.1:7667/api/events` (Bearer token in `Authorization` header or `?token=` query param).

Events are JSON: `{"event": "<name>", "data": {...}, "timestamp": "<ISO8601>"}`.

Emitted events:

| Event | When |
|---|---|
| `page.created` | Page created |
| `page.updated` | Page edited |
| `page.deleted` | Page soft-deleted |
| `page.archived` / `page.unarchived` | Page archive state changed |
| `page.moved` | Page moved between folders/sections |
| `page.tags.updated` | Page tags replaced |
| `page.reordered` | Pages reordered within a folder |
| `folder.created` / `folder.updated` / `folder.deleted` | Folder lifecycle |
| `folder.archived` / `folder.unarchived` | Folder archive state changed |
| `folder.reordered` | Folders reordered |
| `section.created` / `section.updated` / `section.deleted` | Section lifecycle |
| `section.reordered` | Sections reordered |
| `tag.renamed` / `tag.merged` / `tag.deleted` | Tag-bulk operations |
| `inbox.deleted` | Inbox item deleted |

## Content format

Content can be provided in two ways:

1. **Plain text** (`content` field): Text is converted to Editor.js paragraph blocks. Separate paragraphs with double newlines (`\n\n`).

2. **Structured blocks** (`blocks` field): An array of Editor.js block objects. Each block has `type` and `data` fields. An `id` is auto-generated if omitted. Common block types:
   - `paragraph`: `{"text": "..."}`
   - `header`: `{"text": "...", "level": 2}`
   - `checklist`: `{"items": [{"text": "...", "checked": false}]}`
   - `list`: `{"style": "unordered", "items": [{"content": "...", "items": []}]}`

If both `content` and `blocks` are provided, `blocks` takes priority.

## Running the daemon

```
nous-cli daemon start             # foreground, default port 7667
nous-cli daemon start --port 8080 # custom port
nous-cli daemon status            # check if running
nous-cli daemon install           # install as system service
nous-cli daemon uninstall         # remove system service
```

Dev mode: `just daemon`
