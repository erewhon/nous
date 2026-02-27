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

### POST /api/sync/trigger

Trigger WebDAV sync for all notebooks that have sync enabled. Returns the count of notebooks synced.

```json
{"data": {"synced_notebooks": 2}}
```

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

Dev mode: `./run-daemon.sh`
