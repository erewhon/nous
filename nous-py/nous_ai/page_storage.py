"""Nous page storage for external agents.

Write and update Nous pages from Python with proper oplog integration.
This module mirrors the Rust storage layer's oplog format so that external
agents produce the same history records as the app itself.

Usage:
    from nous_ai.page_storage import NousPageStorage

    storage = NousPageStorage()  # auto-discovers data dir

    # Create a new page
    page = storage.create_page(
        notebook_id="b67b98ae-...",
        title="Weekly Dashboard",
        blocks=[
            {"id": str(uuid4()), "type": "header", "data": {"text": "Hello", "level": 2}},
            {"id": str(uuid4()), "type": "paragraph", "data": {"text": "World"}},
        ],
        tags=["weekly-dashboard"],
        folder_id="some-folder-id",
    )

    # Update an existing page
    storage.update_page(
        notebook_id="b67b98ae-...",
        page_id=page["id"],
        content={"time": ..., "version": "2.28.0", "blocks": [...]},
    )

    # Read a page
    page = storage.read_page("b67b98ae-...", "page-id-...")

    # Read oplog
    entries = storage.read_oplog("b67b98ae-...", "page-id-...")

Oplog format (JSONL, one entry per line):
    {
        "ts": "2026-02-15T20:30:00.000000Z",
        "clientId": "my-agent",
        "op": "create" | "modify" | "delete" | "restore",
        "contentHash": "sha256:abc123...",
        "prevHash": "genesis" | "sha256:...",
        "blockChanges": [
            {"blockId": "...", "op": "insert"|"modify"|"delete"|"move",
             "blockType": "paragraph", "afterBlockId": "..."}
        ],
        "blockCount": 5
    }
"""

from __future__ import annotations

import hashlib
import json
import platform
import socket
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4


def _default_data_dir() -> Path:
    """Discover the Nous data directory."""
    # Linux: ~/.local/share/nous
    # macOS: ~/Library/Application Support/nous
    import sys
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "nous"
    return Path.home() / ".local" / "share" / "nous"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _content_hash(content: dict) -> str:
    """SHA-256 hash of the content dict (matches Rust oplog::content_hash)."""
    # Must match serde_json::to_string (compact, no trailing newline)
    raw = json.dumps(content, separators=(",", ":"), ensure_ascii=False)
    h = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"sha256:{h}"


def _diff_blocks(old_blocks: list[dict], new_blocks: list[dict]) -> list[dict]:
    """Diff two block lists to produce block-level changes."""
    old_map: dict[str, tuple[int, dict]] = {}
    for i, b in enumerate(old_blocks):
        old_map[b["id"]] = (i, b)

    new_map: dict[str, tuple[int, dict]] = {}
    for i, b in enumerate(new_blocks):
        new_map[b["id"]] = (i, b)

    changes = []

    for i, block in enumerate(new_blocks):
        after_id = new_blocks[i - 1]["id"] if i > 0 else None
        bid = block["id"]

        if bid not in old_map:
            changes.append({
                "blockId": bid,
                "op": "insert",
                "blockType": block.get("type"),
                "afterBlockId": after_id,
            })
        else:
            old_idx, old_block = old_map[bid]
            if old_block.get("data") != block.get("data") or old_block.get("type") != block.get("type"):
                changes.append({
                    "blockId": bid,
                    "op": "modify",
                    "blockType": block.get("type"),
                })
            elif old_idx != i:
                changes.append({
                    "blockId": bid,
                    "op": "move",
                    "blockType": block.get("type"),
                    "afterBlockId": after_id,
                })

    for block in old_blocks:
        if block["id"] not in new_map:
            changes.append({
                "blockId": block["id"],
                "op": "delete",
                "blockType": block.get("type"),
            })

    return changes


class NousPageStorage:
    """Read/write Nous pages with oplog integration."""

    def __init__(
        self,
        data_dir: str | Path | None = None,
        client_id: str | None = None,
    ):
        self.data_dir = Path(data_dir) if data_dir else _default_data_dir()
        self.client_id = client_id or socket.gethostname()

    def _notebook_dir(self, notebook_id: str) -> Path:
        return self.data_dir / "notebooks" / notebook_id

    def _pages_dir(self, notebook_id: str) -> Path:
        return self._notebook_dir(notebook_id) / "pages"

    def _page_path(self, notebook_id: str, page_id: str) -> Path:
        return self._pages_dir(notebook_id) / f"{page_id}.json"

    def _oplog_path(self, notebook_id: str, page_id: str) -> Path:
        return self._pages_dir(notebook_id) / f"{page_id}.oplog"

    # ---- Oplog ----

    def _read_last_hash(self, notebook_id: str, page_id: str) -> str:
        """Read the last content hash from the oplog, or 'genesis'."""
        path = self._oplog_path(notebook_id, page_id)
        if not path.exists():
            return "genesis"
        last_hash = "genesis"
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                last_hash = entry.get("contentHash", last_hash)
            except json.JSONDecodeError:
                continue
        return last_hash

    def _append_oplog(
        self,
        notebook_id: str,
        page_id: str,
        op: str,
        content: dict,
        block_changes: list[dict] | None = None,
    ) -> None:
        """Append an oplog entry."""
        path = self._oplog_path(notebook_id, page_id)
        prev_hash = self._read_last_hash(notebook_id, page_id)
        entry = {
            "ts": _now_iso(),
            "clientId": self.client_id,
            "op": op,
            "contentHash": _content_hash(content),
            "prevHash": prev_hash,
            "blockChanges": [
                {k: v for k, v in c.items() if v is not None}
                for c in (block_changes or [])
            ],
            "blockCount": len(content.get("blocks", [])),
        }
        with open(path, "a") as f:
            f.write(json.dumps(entry, separators=(",", ":")) + "\n")

    def read_oplog(self, notebook_id: str, page_id: str) -> list[dict]:
        """Read all oplog entries for a page."""
        path = self._oplog_path(notebook_id, page_id)
        if not path.exists():
            return []
        entries = []
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return entries

    # ---- Page CRUD ----

    def read_page(self, notebook_id: str, page_id: str) -> dict | None:
        """Read a page's JSON. Returns None if not found."""
        path = self._page_path(notebook_id, page_id)
        if not path.exists():
            return None
        return json.loads(path.read_text())

    def create_page(
        self,
        notebook_id: str,
        title: str,
        blocks: list[dict] | None = None,
        tags: list[str] | None = None,
        folder_id: str | None = None,
        section_id: str | None = None,
        page_id: str | None = None,
        extra_fields: dict[str, Any] | None = None,
    ) -> dict:
        """Create a new page with oplog entry. Returns the page dict."""
        pid = page_id or str(uuid4())
        now = _now_iso()

        content = {
            "time": int(datetime.now(UTC).timestamp() * 1000),
            "version": "2.28.0",
            "blocks": blocks or [],
        }

        page: dict[str, Any] = {
            "id": pid,
            "notebookId": notebook_id,
            "title": title,
            "content": content,
            "tags": tags or [],
            "isArchived": False,
            "isCover": False,
            "position": 0,
            "systemPromptMode": "override",
            "pageType": "standard",
            "isFavorite": False,
            "isDailyNote": False,
            "createdAt": now,
            "updatedAt": now,
        }
        if folder_id:
            page["folderId"] = folder_id
        if section_id:
            page["sectionId"] = section_id
        if extra_fields:
            page.update(extra_fields)

        # Write page JSON (atomic: write tmp then rename)
        pages_dir = self._pages_dir(notebook_id)
        pages_dir.mkdir(parents=True, exist_ok=True)
        page_path = self._page_path(notebook_id, pid)
        tmp_path = page_path.with_suffix(".json.tmp")
        tmp_path.write_text(json.dumps(page, indent=2) + "\n")
        tmp_path.rename(page_path)

        # Oplog: record create with all blocks as inserts
        block_changes = []
        for i, block in enumerate(content["blocks"]):
            block_changes.append({
                "blockId": block["id"],
                "op": "insert",
                "blockType": block.get("type"),
                "afterBlockId": content["blocks"][i - 1]["id"] if i > 0 else None,
            })
        self._append_oplog(notebook_id, pid, "create", content, block_changes)

        return page

    def update_page(
        self,
        notebook_id: str,
        page_id: str,
        content: dict | None = None,
        title: str | None = None,
        tags: list[str] | None = None,
        extra_fields: dict[str, Any] | None = None,
    ) -> dict:
        """Update an existing page with oplog entry. Returns the updated page dict."""
        page = self.read_page(notebook_id, page_id)
        if page is None:
            raise FileNotFoundError(f"Page {page_id} not found in notebook {notebook_id}")

        old_content = page["content"]

        if title is not None:
            page["title"] = title
        if content is not None:
            page["content"] = content
        if tags is not None:
            page["tags"] = tags
        if extra_fields:
            page.update(extra_fields)
        page["updatedAt"] = _now_iso()

        # Write page JSON (atomic)
        page_path = self._page_path(notebook_id, page_id)
        tmp_path = page_path.with_suffix(".json.tmp")
        tmp_path.write_text(json.dumps(page, indent=2) + "\n")
        tmp_path.rename(page_path)

        # Oplog: diff blocks if content changed
        new_content = page["content"]
        block_changes = _diff_blocks(
            old_content.get("blocks", []),
            new_content.get("blocks", []),
        ) if content is not None else []

        self._append_oplog(notebook_id, page_id, "modify", new_content, block_changes)

        return page

    def list_pages(self, notebook_id: str) -> list[dict]:
        """List all pages in a notebook (metadata only, no content blocks)."""
        pages_dir = self._pages_dir(notebook_id)
        if not pages_dir.exists():
            return []
        pages = []
        for path in sorted(pages_dir.glob("*.json")):
            try:
                page = json.loads(path.read_text())
                pages.append({
                    "id": page["id"],
                    "title": page.get("title", ""),
                    "tags": page.get("tags", []),
                    "folderId": page.get("folderId"),
                    "sectionId": page.get("sectionId"),
                    "pageType": page.get("pageType", "standard"),
                    "isArchived": page.get("isArchived", False),
                    "isDailyNote": page.get("isDailyNote", False),
                    "updatedAt": page.get("updatedAt", ""),
                    "createdAt": page.get("createdAt", ""),
                })
            except (json.JSONDecodeError, KeyError):
                continue
        return pages
