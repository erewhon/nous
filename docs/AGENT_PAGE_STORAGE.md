# Writing Nous Pages from External Agents

External agents (Python scripts, cron jobs, etc.) can read and write Nous pages
directly to disk. This document explains how to do it correctly, maintaining the
operation log (oplog) that the app uses for history tracking.

## Quick Start

```python
from nous_ai.page_storage import NousPageStorage
from uuid import uuid4

storage = NousPageStorage(client_id="my-dashboard-agent")

# Create a page
page = storage.create_page(
    notebook_id="b67b98ae-d5d2-4947-b40d-6fc6410500b6",
    title="Weekly Dashboard - Feb 16, 2026",
    blocks=[
        {"id": str(uuid4()), "type": "header", "data": {"text": "Summary", "level": 2}},
        {"id": str(uuid4()), "type": "paragraph", "data": {"text": "Everything is on track."}},
    ],
    tags=["weekly-dashboard"],
    folder_id="some-folder-uuid",
)

print(f"Created page: {page['id']}")
```

## Installation

The `nous_ai` package lives in the Nous repository at `nous-py/`. To use it
from an external project:

```bash
# Option A: Add to PYTHONPATH
export PYTHONPATH="/path/to/nous/nous-py:$PYTHONPATH"

# Option B: pip install in editable mode
pip install -e /path/to/nous/nous-py
```

## API Reference

### `NousPageStorage(data_dir=None, client_id=None)`

- `data_dir`: Path to the Nous data directory. Auto-detected if not provided
  (`~/.local/share/nous` on Linux, `~/Library/Application Support/nous` on macOS).
- `client_id`: Identifier for this agent in oplog entries. Defaults to hostname.
  Use a descriptive name like `"dashboard-agent"` or `"meta-coordinator"`.

### `storage.create_page(...) -> dict`

Create a new page with a proper oplog "create" entry.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `notebook_id` | `str` | Yes | UUID of the target notebook |
| `title` | `str` | Yes | Page title |
| `blocks` | `list[dict]` | No | Editor.js blocks (default: empty) |
| `tags` | `list[str]` | No | Tags for the page |
| `folder_id` | `str` | No | UUID of the folder to place the page in |
| `section_id` | `str` | No | UUID of the section |
| `page_id` | `str` | No | Custom page UUID (auto-generated if not provided) |
| `extra_fields` | `dict` | No | Additional fields to set on the page |

### `storage.update_page(...) -> dict`

Update an existing page. Reads the old content, computes a block-level diff,
writes the new content atomically, and appends an oplog entry.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `notebook_id` | `str` | Yes | UUID of the notebook |
| `page_id` | `str` | Yes | UUID of the page to update |
| `content` | `dict` | No | New Editor.js content (time, version, blocks) |
| `title` | `str` | No | New title |
| `tags` | `list[str]` | No | New tags |
| `extra_fields` | `dict` | No | Additional fields to update |

### `storage.read_page(notebook_id, page_id) -> dict | None`

Read a page's full JSON. Returns `None` if the page doesn't exist.

### `storage.list_pages(notebook_id) -> list[dict]`

List all pages in a notebook (lightweight metadata, no content blocks).

### `storage.read_oplog(notebook_id, page_id) -> list[dict]`

Read all oplog entries for a page. Returns a list of dicts in chronological order.

## Block Format

Each block must have a unique `id` (UUID string), a `type`, and a `data` dict:

```python
from uuid import uuid4

blocks = [
    {
        "id": str(uuid4()),
        "type": "header",
        "data": {"text": "My Section", "level": 2},
    },
    {
        "id": str(uuid4()),
        "type": "paragraph",
        "data": {"text": "Some content here."},
    },
    {
        "id": str(uuid4()),
        "type": "list",
        "data": {"items": ["Item 1", "Item 2"], "style": "unordered"},
    },
    {
        "id": str(uuid4()),
        "type": "checklist",
        "data": {"items": [
            {"text": "Task 1", "checked": False},
            {"text": "Task 2", "checked": True},
        ]},
    },
]
```

Common block types: `header`, `paragraph`, `list`, `checklist`, `code`, `table`,
`quote`, `callout`, `image`, `delimiter`.

## Oplog Format

The oplog is a JSONL file at `{notebook}/pages/{page_id}.oplog`. Each line is
one entry:

```json
{
  "ts": "2026-02-15T20:30:00.000000+00:00",
  "clientId": "dashboard-agent",
  "op": "create",
  "contentHash": "sha256:abc123...",
  "prevHash": "genesis",
  "blockChanges": [
    {"blockId": "uuid-1", "op": "insert", "blockType": "header", "afterBlockId": null},
    {"blockId": "uuid-2", "op": "insert", "blockType": "paragraph", "afterBlockId": "uuid-1"}
  ],
  "blockCount": 2
}
```

### Hash Chain

Each entry's `prevHash` must equal the previous entry's `contentHash`. The first
entry uses `"genesis"` as its `prevHash`. This allows the app to detect if the
oplog has been tampered with or has gaps.

If your agent writes raw JSON without using `NousPageStorage`, the hash chain
will have a gap. The app detects this but continues working — the next save
through the app or via the storage helper heals the chain going forward.

### Content Hash

The `contentHash` is SHA-256 of the `content` dict serialized as compact JSON
(no spaces, `separators=(",", ":")`). This must match exactly — the Rust app
uses `serde_json::to_string()` which produces the same format.

## Atomic Writes

Both `create_page` and `update_page` use atomic writes (write to `.json.tmp`
then rename). This prevents corruption if the process is killed mid-write.

## Example: Migrating the Dashboard Agent

Before (raw JSON write):
```python
page_path = pages_dir / f"{page.id}.json"
page_path.write_text(json.dumps(page.model_dump(), indent=2) + "\n")
```

After (with oplog):
```python
from nous_ai.page_storage import NousPageStorage

storage = NousPageStorage(client_id="dashboard-agent")
page = storage.create_page(
    notebook_id=settings.notebook_id,
    title=title,
    blocks=[b.model_dump() for b in blocks],
    tags=["weekly-dashboard"],
    folder_id=folder_id,
)
```

## Data Directory Layout

```
~/.local/share/nous/notebooks/{notebook_id}/
    notebook.json          # Notebook metadata
    pages/
        {page_id}.json     # Page content
        {page_id}.oplog    # Operation log (JSONL, append-only)
        {page_id}.snapshots/
            20260215_203000.json       # Full page snapshot
            20260215_203000.meta.json  # Snapshot metadata
    folders.json           # Folder tree
    sections.json          # Sections
```
