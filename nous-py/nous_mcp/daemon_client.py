"""HTTP client for the Nous daemon API (port 7667).

Routes page content reads and writes through the daemon, which handles
BlockNote ↔ EditorJS format conversion via the Rust serde layer.
"""

from __future__ import annotations

import logging
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
    """HTTP client for the Nous daemon API."""

    def __init__(
        self,
        base_url: str = DAEMON_BASE_URL,
        api_key: str | None = None,
    ) -> None:
        self.base_url = base_url
        self.api_key = api_key or _discover_api_key()
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
