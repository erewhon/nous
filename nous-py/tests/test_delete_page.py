"""Tests for the delete_page tool and its strict page resolution.

Deletion must never pick among multiple matches: an ambiguous title or
prefix raises instead of soft-deleting the wrong page (compare the
update_task_status prefix-match bug, Agent Feedback 376ac995).
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from nous_mcp.server import _resolve_page_for_delete, delete_page

PAGE_A = {"id": "11111111-1111-4111-8111-111111111111", "title": "Meeting Notes", "deletedAt": None}
PAGE_B = {
    "id": "22222222-2222-4222-8222-222222222222",
    "title": "Meeting Notes 2026",
    "deletedAt": None,
}
PAGE_C = {"id": "33333333-3333-4333-8333-333333333333", "title": "Shopping List", "deletedAt": None}
TRASHED = {
    "id": "44444444-4444-4444-8444-444444444444",
    "title": "Old Draft",
    "deletedAt": "2026-07-01T00:00:00Z",
}
DUP_1 = {"id": "55555555-5555-4555-8555-555555555555", "title": "Scratch", "deletedAt": None}
DUP_2 = {"id": "66666666-6666-4666-8666-666666666666", "title": "Scratch", "deletedAt": None}

PAGES = [PAGE_A, PAGE_B, PAGE_C, TRASHED, DUP_1, DUP_2]


class TestResolvePageForDelete:
    def test_resolves_by_uuid(self):
        assert _resolve_page_for_delete(PAGES, PAGE_C["id"]) is PAGE_C

    def test_uuid_is_case_insensitive(self):
        assert _resolve_page_for_delete(PAGES, PAGE_C["id"].upper()) is PAGE_C

    def test_uuid_of_trashed_page_raises(self):
        with pytest.raises(ValueError, match="already be in trash"):
            _resolve_page_for_delete(PAGES, TRASHED["id"])

    def test_resolves_by_exact_title(self):
        assert _resolve_page_for_delete(PAGES, "Shopping List") is PAGE_C

    def test_exact_title_wins_over_prefix_ambiguity(self):
        # "Meeting Notes" is an exact title AND a prefix of "Meeting Notes 2026"
        # — the exact match must win, not raise as ambiguous.
        assert _resolve_page_for_delete(PAGES, "Meeting Notes") is PAGE_A

    def test_resolves_by_unique_prefix(self):
        assert _resolve_page_for_delete(PAGES, "Shopp") is PAGE_C

    def test_title_matching_is_case_insensitive(self):
        assert _resolve_page_for_delete(PAGES, "shopping list") is PAGE_C

    def test_ambiguous_prefix_raises_with_candidates(self):
        with pytest.raises(ValueError, match="Ambiguous page reference"):
            _resolve_page_for_delete(PAGES, "Meeting")

    def test_duplicate_exact_titles_raise(self):
        with pytest.raises(ValueError, match="Ambiguous page title"):
            _resolve_page_for_delete(PAGES, "Scratch")

    def test_unknown_page_raises(self):
        with pytest.raises(ValueError, match="No page matching"):
            _resolve_page_for_delete(PAGES, "Nonexistent")

    def test_trashed_pages_are_not_matched_by_title(self):
        with pytest.raises(ValueError, match="No page matching"):
            _resolve_page_for_delete(PAGES, "Old Draft")


class TestDeletePageTool:
    def _run(self, page_query: str):
        storage = MagicMock()
        storage.resolve_notebook.return_value = {"id": "nb-001", "name": "Test"}
        daemon = MagicMock()
        daemon.list_pages.return_value = PAGES
        daemon.delete_page.return_value = {"ok": True}
        with (
            patch("nous_mcp.server._storage", storage),
            patch("nous_mcp.server._daemon", daemon),
        ):
            result = delete_page("Test", page_query)
        return daemon, json.loads(result)

    def test_deletes_by_uuid(self):
        daemon, out = self._run(PAGE_C["id"])
        daemon.delete_page.assert_called_once_with("nb-001", PAGE_C["id"])
        assert out["deleted"] is True
        assert out["id"] == PAGE_C["id"]
        assert out["title"] == "Shopping List"

    def test_deletes_by_unique_title_prefix(self):
        daemon, out = self._run("Shopp")
        daemon.delete_page.assert_called_once_with("nb-001", PAGE_C["id"])
        assert out["deleted"] is True

    def test_ambiguous_prefix_deletes_nothing(self):
        storage = MagicMock()
        storage.resolve_notebook.return_value = {"id": "nb-001", "name": "Test"}
        daemon = MagicMock()
        daemon.list_pages.return_value = PAGES
        with (
            patch("nous_mcp.server._storage", storage),
            patch("nous_mcp.server._daemon", daemon),
            pytest.raises(ValueError, match="Ambiguous"),
        ):
            delete_page("Test", "Meeting")
        daemon.delete_page.assert_not_called()

    def test_unknown_page_deletes_nothing(self):
        storage = MagicMock()
        storage.resolve_notebook.return_value = {"id": "nb-001", "name": "Test"}
        daemon = MagicMock()
        daemon.list_pages.return_value = PAGES
        with (
            patch("nous_mcp.server._storage", storage),
            patch("nous_mcp.server._daemon", daemon),
            pytest.raises(ValueError, match="No page matching"),
        ):
            delete_page("Test", "Nonexistent")
        daemon.delete_page.assert_not_called()
