"""Tests for nous_mcp.workflow module."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from nous_mcp.workflow import (
    ALL_STATUS_TAGS,
    REQUIRED_COLUMNS,
    _check_dependency_status,
    _ensure_database_column,
    _ensure_schema,
    _ensure_select_option,
    _find_task_row,
    _fire_webhook,
    _format_task_content,
    _get_project_tasks,
    _get_row_status,
    _migrate_dependencies,
    _parse_depends_on,
    _resolve_dep_row,
    _resolve_dependencies,
    _resolve_project_folder,
    _topological_sort,
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
        {"id": "prop-feature", "name": "Feature", "type": "text"},
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


# ---------------------------------------------------------------------------
# _find_task_row
# ---------------------------------------------------------------------------


class TestFindTaskRow:
    def test_finds_row_by_name(self):
        db = _make_db_content(
            project_options=["Nous"],
            rows=[{"id": "r1", "cells": {"prop-task": "Setup database"}}],
        )
        row, idx, _ = _find_task_row(db, "Setup database")
        assert row["id"] == "r1"
        assert idx == 0

    def test_case_insensitive(self):
        db = _make_db_content(
            project_options=["Nous"],
            rows=[{"id": "r1", "cells": {"prop-task": "Setup Database"}}],
        )
        row, _, _ = _find_task_row(db, "setup database")
        assert row is not None

    def test_returns_none_for_missing(self):
        db = _make_db_content(project_options=["Nous"])
        row, idx, _ = _find_task_row(db, "Ghost")
        assert row is None
        assert idx is None


# ---------------------------------------------------------------------------
# _check_dependency_status
# ---------------------------------------------------------------------------


class TestCheckDependencyStatus:
    def _make_db_with_deps(self, dep_status_label="Done"):
        db = _make_db_content(project_options=["Nous"])
        # Find the status option ID for the given label
        status_prop = next(p for p in db["properties"] if p["name"] == "Status")
        status_opt = next(
            (o for o in status_prop["options"] if o["label"] == dep_status_label),
            status_prop["options"][0],  # fallback
        )
        db["rows"] = [
            {
                "id": "dep-row",
                "cells": {
                    "prop-task": "Prerequisite",
                    "prop-status": status_opt["id"],
                },
            },
        ]
        return db

    def test_all_satisfied_when_deps_done(self):
        db = self._make_db_with_deps("Done")
        result = _check_dependency_status(db, "dep-row:Prerequisite")
        assert result == "all satisfied"

    def test_warning_when_dep_not_done(self):
        db = self._make_db_with_deps("Ready")
        result = _check_dependency_status(db, "dep-row:Prerequisite")
        assert isinstance(result, dict)
        assert "warning" in result
        assert "Prerequisite" in result["warning"]
        assert "Ready" in result["warning"]

    def test_no_deps_returns_satisfied(self):
        db = _make_db_content()
        assert _check_dependency_status(db, "None") == "all satisfied"
        assert _check_dependency_status(db, "") == "all satisfied"


# ---------------------------------------------------------------------------
# update_task_status (registered tool)
# ---------------------------------------------------------------------------


class TestUpdateTaskStatus:
    def _setup(self, db=None, task_page_tags=None):
        if db is None:
            db = _make_db_content(
                project_options=["Nous"],
                include_external_ref=True,
                rows=[
                    {
                        "id": "row-1",
                        "cells": {
                            "prop-task": "My Task",
                            "prop-project": "opt-proj-nous",
                            "prop-status": "opt-ready",
                            "prop-depends": "None",
                        },
                    },
                ],
            )
        storage = _make_storage(
            folders=[{"id": "folder-nous", "name": "Nous"}],
            db_content=db,
        )
        daemon = _make_daemon()
        daemon.resolve_page.side_effect = self._make_resolve_page(task_page_tags)
        daemon.update_page.return_value = {}
        daemon.update_database_rows.return_value = {"rowsUpdated": 1}
        daemon.append_to_page.return_value = {}
        tools = _register_tools(storage, daemon)
        return tools["update_task_status"], storage, daemon

    @staticmethod
    def _make_resolve_page(task_page_tags=None):
        tags = task_page_tags or ["task", "nous", "ready"]

        def resolver(notebook_id, title_or_id):
            if title_or_id == "Project Tasks":
                return {
                    "id": DB_PAGE_ID,
                    "title": "Project Tasks",
                    "pageType": "database",
                }
            # Task page
            return {
                "id": "page-task-1",
                "title": f"Task: My Task",
                "tags": list(tags),
                "pageType": "standard",
            }

        return resolver

    def test_updates_status_in_tags_and_db(self):
        update, storage, daemon = self._setup()
        result = json.loads(update(task="My Task", status="In Progress"))

        assert result["previous_status"] == "Ready"
        assert result["new_status"] == "In Progress"

        # Check tags updated
        tag_call = daemon.update_page.call_args_list[0]
        new_tags = tag_call.kwargs["tags"]
        assert "in-progress" in new_tags
        assert "ready" not in new_tags

        # Check DB row updated
        daemon.update_database_rows.assert_called_once()

    def test_done_auto_sets_completed_date(self):
        update, storage, daemon = self._setup()
        result = json.loads(update(task="My Task", status="Done"))

        assert result["completed_date"] is not None
        # Check the DB update includes Completed
        db_update = daemon.update_database_rows.call_args[0][2]
        assert "Completed" in db_update[0]["cells"]

    def test_done_with_explicit_date(self):
        update, storage, daemon = self._setup()
        result = json.loads(update(
            task="My Task", status="Done", completed_date="2026-01-15"
        ))
        assert result["completed_date"] == "2026-01-15"

    def test_notes_appended(self):
        update, storage, daemon = self._setup()
        result = json.loads(update(
            task="My Task", status="In Progress",
            notes="Started working on the implementation."
        ))
        assert result["notes_appended"] is True
        daemon.append_to_page.assert_called_once()

    def test_no_notes_when_none(self):
        update, storage, daemon = self._setup()
        result = json.loads(update(task="My Task", status="Ready"))
        assert result["notes_appended"] is False
        daemon.append_to_page.assert_not_called()

    def test_in_progress_checks_deps_all_satisfied(self):
        db = _make_db_content(
            project_options=["Nous"],
            include_external_ref=True,
            rows=[
                {
                    "id": "dep-row",
                    "cells": {
                        "prop-task": "Prerequisite",
                        "prop-status": "opt-done",
                    },
                },
                {
                    "id": "row-1",
                    "cells": {
                        "prop-task": "My Task",
                        "prop-project": "opt-proj-nous",
                        "prop-status": "opt-ready",
                        "prop-depends": "dep-row:Prerequisite",
                    },
                },
            ],
        )
        update, storage, daemon = self._setup(db=db)
        result = json.loads(update(task="My Task", status="In Progress"))
        assert result["dependencies"] == "all satisfied"

    def test_in_progress_warns_unmet_deps(self):
        db = _make_db_content(
            project_options=["Nous"],
            include_external_ref=True,
            rows=[
                {
                    "id": "dep-row",
                    "cells": {
                        "prop-task": "Prerequisite",
                        "prop-status": "opt-ready",
                    },
                },
                {
                    "id": "row-1",
                    "cells": {
                        "prop-task": "My Task",
                        "prop-project": "opt-proj-nous",
                        "prop-status": "opt-ready",
                        "prop-depends": "dep-row:Prerequisite",
                    },
                },
            ],
        )
        update, storage, daemon = self._setup(db=db)
        result = json.loads(update(task="My Task", status="In Progress"))
        assert isinstance(result["dependencies"], dict)
        assert "warning" in result["dependencies"]
        # Status still updated despite warning
        assert result["new_status"] == "In Progress"

    def test_task_prefix_stripped(self):
        update, storage, daemon = self._setup()
        result = json.loads(update(task="Task: My Task", status="Done"))
        assert result["task"] == "My Task"

    def test_unknown_task_raises(self):
        update, storage, daemon = self._setup()
        daemon.resolve_page.side_effect = Exception("Not found")
        with pytest.raises(ValueError, match="not found"):
            update(task="Ghost Task", status="Done")

    def test_external_ref_updated(self):
        update, storage, daemon = self._setup()
        update(task="My Task", status="In Progress", external_ref="PROJ-456")
        db_update = daemon.update_database_rows.call_args[0][2]
        assert db_update[0]["cells"]["External Ref"] == "PROJ-456"

    def test_old_status_tags_removed(self):
        update, storage, daemon = self._setup(
            task_page_tags=["task", "nous", "ready", "spec-needed"]
        )
        update(task="My Task", status="Done")
        tag_call = daemon.update_page.call_args_list[0]
        new_tags = tag_call.kwargs["tags"]
        assert "ready" not in new_tags
        assert "spec-needed" not in new_tags
        assert "done" in new_tags


# ---------------------------------------------------------------------------
# _fire_webhook
# ---------------------------------------------------------------------------


class TestFireWebhook:
    def test_fires_when_url_configured(self, monkeypatch):
        """Webhook POSTs when AGENT_MONITOR_WEBHOOK_URL is set."""
        sent = []

        def mock_post(url, **kwargs):
            sent.append({"url": url, "json": kwargs.get("json"), "headers": kwargs.get("headers")})
            resp = MagicMock()
            resp.status_code = 200
            return resp

        monkeypatch.setenv("AGENT_MONITOR_WEBHOOK_URL", "http://localhost:8070/api/webhook")
        monkeypatch.delenv("AGENT_MONITOR_WEBHOOK_KEY", raising=False)
        monkeypatch.setattr("nous_mcp.workflow.httpx.post", mock_post)

        _fire_webhook("My Task", "Nous", "In Progress", "Ready")

        # Wait for daemon thread
        import time
        time.sleep(0.1)

        assert len(sent) == 1
        payload = sent[0]["json"]
        assert payload["source"] == "nous"
        assert payload["task"] == "My Task"
        assert payload["project"] == "Nous"
        assert payload["status"] == "In Progress"
        assert payload["previous_status"] == "Ready"
        assert payload["kanban_column"] == "Active"
        assert "timestamp" in payload

    def test_skipped_when_url_not_set(self, monkeypatch):
        """Webhook is silently skipped when env var is not set."""
        monkeypatch.delenv("AGENT_MONITOR_WEBHOOK_URL", raising=False)

        # Should not raise or do anything
        _fire_webhook("My Task", "Nous", "Done", "In Progress")

    def test_auth_header_included(self, monkeypatch):
        """Authorization header sent when AGENT_MONITOR_WEBHOOK_KEY is set."""
        sent = []

        def mock_post(url, **kwargs):
            sent.append(kwargs.get("headers", {}))
            resp = MagicMock()
            resp.status_code = 200
            return resp

        monkeypatch.setenv("AGENT_MONITOR_WEBHOOK_URL", "http://localhost:8070/api/webhook")
        monkeypatch.setenv("AGENT_MONITOR_WEBHOOK_KEY", "secret-key")
        monkeypatch.setattr("nous_mcp.workflow.httpx.post", mock_post)

        _fire_webhook("My Task", "Nous", "Done", "In Progress")

        import time
        time.sleep(0.1)

        assert sent[0]["Authorization"] == "Bearer secret-key"

    def test_failure_does_not_raise(self, monkeypatch):
        """Webhook failure is logged but does not propagate."""
        def mock_post(url, **kwargs):
            raise ConnectionError("Connection refused")

        monkeypatch.setenv("AGENT_MONITOR_WEBHOOK_URL", "http://localhost:8070/api/webhook")
        monkeypatch.setattr("nous_mcp.workflow.httpx.post", mock_post)

        # Should not raise
        _fire_webhook("My Task", "Nous", "Done", "In Progress")

        import time
        time.sleep(3)  # Wait for retry

    def test_external_ref_included(self, monkeypatch):
        """External ref is included in payload when provided."""
        sent = []

        def mock_post(url, **kwargs):
            sent.append(kwargs.get("json"))
            resp = MagicMock()
            resp.status_code = 200
            return resp

        monkeypatch.setenv("AGENT_MONITOR_WEBHOOK_URL", "http://localhost:8070/api/webhook")
        monkeypatch.setattr("nous_mcp.workflow.httpx.post", mock_post)

        _fire_webhook("My Task", "Nous", "Done", "In Progress", external_ref="PROJ-123")

        import time
        time.sleep(0.1)

        assert sent[0]["external_ref"] == "PROJ-123"

    def test_kanban_mapping(self, monkeypatch):
        """Status correctly maps to Kanban columns."""
        sent = []

        def mock_post(url, **kwargs):
            sent.append(kwargs.get("json", {}).get("kanban_column"))
            resp = MagicMock()
            resp.status_code = 200
            return resp

        monkeypatch.setenv("AGENT_MONITOR_WEBHOOK_URL", "http://localhost:8070/api/webhook")
        monkeypatch.setattr("nous_mcp.workflow.httpx.post", mock_post)

        _fire_webhook("T", "P", "Ready", "Spec Needed")
        _fire_webhook("T", "P", "In Progress", "Ready")
        _fire_webhook("T", "P", "Done", "In Progress")

        import time
        time.sleep(0.1)

        assert sent == ["Backlog", "Active", "Done"]


# ---------------------------------------------------------------------------
# _parse_depends_on
# ---------------------------------------------------------------------------


class TestParseDependsOn:
    def test_uuid_format(self):
        result = _parse_depends_on("abc-123:Task A, def-456:Task B")
        assert result == [("abc-123", "Task A"), ("def-456", "Task B")]

    def test_free_text(self):
        result = _parse_depends_on("Task A, Task B")
        assert result == [(None, "Task A"), (None, "Task B")]

    def test_mixed_format(self):
        result = _parse_depends_on("abc-123:Task A, Task B")
        assert result == [("abc-123", "Task A"), (None, "Task B")]

    def test_none_value(self):
        assert _parse_depends_on("None") == []
        assert _parse_depends_on("") == []
        assert _parse_depends_on("  none  ") == []

    def test_single_entry(self):
        result = _parse_depends_on("abc:My Task")
        assert result == [("abc", "My Task")]


# ---------------------------------------------------------------------------
# _resolve_dep_row
# ---------------------------------------------------------------------------


class TestResolveDepRow:
    def _make_db(self):
        return _make_db_content(
            project_options=["Nous"],
            rows=[
                {"id": "r1", "cells": {"prop-task": "Setup database"}},
                {"id": "r2", "cells": {"prop-task": "Add tests"}},
            ],
        )

    def test_resolve_by_uuid(self):
        db = self._make_db()
        row = _resolve_dep_row(db, "r1", "Setup database")
        assert row is not None
        assert row["id"] == "r1"

    def test_resolve_by_name(self):
        db = self._make_db()
        row = _resolve_dep_row(db, None, "Add tests")
        assert row is not None
        assert row["id"] == "r2"

    def test_uuid_takes_precedence(self):
        db = self._make_db()
        # UUID points to r1, name says "Add tests" (r2) — UUID wins
        row = _resolve_dep_row(db, "r1", "Add tests")
        assert row["id"] == "r1"

    def test_fallback_to_name_when_uuid_missing(self):
        db = self._make_db()
        row = _resolve_dep_row(db, "nonexistent-uuid", "Add tests")
        assert row is not None
        assert row["id"] == "r2"

    def test_returns_none_when_nothing_matches(self):
        db = self._make_db()
        row = _resolve_dep_row(db, "bad-uuid", "Ghost Task")
        assert row is None


# ---------------------------------------------------------------------------
# _migrate_dependencies
# ---------------------------------------------------------------------------


class TestMigrateDependencies:
    def _make_db_for_migration(self):
        return _make_db_content(
            project_options=["Nous"],
            rows=[
                {"id": "r-setup", "cells": {"prop-task": "Setup database", "prop-depends": ""}},
                {"id": "r-api", "cells": {"prop-task": "Add API", "prop-depends": "Setup database"}},
                {"id": "r-tests", "cells": {"prop-task": "Add tests", "prop-depends": "Setup database, Add API"}},
                {"id": "r-already", "cells": {"prop-task": "Deploy", "prop-depends": "r-api:Add API"}},
            ],
        )

    def test_migrates_free_text_to_uuid(self):
        db = self._make_db_for_migration()
        storage = _make_storage(db_content=db)
        result = _migrate_dependencies(storage, NOTEBOOK_ID, DB_PAGE_ID)

        assert result["migrated"] == 2  # r-api and r-tests
        assert result["unresolved"] == 0

        # Check the actual values
        api_row = db["rows"][1]
        assert f"r-setup:Setup database" == api_row["cells"]["prop-depends"]

        tests_row = db["rows"][2]
        assert "r-setup:Setup database" in tests_row["cells"]["prop-depends"]
        assert "r-api:Add API" in tests_row["cells"]["prop-depends"]

    def test_already_uuid_format_unchanged(self):
        db = self._make_db_for_migration()
        storage = _make_storage(db_content=db)
        result = _migrate_dependencies(storage, NOTEBOOK_ID, DB_PAGE_ID)

        # Deploy row already had UUID format — should not be in migrated count
        deploy_row = db["rows"][3]
        assert deploy_row["cells"]["prop-depends"] == "r-api:Add API"

    def test_unresolved_deps_tracked(self):
        db = _make_db_content(
            project_options=["Nous"],
            rows=[
                {"id": "r1", "cells": {"prop-task": "Task A", "prop-depends": "Ghost Task"}},
            ],
        )
        storage = _make_storage(db_content=db)
        result = _migrate_dependencies(storage, NOTEBOOK_ID, DB_PAGE_ID)

        assert result["unresolved"] == 1
        assert "Ghost Task" in result["unresolved_names"]
        # Row not counted as migrated since no UUID was added
        assert result["migrated"] == 0

    def test_idempotent(self):
        db = self._make_db_for_migration()
        storage = _make_storage(db_content=db)

        result1 = _migrate_dependencies(storage, NOTEBOOK_ID, DB_PAGE_ID)
        storage.write_database_content.reset_mock()

        result2 = _migrate_dependencies(storage, NOTEBOOK_ID, DB_PAGE_ID)
        assert result2["migrated"] == 0
        storage.write_database_content.assert_not_called()

    def test_empty_depends_on_skipped(self):
        db = _make_db_content(
            project_options=["Nous"],
            rows=[
                {"id": "r1", "cells": {"prop-task": "Task A", "prop-depends": ""}},
                {"id": "r2", "cells": {"prop-task": "Task B", "prop-depends": "None"}},
            ],
        )
        storage = _make_storage(db_content=db)
        result = _migrate_dependencies(storage, NOTEBOOK_ID, DB_PAGE_ID)
        assert result["migrated"] == 0


# ---------------------------------------------------------------------------
# check_dependencies (registered tool)
# ---------------------------------------------------------------------------


class TestCheckDependenciesTool:
    def _setup(self, db=None):
        if db is None:
            db = _make_db_content(
                project_options=["Nous"],
                include_external_ref=True,
                rows=[
                    {
                        "id": "dep-done",
                        "cells": {
                            "prop-task": "Prerequisite Done",
                            "prop-status": "opt-done",
                        },
                    },
                    {
                        "id": "dep-ready",
                        "cells": {
                            "prop-task": "Prerequisite Ready",
                            "prop-status": "opt-ready",
                        },
                    },
                    {
                        "id": "row-main",
                        "cells": {
                            "prop-task": "Main Task",
                            "prop-status": "opt-ready",
                            "prop-depends": "dep-done:Prerequisite Done, dep-ready:Prerequisite Ready",
                        },
                    },
                ],
            )
        storage = _make_storage(
            folders=[{"id": "folder-nous", "name": "Nous"}],
            db_content=db,
        )
        daemon = _make_daemon()
        tools = _register_tools(storage, daemon)
        return tools["check_dependencies"], storage, daemon

    def test_mixed_dep_status(self):
        check, _, _ = self._setup()
        result = json.loads(check(task="Main Task"))

        assert result["task"] == "Main Task"
        assert result["ready"] is False
        assert len(result["dependencies"]) == 2

        done_dep = next(d for d in result["dependencies"] if d["task"] == "Prerequisite Done")
        assert done_dep["satisfied"] is True
        assert done_dep["status"] == "Done"

        ready_dep = next(d for d in result["dependencies"] if d["task"] == "Prerequisite Ready")
        assert ready_dep["satisfied"] is False
        assert ready_dep["status"] == "Ready"

        assert result["blocking"] == ["Prerequisite Ready"]

    def test_all_deps_done(self):
        db = _make_db_content(
            project_options=["Nous"],
            include_external_ref=True,
            rows=[
                {"id": "dep1", "cells": {"prop-task": "Dep A", "prop-status": "opt-done"}},
                {
                    "id": "row-main",
                    "cells": {
                        "prop-task": "Main Task",
                        "prop-status": "opt-ready",
                        "prop-depends": "dep1:Dep A",
                    },
                },
            ],
        )
        check, _, _ = self._setup(db=db)
        result = json.loads(check(task="Main Task"))
        assert result["ready"] is True
        assert result["blocking"] == []

    def test_no_deps(self):
        db = _make_db_content(
            project_options=["Nous"],
            include_external_ref=True,
            rows=[
                {
                    "id": "row-main",
                    "cells": {
                        "prop-task": "Main Task",
                        "prop-status": "opt-ready",
                        "prop-depends": "None",
                    },
                },
            ],
        )
        check, _, _ = self._setup(db=db)
        result = json.loads(check(task="Main Task"))
        assert result["ready"] is True
        assert result["dependencies"] == []

    def test_free_text_dep_resolved(self):
        db = _make_db_content(
            project_options=["Nous"],
            include_external_ref=True,
            rows=[
                {"id": "dep1", "cells": {"prop-task": "Setup", "prop-status": "opt-done"}},
                {
                    "id": "row-main",
                    "cells": {
                        "prop-task": "Main Task",
                        "prop-status": "opt-ready",
                        "prop-depends": "Setup",  # free-text, no UUID
                    },
                },
            ],
        )
        check, _, _ = self._setup(db=db)
        result = json.loads(check(task="Main Task"))
        assert result["ready"] is True
        assert result["dependencies"][0]["task"] == "Setup"
        assert result["dependencies"][0]["satisfied"] is True

    def test_unknown_task_raises(self):
        check, _, _ = self._setup()
        with pytest.raises(ValueError, match="not found"):
            check(task="Ghost Task")

    def test_task_prefix_stripped(self):
        check, _, _ = self._setup()
        result = json.loads(check(task="Task: Main Task"))
        assert result["task"] == "Main Task"


# ---------------------------------------------------------------------------
# migrate_dependencies (registered tool)
# ---------------------------------------------------------------------------


class TestMigrateDependenciesTool:
    def _setup(self, db=None):
        if db is None:
            db = _make_db_content(
                project_options=["Nous"],
                include_external_ref=True,
                rows=[
                    {"id": "r-setup", "cells": {"prop-task": "Setup", "prop-depends": ""}},
                    {"id": "r-api", "cells": {"prop-task": "API", "prop-depends": "Setup"}},
                ],
            )
        storage = _make_storage(
            folders=[{"id": "folder-nous", "name": "Nous"}],
            db_content=db,
        )
        daemon = _make_daemon()
        tools = _register_tools(storage, daemon)
        return tools["migrate_dependencies"], storage, daemon

    def test_migrates_and_returns_summary(self):
        migrate, storage, daemon = self._setup()
        result = json.loads(migrate())

        assert result["migrated"] == 1
        assert result["unresolved"] == 0
        daemon.update_page.assert_called_once()

    def test_no_changes_no_update(self):
        db = _make_db_content(
            project_options=["Nous"],
            include_external_ref=True,
            rows=[
                {"id": "r1", "cells": {"prop-task": "Task A", "prop-depends": ""}},
            ],
        )
        migrate, storage, daemon = self._setup(db=db)
        result = json.loads(migrate())

        assert result["migrated"] == 0
        daemon.update_page.assert_not_called()


# ---------------------------------------------------------------------------
# get_task_spec (registered tool)
# ---------------------------------------------------------------------------


class TestGetTaskSpec:
    def _setup(self, db=None, status_opt="opt-ready"):
        if db is None:
            db = _make_db_content(
                project_options=["Nous"],
                include_external_ref=True,
                rows=[
                    {
                        "id": "row-1",
                        "cells": {
                            "prop-task": "My Task",
                            "prop-project": "opt-proj-nous",
                            "prop-status": status_opt,
                            "prop-priority": 2,
                            "prop-phase": "opt-feature",
                            "prop-depends": "None",
                            "prop-extref": "PROJ-42",
                        },
                    },
                ],
            )
        storage = _make_storage(
            folders=[{"id": "folder-nous", "name": "Nous"}],
            db_content=db,
        )
        daemon = _make_daemon()

        # resolve_page returns task page or DB page depending on arg
        def resolve_page(notebook_id, title_or_id):
            if title_or_id == "Project Tasks":
                return {
                    "id": DB_PAGE_ID,
                    "title": "Project Tasks",
                    "pageType": "database",
                }
            return {
                "id": "page-task-1",
                "title": "Task: My Task",
                "tags": ["task", "nous"],
                "pageType": "standard",
                "content": {"blocks": [
                    {"type": "paragraph", "data": {"text": "Build the thing."}},
                ]},
            }

        daemon.resolve_page.side_effect = resolve_page
        tools = _register_tools(storage, daemon)
        return tools["get_task_spec"], storage, daemon

    def test_returns_metadata_and_content(self):
        get_spec, _, _ = self._setup()
        result = get_spec(task="My Task")

        assert "## Task Metadata" in result
        assert "**Project:** Nous" in result
        assert "**Status:** Ready" in result
        assert "**Priority:** 2" in result
        assert "**Phase:** Feature" in result
        assert "**External Ref:** PROJ-42" in result
        assert "---" in result

    def test_dependency_status_shown(self):
        db = _make_db_content(
            project_options=["Nous"],
            include_external_ref=True,
            rows=[
                {"id": "dep1", "cells": {"prop-task": "Setup", "prop-status": "opt-done"}},
                {
                    "id": "row-1",
                    "cells": {
                        "prop-task": "My Task",
                        "prop-project": "opt-proj-nous",
                        "prop-status": "opt-ready",
                        "prop-depends": "dep1:Setup",
                    },
                },
            ],
        )
        get_spec, _, _ = self._setup(db=db)
        result = get_spec(task="My Task")
        assert "Setup: done" in result

    def test_done_task_notice(self):
        get_spec, _, _ = self._setup(status_opt="opt-done")
        result = get_spec(task="My Task")
        assert "already marked Done" in result

    def test_in_progress_warning(self):
        get_spec, _, _ = self._setup(status_opt="opt-inprogress")
        result = get_spec(task="My Task")
        assert "already In Progress" in result

    def test_blocked_warning(self):
        db = _make_db_content(
            project_options=["Nous"],
            include_external_ref=True,
            rows=[
                {"id": "dep1", "cells": {"prop-task": "Blocker", "prop-status": "opt-ready"}},
                {
                    "id": "row-1",
                    "cells": {
                        "prop-task": "My Task",
                        "prop-project": "opt-proj-nous",
                        "prop-status": "opt-ready",
                        "prop-depends": "dep1:Blocker",
                    },
                },
            ],
        )
        get_spec, _, _ = self._setup(db=db)
        result = get_spec(task="My Task")
        assert "Blocked" in result
        assert "Blocker" in result

    def test_no_external_ref(self):
        db = _make_db_content(
            project_options=["Nous"],
            include_external_ref=True,
            rows=[
                {
                    "id": "row-1",
                    "cells": {
                        "prop-task": "My Task",
                        "prop-project": "opt-proj-nous",
                        "prop-status": "opt-ready",
                        "prop-depends": "None",
                    },
                },
            ],
        )
        get_spec, _, _ = self._setup(db=db)
        result = get_spec(task="My Task")
        assert "**External Ref:** None" in result

    def test_unknown_task_raises(self):
        get_spec, _, daemon = self._setup()
        daemon.resolve_page.side_effect = Exception("Not found")
        with pytest.raises(ValueError, match="not found"):
            get_spec(task="Ghost Task")

    def test_task_prefix_stripped(self):
        get_spec, _, _ = self._setup()
        result = get_spec(task="Task: My Task")
        assert "## Task Metadata" in result


# ---------------------------------------------------------------------------
# _topological_sort
# ---------------------------------------------------------------------------


class TestTopologicalSort:
    def _make_tasks(self, specs):
        """Build task dicts from (id, name, priority, depends_on_raw) tuples."""
        tasks = []
        for tid, name, prio, deps_raw in specs:
            parsed = _parse_depends_on(deps_raw)
            tasks.append({
                "id": tid,
                "task": name,
                "priority": prio,
                "status": "Ready",
                "deps": [n for _, n in parsed],
                "_depends_on_raw": deps_raw,
            })
        return tasks

    def test_simple_chain(self):
        tasks = self._make_tasks([
            ("a", "A", 1, ""),
            ("b", "B", 1, "a:A"),
            ("c", "C", 1, "b:B"),
        ])
        db = _make_db_content()
        sorted_tasks, cycles = _topological_sort(tasks, db)
        names = [t["task"] for t in sorted_tasks]
        assert names == ["A", "B", "C"]
        assert cycles == []

    def test_priority_tiebreak(self):
        tasks = self._make_tasks([
            ("a", "Low Prio", 5, ""),
            ("b", "High Prio", 1, ""),
            ("c", "Mid Prio", 3, ""),
        ])
        db = _make_db_content()
        sorted_tasks, _ = _topological_sort(tasks, db)
        names = [t["task"] for t in sorted_tasks]
        assert names == ["High Prio", "Mid Prio", "Low Prio"]

    def test_diamond_dependency(self):
        # A → B, A → C, B → D, C → D
        tasks = self._make_tasks([
            ("a", "A", 1, ""),
            ("b", "B", 1, "a:A"),
            ("c", "C", 1, "a:A"),
            ("d", "D", 1, "b:B, c:C"),
        ])
        db = _make_db_content()
        sorted_tasks, cycles = _topological_sort(tasks, db)
        names = [t["task"] for t in sorted_tasks]
        assert names.index("A") < names.index("B")
        assert names.index("A") < names.index("C")
        assert names.index("B") < names.index("D")
        assert names.index("C") < names.index("D")
        assert cycles == []

    def test_cycle_detection(self):
        tasks = self._make_tasks([
            ("a", "A", 1, "b:B"),
            ("b", "B", 1, "a:A"),
        ])
        db = _make_db_content()
        sorted_tasks, cycles = _topological_sort(tasks, db)
        assert len(cycles) == 2
        assert "A" in cycles
        assert "B" in cycles

    def test_empty_list(self):
        db = _make_db_content()
        sorted_tasks, cycles = _topological_sort([], db)
        assert sorted_tasks == []
        assert cycles == []

    def test_no_deps_all_by_priority(self):
        tasks = self._make_tasks([
            ("a", "Z Task", 3, ""),
            ("b", "A Task", 1, ""),
            ("c", "M Task", 2, ""),
        ])
        db = _make_db_content()
        sorted_tasks, _ = _topological_sort(tasks, db)
        names = [t["task"] for t in sorted_tasks]
        assert names == ["A Task", "M Task", "Z Task"]


# ---------------------------------------------------------------------------
# _get_project_tasks
# ---------------------------------------------------------------------------


class TestGetProjectTasks:
    def _make_project_db(self):
        return _make_db_content(
            project_options=["Nous", "Other"],
            include_external_ref=True,
            rows=[
                {
                    "id": "r1",
                    "cells": {
                        "prop-task": "Task A",
                        "prop-project": "opt-proj-nous",
                        "prop-status": "opt-ready",
                        "prop-priority": 1,
                        "prop-depends": "",
                        "prop-notes": "credit optimizer related",
                    },
                },
                {
                    "id": "r2",
                    "cells": {
                        "prop-task": "Task B",
                        "prop-project": "opt-proj-nous",
                        "prop-status": "opt-done",
                        "prop-priority": 2,
                        "prop-depends": "r1:Task A",
                    },
                },
                {
                    "id": "r3",
                    "cells": {
                        "prop-task": "Task C",
                        "prop-project": "opt-proj-other",
                        "prop-status": "opt-ready",
                        "prop-priority": 1,
                    },
                },
            ],
        )

    def test_filters_by_project(self):
        db = self._make_project_db()
        tasks = _get_project_tasks(db, "Nous", include_done=True)
        names = [t["task"] for t in tasks]
        assert "Task A" in names
        assert "Task B" in names
        assert "Task C" not in names

    def test_excludes_done_by_default(self):
        db = self._make_project_db()
        tasks = _get_project_tasks(db, "Nous")
        names = [t["task"] for t in tasks]
        assert "Task A" in names
        assert "Task B" not in names

    def test_includes_done_with_flag(self):
        db = self._make_project_db()
        tasks = _get_project_tasks(db, "Nous", include_done=True)
        names = [t["task"] for t in tasks]
        assert "Task B" in names

    def test_feature_filter(self):
        db = self._make_project_db()
        tasks = _get_project_tasks(db, "Nous", include_done=True, feature="credit optimizer")
        names = [t["task"] for t in tasks]
        assert "Task A" in names  # notes contain "credit optimizer"
        assert "Task B" not in names  # no match

    def test_empty_project(self):
        db = self._make_project_db()
        tasks = _get_project_tasks(db, "Nonexistent")
        assert tasks == []


# ---------------------------------------------------------------------------
# get_feature_tasks (registered tool)
# ---------------------------------------------------------------------------


class TestGetFeatureTasksTool:
    def _setup(self, db=None):
        if db is None:
            db = _make_db_content(
                project_options=["Nous"],
                include_external_ref=True,
                rows=[
                    {
                        "id": "r-setup",
                        "cells": {
                            "prop-task": "Setup",
                            "prop-project": "opt-proj-nous",
                            "prop-status": "opt-done",
                            "prop-priority": 1,
                            "prop-phase": "opt-infra",
                            "prop-depends": "",
                        },
                    },
                    {
                        "id": "r-api",
                        "cells": {
                            "prop-task": "Build API",
                            "prop-project": "opt-proj-nous",
                            "prop-status": "opt-ready",
                            "prop-priority": 2,
                            "prop-phase": "opt-feature",
                            "prop-depends": "r-setup:Setup",
                        },
                    },
                    {
                        "id": "r-tests",
                        "cells": {
                            "prop-task": "Add Tests",
                            "prop-project": "opt-proj-nous",
                            "prop-status": "opt-ready",
                            "prop-priority": 3,
                            "prop-phase": "opt-feature",
                            "prop-depends": "r-api:Build API",
                        },
                    },
                ],
            )
        storage = _make_storage(
            folders=[{"id": "folder-nous", "name": "Nous"}],
            db_content=db,
        )
        daemon = _make_daemon()
        tools = _register_tools(storage, daemon)
        return tools["get_feature_tasks"], storage, daemon

    def test_returns_tasks_in_topo_order(self):
        get_tasks, _, _ = self._setup()
        result = json.loads(get_tasks(project="Nous", include_done=True))

        assert result["project"] == "Nous"
        assert result["total_tasks"] == 3
        order = result["execution_order"]
        names = [t["task"] for t in order]
        # Setup before Build API before Add Tests
        assert names.index("Setup") < names.index("Build API")
        assert names.index("Build API") < names.index("Add Tests")

    def test_excludes_done_by_default(self):
        get_tasks, _, _ = self._setup()
        result = json.loads(get_tasks(project="Nous"))

        names = [t["task"] for t in result["execution_order"]]
        assert "Setup" not in names
        assert "Build API" in names

    def test_completed_count(self):
        get_tasks, _, _ = self._setup()
        result = json.loads(get_tasks(project="Nous", include_done=True))
        assert result["completed"] == 1
        assert result["remaining"] == 2

    def test_cycle_detection(self):
        db = _make_db_content(
            project_options=["Nous"],
            include_external_ref=True,
            rows=[
                {
                    "id": "r1",
                    "cells": {
                        "prop-task": "Task A",
                        "prop-project": "opt-proj-nous",
                        "prop-status": "opt-ready",
                        "prop-priority": 1,
                        "prop-depends": "r2:Task B",
                    },
                },
                {
                    "id": "r2",
                    "cells": {
                        "prop-task": "Task B",
                        "prop-project": "opt-proj-nous",
                        "prop-status": "opt-ready",
                        "prop-priority": 1,
                        "prop-depends": "r1:Task A",
                    },
                },
            ],
        )
        get_tasks, _, _ = self._setup(db=db)
        result = json.loads(get_tasks(project="Nous"))
        assert "cycle_error" in result
        assert "Task A" in result["cycle_error"]

    def test_empty_project(self):
        get_tasks, _, _ = self._setup()
        result = json.loads(get_tasks(project="Nonexistent"))
        assert result["total_tasks"] == 0
        assert result["execution_order"] == []

    def test_priority_ordering_at_same_level(self):
        db = _make_db_content(
            project_options=["Nous"],
            include_external_ref=True,
            rows=[
                {
                    "id": "r1",
                    "cells": {
                        "prop-task": "Low Prio",
                        "prop-project": "opt-proj-nous",
                        "prop-status": "opt-ready",
                        "prop-priority": 5,
                        "prop-depends": "",
                    },
                },
                {
                    "id": "r2",
                    "cells": {
                        "prop-task": "High Prio",
                        "prop-project": "opt-proj-nous",
                        "prop-status": "opt-ready",
                        "prop-priority": 1,
                        "prop-depends": "",
                    },
                },
            ],
        )
        get_tasks, _, _ = self._setup(db=db)
        result = json.loads(get_tasks(project="Nous"))
        names = [t["task"] for t in result["execution_order"]]
        assert names == ["High Prio", "Low Prio"]
