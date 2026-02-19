"""Read-only data access for Nous notebooks, sections, folders, and pages.

Handles library discovery, name resolution, and provides a high-level API
for the MCP server tools.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def _default_data_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "nous"
    return Path.home() / ".local" / "share" / "nous"


class NousStorage:
    """Read-only access to Nous data on disk."""

    def __init__(self, library_path: Path):
        self.library_path = library_path

    # --- Library discovery ---

    @staticmethod
    def discover_libraries() -> list[dict]:
        """Read ~/.local/share/nous/libraries.json."""
        path = _default_data_dir() / "libraries.json"
        if not path.exists():
            return []
        return json.loads(path.read_text())

    @classmethod
    def from_library_name(cls, name: str | None = None) -> NousStorage:
        """Create a NousStorage for a library by name, or the default library."""
        libraries = cls.discover_libraries()
        if not libraries:
            raise RuntimeError("No Nous libraries found. Is Nous installed?")

        if name:
            match = _resolve_name(name, libraries, key="name")
            return cls(Path(match["path"]))

        # Default library
        for lib in libraries:
            if lib.get("isDefault"):
                return cls(Path(lib["path"]))

        # Fallback to first
        return cls(Path(libraries[0]["path"]))

    # --- Notebooks ---

    def _notebooks_dir(self) -> Path:
        return self.library_path / "notebooks"

    def list_notebooks(self) -> list[dict]:
        nb_dir = self._notebooks_dir()
        if not nb_dir.exists():
            return []

        results = []
        for d in sorted(nb_dir.iterdir()):
            meta_path = d / "notebook.json"
            if not meta_path.exists():
                continue
            try:
                nb = json.loads(meta_path.read_text())
            except (json.JSONDecodeError, OSError):
                continue

            pages_dir = d / "pages"
            page_count = len(list(pages_dir.glob("*.json"))) if pages_dir.exists() else 0

            results.append(
                {
                    "id": nb["id"],
                    "name": nb.get("name", ""),
                    "icon": nb.get("icon"),
                    "sectionsEnabled": nb.get("sectionsEnabled", False),
                    "archived": nb.get("archived", False),
                    "pageCount": page_count,
                }
            )

        return results

    def resolve_notebook(self, name_or_id: str) -> dict:
        """Resolve a notebook by name prefix or UUID. Returns notebook.json dict."""
        if UUID_RE.match(name_or_id):
            path = self._notebooks_dir() / name_or_id / "notebook.json"
            if path.exists():
                return json.loads(path.read_text())
            raise ValueError(f"Notebook not found: {name_or_id}")

        notebooks = self.list_notebooks()
        return _resolve_name(name_or_id, notebooks, key="name")

    def _notebook_dir(self, notebook_id: str) -> Path:
        return self._notebooks_dir() / notebook_id

    # --- Sections ---

    def list_sections(self, notebook_id: str) -> list[dict]:
        path = self._notebook_dir(notebook_id) / "sections.json"
        if not path.exists():
            return []
        try:
            sections = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            return []

        return [
            {
                "id": s["id"],
                "name": s.get("name", ""),
                "color": s.get("color"),
                "position": s.get("position", 0),
            }
            for s in sections
        ]

    def resolve_section(self, notebook_id: str, name_or_id: str) -> dict:
        if UUID_RE.match(name_or_id):
            for s in self.list_sections(notebook_id):
                if s["id"] == name_or_id:
                    return s
            raise ValueError(f"Section not found: {name_or_id}")

        sections = self.list_sections(notebook_id)
        return _resolve_name(name_or_id, sections, key="name")

    # --- Folders ---

    def list_folders(
        self,
        notebook_id: str,
        section_id: str | None = None,
        include_archived: bool = False,
    ) -> list[dict]:
        path = self._notebook_dir(notebook_id) / "folders.json"
        if not path.exists():
            return []
        try:
            folders = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            return []

        results = []
        for f in folders:
            if not include_archived and f.get("isArchived", False):
                continue
            if section_id and f.get("sectionId") != section_id:
                continue
            results.append(
                {
                    "id": f["id"],
                    "name": f.get("name", ""),
                    "parentId": f.get("parentId"),
                    "sectionId": f.get("sectionId"),
                    "isArchived": f.get("isArchived", False),
                    "position": f.get("position", 0),
                }
            )

        return results

    def resolve_folder(self, notebook_id: str, name_or_id: str) -> dict:
        if UUID_RE.match(name_or_id):
            for f in self.list_folders(notebook_id, include_archived=True):
                if f["id"] == name_or_id:
                    return f
            raise ValueError(f"Folder not found: {name_or_id}")

        folders = self.list_folders(notebook_id, include_archived=True)
        return _resolve_name(name_or_id, folders, key="name")

    def create_folder(
        self,
        notebook_id: str,
        name: str,
        parent_id: str | None = None,
        section_id: str | None = None,
    ) -> dict:
        """Create a new folder. Returns dict with id, name."""
        from uuid import uuid4

        path = self._notebook_dir(notebook_id) / "folders.json"
        try:
            folders = json.loads(path.read_text()) if path.exists() else []
        except (json.JSONDecodeError, OSError):
            folders = []

        max_pos = max(
            (f.get("position", 0) for f in folders if f.get("parentId") == parent_id),
            default=-1,
        )

        folder = {
            "id": str(uuid4()),
            "notebookId": notebook_id,
            "name": name,
            "parentId": parent_id,
            "sectionId": section_id,
            "isArchived": False,
            "position": max_pos + 1,
            "folderType": "Standard",
        }
        folders.append(folder)

        # Atomic write
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(folders, indent=2) + "\n")
        tmp.rename(path)

        return {"id": folder["id"], "name": folder["name"]}

    # --- Files / Databases ---

    def _files_dir(self, notebook_id: str) -> Path:
        return self._notebook_dir(notebook_id) / "files"

    def _database_path(self, notebook_id: str, page_id: str) -> Path:
        return self._files_dir(notebook_id) / f"{page_id}.database"

    def read_database_content(self, notebook_id: str, page_id: str) -> dict | None:
        """Read and parse the .database JSON file for a database page."""
        path = self._database_path(notebook_id, page_id)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            return None

    def write_database_content(self, notebook_id: str, page_id: str, content: dict) -> None:
        """Atomic write of .database file (write .tmp then rename)."""
        files_dir = self._files_dir(notebook_id)
        files_dir.mkdir(parents=True, exist_ok=True)
        db_path = self._database_path(notebook_id, page_id)
        tmp = db_path.with_suffix(".database.tmp")
        tmp.write_text(json.dumps(content, indent=2) + "\n")
        tmp.rename(db_path)

    def list_database_pages(
        self,
        notebook_id: str,
        folder_id: str | None = None,
        section_id: str | None = None,
    ) -> list[dict]:
        """List pages with pageType == 'database', enriched with property/row counts."""
        pages = self.list_pages(
            notebook_id, folder_id=folder_id, section_id=section_id, limit=10000
        )
        results = []
        for p in pages:
            if p.get("pageType") != "database":
                continue
            db = self.read_database_content(notebook_id, p["id"])
            prop_count = len(db.get("properties", [])) if db else 0
            row_count = len(db.get("rows", [])) if db else 0
            results.append(
                {
                    "id": p["id"],
                    "title": p["title"],
                    "tags": p.get("tags", []),
                    "folderId": p.get("folderId"),
                    "sectionId": p.get("sectionId"),
                    "propertyCount": prop_count,
                    "rowCount": row_count,
                }
            )
        return results

    # --- Pages ---

    def _pages_dir(self, notebook_id: str) -> Path:
        return self._notebook_dir(notebook_id) / "pages"

    def list_pages(
        self,
        notebook_id: str,
        folder_id: str | None = None,
        section_id: str | None = None,
        tag: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        pages_dir = self._pages_dir(notebook_id)
        if not pages_dir.exists():
            return []

        results = []
        for path in pages_dir.glob("*.json"):
            try:
                page = json.loads(path.read_text())
            except (json.JSONDecodeError, OSError):
                continue

            if page.get("isArchived", False):
                continue
            if folder_id and page.get("folderId") != folder_id:
                continue
            if section_id and page.get("sectionId") != section_id:
                continue
            if tag and tag.lower() not in [t.lower() for t in page.get("tags", [])]:
                continue

            results.append(
                {
                    "id": page["id"],
                    "title": page.get("title", ""),
                    "tags": page.get("tags", []),
                    "folderId": page.get("folderId"),
                    "sectionId": page.get("sectionId"),
                    "pageType": page.get("pageType", "standard"),
                    "isArchived": page.get("isArchived", False),
                    "updatedAt": page.get("updatedAt", ""),
                    "createdAt": page.get("createdAt", ""),
                }
            )

        # Sort by updatedAt descending
        results.sort(key=lambda p: p.get("updatedAt", ""), reverse=True)
        return results[:limit]

    def read_page(self, notebook_id: str, page_id: str) -> dict | None:
        path = self._pages_dir(notebook_id) / f"{page_id}.json"
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            return None

    def resolve_page(self, notebook_id: str, title_or_id: str) -> dict:
        """Resolve a page by title prefix or UUID."""
        if UUID_RE.match(title_or_id):
            page = self.read_page(notebook_id, title_or_id)
            if page:
                return page
            raise ValueError(f"Page not found: {title_or_id}")

        # Load all pages and match by title
        pages_dir = self._pages_dir(notebook_id)
        if not pages_dir.exists():
            raise ValueError(f"No pages in notebook {notebook_id}")

        all_pages = []
        for path in pages_dir.glob("*.json"):
            try:
                page = json.loads(path.read_text())
                all_pages.append(page)
            except (json.JSONDecodeError, OSError):
                continue

        return _resolve_name(title_or_id, all_pages, key="title")

    # --- Search ---

    def search_pages(
        self,
        query: str,
        notebook_id: str | None = None,
        limit: int = 20,
    ) -> list[dict]:
        """Brute-force case-insensitive substring search across page JSON files."""
        query_lower = query.lower()
        notebooks = self.list_notebooks()

        if notebook_id:
            notebooks = [nb for nb in notebooks if nb["id"] == notebook_id]

        title_matches: list[dict] = []
        content_matches: list[dict] = []

        for nb in notebooks:
            pages_dir = self._pages_dir(nb["id"])
            if not pages_dir.exists():
                continue

            for path in pages_dir.glob("*.json"):
                try:
                    raw = path.read_text()
                    page = json.loads(raw)
                except (json.JSONDecodeError, OSError):
                    continue

                if page.get("isArchived", False):
                    continue

                title = page.get("title", "")
                title_hit = query_lower in title.lower()

                # Search block text content
                snippet = ""
                blocks = page.get("content", {}).get("blocks", [])
                for block in blocks:
                    text = _extract_block_text(block)
                    if not text:
                        continue
                    pos = text.lower().find(query_lower)
                    if pos >= 0:
                        start = max(0, pos - 50)
                        end = min(len(text), pos + len(query) + 50)
                        prefix = "..." if start > 0 else ""
                        suffix = "..." if end < len(text) else ""
                        snippet = prefix + text[start:end] + suffix
                        break

                if title_hit or snippet:
                    entry = {
                        "pageId": page["id"],
                        "notebookId": nb["id"],
                        "notebookName": nb["name"],
                        "title": title,
                        "snippet": snippet,
                        "tags": page.get("tags", []),
                    }
                    if title_hit:
                        title_matches.append(entry)
                    else:
                        content_matches.append(entry)

        # Title matches first
        results = title_matches + content_matches
        return results[:limit]


# --- Helpers ---


def _extract_block_text(block: dict) -> str:
    """Extract plain text from a block for search."""
    data = block.get("data", {})
    block_type = block.get("type", "")

    if block_type in ("paragraph", "header", "quote"):
        return data.get("text", "")
    if block_type == "code":
        return data.get("code", "")
    if block_type == "list":
        items = data.get("items", [])
        parts = []
        for item in items:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(item.get("content", item.get("text", "")))
        return " ".join(parts)
    if block_type == "checklist":
        return " ".join(item.get("text", "") for item in data.get("items", []))
    if block_type == "callout":
        return f"{data.get('title', '')} {data.get('content', '')}"
    if block_type == "table":
        rows = data.get("content", [])
        return " ".join(
            cell for row in rows if isinstance(row, list) for cell in row if isinstance(cell, str)
        )

    return ""


def _resolve_name(name: str, items: list[dict], key: str) -> dict:
    """Resolve by exact case-insensitive match first, then prefix match.

    Raises ValueError on no match or ambiguity.
    """
    name_lower = name.lower()

    # Exact match (case-insensitive)
    exact = [item for item in items if item.get(key, "").lower() == name_lower]
    if len(exact) == 1:
        return exact[0]

    # Prefix match (case-insensitive)
    prefix = [item for item in items if item.get(key, "").lower().startswith(name_lower)]
    if len(prefix) == 1:
        return prefix[0]
    if len(prefix) > 1:
        names = [item.get(key, "") for item in prefix]
        raise ValueError(f"Ambiguous name '{name}', matches: {', '.join(names)}")

    available = [item.get(key, "") for item in items]
    raise ValueError(f"Not found: '{name}'. Available: {', '.join(available)}")
