"""Nous MCP Server — expose Nous notebooks to AI agents.

Run with:  uv run nous-mcp [--library NAME]
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import UTC, datetime
from uuid import uuid4

from mcp.server.fastmcp import FastMCP

from nous_ai.database_helpers import (
    build_property,
    format_database_as_table,
    resolve_cell_value,
    resolve_option_label,
)
from nous_mcp.markdown import export_page_to_markdown, markdown_to_blocks
from nous_mcp.storage import NousStorage

# All logging to stderr (stdout is reserved for JSON-RPC on stdio transport)
logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="%(name)s: %(message)s",
)
logger = logging.getLogger("nous-mcp")

mcp = FastMCP(
    "nous",
    instructions=(
        "Nous is a notebook application. Use these tools to read and create content "
        "in the user's Nous notebooks. Notebooks contain pages organized into optional "
        "sections and folders. Pages use a block-based editor (Editor.js). "
        "When reading pages, prefer markdown format for readability."
    ),
)

# Global storage instance, initialized in main()
_storage: NousStorage | None = None


def _get_storage() -> NousStorage:
    if _storage is None:
        raise RuntimeError("Storage not initialized")
    return _storage


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@mcp.tool()
def list_notebooks() -> str:
    """List all notebooks in the library.

    Returns JSON array of notebooks with id, name, icon, sectionsEnabled, archived, pageCount.
    """
    storage = _get_storage()
    notebooks = storage.list_notebooks()
    return json.dumps(notebooks, indent=2)


@mcp.tool()
def list_sections(notebook: str) -> str:
    """List sections in a notebook.

    Args:
        notebook: Notebook name or UUID (case-insensitive prefix match supported).

    Returns JSON array of sections with id, name, color, position.
    """
    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)
    sections = storage.list_sections(nb["id"])
    return json.dumps(sections, indent=2)


@mcp.tool()
def list_folders(
    notebook: str,
    section: str | None = None,
    include_archived: bool = False,
) -> str:
    """List folders in a notebook.

    Args:
        notebook: Notebook name or UUID (case-insensitive prefix match supported).
        section: Optional section name or UUID to filter by.
        include_archived: Include archived folders (default false).

    Returns JSON array of folders with id, name, parentId, sectionId, isArchived, position.
    """
    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)

    section_id = None
    if section:
        sec = storage.resolve_section(nb["id"], section)
        section_id = sec["id"]

    folders = storage.list_folders(
        nb["id"], section_id=section_id, include_archived=include_archived
    )
    return json.dumps(folders, indent=2)


@mcp.tool()
def list_pages(
    notebook: str,
    folder: str | None = None,
    section: str | None = None,
    tag: str | None = None,
    limit: int = 50,
) -> str:
    """List pages in a notebook, sorted by last updated.

    Args:
        notebook: Notebook name or UUID (case-insensitive prefix match supported).
        folder: Optional folder name or UUID to filter by.
        section: Optional section name or UUID to filter by.
        tag: Optional tag to filter by (case-insensitive).
        limit: Maximum number of pages to return (default 50).

    Returns JSON array of pages with id, title, tags, folderId, sectionId, pageType, updatedAt.
    """
    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)

    folder_id = None
    if folder:
        f = storage.resolve_folder(nb["id"], folder)
        folder_id = f["id"]

    section_id = None
    if section:
        sec = storage.resolve_section(nb["id"], section)
        section_id = sec["id"]

    pages = storage.list_pages(
        nb["id"],
        folder_id=folder_id,
        section_id=section_id,
        tag=tag,
        limit=limit,
    )
    return json.dumps(pages, indent=2)


@mcp.tool()
def get_page(
    notebook: str,
    page: str,
    format: str = "markdown",
) -> str:
    """Get the full content of a page.

    Args:
        notebook: Notebook name or UUID.
        page: Page title (prefix match) or UUID.
        format: Output format — "markdown" (default, with YAML frontmatter) or "json" (raw blocks).

    Returns the page content in the requested format.
    """
    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)
    pg = storage.resolve_page(nb["id"], page)

    if format == "json":
        return json.dumps(pg, indent=2)

    return export_page_to_markdown(pg)


@mcp.tool()
def search_pages(
    query: str,
    notebook: str | None = None,
    limit: int = 20,
) -> str:
    """Search for pages by text content or title.

    Args:
        query: Case-insensitive substring to search for in page titles and content.
        notebook: Optional notebook name or UUID to limit search to.
        limit: Maximum results (default 20).

    Returns JSON array of matches with pageId, notebookId, notebookName, title, snippet, tags.
    Title matches are ranked first.
    """
    storage = _get_storage()

    notebook_id = None
    if notebook:
        nb = storage.resolve_notebook(notebook)
        notebook_id = nb["id"]

    results = storage.search_pages(query, notebook_id=notebook_id, limit=limit)
    return json.dumps(results, indent=2)


@mcp.tool()
def create_page(
    notebook: str,
    title: str,
    content: str | None = None,
    tags: str | None = None,
    folder: str | None = None,
    section: str | None = None,
) -> str:
    """Create a new page in a notebook.

    Args:
        notebook: Notebook name or UUID.
        title: Page title.
        content: Optional markdown text content. Paragraphs are split on blank lines.
        tags: Optional comma-separated tags (e.g. "tag1, tag2").
        folder: Optional folder name or UUID to place the page in.
        section: Optional section name or UUID to place the page in.

    Returns JSON with id, title, notebookId of the created page.
    """
    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)

    folder_id = None
    if folder:
        f = storage.resolve_folder(nb["id"], folder)
        folder_id = f["id"]

    section_id = None
    if section:
        sec = storage.resolve_section(nb["id"], section)
        section_id = sec["id"]

    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

    blocks = _markdown_to_blocks(content) if content else []

    # Use NousPageStorage for atomic writes + oplog
    from nous_ai.page_storage import NousPageStorage

    page_storage = NousPageStorage(data_dir=storage.library_path, client_id="nous-mcp")
    page = page_storage.create_page(
        notebook_id=nb["id"],
        title=title,
        blocks=blocks,
        tags=tag_list,
        folder_id=folder_id,
        section_id=section_id,
    )

    return json.dumps(
        {
            "id": page["id"],
            "title": page["title"],
            "notebookId": nb["id"],
        },
        indent=2,
    )


@mcp.tool()
def append_to_page(
    notebook: str,
    page: str,
    content: str,
) -> str:
    """Append content to an existing page.

    Args:
        notebook: Notebook name or UUID.
        page: Page title (prefix match) or UUID.
        content: Markdown text to append. Paragraphs are split on blank lines.

    Returns JSON with id, title, blocksAdded count.
    """
    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)
    pg = storage.resolve_page(nb["id"], page)

    new_blocks = _markdown_to_blocks(content)
    if not new_blocks:
        return json.dumps({"id": pg["id"], "title": pg["title"], "blocksAdded": 0})

    existing_content = pg.get("content", {"time": None, "version": "2.28.0", "blocks": []})
    existing_blocks = existing_content.get("blocks", [])

    updated_content = {
        "time": int(datetime.now(UTC).timestamp() * 1000),
        "version": existing_content.get("version", "2.28.0"),
        "blocks": existing_blocks + new_blocks,
    }

    from nous_ai.page_storage import NousPageStorage

    page_storage = NousPageStorage(data_dir=storage.library_path, client_id="nous-mcp")
    page_storage.update_page(
        notebook_id=nb["id"],
        page_id=pg["id"],
        content=updated_content,
    )

    return json.dumps(
        {
            "id": pg["id"],
            "title": pg["title"],
            "blocksAdded": len(new_blocks),
        },
        indent=2,
    )


@mcp.tool()
def update_page(
    notebook: str,
    page: str,
    content: str | None = None,
    title: str | None = None,
    tags: str | None = None,
) -> str:
    """Replace the content, title, or tags of an existing page.

    Args:
        notebook: Notebook name or UUID.
        page: Page title (prefix match) or UUID.
        content: New markdown content (replaces all existing blocks).
        title: New page title.
        tags: New comma-separated tags (replaces all existing tags).

    Returns JSON with id, title of the updated page.
    """
    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)
    pg = storage.resolve_page(nb["id"], page)

    from nous_ai.page_storage import NousPageStorage

    page_storage = NousPageStorage(data_dir=storage.library_path, client_id="nous-mcp")

    updated_content = None
    if content is not None:
        blocks = _markdown_to_blocks(content)
        existing = pg.get("content", {"version": "2.28.0"})
        updated_content = {
            "time": int(datetime.now(UTC).timestamp() * 1000),
            "version": existing.get("version", "2.28.0"),
            "blocks": blocks,
        }

    tag_list = None
    if tags is not None:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]

    updated = page_storage.update_page(
        notebook_id=nb["id"],
        page_id=pg["id"],
        content=updated_content,
        title=title,
        tags=tag_list,
    )

    return json.dumps(
        {
            "id": updated["id"],
            "title": updated["title"],
        },
        indent=2,
    )


@mcp.tool()
def create_folder(
    notebook: str,
    name: str,
    parent: str | None = None,
    section: str | None = None,
) -> str:
    """Create a new folder in a notebook.

    Args:
        notebook: Notebook name or UUID.
        name: Folder name.
        parent: Optional parent folder name or UUID for nesting.
        section: Optional section name or UUID to place the folder in.

    Returns JSON with id, name of the created folder.
    """
    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)

    parent_id = None
    if parent:
        p = storage.resolve_folder(nb["id"], parent)
        parent_id = p["id"]

    section_id = None
    if section:
        sec = storage.resolve_section(nb["id"], section)
        section_id = sec["id"]

    folder = storage.create_folder(nb["id"], name, parent_id=parent_id, section_id=section_id)

    return json.dumps(
        {
            "id": folder["id"],
            "name": folder["name"],
        },
        indent=2,
    )


@mcp.tool()
def move_page(
    notebook: str,
    page: str,
    folder: str | None = None,
    section: str | None = None,
) -> str:
    """Move a page to a different folder and/or section.

    Args:
        notebook: Notebook name or UUID.
        page: Page title (prefix match) or UUID.
        folder: Target folder name or UUID. Omit to move to notebook root.
        section: Target section name or UUID.

    Returns JSON with id, title, folderId, sectionId of the moved page.
    """
    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)
    pg = storage.resolve_page(nb["id"], page)

    folder_id = None
    if folder:
        f = storage.resolve_folder(nb["id"], folder)
        folder_id = f["id"]

    section_id = None
    if section:
        sec = storage.resolve_section(nb["id"], section)
        section_id = sec["id"]

    from nous_ai.page_storage import NousPageStorage

    page_storage = NousPageStorage(data_dir=storage.library_path, client_id="nous-mcp")

    extra: dict[str, str | None] = {"folderId": folder_id}
    if section_id is not None:
        extra["sectionId"] = section_id

    updated = page_storage.update_page(
        notebook_id=nb["id"],
        page_id=pg["id"],
        extra_fields=extra,
    )

    return json.dumps(
        {
            "id": updated["id"],
            "title": updated["title"],
            "folderId": updated.get("folderId"),
            "sectionId": updated.get("sectionId"),
        },
        indent=2,
    )


@mcp.tool()
def manage_tags(
    notebook: str,
    page: str,
    add: str | None = None,
    remove: str | None = None,
) -> str:
    """Add or remove tags on a page without replacing all existing tags.

    Args:
        notebook: Notebook name or UUID.
        page: Page title (prefix match) or UUID.
        add: Comma-separated tags to add.
        remove: Comma-separated tags to remove.

    Returns JSON with id, title, tags of the updated page.
    """
    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)
    pg = storage.resolve_page(nb["id"], page)

    existing_tags: list[str] = pg.get("tags", [])
    tag_set = list(dict.fromkeys(existing_tags))  # preserve order, dedup

    if add:
        for t in add.split(","):
            t = t.strip()
            if t and t not in tag_set:
                tag_set.append(t)

    if remove:
        remove_set = {t.strip().lower() for t in remove.split(",") if t.strip()}
        tag_set = [t for t in tag_set if t.lower() not in remove_set]

    from nous_ai.page_storage import NousPageStorage

    page_storage = NousPageStorage(data_dir=storage.library_path, client_id="nous-mcp")
    updated = page_storage.update_page(
        notebook_id=nb["id"],
        page_id=pg["id"],
        tags=tag_set,
    )

    return json.dumps(
        {
            "id": updated["id"],
            "title": updated["title"],
            "tags": updated.get("tags", []),
        },
        indent=2,
    )


# ---------------------------------------------------------------------------
# Database tools
# ---------------------------------------------------------------------------

_build_property = build_property
_resolve_cell_value = resolve_cell_value
_resolve_option_label = resolve_option_label
_format_database_as_table = format_database_as_table


@mcp.tool()
def list_databases(
    notebook: str,
    folder: str | None = None,
    section: str | None = None,
) -> str:
    """List databases in a notebook.

    Args:
        notebook: Notebook name or UUID (case-insensitive prefix match supported).
        folder: Optional folder name or UUID to filter by.
        section: Optional section name or UUID to filter by.

    Returns JSON array of databases with id, title, tags, folderId,
    sectionId, propertyCount, rowCount.
    """
    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)

    folder_id = None
    if folder:
        f = storage.resolve_folder(nb["id"], folder)
        folder_id = f["id"]

    section_id = None
    if section:
        sec = storage.resolve_section(nb["id"], section)
        section_id = sec["id"]

    databases = storage.list_database_pages(nb["id"], folder_id=folder_id, section_id=section_id)
    return json.dumps(databases, indent=2)


@mcp.tool()
def get_database(
    notebook: str,
    database: str,
    format: str = "table",
) -> str:
    """Get the full content of a database.

    Args:
        notebook: Notebook name or UUID.
        database: Database title (prefix match) or UUID.
        format: Output format — "table" (default, markdown table with
            YAML frontmatter) or "json" (raw database JSON).

    Returns the database content in the requested format.
    """
    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)
    pg = storage.resolve_page(nb["id"], database)

    if pg.get("pageType") != "database":
        page_type = pg.get("pageType")
        raise ValueError(f"Page '{pg.get('title')}' is not a database (pageType: {page_type})")

    db_content = storage.read_database_content(nb["id"], pg["id"])
    if db_content is None:
        raise ValueError(f"Database file not found for page '{pg.get('title')}'")

    if format == "json":
        return json.dumps(db_content, indent=2)

    return _format_database_as_table(db_content, pg.get("title", ""))


@mcp.tool()
def create_database(
    notebook: str,
    title: str,
    properties: str,
    folder: str | None = None,
    section: str | None = None,
    tags: str | None = None,
) -> str:
    """Create a new database in a notebook.

    Args:
        notebook: Notebook name or UUID.
        title: Database title.
        properties: JSON string describing columns, e.g.
            '[{"name": "Name", "type": "text"},
            {"name": "Status", "type": "select",
            "options": ["Todo", "In Progress", "Done"]}]'.
            Supported types: text, number, select, multiSelect,
            checkbox, date, url.
        folder: Optional folder name or UUID to place the database in.
        section: Optional section name or UUID.
        tags: Optional comma-separated tags.

    Returns JSON with id, title, notebookId, propertyCount.
    """
    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)

    folder_id = None
    if folder:
        f = storage.resolve_folder(nb["id"], folder)
        folder_id = f["id"]

    section_id = None
    if section:
        sec = storage.resolve_section(nb["id"], section)
        section_id = sec["id"]

    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

    prop_specs = json.loads(properties)
    built_properties = []
    color_idx = 0
    for spec in prop_specs:
        prop, color_idx = _build_property(spec, color_idx)
        built_properties.append(prop)

    # Pre-generate page ID so we can reference it in sourceFile
    page_id = str(uuid4())

    # Create the page metadata
    from nous_ai.page_storage import NousPageStorage

    page_storage = NousPageStorage(data_dir=storage.library_path, client_id="nous-mcp")
    page = page_storage.create_page(
        notebook_id=nb["id"],
        title=title,
        blocks=[],
        tags=tag_list,
        folder_id=folder_id,
        section_id=section_id,
        page_id=page_id,
        extra_fields={
            "pageType": "database",
            "sourceFile": f"files/{page_id}.database",
            "storageMode": "embedded",
            "fileExtension": "database",
        },
    )

    # Create the .database file
    db_content = {
        "version": 2,
        "properties": built_properties,
        "rows": [],
        "views": [
            {
                "id": str(uuid4()),
                "name": "Table",
                "type": "table",
                "sorts": [],
                "filters": [],
                "config": {},
            }
        ],
    }
    storage.write_database_content(nb["id"], page_id, db_content)

    return json.dumps(
        {
            "id": page["id"],
            "title": page["title"],
            "notebookId": nb["id"],
            "propertyCount": len(built_properties),
        },
        indent=2,
    )


@mcp.tool()
def add_database_rows(
    notebook: str,
    database: str,
    rows: str,
) -> str:
    """Add rows to a database.

    Args:
        notebook: Notebook name or UUID.
        database: Database title (prefix match) or UUID.
        rows: JSON string of rows to add, e.g.
            '[{"Name": "Task 1", "Status": "Todo"}]'.
            Use property names as keys. For select/multiSelect,
            use option labels (new options are auto-created).

    Returns JSON with databaseId, rowsAdded, totalRows.
    """
    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)
    pg = storage.resolve_page(nb["id"], database)

    if pg.get("pageType") != "database":
        raise ValueError(f"Page '{pg.get('title')}' is not a database")

    db_content = storage.read_database_content(nb["id"], pg["id"])
    if db_content is None:
        raise ValueError(f"Database file not found for page '{pg.get('title')}'")

    properties = db_content.get("properties", [])
    prop_by_name = {p["name"].lower(): p for p in properties}

    row_specs = json.loads(rows)
    now = datetime.now(UTC).isoformat()

    new_rows = []
    for spec in row_specs:
        cells: dict = {}
        for key, value in spec.items():
            prop = prop_by_name.get(key.lower())
            if prop is None:
                continue
            cells[prop["id"]] = _resolve_cell_value(value, prop)

        new_rows.append(
            {
                "id": str(uuid4()),
                "cells": cells,
                "createdAt": now,
                "updatedAt": now,
            }
        )

    db_content["rows"].extend(new_rows)
    storage.write_database_content(nb["id"], pg["id"], db_content)

    # Touch page updatedAt
    from nous_ai.page_storage import NousPageStorage

    page_storage = NousPageStorage(data_dir=storage.library_path, client_id="nous-mcp")
    page_storage.update_page(notebook_id=nb["id"], page_id=pg["id"])

    return json.dumps(
        {
            "databaseId": pg["id"],
            "rowsAdded": len(new_rows),
            "totalRows": len(db_content["rows"]),
        },
        indent=2,
    )


@mcp.tool()
def update_database_rows(
    notebook: str,
    database: str,
    updates: str,
) -> str:
    """Update rows in a database.

    Args:
        notebook: Notebook name or UUID.
        database: Database title (prefix match) or UUID.
        updates: JSON string of updates, e.g.
            '[{"row": 0, "cells": {"Status": "Done"}}]'.
            "row" can be a 0-based index or a row UUID.
            Cell keys are property names; select values are
            option labels.

    Returns JSON with databaseId, rowsUpdated.
    """
    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)
    pg = storage.resolve_page(nb["id"], database)

    if pg.get("pageType") != "database":
        raise ValueError(f"Page '{pg.get('title')}' is not a database")

    db_content = storage.read_database_content(nb["id"], pg["id"])
    if db_content is None:
        raise ValueError(f"Database file not found for page '{pg.get('title')}'")

    properties = db_content.get("properties", [])
    prop_by_name = {p["name"].lower(): p for p in properties}
    existing_rows = db_content.get("rows", [])
    row_id_map = {r["id"]: i for i, r in enumerate(existing_rows)}

    update_specs = json.loads(updates)
    now = datetime.now(UTC).isoformat()
    updated_count = 0

    for spec in update_specs:
        row_ref = spec["row"]
        # Resolve row by index or UUID
        if isinstance(row_ref, int):
            if row_ref < 0 or row_ref >= len(existing_rows):
                continue
            row_idx = row_ref
        else:
            row_idx = row_id_map.get(str(row_ref))
            if row_idx is None:
                continue

        row = existing_rows[row_idx]
        for key, value in spec.get("cells", {}).items():
            prop = prop_by_name.get(key.lower())
            if prop is None:
                continue
            row["cells"][prop["id"]] = _resolve_cell_value(value, prop)

        row["updatedAt"] = now
        updated_count += 1

    db_content["rows"] = existing_rows
    storage.write_database_content(nb["id"], pg["id"], db_content)

    # Touch page updatedAt
    from nous_ai.page_storage import NousPageStorage

    page_storage = NousPageStorage(data_dir=storage.library_path, client_id="nous-mcp")
    page_storage.update_page(notebook_id=nb["id"], page_id=pg["id"])

    return json.dumps(
        {
            "databaseId": pg["id"],
            "rowsUpdated": updated_count,
        },
        indent=2,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _markdown_to_blocks(text: str) -> list[dict]:
    """Convert markdown text to Editor.js blocks.

    Handles headers, lists, checklists, code blocks, blockquotes,
    horizontal rules, and paragraphs.
    """
    return markdown_to_blocks(text)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="nous-mcp",
        description="Nous MCP Server — expose Nous notebooks to AI agents",
    )
    parser.add_argument(
        "--library",
        default=os.environ.get("NOUS_LIBRARY"),
        help="Library name (default: the default library). Can also set NOUS_LIBRARY env var.",
    )
    args = parser.parse_args()

    global _storage
    _storage = NousStorage.from_library_name(args.library)
    logger.info("Using library at: %s", _storage.library_path)

    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
