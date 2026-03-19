"""Nous SDK client — synchronous and async access to the Nous daemon API."""

from __future__ import annotations

import os
from typing import Any

import httpx

from nous_sdk.models import (
    Notebook,
    Page,
    Folder,
    Section,
    InboxItem,
    Goal,
    Database,
    SearchResult,
)

DEFAULT_BASE_URL = "http://127.0.0.1:7667"


class NousError(Exception):
    """Error from the Nous API."""

    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(f"Nous API error ({status_code}): {message}")


class Nous:
    """Synchronous client for the Nous daemon API.

    Usage:
        app = Nous()
        notebooks = app.list_notebooks()
        pages = app.list_pages("My Notebook")
        page = app.get_page("My Notebook", "page-title-or-id")
    """

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        timeout: float = 30.0,
    ):
        self.base_url = (
            base_url
            or os.environ.get("NOUS_API_URL")
            or DEFAULT_BASE_URL
        ).rstrip("/")
        self.api_key = api_key or os.environ.get("NOUS_API_KEY")
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=timeout,
            headers=self._headers(),
        )

    def _headers(self) -> dict[str, str]:
        h: dict[str, str] = {}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def _request(
        self,
        method: str,
        path: str,
        json: Any = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        resp = self._client.request(method, path, json=json, params=params)
        if resp.status_code >= 400:
            try:
                body = resp.json()
                msg = body.get("error", resp.text)
            except Exception:
                msg = resp.text
            raise NousError(resp.status_code, msg)
        data = resp.json()
        # Unwrap {"data": ...} envelope if present
        if isinstance(data, dict) and "data" in data and len(data) == 1:
            return data["data"]
        return data

    def _get(self, path: str, **params: Any) -> Any:
        return self._request("GET", path, params={k: v for k, v in params.items() if v is not None})

    def _post(self, path: str, json: Any = None) -> Any:
        return self._request("POST", path, json=json)

    def _put(self, path: str, json: Any = None) -> Any:
        return self._request("PUT", path, json=json)

    def _delete(self, path: str) -> Any:
        return self._request("DELETE", path)

    # ─── Resolve notebook by name or ID ─────────────────────────────────

    def _resolve_notebook_id(self, notebook: str) -> str:
        """Accept a notebook name (fuzzy) or UUID."""
        # If it looks like a UUID, use it directly
        if len(notebook) == 36 and notebook.count("-") == 4:
            return notebook
        # Otherwise search by name
        notebooks = self.list_notebooks()
        # Exact match first
        for nb in notebooks:
            if nb.name.lower() == notebook.lower():
                return nb.id
        # Prefix match
        for nb in notebooks:
            if nb.name.lower().startswith(notebook.lower()):
                return nb.id
        raise NousError(404, f"Notebook not found: {notebook}")

    # ─── Status ─────────────────────────────────────────────────────────

    def status(self) -> dict[str, Any]:
        """Get daemon status."""
        return self._get("/api/status")

    def is_running(self) -> bool:
        """Check if the daemon is running."""
        try:
            self.status()
            return True
        except (httpx.ConnectError, httpx.TimeoutException):
            return False

    # ─── Notebooks ──────────────────────────────────────────────────────

    def list_notebooks(self, include_archived: bool = False) -> list[Notebook]:
        """List all notebooks."""
        data = self._get("/api/notebooks")
        notebooks = [Notebook.from_dict(d) for d in data]
        if not include_archived:
            notebooks = [nb for nb in notebooks if not nb.archived]
        return notebooks

    def get_notebook(self, notebook: str) -> Notebook:
        """Get a notebook by name or ID."""
        nb_id = self._resolve_notebook_id(notebook)
        notebooks = self.list_notebooks(include_archived=True)
        for nb in notebooks:
            if nb.id == nb_id:
                return nb
        raise NousError(404, f"Notebook not found: {notebook}")

    # ─── Pages ──────────────────────────────────────────────────────────

    def list_pages(self, notebook: str) -> list[Page]:
        """List all pages in a notebook."""
        nb_id = self._resolve_notebook_id(notebook)
        data = self._get(f"/api/notebooks/{nb_id}/pages")
        return [Page.from_dict(d) for d in data]

    def get_page(self, notebook: str, page: str) -> Page:
        """Get a page by title or ID.

        Args:
            notebook: Notebook name or ID.
            page: Page title (prefix match) or UUID.
        """
        nb_id = self._resolve_notebook_id(notebook)
        # Try as UUID first
        if len(page) == 36 and page.count("-") == 4:
            data = self._get(f"/api/notebooks/{nb_id}/pages/{page}")
            return Page.from_dict(data)
        # Resolve by title
        data = self._get(f"/api/notebooks/{nb_id}/pages/resolve", title=page)
        return Page.from_dict(data)

    def create_page(
        self,
        notebook: str,
        title: str,
        content: str | None = None,
        tags: list[str] | None = None,
        folder_id: str | None = None,
        section_id: str | None = None,
    ) -> Page:
        """Create a new page.

        Args:
            notebook: Notebook name or ID.
            title: Page title.
            content: Plain text content (paragraphs split on double newlines).
            tags: Optional list of tags.
            folder_id: Optional folder UUID.
            section_id: Optional section UUID.
        """
        nb_id = self._resolve_notebook_id(notebook)
        body: dict[str, Any] = {"title": title}
        if content is not None:
            body["content"] = content
        if tags is not None:
            body["tags"] = tags
        if folder_id is not None:
            body["folder_id"] = folder_id
        if section_id is not None:
            body["section_id"] = section_id
        data = self._post(f"/api/notebooks/{nb_id}/pages", json=body)
        return Page.from_dict(data)

    def update_page(
        self,
        notebook: str,
        page_id: str,
        title: str | None = None,
        content: str | None = None,
        tags: list[str] | None = None,
    ) -> Page:
        """Update an existing page.

        Args:
            notebook: Notebook name or ID.
            page_id: Page UUID.
            title: New title (optional).
            content: New plain text content (optional).
            tags: New tags (optional).
        """
        nb_id = self._resolve_notebook_id(notebook)
        body: dict[str, Any] = {}
        if title is not None:
            body["title"] = title
        if content is not None:
            body["content"] = content
        if tags is not None:
            body["tags"] = tags
        data = self._put(f"/api/notebooks/{nb_id}/pages/{page_id}", json=body)
        return Page.from_dict(data)

    def delete_page(self, notebook: str, page_id: str) -> None:
        """Delete a page (move to trash)."""
        nb_id = self._resolve_notebook_id(notebook)
        self._delete(f"/api/notebooks/{nb_id}/pages/{page_id}")

    def append_to_page(
        self,
        notebook: str,
        page_id: str,
        content: str,
    ) -> dict[str, Any]:
        """Append content to an existing page.

        Args:
            notebook: Notebook name or ID.
            page_id: Page UUID.
            content: Plain text to append.
        """
        nb_id = self._resolve_notebook_id(notebook)
        return self._post(
            f"/api/notebooks/{nb_id}/pages/{page_id}/append",
            json={"content": content},
        )

    def set_tags(self, notebook: str, page_id: str, tags: list[str]) -> None:
        """Set tags on a page (replaces existing tags)."""
        nb_id = self._resolve_notebook_id(notebook)
        self._put(f"/api/notebooks/{nb_id}/pages/{page_id}/tags", json={"tags": tags})

    def move_page(
        self,
        notebook: str,
        page_id: str,
        folder_id: str | None = None,
        section_id: str | None = None,
    ) -> None:
        """Move a page to a different folder or section."""
        nb_id = self._resolve_notebook_id(notebook)
        body: dict[str, Any] = {}
        if folder_id is not None:
            body["folder_id"] = folder_id
        if section_id is not None:
            body["section_id"] = section_id
        self._post(f"/api/notebooks/{nb_id}/pages/{page_id}/move", json=body)

    # ─── Folders ────────────────────────────────────────────────────────

    def list_folders(self, notebook: str) -> list[Folder]:
        """List all folders in a notebook."""
        nb_id = self._resolve_notebook_id(notebook)
        data = self._get(f"/api/notebooks/{nb_id}/folders")
        return [Folder.from_dict(d) for d in data]

    def create_folder(
        self,
        notebook: str,
        name: str,
        parent_id: str | None = None,
        section_id: str | None = None,
    ) -> Folder:
        """Create a folder in a notebook."""
        nb_id = self._resolve_notebook_id(notebook)
        body: dict[str, Any] = {"name": name}
        if parent_id:
            body["parent_id"] = parent_id
        if section_id:
            body["section_id"] = section_id
        data = self._post(f"/api/notebooks/{nb_id}/folders", json=body)
        return Folder.from_dict(data)

    # ─── Sections ───────────────────────────────────────────────────────

    def list_sections(self, notebook: str) -> list[Section]:
        """List all sections in a notebook."""
        nb_id = self._resolve_notebook_id(notebook)
        data = self._get(f"/api/notebooks/{nb_id}/sections")
        return [Section.from_dict(d) for d in data]

    # ─── Databases ───────────────────────────────────────────────────────

    def list_databases(self, notebook: str) -> list[Database]:
        """List all databases in a notebook."""
        nb_id = self._resolve_notebook_id(notebook)
        data = self._get(f"/api/notebooks/{nb_id}/databases")
        return [Database.from_dict(d) for d in data]

    def get_database(self, notebook: str, database_id: str) -> dict[str, Any]:
        """Get full database content (properties, rows, views).

        Returns a dict with 'id', 'title', 'tags', and 'database' (the full DB data).
        """
        nb_id = self._resolve_notebook_id(notebook)
        return self._get(f"/api/notebooks/{nb_id}/databases/{database_id}")

    # ─── Search ─────────────────────────────────────────────────────────

    def search(
        self,
        query: str,
        notebook: str | None = None,
        limit: int = 20,
    ) -> list[SearchResult]:
        """Search across pages.

        Args:
            query: Search query.
            notebook: Optional notebook name or ID to scope the search.
            limit: Maximum results (default 20).
        """
        params: dict[str, Any] = {"q": query, "limit": limit}
        if notebook:
            params["notebook_id"] = self._resolve_notebook_id(notebook)
        data = self._get("/api/search", **params)
        return [SearchResult.from_dict(d) for d in data]

    # ─── Daily Notes ────────────────────────────────────────────────────

    def get_daily_note(self, notebook: str, date: str) -> Page | None:
        """Get the daily note for a date (YYYY-MM-DD). Returns None if not found."""
        nb_id = self._resolve_notebook_id(notebook)
        try:
            data = self._get(f"/api/notebooks/{nb_id}/daily-notes/{date}")
            return Page.from_dict(data)
        except NousError as e:
            if e.status_code == 404:
                return None
            raise

    def create_daily_note(self, notebook: str, date: str) -> Page:
        """Create (or get existing) daily note for a date."""
        nb_id = self._resolve_notebook_id(notebook)
        data = self._post(f"/api/notebooks/{nb_id}/daily-notes/{date}")
        return Page.from_dict(data)

    # ─── Inbox ──────────────────────────────────────────────────────────

    def list_inbox(self) -> list[InboxItem]:
        """List all inbox items."""
        data = self._get("/api/inbox")
        return [InboxItem.from_dict(d) for d in data]

    def capture_inbox(
        self,
        title: str,
        content: str | None = None,
        tags: list[str] | None = None,
    ) -> InboxItem:
        """Capture an item to the inbox."""
        body: dict[str, Any] = {"title": title}
        if content:
            body["content"] = content
        if tags:
            body["tags"] = tags
        data = self._post("/api/inbox", json=body)
        return InboxItem.from_dict(data)

    def delete_inbox_item(self, item_id: str) -> None:
        """Delete an inbox item."""
        self._delete(f"/api/inbox/{item_id}")

    # ─── Goals ──────────────────────────────────────────────────────────

    def list_goals(self) -> list[Goal]:
        """List all goals."""
        data = self._get("/api/goals")
        return [Goal.from_dict(d) for d in data]

    def get_goal(self, goal_id: str) -> Goal:
        """Get a goal by ID."""
        data = self._get(f"/api/goals/{goal_id}")
        return Goal.from_dict(data)

    def record_progress(
        self,
        goal_id: str,
        date: str,
        completed: bool | None = None,
        value: int | None = None,
    ) -> dict[str, Any]:
        """Record progress on a goal."""
        body: dict[str, Any] = {"date": date}
        if completed is not None:
            body["completed"] = completed
        if value is not None:
            body["value"] = value
        return self._post(f"/api/goals/{goal_id}/progress", json=body)

    # ─── Sync ───────────────────────────────────────────────────────────

    def trigger_sync(self, notebook: str) -> dict[str, Any]:
        """Trigger a sync for a notebook."""
        nb_id = self._resolve_notebook_id(notebook)
        return self._post("/api/sync/trigger", json={"notebook_id": nb_id})

    # ─── Events (async) ────────────────────────────────────────────────

    async def events(
        self,
        event_types: list[str] | None = None,
    ):
        """Async generator that yields real-time events from the daemon.

        Args:
            event_types: Optional filter — only yield events matching these types
                        (e.g. ["page.created", "page.updated"]).

        Usage:
            async for event in app.events():
                print(event["event"], event["data"])

            async for event in app.events(["page.created"]):
                print(f"New page: {event['data']['title']}")
        """
        import json
        import websockets

        ws_url = self.base_url.replace("http://", "ws://").replace("https://", "wss://")
        ws_url = f"{ws_url}/api/events"

        async for ws in websockets.connect(ws_url):
            try:
                async for message in ws:
                    try:
                        event = json.loads(message)
                        if event_types and event.get("event") not in event_types:
                            continue
                        yield event
                    except json.JSONDecodeError:
                        continue
            except websockets.ConnectionClosed:
                continue  # Auto-reconnect

    # ─── Cleanup ────────────────────────────────────────────────────────

    def close(self) -> None:
        """Close the HTTP client."""
        self._client.close()

    def __enter__(self) -> Nous:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()
