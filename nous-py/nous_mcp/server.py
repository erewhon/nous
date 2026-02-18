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

from mcp.server.fastmcp import FastMCP

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
) -> str:
    """Create a new page in a notebook.

    Args:
        notebook: Notebook name or UUID.
        title: Page title.
        content: Optional markdown text content. Paragraphs are split on blank lines.
        tags: Optional comma-separated tags (e.g. "tag1, tag2").
        folder: Optional folder name or UUID to place the page in.

    Returns JSON with id, title, notebookId of the created page.
    """
    storage = _get_storage()
    nb = storage.resolve_notebook(notebook)

    folder_id = None
    if folder:
        f = storage.resolve_folder(nb["id"], folder)
        folder_id = f["id"]

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
    )

    return json.dumps({
        "id": page["id"],
        "title": page["title"],
        "notebookId": nb["id"],
    }, indent=2)


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

    return json.dumps({
        "id": pg["id"],
        "title": pg["title"],
        "blocksAdded": len(new_blocks),
    }, indent=2)


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
