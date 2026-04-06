"""Tests for nous_mcp.workflow module."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from nous_mcp.workflow import (
    REQUIRED_COLUMNS,
    _ensure_database_column,
    _ensure_schema,
    _ensure_select_option,
    _resolve_project_folder,
    register_workflow_tools,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

NOTEBOOK_ID = "nb-001"
DB_PAGE_ID = "db-page-001"


def _make_db_content(
    project_options: list[str] | None = None,
) -> dict:
    """Build a minimal database content dict with a Project select property."""
    options = []
    if project_options:
        options = [
            {"id": str(uuid4()), "label": label, "color": "#ef4444"}
            for label in project_options
        ]
    return {
        "version": 2,
        "properties": [
            {"id": "prop-name", "name": "Name", "type": "text"},
            {
                "id": "prop-project",
                "name": "Project",
                "type": "select",
                "options": options,
            },
            {
                "id": "prop-status",
                "name": "Status",
                "type": "select",
                "options": [
                    {"id": "opt-todo", "label": "Todo", "color": "#ef4444"},
                    {"id": "opt-done", "label": "Done", "color": "#22c55e"},
                ],
            },
        ],
        "rows": [],
        "views": [],
    }


def _make_storage(
    folders: list[dict] | None = None,
    db_content: dict | None = None,
) -> MagicMock:
    """Build a mock NousStorage."""
    storage = MagicMock()
    storage.resolve_notebook.return_value = {"id": NOTEBOOK_ID, "name": "Forge"}
    storage.list_folders.return_value = folders or []
    storage.read_database_content.return_value = db_content or _make_db_content()
    storage.create_folder.return_value = {"id": "new-folder-id", "name": "TestProject"}
    return storage


def _make_daemon() -> MagicMock:
    """Build a mock NousDaemonClient."""
    daemon = MagicMock()
    daemon.resolve_page.return_value = {
        "id": DB_PAGE_ID,
        "title": "Project Tasks",
        "pageType": "database",
    }
    daemon.update_page.return_value = {}
    return daemon


# ---------------------------------------------------------------------------
# _resolve_project_folder
# ---------------------------------------------------------------------------


class TestResolveProjectFolder:
    def test_finds_existing_folder(self):
        folders = [
            {"id": "f1", "name": "Alpha"},
            {"id": "f2", "name": "Beta"},
        ]
        storage = _make_storage(folders=folders)
        result = _resolve_project_folder(storage, NOTEBOOK_ID, "Alpha")
        assert result["id"] == "f1"

    def test_case_insensitive(self):
        folders = [{"id": "f1", "name": "MyProject"}]
        storage = _make_storage(folders=folders)
        result = _resolve_project_folder(storage, NOTEBOOK_ID, "myproject")
        assert result["id"] == "f1"

    def test_raises_for_unknown_project(self):
        storage = _make_storage(folders=[])
        with pytest.raises(ValueError, match="not found"):
            _resolve_project_folder(storage, NOTEBOOK_ID, "Ghost")

    def test_error_suggests_create_project(self):
        storage = _make_storage(folders=[])
        with pytest.raises(ValueError, match="create_project"):
            _resolve_project_folder(storage, NOTEBOOK_ID, "Ghost")


# ---------------------------------------------------------------------------
# _ensure_select_option
# ---------------------------------------------------------------------------


class TestEnsureSelectOption:
    def test_adds_new_option(self):
        db = _make_db_content(project_options=[])
        storage = _make_storage(db_content=db)

        _, added = _ensure_select_option(
            storage, NOTEBOOK_ID, DB_PAGE_ID, "Project", "NewProject"
        )
        assert added is True
        storage.write_database_content.assert_called_once()

        # Verify the option was added in-memory
        proj_prop = db["properties"][1]
        assert len(proj_prop["options"]) == 1
        assert proj_prop["options"][0]["label"] == "NewProject"

    def test_existing_option_is_noop(self):
        db = _make_db_content(project_options=["Existing"])
        storage = _make_storage(db_content=db)

        _, added = _ensure_select_option(
            storage, NOTEBOOK_ID, DB_PAGE_ID, "Project", "Existing"
        )
        assert added is False
        storage.write_database_content.assert_not_called()

    def test_case_insensitive_match(self):
        db = _make_db_content(project_options=["MyProject"])
        storage = _make_storage(db_content=db)

        _, added = _ensure_select_option(
            storage, NOTEBOOK_ID, DB_PAGE_ID, "Project", "myproject"
        )
        assert added is False

    def test_no_duplicate_on_repeat(self):
        db = _make_db_content(project_options=[])
        storage = _make_storage(db_content=db)

        _ensure_select_option(storage, NOTEBOOK_ID, DB_PAGE_ID, "Project", "Alpha")
        # Reset mock but keep the mutated db_content
        storage.write_database_content.reset_mock()

        _, added = _ensure_select_option(
            storage, NOTEBOOK_ID, DB_PAGE_ID, "Project", "Alpha"
        )
        assert added is False
        storage.write_database_content.assert_not_called()

    def test_raises_for_missing_property(self):
        db = _make_db_content()
        storage = _make_storage(db_content=db)

        with pytest.raises(ValueError, match="not found"):
            _ensure_select_option(
                storage, NOTEBOOK_ID, DB_PAGE_ID, "NonExistent", "X"
            )

    def test_raises_for_non_select_property(self):
        db = _make_db_content()
        storage = _make_storage(db_content=db)

        with pytest.raises(ValueError, match="not select"):
            _ensure_select_option(
                storage, NOTEBOOK_ID, DB_PAGE_ID, "Name", "X"
            )


# ---------------------------------------------------------------------------
# _ensure_database_column
# ---------------------------------------------------------------------------


class TestEnsureDatabaseColumn:
    def test_adds_new_column(self):
        db = _make_db_content()
        storage = _make_storage(db_content=db)

        _, added = _ensure_database_column(
            storage, NOTEBOOK_ID, DB_PAGE_ID, "Priority", "select", ["High", "Low"]
        )
        assert added is True
        new_prop = db["properties"][-1]
        assert new_prop["name"] == "Priority"
        assert new_prop["type"] == "select"
        assert len(new_prop["options"]) == 2

    def test_existing_column_is_noop(self):
        db = _make_db_content()
        storage = _make_storage(db_content=db)

        _, added = _ensure_database_column(
            storage, NOTEBOOK_ID, DB_PAGE_ID, "Name", "text"
        )
        assert added is False
        storage.write_database_content.assert_not_called()


# ---------------------------------------------------------------------------
# _ensure_schema
# ---------------------------------------------------------------------------


class TestEnsureSchema:
    def test_adds_external_ref_column_when_missing(self):
        db = _make_db_content()
        storage = _make_storage(db_content=db)

        added = _ensure_schema(storage, NOTEBOOK_ID, DB_PAGE_ID)
        assert "External Ref" in added
        # Verify the column was added
        col_names = [p["name"] for p in db["properties"]]
        assert "External Ref" in col_names
        ext_ref = next(p for p in db["properties"] if p["name"] == "External Ref")
        assert ext_ref["type"] == "text"

    def test_no_duplicates_when_column_exists(self):
        db = _make_db_content()
        db["properties"].append(
            {"id": "prop-extref", "name": "External Ref", "type": "text"}
        )
        storage = _make_storage(db_content=db)

        added = _ensure_schema(storage, NOTEBOOK_ID, DB_PAGE_ID)
        assert added == []
        storage.write_database_content.assert_not_called()

    def test_idempotent_double_call(self):
        db = _make_db_content()
        storage = _make_storage(db_content=db)

        added1 = _ensure_schema(storage, NOTEBOOK_ID, DB_PAGE_ID)
        storage.write_database_content.reset_mock()

        added2 = _ensure_schema(storage, NOTEBOOK_ID, DB_PAGE_ID)
        assert len(added1) > 0
        assert added2 == []
        storage.write_database_content.assert_not_called()

    def test_required_columns_includes_external_ref(self):
        col_names = [name for name, _, _ in REQUIRED_COLUMNS]
        assert "External Ref" in col_names


# ---------------------------------------------------------------------------
# create_project (registered tool)
# ---------------------------------------------------------------------------


class TestCreateProject:
    def _register_and_get_tool(self, storage, daemon):
        """Register tools on a mock MCP and return the create_project function."""
        mcp = MagicMock()
        # Capture the decorated function
        registered = {}

        def tool_decorator():
            def wrapper(fn):
                registered[fn.__name__] = fn
                return fn
            return wrapper

        mcp.tool = tool_decorator
        register_workflow_tools(
            mcp,
            get_storage=lambda: storage,
            get_daemon=lambda: daemon,
            daemon_available=lambda: True,
        )
        return registered["create_project"]

    def test_creates_folder_and_updates_db(self):
        db = _make_db_content(project_options=[])
        storage = _make_storage(folders=[], db_content=db)
        daemon = _make_daemon()

        create_project = self._register_and_get_tool(storage, daemon)
        result = json.loads(create_project("TestProject"))

        assert result["created"] is True
        assert result["database_updated"] is True
        assert result["project_name"] == "TestProject"
        storage.create_folder.assert_called_once_with(NOTEBOOK_ID, "TestProject")
        daemon.update_page.assert_called_once()

    def test_idempotent_second_call(self):
        db = _make_db_content(project_options=["TestProject"])
        # Pre-add External Ref so schema is already up to date
        db["properties"].append(
            {"id": "prop-extref", "name": "External Ref", "type": "text"}
        )
        folders = [{"id": "f1", "name": "TestProject"}]
        storage = _make_storage(folders=folders, db_content=db)
        daemon = _make_daemon()

        create_project = self._register_and_get_tool(storage, daemon)
        result = json.loads(create_project("TestProject"))

        assert result["created"] is False
        assert result["database_updated"] is False
        assert result["columns_added"] == []
        assert result["folder_id"] == "f1"
        storage.create_folder.assert_not_called()
        daemon.update_page.assert_not_called()

    def test_existing_folder_new_option(self):
        db = _make_db_content(project_options=[])
        folders = [{"id": "f1", "name": "TestProject"}]
        storage = _make_storage(folders=folders, db_content=db)
        daemon = _make_daemon()

        create_project = self._register_and_get_tool(storage, daemon)
        result = json.loads(create_project("TestProject"))

        assert result["created"] is False
        assert result["database_updated"] is True
        storage.create_folder.assert_not_called()
        daemon.update_page.assert_called_once()

    def test_auto_adds_external_ref_column(self):
        db = _make_db_content(project_options=["TestProject"])
        # No External Ref column yet
        folders = [{"id": "f1", "name": "TestProject"}]
        storage = _make_storage(folders=folders, db_content=db)
        daemon = _make_daemon()

        create_project = self._register_and_get_tool(storage, daemon)
        result = json.loads(create_project("TestProject"))

        assert "External Ref" in result["columns_added"]
        # Schema change should trigger daemon.update_page
        daemon.update_page.assert_called_once()

    def test_raises_for_non_database_page(self):
        storage = _make_storage()
        daemon = _make_daemon()
        daemon.resolve_page.return_value = {
            "id": DB_PAGE_ID,
            "title": "Not A DB",
            "pageType": "standard",
        }

        create_project = self._register_and_get_tool(storage, daemon)
        with pytest.raises(ValueError, match="not a database"):
            create_project("TestProject")
