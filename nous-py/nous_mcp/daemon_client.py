"""HTTP client for the Nous daemon API (port 7667).

Routes page content reads and writes through the daemon, which handles
BlockNote ↔ EditorJS format conversion via the Rust serde layer.

The MCP server can run on a different machine than the daemon — set
``NOUS_DAEMON_URL`` and ``NOUS_API_KEY`` to point at a remote daemon.
The defaults below are the local-machine fallback.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

DAEMON_BASE_URL = "http://localhost:7667"
DEFAULT_KEY_FILE = Path.home() / ".local" / "share" / "nous" / "daemon-api-key"


def _discover_api_key(key_file: Path = DEFAULT_KEY_FILE) -> str | None:
    """Read the first rw: key from the daemon key file."""
    if not key_file.exists():
        return None
    try:
        for line in key_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and line.startswith("rw:"):
                return line
    except OSError:
        pass
    return None


class DaemonError(Exception):
    """Raised when the daemon returns an error or is unreachable."""


class NousDaemonClient:
    """HTTP client for the Nous daemon API.

    Resolution order for connection details:

    1. Explicit ``base_url`` / ``api_key`` constructor args (tests use this).
    2. ``NOUS_DAEMON_URL`` / ``NOUS_API_KEY`` environment variables (the
       remote-MCP setup uses this).
    3. Defaults: ``http://localhost:7667`` and the rw key from
       ``~/.local/share/nous/daemon-api-key`` (the local-machine setup).
    """

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
    ) -> None:
        self.base_url = (
            base_url
            or os.environ.get("NOUS_DAEMON_URL")
            or DAEMON_BASE_URL
        ).rstrip("/")
        self.api_key = (
            api_key
            or os.environ.get("NOUS_API_KEY")
            or _discover_api_key()
        )
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        self.client = httpx.Client(timeout=30, headers=headers)

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def _unwrap(self, resp: httpx.Response) -> Any:
        """Unwrap the {"data": ...} envelope, raising on errors."""
        if resp.status_code >= 400:
            try:
                body = resp.json()
                msg = body.get("error", resp.text)
            except Exception:
                msg = resp.text
            raise DaemonError(f"Daemon API error ({resp.status_code}): {msg}")
        body = resp.json()
        return body.get("data", body)

    # --- Status ---

    def is_available(self) -> bool:
        """Check if daemon is reachable. Returns False if not running."""
        try:
            self.client.get(self._url("/api/status"))
            return True
        except (httpx.ConnectError, httpx.ConnectTimeout):
            return False

    def status(self) -> dict:
        """Check daemon status. Raises if daemon is not running."""
        try:
            resp = self.client.get(self._url("/api/status"))
            return self._unwrap(resp)
        except httpx.ConnectError:
            raise DaemonError(
                "Cannot connect to Nous daemon. Start it with: nous daemon start"
            )

    # --- Notebooks ---

    def list_notebooks(self) -> list[dict]:
        resp = self.client.get(self._url("/api/notebooks"))
        return self._unwrap(resp)

    # --- Pages ---

    def list_pages(self, notebook_id: str) -> list[dict]:
        resp = self.client.get(self._url(f"/api/notebooks/{notebook_id}/pages"))
        return self._unwrap(resp)

    def get_page(self, notebook_id: str, page_id: str) -> dict:
        resp = self.client.get(
            self._url(f"/api/notebooks/{notebook_id}/pages/{page_id}")
        )
        return self._unwrap(resp)

    def resolve_page(self, notebook_id: str, title_or_id: str) -> dict:
        """Resolve a page by title prefix or UUID. Returns full page with EditorJS content."""
        resp = self.client.get(
            self._url(f"/api/notebooks/{notebook_id}/pages/resolve"),
            params={"title": title_or_id},
        )
        return self._unwrap(resp)

    def create_page(
        self,
        notebook_id: str,
        title: str,
        *,
        blocks: list[dict] | None = None,
        content: str | None = None,
        tags: list[str] | None = None,
        folder_id: str | None = None,
        section_id: str | None = None,
        page_type: str | None = None,
        is_daily_note: bool = False,
        daily_note_date: str | None = None,
        extra_fields: dict | None = None,
    ) -> dict:
        body: dict[str, Any] = {"title": title}
        if blocks is not None:
            body["blocks"] = blocks
        elif content is not None:
            body["content"] = content
        if tags is not None:
            body["tags"] = tags
        if folder_id is not None:
            body["folder_id"] = folder_id
        if section_id is not None:
            body["section_id"] = section_id
        if page_type is not None:
            body["page_type"] = page_type
        if is_daily_note:
            body["is_daily_note"] = True
        if daily_note_date is not None:
            body["daily_note_date"] = daily_note_date
        if extra_fields is not None:
            body["extra_fields"] = extra_fields

        resp = self.client.post(
            self._url(f"/api/notebooks/{notebook_id}/pages"),
            json=body,
        )
        return self._unwrap(resp)

    def update_page(
        self,
        notebook_id: str,
        page_id: str,
        *,
        title: str | None = None,
        blocks: list[dict] | None = None,
        content: str | None = None,
        tags: list[str] | None = None,
        folder_id: str | None = None,
        section_id: str | None = None,
    ) -> dict:
        body: dict[str, Any] = {}
        if title is not None:
            body["title"] = title
        if blocks is not None:
            body["blocks"] = blocks
        elif content is not None:
            body["content"] = content
        if tags is not None:
            body["tags"] = tags
        if folder_id is not None:
            body["folder_id"] = folder_id
        if section_id is not None:
            body["section_id"] = section_id

        resp = self.client.put(
            self._url(f"/api/notebooks/{notebook_id}/pages/{page_id}"),
            json=body,
        )
        return self._unwrap(resp)

    def append_to_page(
        self,
        notebook_id: str,
        page_id: str,
        *,
        blocks: list[dict] | None = None,
        content: str | None = None,
    ) -> dict:
        body: dict[str, Any] = {}
        if blocks is not None:
            body["blocks"] = blocks
        elif content is not None:
            body["content"] = content

        resp = self.client.post(
            self._url(f"/api/notebooks/{notebook_id}/pages/{page_id}/append"),
            json=body,
        )
        return self._unwrap(resp)

    def delete_block(
        self,
        notebook_id: str,
        page_id: str,
        *,
        block_id: str,
    ) -> dict:
        body = {"block_id": block_id}
        resp = self.client.post(
            self._url(f"/api/notebooks/{notebook_id}/pages/{page_id}/delete-block"),
            json=body,
        )
        return self._unwrap(resp)

    def replace_block(
        self,
        notebook_id: str,
        page_id: str,
        *,
        block_id: str,
        blocks: list[dict] | None = None,
        content: str | None = None,
    ) -> dict:
        body: dict[str, Any] = {"block_id": block_id}
        if blocks is not None:
            body["blocks"] = blocks
        elif content is not None:
            body["content"] = content
        resp = self.client.post(
            self._url(f"/api/notebooks/{notebook_id}/pages/{page_id}/replace-block"),
            json=body,
        )
        return self._unwrap(resp)

    def insert_after_block(
        self,
        notebook_id: str,
        page_id: str,
        *,
        block_id: str,
        blocks: list[dict] | None = None,
        content: str | None = None,
    ) -> dict:
        body: dict[str, Any] = {"block_id": block_id}
        if blocks is not None:
            body["blocks"] = blocks
        elif content is not None:
            body["content"] = content
        resp = self.client.post(
            self._url(f"/api/notebooks/{notebook_id}/pages/{page_id}/insert-after-block"),
            json=body,
        )
        return self._unwrap(resp)

    # --- Search ---

    def search_pages(
        self,
        query: str,
        notebook_id: str | None = None,
        limit: int = 20,
    ) -> list[dict]:
        params: dict[str, Any] = {"q": query, "limit": limit}
        if notebook_id is not None:
            params["notebook_id"] = notebook_id
        resp = self.client.get(self._url("/api/search"), params=params)
        return self._unwrap(resp)

    # --- Daily Notes ---

    def get_daily_note(self, notebook_id: str, date: str) -> dict | None:
        """Get daily note for a date. Returns None if not found."""
        resp = self.client.get(
            self._url(f"/api/notebooks/{notebook_id}/daily-notes/{date}")
        )
        if resp.status_code == 404:
            return None
        return self._unwrap(resp)

    def create_daily_note(
        self,
        notebook_id: str,
        date: str,
        *,
        template_id: str | None = None,
    ) -> dict:
        body: dict[str, Any] = {}
        if template_id is not None:
            body["template_id"] = template_id
        resp = self.client.post(
            self._url(f"/api/notebooks/{notebook_id}/daily-notes/{date}"),
            json=body,
        )
        return self._unwrap(resp)

    # --- Databases ---

    def list_databases(self, notebook_id: str) -> list[dict]:
        resp = self.client.get(
            self._url(f"/api/notebooks/{notebook_id}/databases")
        )
        return self._unwrap(resp)

    def get_database(self, notebook_id: str, db_id: str) -> dict:
        resp = self.client.get(
            self._url(f"/api/notebooks/{notebook_id}/databases/{db_id}")
        )
        return self._unwrap(resp)

    def create_database(
        self,
        notebook_id: str,
        title: str,
        properties: list[dict],
        *,
        tags: list[str] | None = None,
        folder_id: str | None = None,
        section_id: str | None = None,
    ) -> dict:
        body: dict[str, Any] = {
            "title": title,
            "properties": properties,
        }
        if tags is not None:
            body["tags"] = tags
        if folder_id is not None:
            body["folder_id"] = folder_id
        if section_id is not None:
            body["section_id"] = section_id
        resp = self.client.post(
            self._url(f"/api/notebooks/{notebook_id}/databases"),
            json=body,
        )
        return self._unwrap(resp)

    def add_database_rows(
        self,
        notebook_id: str,
        db_id: str,
        rows: list[dict],
    ) -> dict:
        resp = self.client.post(
            self._url(f"/api/notebooks/{notebook_id}/databases/{db_id}/rows"),
            json={"rows": rows},
        )
        return self._unwrap(resp)

    def update_database_rows(
        self,
        notebook_id: str,
        db_id: str,
        updates: list[dict],
    ) -> dict:
        resp = self.client.put(
            self._url(f"/api/notebooks/{notebook_id}/databases/{db_id}/rows"),
            json={"updates": updates},
        )
        return self._unwrap(resp)

    def delete_database_rows(
        self,
        notebook_id: str,
        db_id: str,
        row_ids: list[str],
    ) -> dict:
        resp = self.client.request(
            "DELETE",
            self._url(f"/api/notebooks/{notebook_id}/databases/{db_id}/rows"),
            json={"row_ids": row_ids},
        )
        return self._unwrap(resp)

    def put_database(
        self,
        notebook_id: str,
        db_id: str,
        content: dict,
    ) -> dict:
        """Replace the whole .database content for a database page atomically.
        Used by tools that do read-modify-write on properties/views (not just
        rows). The daemon writes the file with atomic rename + bumps the
        page's updatedAt."""
        resp = self.client.put(
            self._url(f"/api/notebooks/{notebook_id}/databases/{db_id}"),
            json=content,
        )
        return self._unwrap(resp)

    # --- Sections ---

    def list_sections(self, notebook_id: str) -> list[dict]:
        resp = self.client.get(
            self._url(f"/api/notebooks/{notebook_id}/sections")
        )
        return self._unwrap(resp)

    # --- Folders ---

    def list_folders(self, notebook_id: str) -> list[dict]:
        resp = self.client.get(
            self._url(f"/api/notebooks/{notebook_id}/folders")
        )
        return self._unwrap(resp)

    def create_folder(
        self,
        notebook_id: str,
        name: str,
        *,
        parent_id: str | None = None,
        section_id: str | None = None,
    ) -> dict:
        body: dict[str, Any] = {"name": name}
        if parent_id is not None:
            body["parent_id"] = parent_id
        if section_id is not None:
            body["section_id"] = section_id
        resp = self.client.post(
            self._url(f"/api/notebooks/{notebook_id}/folders"),
            json=body,
        )
        return self._unwrap(resp)

    # --- Daily Notes (list) ---

    def list_daily_notes(
        self,
        notebook_id: str,
        *,
        limit: int | None = None,
    ) -> list[dict]:
        params: dict[str, Any] = {}
        if limit is not None:
            params["limit"] = limit
        resp = self.client.get(
            self._url(f"/api/notebooks/{notebook_id}/daily-notes"),
            params=params,
        )
        return self._unwrap(resp)

    # --- Inbox ---

    def list_inbox(self, *, include_processed: bool = False) -> list[dict]:
        params: dict[str, Any] = {}
        if include_processed:
            params["include_processed"] = "true"
        resp = self.client.get(self._url("/api/inbox"), params=params)
        return self._unwrap(resp)

    def capture_inbox(
        self,
        title: str,
        *,
        content: str | None = None,
        tags: list[str] | None = None,
    ) -> dict:
        body: dict[str, Any] = {"title": title}
        if content is not None:
            body["content"] = content
        if tags is not None:
            body["tags"] = tags
        resp = self.client.post(self._url("/api/inbox"), json=body)
        return self._unwrap(resp)

    def delete_inbox_item(self, item_id: str) -> dict:
        resp = self.client.delete(self._url(f"/api/inbox/{item_id}"))
        return self._unwrap(resp)

    # --- Goals ---

    def list_goals(self, *, include_archived: bool = False) -> list[dict]:
        params: dict[str, Any] = {}
        if include_archived:
            params["include_archived"] = "true"
        resp = self.client.get(self._url("/api/goals"), params=params)
        return self._unwrap(resp)

    def get_goal(self, goal_id: str) -> dict:
        resp = self.client.get(self._url(f"/api/goals/{goal_id}"))
        return self._unwrap(resp)

    def get_goal_progress(
        self,
        goal_id: str,
        *,
        start: str | None = None,
        end: str | None = None,
        days: int | None = None,
    ) -> list[dict]:
        params: dict[str, Any] = {}
        if start is not None:
            params["start"] = start
        if end is not None:
            params["end"] = end
        if days is not None:
            params["days"] = days
        resp = self.client.get(
            self._url(f"/api/goals/{goal_id}/progress"),
            params=params,
        )
        return self._unwrap(resp)

    def record_goal_progress(
        self,
        goal_id: str,
        date: str,
        *,
        completed: bool | None = None,
        value: int | None = None,
    ) -> dict:
        body: dict[str, Any] = {"date": date}
        if completed is not None:
            body["completed"] = completed
        if value is not None:
            body["value"] = value
        resp = self.client.post(
            self._url(f"/api/goals/{goal_id}/progress"),
            json=body,
        )
        return self._unwrap(resp)

    def get_goals_summary(self) -> dict:
        resp = self.client.get(self._url("/api/goals/summary"))
        return self._unwrap(resp)

    # --- Energy ---

    def get_energy_checkins(
        self,
        *,
        start: str | None = None,
        end: str | None = None,
        days: int | None = None,
    ) -> list[dict]:
        params: dict[str, Any] = {}
        if start is not None:
            params["start"] = start
        if end is not None:
            params["end"] = end
        if days is not None:
            params["days"] = days
        resp = self.client.get(self._url("/api/energy/checkins"), params=params)
        return self._unwrap(resp)

    def get_energy_patterns(
        self,
        *,
        start: str | None = None,
        end: str | None = None,
        days: int | None = None,
    ) -> dict:
        params: dict[str, Any] = {}
        if start is not None:
            params["start"] = start
        if end is not None:
            params["end"] = end
        if days is not None:
            params["days"] = days
        resp = self.client.get(self._url("/api/energy/patterns"), params=params)
        return self._unwrap(resp)
