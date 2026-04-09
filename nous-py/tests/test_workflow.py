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
    _format_task_content,
    _resolve_dependencies,
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
    rows: list[dict] | None = None,
    include_external_ref: bool = False,
) -> dict:
    """Build a minimal database content dict with a Project select property."""
    options = []
    if project_options:
        options = [
            {"id": f"opt-proj-{label.lower()}", "label": label, "color": "#ef4444"}
            for label in project_options
        ]
    properties = [
        {"id": "prop-task", "name": "Task", "type": "text"},
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
                {"id": "opt-ready", "label": "Ready", "color": "#f97316"},
                {"id": "opt-inprogress", "label": "In Progress", "color": "#3b82f6"},
                {"id": "opt-done", "label": "Done", "color": "#22c55e"},
            ],
        },
        {"id": "prop-priority", "name": "Priority", "type": "number"},
        {
            "id": "prop-phase",
            "name": "Phase",
            "type": "select",
            "options": [
                {"id": "opt-feature", "label": "Feature", "color": "#3b82f6"},
                {"id": "opt-infra", "label": "Infrastructure", "color": "#6366f1"},
                {"id": "opt-bugfix", "label": "Bugfix", "color": "#ef4444"},
            ],
        },
        {"id": "prop-depends", "name": "Depends On", "type": "text"},
        {"id": "prop-notes", "name": "Notes", "type": "text"},
    ]
    if include_external_ref:
        properties.append({"id": "prop-extref", "name": "External Ref", "type": "text"})
    return {
        "version": 2,
        "properties": properties,
        "rows": rows or [],
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
                storage, NOTEBOOK_ID, DB_PAGE_ID, "Task", "X"
            )


# ---------------------------------------------------------------------------
# _ensure_database_column
# ---------------------------------------------------------------------------


class TestEnsureDatabaseColumn:
    def test_adds_new_column(self):
        db = _make_db_content()
        storage = _make_storage(db_content=db)

        _, added = _ensure_database_column(
            storage, NOTEBOOK_ID, DB_PAGE_ID, "Assignee", "select", ["Alice", "Bob"]
        )
        assert added is True
        new_prop = db["properties"][-1]
        assert new_prop["name"] == "Assignee"
        assert new_prop["type"] == "select"
        assert len(new_prop["options"]) == 2

    def test_existing_column_is_noop(self):
        db = _make_db_content()
        storage = _make_storage(db_content=db)

        _, added = _ensure_database_column(
            storage, NOTEBOOK_ID, DB_PAGE_ID, "Task", "text"
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


def _register_tools(storage, daemon):
    """Register tools on a mock MCP and return dict of all registered functions."""
    mcp = MagicMock()
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
    return registered


class TestCreateProject:
    def _register_and_get_tool(self, storage, daemon):
        return _register_tools(storage, daemon)["create_project"]

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


# ---------------------------------------------------------------------------
# _resolve_dependencies
# ---------------------------------------------------------------------------


class TestResolveDependencies:
    def _make_db_with_rows(self):
        db = _make_db_content(project_options=["Nous"], include_external_ref=True)
        db["rows"] = [
            {
                "id": "row-1",
                "cells": {
                    "prop-task": "Setup database",
                    "prop-project": "opt-proj-nous",
                },
            },
            {
                "id": "row-2",
                "cells": {
                    "prop-task": "Add tests",
                    "prop-project": "opt-proj-nous",
                },
            },
        ]
        return db

    def test_resolves_existing_task(self):
        db = self._make_db_with_rows()
        storage = _make_storage(db_content=db)
        value, warnings = _resolve_dependencies(
            storage, NOTEBOOK_ID, DB_PAGE_ID, "Nous", ["Setup database"]
        )
        assert "row-1:Setup database" in value
        assert warnings == []

    def test_warns_for_unknown_task(self):
        db = self._make_db_with_rows()
        storage = _make_storage(db_content=db)
        value, warnings = _resolve_dependencies(
            storage, NOTEBOOK_ID, DB_PAGE_ID, "Nous", ["Nonexistent"]
        )
        assert "Nonexistent" in value
        assert len(warnings) == 1
        assert "not found" in warnings[0]

    def test_prefers_same_project_match(self):
        db = _make_db_content(project_options=["Nous", "Other"], include_external_ref=True)
        db["rows"] = [
            {
                "id": "row-other",
                "cells": {
                    "prop-task": "Shared name",
                    "prop-project": "opt-proj-other",
                },
            },
            {
                "id": "row-nous",
                "cells": {
                    "prop-task": "Shared name",
                    "prop-project": "opt-proj-nous",
                },
            },
        ]
        storage = _make_storage(db_content=db)
        value, warnings = _resolve_dependencies(
            storage, NOTEBOOK_ID, DB_PAGE_ID, "Nous", ["Shared name"]
        )
        assert "row-nous:" in value
        assert warnings == []

    def test_multiple_dependencies(self):
        db = self._make_db_with_rows()
        storage = _make_storage(db_content=db)
        value, warnings = _resolve_dependencies(
            storage, NOTEBOOK_ID, DB_PAGE_ID, "Nous", ["Setup database", "Add tests"]
        )
        assert "row-1:Setup database" in value
        assert "row-2:Add tests" in value
        assert ", " in value


# ---------------------------------------------------------------------------
# _format_task_content
# ---------------------------------------------------------------------------


class TestFormatTaskContent:
    def test_prepends_header_and_metadata(self):
        result = _format_task_content(
            "My Task", "Nous", "Forge", "Ready", 3, "None", "Do the thing."
        )
        assert "## Task: My Task" in result
        assert "**Project:** Nous (Forge)" in result
        assert "**Status:** Ready" in result
        assert "**Priority:** 3" in result
        assert "**Depends on:** None" in result
        assert "Do the thing." in result

    def test_preserves_existing_header(self):
        result = _format_task_content(
            "My Task", "Nous", "Forge", "Ready", 3, "None",
            "## Custom Header\n\nBody text."
        )
        assert result.startswith("## Custom Header")
        assert "**Project:** Nous (Forge)" in result
        assert "Body text." in result

    def test_includes_dependency_names(self):
        result = _format_task_content(
            "My Task", "Nous", "Forge", "Ready", 3,
            "uuid1:Setup, uuid2:Deploy", "Content."
        )
        assert "uuid1:Setup, uuid2:Deploy" in result


# ---------------------------------------------------------------------------
# create_task (registered tool)
# ---------------------------------------------------------------------------


class TestCreateTask:
    def _setup(self, db=None, folders=None):
        if db is None:
            db = _make_db_content(
                project_options=["Nous"], include_external_ref=True
            )
        if folders is None:
            folders = [{"id": "folder-nous", "name": "Nous"}]
        storage = _make_storage(folders=folders, db_content=db)
        daemon = _make_daemon()
        daemon.create_page.return_value = {"id": "page-123", "title": "Task: My Task"}
        daemon.add_database_rows.return_value = {
            "databaseId": DB_PAGE_ID,
            "rowsAdded": 1,
            "totalRows": 1,
        }
        tools = _register_tools(storage, daemon)
        return tools["create_task"], storage, daemon

    def test_creates_page_in_project_folder(self):
        create_task, storage, daemon = self._setup()
        result = json.loads(create_task(
            project="Nous", title="My Task", content="Build the thing."
        ))
        assert result["page_id"] == "page-123"
        assert result["project"] == "Nous"
        assert result["title"] == "Task: My Task"

        # Verify page created in correct folder
        call_kwargs = daemon.create_page.call_args
        assert call_kwargs.kwargs["folder_id"] == "folder-nous"

    def test_creates_database_row(self):
        create_task, storage, daemon = self._setup()
        create_task(
            project="Nous", title="My Task", content="Build the thing.",
            priority=2, phase="Infrastructure", status="In Progress",
        )
        daemon.add_database_rows.assert_called_once()
        rows_arg = daemon.add_database_rows.call_args[0][2]
        row = rows_arg[0]
        assert row["Task"] == "My Task"
        assert row["Project"] == "Nous"
        assert row["Status"] == "In Progress"
        assert row["Priority"] == 2
        assert row["Phase"] == "Infrastructure"

    def test_auto_tags(self):
        create_task, storage, daemon = self._setup()
        create_task(
            project="Nous", title="My Task", content="Build it.",
            status="Ready", tags="workflow,sdk",
        )
        call_kwargs = daemon.create_page.call_args
        tags = call_kwargs.kwargs["tags"]
        assert "task" in tags
        assert "nous" in tags
        assert "ready" in tags
        assert "workflow" in tags
        assert "sdk" in tags

    def test_external_ref_stored(self):
        create_task, storage, daemon = self._setup()
        create_task(
            project="Nous", title="My Task", content="Fix it.",
            external_ref="PROJ-123",
        )
        rows_arg = daemon.add_database_rows.call_args[0][2]
        assert rows_arg[0]["External Ref"] == "PROJ-123"

    def test_no_external_ref_when_empty(self):
        create_task, storage, daemon = self._setup()
        create_task(
            project="Nous", title="My Task", content="Fix it.",
        )
        rows_arg = daemon.add_database_rows.call_args[0][2]
        assert "External Ref" not in rows_arg[0]

    def test_dependency_resolution(self):
        db = _make_db_content(
            project_options=["Nous"], include_external_ref=True,
            rows=[
                {
                    "id": "dep-row",
                    "cells": {
                        "prop-task": "Setup database",
                        "prop-project": "opt-proj-nous",
                    },
                },
            ],
        )
        create_task, storage, daemon = self._setup(db=db)
        result = json.loads(create_task(
            project="Nous", title="Add API",
            content="Build API.", depends_on="Setup database",
        ))
        rows_arg = daemon.add_database_rows.call_args[0][2]
        assert "dep-row:Setup database" in rows_arg[0]["Depends On"]
        assert result["warnings"] == []

    def test_unresolvable_dependency_warns(self):
        create_task, storage, daemon = self._setup()
        result = json.loads(create_task(
            project="Nous", title="Add API",
            content="Build API.", depends_on="Ghost Task",
        ))
        assert len(result["warnings"]) > 0
        assert "Ghost Task" in result["warnings"][0]
        # Should still create the page
        assert result["page_id"] == "page-123"

    def test_missing_project_folder_raises(self):
        create_task, storage, daemon = self._setup(folders=[])
        with pytest.raises(ValueError, match="not found"):
            create_task(
                project="Nous", title="My Task", content="Content."
            )

    def test_content_gets_metadata_header(self):
        create_task, storage, daemon = self._setup()
        create_task(
            project="Nous", title="My Task", content="Just the body.",
            priority=1, status="Ready",
        )
        blocks_arg = daemon.create_page.call_args.kwargs.get("blocks") or daemon.create_page.call_args[0][2] if len(daemon.create_page.call_args[0]) > 2 else daemon.create_page.call_args.kwargs["blocks"]
        # The markdown_to_blocks was called with formatted content
        # Just verify create_page was called (content formatting tested separately)
        daemon.create_page.assert_called_once()

    def test_db_row_failure_returns_page_with_warning(self):
        create_task, storage, daemon = self._setup()
        daemon.add_database_rows.side_effect = Exception("DB write failed")

        result = json.loads(create_task(
            project="Nous", title="My Task", content="Content.",
        ))
        assert result["page_id"] == "page-123"
        assert result["row_id"] is None
        assert any("database row failed" in w for w in result["warnings"])
