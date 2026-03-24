"""Nous MCP Server — expose Nous notebooks to AI agents.

Run with:  uv run nous-mcp [--library NAME]
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from datetime import UTC, datetime
from html import unescape as html_unescape
from uuid import uuid4

from mcp.server.fastmcp import FastMCP

from nous_ai.database_helpers import (
    build_property,
    format_database_as_table,
    resolve_cell_value,
    resolve_option_label,
)
from nous_mcp.daemon_client import DaemonError, NousDaemonClient
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

# Global instances, initialized in main()
_storage: NousStorage | None = None
_daemon: NousDaemonClient | None = None


def _get_storage() -> NousStorage:
    if _storage is None:
        raise RuntimeError("Storage not initialized")
    return _storage


def _get_daemon() -> NousDaemonClient:
    if _daemon is None:
        raise RuntimeError("Daemon client not initialized")
    return _daemon


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
def create_folder(
    notebook: str,
    name: str,
    parent: str | None = None,
    section: str | None = None,
) -> str:
    """Create a folder in a notebook.

    Args:
        notebook: Notebook name or UUID.
        name: Folder name.
        parent: Optional parent folder name or UUID (for nesting).
        section: Optional section name or UUID to place the folder in.

    Returns JSON with id, name of the created folder.
    """
    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)

    parent_id = None
    if parent:
        folders = storage.list_folders(nb["id"])
        match = next(
            (f for f in folders if f["id"] == parent or f["name"].lower() == parent.lower()),
            None,
        )
        if match:
            parent_id = match["id"]

    section_id = None
    if section:
        sec = storage.resolve_section(nb["id"], section)
        section_id = sec["id"]

    folder = storage.create_folder(nb["id"], name, parent_id=parent_id, section_id=section_id)
    return json.dumps({"id": folder["id"], "name": folder["name"]}, indent=2)


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
    daemon = _get_daemon()
    nb = storage.resolve_notebook(notebook)
    pg = daemon.resolve_page(nb["id"], page)

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
    daemon = _get_daemon()

    notebook_id = None
    if notebook:
        nb = storage.resolve_notebook(notebook)
        notebook_id = nb["id"]

    results = daemon.search_pages(query, notebook_id=notebook_id, limit=limit)
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
    daemon = _get_daemon()
    nb = storage.resolve_notebook(notebook)

    folder_id = None
    if folder:
        f = storage.resolve_folder(nb["id"], folder)
        folder_id = f["id"]

    section_id = None
    if section:
        sec = storage.resolve_section(nb["id"], section)
        section_id = sec["id"]

    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None

    blocks = _markdown_to_blocks(content) if content else None

    page = daemon.create_page(
        nb["id"],
        title,
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
    daemon = _get_daemon()
    nb = storage.resolve_notebook(notebook)
    pg = daemon.resolve_page(nb["id"], page)

    new_blocks = _markdown_to_blocks(content)
    if not new_blocks:
        return json.dumps({"id": pg["id"], "title": pg["title"], "blocksAdded": 0})

    daemon.append_to_page(nb["id"], pg["id"], blocks=new_blocks)

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
    daemon = _get_daemon()
    nb = storage.resolve_notebook(notebook)
    pg = daemon.resolve_page(nb["id"], page)

    blocks = _markdown_to_blocks(content) if content is not None else None

    tag_list = None
    if tags is not None:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]

    updated = daemon.update_page(
        nb["id"],
        pg["id"],
        title=title,
        blocks=blocks,
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
    daemon = _get_daemon()
    nb = storage.resolve_notebook(notebook)
    pg = daemon.resolve_page(nb["id"], page)

    # Use empty string to clear folder (move to root)
    folder_id: str | None = ""
    if folder:
        f = storage.resolve_folder(nb["id"], folder)
        folder_id = f["id"]

    section_id = None
    if section:
        sec = storage.resolve_section(nb["id"], section)
        section_id = sec["id"]

    updated = daemon.update_page(
        nb["id"],
        pg["id"],
        folder_id=folder_id,
        section_id=section_id,
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
    daemon = _get_daemon()
    nb = storage.resolve_notebook(notebook)
    pg = daemon.resolve_page(nb["id"], page)

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

    updated = daemon.update_page(
        nb["id"],
        pg["id"],
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


@mcp.tool()
def toggle_checklist_item(
    notebook: str,
    page: str,
    item: str,
    checked: bool | None = None,
) -> str:
    """Toggle or set the checked state of a checklist item.

    Args:
        notebook: Notebook name or UUID.
        page: Page title (prefix match) or UUID.
        item: Text of the checklist item to match (case-insensitive substring).
        checked: Explicitly set to true or false. If omitted, toggles current state.

    Returns JSON with id, title, item text, and new checked state.
    """
    storage = _get_storage()
    daemon = _get_daemon()
    nb = storage.resolve_notebook(notebook)
    pg = daemon.resolve_page(nb["id"], page)

    content = pg.get("content", {})
    blocks = content.get("blocks", [])

    query = item.lower().strip()
    matches: list[tuple[int, int, dict, str]] = []

    for block_idx, block in enumerate(blocks):
        if block.get("type") != "checklist":
            continue
        items = block.get("data", {}).get("items", [])
        for item_idx, ci in enumerate(items):
            raw_text = ci.get("text", "")
            # Strip HTML tags and decode entities for matching
            clean = re.sub(r"<[^>]+>", "", raw_text)
            clean = html_unescape(clean).replace("\xa0", " ").strip()
            if query in clean.lower():
                matches.append((block_idx, item_idx, ci, clean))

    if len(matches) == 0:
        raise ValueError(
            f"No checklist item matching '{item}' found on page '{pg.get('title')}'"
        )

    if len(matches) > 1:
        # Try exact match
        exact = [(bi, ii, ci, t) for bi, ii, ci, t in matches if t.lower() == query]
        if len(exact) == 1:
            matches = exact
        else:
            match_list = "\n".join(
                f"  - [{'x' if m[2].get('checked') else ' '}] {m[3]}"
                for m in matches
            )
            raise ValueError(
                f"Multiple checklist items match '{item}'. Be more specific:\n{match_list}"
            )

    block_idx, item_idx, matched_item, clean_text = matches[0]

    old_checked = matched_item.get("checked", False)
    new_checked = (not old_checked) if checked is None else checked

    blocks[block_idx]["data"]["items"][item_idx]["checked"] = new_checked

    daemon.update_page(
        nb["id"],
        pg["id"],
        blocks=blocks,
    )

    return json.dumps(
        {
            "id": pg["id"],
            "title": pg.get("title"),
            "item": clean_text,
            "checked": new_checked,
        },
        indent=2,
    )


@mcp.tool()
def delete_block(
    notebook: str,
    page: str,
    block_id: str,
) -> str:
    """Delete a block from a page by its block ID.

    Args:
        notebook: Notebook name or UUID.
        page: Page title (prefix match) or UUID.
        block_id: The ID of the block to delete (from get_page format="json").

    Returns JSON with id, title, blockCount.
    """
    storage = _get_storage()
    daemon = _get_daemon()
    nb = storage.resolve_notebook(notebook)
    pg = daemon.resolve_page(nb["id"], page)

    updated = daemon.delete_block(nb["id"], pg["id"], block_id=block_id)

    return json.dumps(
        {
            "id": updated["id"],
            "title": updated["title"],
            "blockCount": len(updated.get("content", {}).get("blocks", [])),
        },
        indent=2,
    )


@mcp.tool()
def replace_block(
    notebook: str,
    page: str,
    block_id: str,
    content: str,
) -> str:
    """Replace a block in a page with new markdown content.

    Args:
        notebook: Notebook name or UUID.
        page: Page title (prefix match) or UUID.
        block_id: The ID of the block to replace (from get_page format="json").
        content: Markdown text to replace the block with. Can produce multiple blocks.

    Returns JSON with id, title, blocksInserted.
    """
    storage = _get_storage()
    daemon = _get_daemon()
    nb = storage.resolve_notebook(notebook)
    pg = daemon.resolve_page(nb["id"], page)

    new_blocks = _markdown_to_blocks(content)
    if not new_blocks:
        raise ValueError("Content produced no blocks")

    daemon.replace_block(nb["id"], pg["id"], block_id=block_id, blocks=new_blocks)

    return json.dumps(
        {
            "id": pg["id"],
            "title": pg.get("title"),
            "blocksInserted": len(new_blocks),
        },
        indent=2,
    )


@mcp.tool()
def insert_after_block(
    notebook: str,
    page: str,
    block_id: str,
    content: str,
) -> str:
    """Insert content after a specific block in a page.

    Args:
        notebook: Notebook name or UUID.
        page: Page title (prefix match) or UUID.
        block_id: The ID of the block to insert after (from get_page format="json" or find_block).
        content: Markdown text to insert. Can produce multiple blocks.

    Returns JSON with id, title, blocksInserted.
    """
    storage = _get_storage()
    daemon = _get_daemon()
    nb = storage.resolve_notebook(notebook)
    pg = daemon.resolve_page(nb["id"], page)

    new_blocks = _markdown_to_blocks(content)
    if not new_blocks:
        raise ValueError("Content produced no blocks")

    daemon.insert_after_block(nb["id"], pg["id"], block_id=block_id, blocks=new_blocks)

    return json.dumps(
        {
            "id": pg["id"],
            "title": pg.get("title"),
            "blocksInserted": len(new_blocks),
        },
        indent=2,
    )


@mcp.tool()
def add_checklist_item(
    notebook: str,
    page: str,
    item: str,
    section: str | None = None,
    checked: bool = False,
) -> str:
    """Add a checklist item to a page, optionally under a specific section heading.

    If section is provided, the item is inserted after the last checklist block
    under that heading. If no section is specified, the item is appended to the
    end of the page.

    Args:
        notebook: Notebook name or UUID.
        page: Page title (prefix match) or UUID.
        item: Text of the checklist item to add.
        section: Optional heading text to insert under (case-insensitive substring match).
        checked: Whether the item starts checked (default false).

    Returns JSON with id, title, blockId of the new checklist block.
    """
    storage = _get_storage()
    daemon = _get_daemon()
    nb = storage.resolve_notebook(notebook)
    pg = daemon.resolve_page(nb["id"], page)

    new_block = {
        "id": str(uuid4())[:8],
        "type": "checklist",
        "data": {"items": [{"text": item, "checked": checked}]},
    }

    if section:
        # Find the heading, then find the last checklist block in that section
        blocks = pg.get("content", {}).get("blocks", [])
        query = section.lower().strip()
        heading_idx = None
        for i, block in enumerate(blocks):
            if block.get("type") == "header":
                text = block.get("data", {}).get("text", "")
                clean = re.sub(r"<[^>]+>", "", text)
                clean = html_unescape(clean).replace("\xa0", " ").strip()
                if query in clean.lower():
                    heading_idx = i
                    break

        if heading_idx is None:
            raise ValueError(
                f"No heading matching '{section}' found on page '{pg.get('title')}'"
            )

        # Walk forward from heading to find the last checklist before the next
        # heading of the same or higher level
        heading_level = blocks[heading_idx].get("data", {}).get("level", 3)
        last_checklist_idx = heading_idx  # fallback: insert right after heading
        for i in range(heading_idx + 1, len(blocks)):
            b = blocks[i]
            if b.get("type") == "header":
                blevel = b.get("data", {}).get("level", 3)
                if blevel <= heading_level:
                    break  # reached next section at same or higher level
            if b.get("type") == "checklist":
                last_checklist_idx = i

        insert_after_id = blocks[last_checklist_idx]["id"]
        daemon.insert_after_block(
            nb["id"], pg["id"], block_id=insert_after_id, blocks=[new_block]
        )
    else:
        # Append to end
        daemon.append_to_page(nb["id"], pg["id"], blocks=[new_block])

    return json.dumps(
        {
            "id": pg["id"],
            "title": pg.get("title"),
            "blockId": new_block["id"],
        },
        indent=2,
    )


@mcp.tool()
def find_block(
    notebook: str,
    page: str,
    query: str,
    block_type: str | None = None,
) -> str:
    """Search for blocks within a page by text content.

    Args:
        notebook: Notebook name or UUID.
        page: Page title (prefix match) or UUID.
        query: Case-insensitive substring to search for in block text.
        block_type: Optional block type filter (e.g. "header", "paragraph", "checklist").

    Returns JSON array of matching blocks with id, type, text, and index.
    """
    storage = _get_storage()
    daemon = _get_daemon()
    nb = storage.resolve_notebook(notebook)
    pg = daemon.resolve_page(nb["id"], page)

    blocks = pg.get("content", {}).get("blocks", [])
    q = query.lower().strip()
    results = []

    for i, block in enumerate(blocks):
        if block_type and block.get("type") != block_type:
            continue

        # Extract text from block
        data = block.get("data", {})
        texts = []

        if data.get("text"):
            texts.append(data["text"])
        if data.get("items"):
            for item in data["items"]:
                if isinstance(item, dict):
                    texts.append(item.get("text", item.get("content", "")))
                elif isinstance(item, str):
                    texts.append(item)
        if data.get("code"):
            texts.append(data["code"])
        if data.get("caption"):
            texts.append(data["caption"])

        raw_text = " ".join(texts)
        clean = re.sub(r"<[^>]+>", "", raw_text)
        clean = html_unescape(clean).replace("\xa0", " ").strip()

        if q in clean.lower():
            result: dict = {
                "id": block.get("id", ""),
                "type": block.get("type", ""),
                "text": clean[:200],  # truncate for readability
                "index": i,
            }
            if block.get("type") == "checklist" and data.get("items"):
                result["checked"] = data["items"][0].get("checked", False)
            results.append(result)

    return json.dumps(results, indent=2)


@mcp.tool()
def get_page_outline(
    notebook: str,
    page: str,
    include_checklists: bool = True,
    include_paragraphs: bool = False,
) -> str:
    """Get a condensed outline of a page — headings and optionally checklist items.

    Useful for navigating large pages without loading full content. Returns block IDs
    that can be used with insert_after_block, replace_block, or delete_block.

    Args:
        notebook: Notebook name or UUID.
        page: Page title (prefix match) or UUID.
        include_checklists: Include checklist items (default true).
        include_paragraphs: Include paragraph text previews (default false).

    Returns JSON with title, blockCount, and outline array of {id, type, level, text, checked?}.
    """
    storage = _get_storage()
    daemon = _get_daemon()
    nb = storage.resolve_notebook(notebook)
    pg = daemon.resolve_page(nb["id"], page)

    blocks = pg.get("content", {}).get("blocks", [])
    outline = []

    for block in blocks:
        btype = block.get("type", "")
        data = block.get("data", {})
        bid = block.get("id", "")

        if btype == "header":
            text = re.sub(r"<[^>]+>", "", data.get("text", ""))
            text = html_unescape(text).replace("\xa0", " ").strip()
            outline.append({
                "id": bid,
                "type": "header",
                "level": data.get("level", 3),
                "text": text,
            })
        elif btype == "checklist" and include_checklists:
            items = data.get("items", [])
            for item in items:
                if isinstance(item, dict):
                    text = re.sub(r"<[^>]+>", "", item.get("text", ""))
                    text = html_unescape(text).replace("\xa0", " ").strip()
                    outline.append({
                        "id": bid,
                        "type": "checklist",
                        "text": text[:120],
                        "checked": item.get("checked", False),
                    })
        elif btype == "paragraph" and include_paragraphs:
            text = re.sub(r"<[^>]+>", "", data.get("text", ""))
            text = html_unescape(text).replace("\xa0", " ").strip()
            if text:
                outline.append({
                    "id": bid,
                    "type": "paragraph",
                    "text": text[:120],
                })

    return json.dumps(
        {
            "title": pg.get("title", ""),
            "blockCount": len(blocks),
            "outline": outline,
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
    daemon = _get_daemon()
    nb = storage.resolve_notebook(notebook)
    pg = daemon.resolve_page(nb["id"], database)

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

    daemon = _get_daemon()

    prop_specs = json.loads(properties)
    built_properties = []
    color_idx = 0
    for spec in prop_specs:
        prop, color_idx = _build_property(spec, color_idx)
        built_properties.append(prop)

    # Create the page via daemon — Rust auto-sets sourceFile from fileExtension + page ID
    page = daemon.create_page(
        nb["id"],
        title,
        tags=tag_list if tag_list else None,
        folder_id=folder_id,
        section_id=section_id,
        page_type="database",
        extra_fields={
            "storageMode": "embedded",
            "fileExtension": "database",
        },
    )
    page_id = page["id"]

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
    daemon = _get_daemon()
    nb = storage.resolve_notebook(notebook)
    pg = daemon.resolve_page(nb["id"], database)

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

    # Touch page updatedAt via daemon
    daemon.update_page(nb["id"], pg["id"])

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
    daemon = _get_daemon()
    nb = storage.resolve_notebook(notebook)
    pg = daemon.resolve_page(nb["id"], database)

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

    # Touch page updatedAt via daemon
    daemon.update_page(nb["id"], pg["id"])

    return json.dumps(
        {
            "databaseId": pg["id"],
            "rowsUpdated": updated_count,
        },
        indent=2,
    )


# ---------------------------------------------------------------------------
# Inbox tools
# ---------------------------------------------------------------------------


@mcp.tool()
def inbox_list(include_processed: bool = False) -> str:
    """List inbox items.

    Args:
        include_processed: Include processed items (default false).

    Returns JSON array of items with id, title, content, tags, capturedAt, source, isProcessed.
    """
    storage = _get_storage()
    items = storage.list_inbox_items(include_processed=include_processed)
    return json.dumps(items, indent=2)


@mcp.tool()
def inbox_capture(
    title: str,
    content: str = "",
    tags: str = "",
    source: str = "mcp",
) -> str:
    """Create a new inbox item.

    Args:
        title: Title of the inbox item.
        content: Optional text content (plain text or markdown).
        tags: Optional comma-separated tags.
        source: Source identifier (default "mcp").

    Returns JSON with id, title, capturedAt of the created item.
    """
    storage = _get_storage()

    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    now = datetime.now(UTC).isoformat()

    item = {
        "id": str(uuid4()),
        "title": title,
        "content": content,
        "tags": tag_list,
        "capturedAt": now,
        "updatedAt": now,
        "source": {"type": "api", "source": source},
        "classification": None,
        "isProcessed": False,
    }

    storage.write_inbox_item(item)

    return json.dumps(
        {
            "id": item["id"],
            "title": item["title"],
            "capturedAt": item["capturedAt"],
        },
        indent=2,
    )


@mcp.tool()
def inbox_delete(item_id: str) -> str:
    """Delete an inbox item by ID.

    Args:
        item_id: The UUID of the inbox item to delete.

    Returns JSON with id and deleted status.
    """
    storage = _get_storage()
    deleted = storage.delete_inbox_item(item_id)
    if not deleted:
        raise ValueError(f"Inbox item not found: {item_id}")
    return json.dumps({"id": item_id, "deleted": True}, indent=2)


# ---------------------------------------------------------------------------
# Daily notes tools
# ---------------------------------------------------------------------------


@mcp.tool()
def list_daily_notes(
    notebook: str,
    limit: int = 10,
) -> str:
    """List recent daily notes in a notebook.

    Args:
        notebook: Notebook name or UUID.
        limit: Maximum number of daily notes to return (default 10).

    Returns JSON array of daily notes with id, title, dailyNoteDate, tags.
    """
    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)
    notes = storage.list_daily_notes(nb["id"], limit=limit)
    return json.dumps(notes, indent=2)


@mcp.tool()
def get_daily_note(
    notebook: str,
    date: str,
) -> str:
    """Get the daily note for a specific date.

    Args:
        notebook: Notebook name or UUID.
        date: Date in YYYY-MM-DD format.

    Returns the daily note content in markdown format, or an error if not found.
    """
    storage = _get_storage()
    daemon = _get_daemon()
    nb = storage.resolve_notebook(notebook)
    page = daemon.get_daily_note(nb["id"], date)
    if page is None:
        raise ValueError(f"No daily note found for {date} in notebook '{nb.get('name')}'")

    return export_page_to_markdown(page)


@mcp.tool()
def create_daily_note(
    notebook: str,
    date: str,
    content: str = "",
) -> str:
    """Create a daily note for a specific date.

    Args:
        notebook: Notebook name or UUID.
        date: Date in YYYY-MM-DD format.
        content: Optional markdown content for the note.

    Returns JSON with id, title, dailyNoteDate of the created page.
    """
    storage = _get_storage()
    daemon = _get_daemon()
    nb = storage.resolve_notebook(notebook)

    # The daemon's create_or_get endpoint handles duplicate checking
    # and title formatting via create_daily_note_core
    page = daemon.create_daily_note(nb["id"], date)

    # If content was provided, append it
    if content:
        blocks = _markdown_to_blocks(content)
        if blocks:
            daemon.append_to_page(nb["id"], page["id"], blocks=blocks)

    return json.dumps(
        {
            "id": page["id"],
            "title": page["title"],
            "dailyNoteDate": page.get("dailyNoteDate", date),
            "notebookId": nb["id"],
        },
        indent=2,
    )


# ---------------------------------------------------------------------------
# Goals tools
# ---------------------------------------------------------------------------


@mcp.tool()
def list_goals(include_archived: bool = False) -> str:
    """List all goals.

    Args:
        include_archived: Include archived goals (default false).

    Returns JSON array of goals with id, name, description, frequency, trackingType, etc.
    """
    storage = _get_storage()
    goals = storage.list_goals(include_archived=include_archived)

    # Return a summary view
    results = []
    for g in goals:
        results.append({
            "id": g["id"],
            "name": g.get("name", ""),
            "description": g.get("description"),
            "frequency": g.get("frequency", "Daily"),
            "trackingType": g.get("trackingType", "Manual"),
            "createdAt": g.get("createdAt", ""),
            "archivedAt": g.get("archivedAt"),
        })

    return json.dumps(results, indent=2)


@mcp.tool()
def get_goal_progress(
    goal_id: str,
    limit: int = 30,
) -> str:
    """Get recent progress entries for a goal.

    Args:
        goal_id: The UUID of the goal.
        limit: Maximum number of entries to return (default 30).

    Returns JSON array of progress entries with goalId, date, completed, value.
    """
    storage = _get_storage()
    entries = storage.get_goal_progress(goal_id)

    # Sort by date descending and limit
    entries.sort(key=lambda e: e.get("date", ""), reverse=True)
    entries = entries[:limit]

    return json.dumps(entries, indent=2)


@mcp.tool()
def record_goal_progress(
    goal_id: str,
    date: str,
    completed: bool = True,
    value: float | None = None,
) -> str:
    """Record progress for a goal on a specific date.

    Args:
        goal_id: The UUID of the goal.
        date: Date in YYYY-MM-DD format.
        completed: Whether the goal was completed (default true).
        value: Optional numeric value (e.g., pages edited, commits made).

    Returns JSON with goalId, date, completed, value.
    """
    storage = _get_storage()

    # Verify goal exists
    goals = storage.list_goals(include_archived=True)
    goal = None
    for g in goals:
        if g["id"] == goal_id:
            goal = g
            break
    if goal is None:
        raise ValueError(f"Goal not found: {goal_id}")

    # Load existing progress
    entries = storage.get_goal_progress(goal_id)

    # Update or append entry for this date
    entry_data = {
        "goalId": goal_id,
        "date": date,
        "completed": completed,
        "autoDetected": False,
    }
    if value is not None:
        entry_data["value"] = int(value)

    updated = False
    for i, entry in enumerate(entries):
        if entry.get("date") == date:
            entries[i] = entry_data
            updated = True
            break

    if not updated:
        entries.append(entry_data)

    storage.write_goal_progress(goal_id, entries)

    return json.dumps(entry_data, indent=2)


@mcp.tool()
def get_goal_stats(goal_id: str) -> str:
    """Get computed statistics for a goal including streaks and completion rate.

    Args:
        goal_id: The UUID of the goal.

    Returns JSON with goalId, currentStreak, longestStreak, totalCompleted, completionRate.
    """
    storage = _get_storage()
    stats = storage.calculate_goal_stats(goal_id)
    return json.dumps(stats, indent=2)


@mcp.tool()
def get_goals_summary() -> str:
    """Get a summary of all active goals with today's completions and streaks.

    Returns JSON with activeGoals, completedToday, totalStreaks, highestStreak.
    """
    storage = _get_storage()
    summary = storage.get_goals_summary()
    return json.dumps(summary, indent=2)


# ---------------------------------------------------------------------------
# Energy tools
# ---------------------------------------------------------------------------


@mcp.tool()
def get_energy_checkins(
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 30,
) -> str:
    """Get energy check-ins, optionally filtered by date range.

    Args:
        start_date: Optional start date (YYYY-MM-DD). Defaults to 30 days ago.
        end_date: Optional end date (YYYY-MM-DD). Defaults to today.
        limit: Maximum number of check-ins to return (default 30).

    Returns JSON array of check-ins with date, energyLevel, mood,
    sleepQuality, focusCapacity, notes.
    """
    storage = _get_storage()

    if start_date and end_date:
        checkins = storage.get_energy_checkins_range(start_date, end_date)
    elif start_date:
        from datetime import date

        checkins = storage.get_energy_checkins_range(start_date, date.today().isoformat())
    else:
        checkins = storage.list_energy_checkins()

    # Sort by date descending
    checkins.sort(key=lambda c: c.get("date", ""), reverse=True)
    return json.dumps(checkins[:limit], indent=2)


@mcp.tool()
def get_energy_patterns(
    start_date: str | None = None,
    end_date: str | None = None,
) -> str:
    """Get computed energy patterns including day-of-week averages and streaks.

    Args:
        start_date: Optional start date (YYYY-MM-DD). Defaults to 90 days ago.
        end_date: Optional end date (YYYY-MM-DD). Defaults to today.

    Returns JSON with dayOfWeekAverages, moodDayOfWeekAverages,
    currentStreak, typicalLowDays, typicalHighDays.
    """
    storage = _get_storage()

    from datetime import date, timedelta

    end = end_date or date.today().isoformat()
    start = start_date or (date.today() - timedelta(days=90)).isoformat()

    checkins = storage.get_energy_checkins_range(start, end)
    patterns = storage.calculate_energy_patterns(checkins)
    return json.dumps(patterns, indent=2)


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

    global _storage, _daemon
    _storage = NousStorage.from_library_name(args.library)
    logger.info("Using library at: %s", _storage.library_path)

    # Initialize daemon client and verify connectivity
    _daemon = NousDaemonClient()
    try:
        status = _daemon.status()
        logger.info("Connected to Nous daemon (pid %s)", status.get("pid"))
    except DaemonError as e:
        logger.error("Nous daemon is not running: %s", e)
        logger.error("Start the daemon with: nous daemon start")
        sys.exit(1)

    mcp.run(transport="stdio")


# ===== Financial Tools =====


@mcp.tool()
def query_spending(
    notebook: str,
    start_date: str | None = None,
    end_date: str | None = None,
    category: str | None = None,
    merchant: str | None = None,
    account: str | None = None,
    group_by: str | None = None,
    limit: int = 50,
) -> str:
    """Query spending from the Transactions database.

    Args:
        notebook: Notebook name or UUID containing the Transactions database.
        start_date: Filter from this date (YYYY-MM-DD).
        end_date: Filter to this date (YYYY-MM-DD).
        category: Filter by category name (case-insensitive).
        merchant: Filter by merchant name (substring match).
        account: Filter by account name.
        group_by: Optional grouping — "category", "merchant", "month", or "account".
        limit: Max rows to return when not grouping (default 50).

    Returns JSON with matching transactions or grouped summary.
    """
    from nous_mcp.finance import (
        load_transactions, filter_transactions, summarize_by_category,
        monthly_totals, top_merchants,
    )

    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)
    rows, _ = load_transactions(storage, nb["id"])

    filtered = filter_transactions(
        rows, start_date=start_date, end_date=end_date,
        category=category, merchant=merchant, account=account,
    )

    if group_by == "category":
        return json.dumps(summarize_by_category(filtered), indent=2)
    elif group_by == "month":
        return json.dumps(monthly_totals(filtered), indent=2)
    elif group_by == "merchant":
        return json.dumps(top_merchants(filtered, limit=limit), indent=2)
    elif group_by == "account":
        from collections import defaultdict
        groups: dict[str, list] = defaultdict(list)
        for r in filtered:
            groups[str(r.get("Account", "Unknown"))].append(r)
        result = {}
        for acct, acct_rows in groups.items():
            total = sum(abs(float(r.get("Amount", 0))) for r in acct_rows)
            result[acct] = {"total": round(total, 2), "count": len(acct_rows)}
        return json.dumps(result, indent=2)
    else:
        # Return individual rows, sorted by date descending
        sorted_rows = sorted(filtered, key=lambda r: str(r.get("Date", "")), reverse=True)
        return json.dumps(sorted_rows[:limit], indent=2)


@mcp.tool()
def get_spending_summary(
    notebook: str,
    month: str | None = None,
) -> str:
    """Get a spending summary for a month (or current month by default).

    Args:
        notebook: Notebook name or UUID.
        month: Month in YYYY-MM format (default: current month).

    Returns JSON with totalSpent, totalIncome, net, topCategories,
    topMerchants, transactionCount, dailyAverage.
    """
    from nous_mcp.finance import load_transactions, get_month_summary
    from datetime import date as date_type

    if not month:
        month = date_type.today().strftime("%Y-%m")

    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)
    rows, _ = load_transactions(storage, nb["id"])

    summary = get_month_summary(rows, month)
    return json.dumps(summary, indent=2)


@mcp.tool()
def compare_spending(
    notebook: str,
    period1: str,
    period2: str,
) -> str:
    """Compare spending between two months.

    Args:
        notebook: Notebook name or UUID.
        period1: First month (YYYY-MM).
        period2: Second month (YYYY-MM).

    Returns JSON with period totals, difference, percentage change,
    and per-category comparison.
    """
    from nous_mcp.finance import load_transactions, compare_months

    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)
    rows, _ = load_transactions(storage, nb["id"])

    comparison = compare_months(rows, period1, period2)
    return json.dumps(comparison, indent=2)


@mcp.tool()
def get_spending_trends(
    notebook: str,
    months: int = 6,
    category: str | None = None,
) -> str:
    """Get spending trends over the last N months.

    Args:
        notebook: Notebook name or UUID.
        months: Number of months to look back (default 6).
        category: Optional category to focus on.

    Returns JSON with monthly totals array, trend direction, and averages.
    """
    from nous_mcp.finance import load_transactions, spending_trends

    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)
    rows, _ = load_transactions(storage, nb["id"])

    trends = spending_trends(rows, months=months, category=category)
    return json.dumps(trends, indent=2)


# ===== Agile Results Tools =====


@mcp.tool()
def check_alignment(
    notebook: str,
    date: str | None = None,
) -> str:
    """Check if today's daily outcomes align with weekly and monthly goals.

    Provides a gentle review: alignment check, blind spots, and one suggestion.
    Call this when the user asks to "check my alignment", "review my plan",
    "am I on track", or "nudge me".

    Args:
        notebook: Notebook name or UUID (e.g. "Agile Results").
        date: Date to check (YYYY-MM-DD, default: today).

    Returns the alignment review as text.
    """
    from datetime import date as date_type
    from nous_mcp.agile import (
        get_page_text, get_daily_note_text, get_week_daily_notes,
        build_alignment_prompt,
    )

    target = date_type.fromisoformat(date) if date else date_type.today()

    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)
    nb_id = nb["id"]

    daily_text = get_daily_note_text(storage, nb_id, target)
    if not daily_text:
        return f"No daily note found for {target.isoformat()}. Create one first."

    weekly_text = get_page_text(storage, nb_id, "Weekly Plan")
    monthly_text = get_page_text(storage, nb_id, "Monthly Plan")
    yearly_text = get_page_text(storage, nb_id, "Yearly Vision")

    if not weekly_text and not monthly_text:
        return "No Weekly Plan or Monthly Plan pages found. Create them with your Rule of 3 goals."

    week_summary = get_week_daily_notes(storage, nb_id, target)

    prompt = build_alignment_prompt(
        daily_text, weekly_text, monthly_text, yearly_text, week_summary
    )

    # Return the prompt as context — the AI model will generate the review
    return prompt


@mcp.tool()
def get_week_progress(
    notebook: str,
    date: str | None = None,
) -> str:
    """Get a summary of this week's daily outcomes and completion rates.

    Shows each day's outcomes, completion rate, and overall progress.
    Call this when the user asks "how's my week going", "weekly progress",
    or "what have I done this week".

    Args:
        notebook: Notebook name or UUID.
        date: Any date in the target week (YYYY-MM-DD, default: today).

    Returns JSON with daily summaries and overall stats.
    """
    from datetime import date as date_type
    from nous_mcp.agile import get_page_text, get_week_daily_notes

    target = date_type.fromisoformat(date) if date else date_type.today()

    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)
    nb_id = nb["id"]

    days = get_week_daily_notes(storage, nb_id, target)

    if not days:
        return json.dumps({"message": "No daily notes found for this week."})

    total_items = sum(d["total_items"] for d in days)
    total_done = sum(d["completed"] for d in days)
    overall_rate = round(total_done / total_items * 100) if total_items > 0 else 0

    # Check weekly goals
    weekly_text = get_page_text(storage, nb_id, "Weekly Plan")

    result = {
        "week": f"{days[0]['date']} to {days[-1]['date']}",
        "days": days,
        "overall": {
            "totalItems": total_items,
            "completed": total_done,
            "completionRate": overall_rate,
            "daysTracked": len(days),
        },
    }
    if weekly_text:
        result["weeklyPlan"] = weekly_text[:500]

    return json.dumps(result, indent=2)


@mcp.tool()
def get_planning_context(
    notebook: str,
) -> str:
    """Get current weekly goals, monthly goals, and yearly vision.

    Call this when the user asks "what are my goals", "show my plan",
    or needs context for planning.

    Args:
        notebook: Notebook name or UUID.

    Returns the content of the Weekly Plan, Monthly Plan, and Yearly Vision pages.
    """
    from nous_mcp.agile import get_page_text

    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)
    nb_id = nb["id"]

    parts = []

    weekly = get_page_text(storage, nb_id, "Weekly Plan")
    if weekly:
        parts.append(f"## Weekly Plan\n{weekly}")

    monthly = get_page_text(storage, nb_id, "Monthly Plan")
    if monthly:
        parts.append(f"## Monthly Plan\n{monthly}")

    yearly = get_page_text(storage, nb_id, "Yearly Vision")
    if yearly:
        parts.append(f"## Yearly Vision\n{yearly}")

    if not parts:
        return "No planning pages found. Create Weekly Plan, Monthly Plan, and/or Yearly Vision pages."

    return "\n\n".join(parts)


if __name__ == "__main__":
    main()
