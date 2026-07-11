"""Tests for nous_mcp.workflow module."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from nous_mcp.daemon_client import DaemonError
from nous_mcp.workflow import (
    ALL_STATUS_TAGS,
    REQUIRED_COLUMNS,
    _check_dependency_status,
    _detect_fragmentation,
    _ensure_database_column,
    _ensure_schema,
    _ensure_select_option,
    _find_task_row,
    _find_task_rows,
    _fire_webhook,
    _format_task_content,
    _get_project_tasks,
    _get_row_status,
    _migrate_dependencies,
    _parse_depends_on,
    _raw_dep_entry,
    _resolve_dep_ref,
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


def _complete_required_schema(db: dict) -> None:
    """Append any missing REQUIRED_COLUMNS so _ensure_schema is a no-op."""
    existing = {p["name"].lower() for p in db["properties"]}
    for name, ctype, options in REQUIRED_COLUMNS:
        if name.lower() in existing:
            continue
        prop: dict = {
            "id": f"prop-{name.lower().replace(' ', '-')}",
            "name": name,
            "type": ctype,
        }
        if options:
            prop["options"] = [
                {"id": f"opt-{o.lower()}", "label": o, "color": "#888888"}
                for o in options
            ]
        db["properties"].append(prop)


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
        _complete_required_schema(db)
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
        # Schema already fully up to date
        _complete_required_schema(db)
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


DEP_ROW_ID = "dddddddd-1111-4111-8111-000000000001"
DEP_ROW_ID2 = "dddddddd-1111-4111-8111-000000000002"


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
                "id": DEP_ROW_ID,
                "cells": {
                    "prop-task": "Prerequisite",
                    "prop-status": status_opt["id"],
                },
            },
        ]
        return db

    def test_all_satisfied_when_deps_done(self):
        db = self._make_db_with_deps("Done")
        result = _check_dependency_status(db, f"{DEP_ROW_ID}:Prerequisite")
        assert result == "all satisfied"

    def test_warning_when_dep_not_done(self):
        db = self._make_db_with_deps("Ready")
        result = _check_dependency_status(db, f"{DEP_ROW_ID}:Prerequisite")
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
                    "id": DEP_ROW_ID,
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
                        "prop-depends": f"{DEP_ROW_ID}:Prerequisite",
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

        def resolver(notebook_id, title_or_id):
            if title_or_id == "Project Tasks":
                return {
                    "id": DB_PAGE_ID,
                    "title": "Project Tasks",
                    "pageType": "database",
                }
            raise DaemonError(f"Daemon API error (404): No page matching '{title_or_id}'")

        daemon.resolve_page.side_effect = resolver
        with pytest.raises(ValueError, match="not found"):
            update(task="Ghost Task", status="Done")

    def test_external_ref_updated(self):
        update, storage, daemon = self._setup()
        update(task="My Task", status="In Progress", external_ref="PROJ-456")
        db_update = daemon.update_database_rows.call_args[0][2]
        assert db_update[0]["cells"]["External Ref"] == "PROJ-456"

    def test_priority_updated(self):
        update, storage, daemon = self._setup()
        update(task="My Task", status="Ready", priority=2)
        db_update = daemon.update_database_rows.call_args[0][2]
        assert db_update[0]["cells"]["Priority"] == 2

    def test_priority_untouched_when_omitted(self):
        update, storage, daemon = self._setup()
        update(task="My Task", status="Ready")
        db_update = daemon.update_database_rows.call_args[0][2]
        assert "Priority" not in db_update[0]["cells"]

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


PARSE_UUID_A = "12345678-1234-4123-8123-123456789abc"
PARSE_UUID_B = "87654321-4321-4321-8321-cba987654321"


class TestParseDependsOn:
    def test_uuid_format(self):
        result = _parse_depends_on(f"{PARSE_UUID_A}:Task A, {PARSE_UUID_B}:Task B")
        assert result == [(PARSE_UUID_A, "Task A"), (PARSE_UUID_B, "Task B")]

    def test_free_text(self):
        result = _parse_depends_on("Task A, Task B")
        assert result == [(None, "Task A"), (None, "Task B")]

    def test_mixed_format(self):
        result = _parse_depends_on(f"{PARSE_UUID_A}:Task A, Task B")
        assert result == [(PARSE_UUID_A, "Task A"), (None, "Task B")]

    def test_none_value(self):
        assert _parse_depends_on("None") == []
        assert _parse_depends_on("") == []
        assert _parse_depends_on("  none  ") == []

    def test_single_entry(self):
        result = _parse_depends_on(f"{PARSE_UUID_A}:My Task")
        assert result == [(PARSE_UUID_A, "My Task")]

    def test_ref_entries_kept_whole(self):
        result = _parse_depends_on(f"ref:pipeline:epic:leaf, {PARSE_UUID_A}:Task A")
        assert result == [
            (None, "ref:pipeline:epic:leaf"),
            (PARSE_UUID_A, "Task A"),
        ]

    def test_free_text_with_colon_stays_whole(self):
        # Only a UUID prefix triggers the uuid:Title split — free text
        # containing a colon must survive intact (and round-trip).
        result = _parse_depends_on("External: astro firmware 3.2 release")
        assert result == [(None, "External: astro firmware 3.2 release")]
        assert _raw_dep_entry(*result[0]) == "External: astro firmware 3.2 release"

    def test_non_uuid_colon_prefix_stays_whole(self):
        result = _parse_depends_on("abc-123:Task A")
        assert result == [(None, "abc-123:Task A")]

    def test_uuid_entry_round_trips(self):
        entry = f"{PARSE_UUID_A}:Task A"
        [(uid, name)] = _parse_depends_on(entry)
        assert _raw_dep_entry(uid, name) == entry


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
# Cross-epic / cross-project dependencies
# ---------------------------------------------------------------------------

DEP_ROW_UUID = "aaaaaaaa-0000-4000-8000-000000000001"  # Astra prerequisite
BLOCKED_ROW_UUID = "aaaaaaaa-0000-4000-8000-000000000002"  # Nous task blocked on it
OTHER_ROW_UUID = "aaaaaaaa-0000-4000-8000-000000000003"  # Nous unblocked task
DEP_REF = "pipeline:astra-web-parity:publish-model"


def _make_cross_project_db(dep_status: str = "opt-ready") -> dict:
    """Nous task with a canonical uuid:Title dep on an Astra task."""
    db = _make_db_content(
        project_options=["Nous", "Astra"],
        include_external_ref=True,
        rows=[
            {
                "id": DEP_ROW_UUID,
                "cells": {
                    "prop-task": "Server-side publish model",
                    "prop-project": "opt-proj-astra",
                    "prop-status": dep_status,
                    "prop-priority": 2,
                    "prop-extref": DEP_REF,
                    "prop-depends": "None",
                },
            },
            {
                "id": BLOCKED_ROW_UUID,
                "cells": {
                    "prop-task": "Publish event fan-out",
                    "prop-project": "opt-proj-nous",
                    "prop-status": "opt-ready",
                    "prop-priority": 1,
                    "prop-depends": f"{DEP_ROW_UUID}:Server-side publish model",
                    "prop-execution-mode": "opt-auto-ok",
                },
            },
            {
                "id": OTHER_ROW_UUID,
                "cells": {
                    "prop-task": "Unrelated ready work",
                    "prop-project": "opt-proj-nous",
                    "prop-status": "opt-ready",
                    "prop-priority": 5,
                    "prop-depends": "None",
                    "prop-execution-mode": "opt-auto-ok",
                },
            },
        ],
    )
    _complete_required_schema(db)
    return db


class TestResolveDepRef:
    def test_bare_row_uuid(self):
        db = _make_cross_project_db()
        ref = _resolve_dep_ref(db, DEP_ROW_UUID, "Nous")
        assert ref["row"]["id"] == DEP_ROW_UUID
        assert ref["canonical"] == f"{DEP_ROW_UUID}:Server-side publish model"
        assert ref["warning"] is None

    def test_unknown_row_uuid_warns(self):
        db = _make_cross_project_db()
        ghost = "99999999-9999-4999-8999-999999999999"
        ref = _resolve_dep_ref(db, ghost, "Nous")
        assert ref["row"] is None
        assert ref["canonical"] == ghost
        assert "not found" in ref["warning"]

    def test_uuid_title_refreshes_stale_title(self):
        db = _make_cross_project_db()
        ref = _resolve_dep_ref(db, f"{DEP_ROW_UUID}:Old Stale Title", "Nous")
        assert ref["row"]["id"] == DEP_ROW_UUID
        assert ref["canonical"] == f"{DEP_ROW_UUID}:Server-side publish model"

    def test_external_ref_form(self):
        db = _make_cross_project_db()
        ref = _resolve_dep_ref(db, f"ref:{DEP_REF}", "Nous")
        assert ref["row"]["id"] == DEP_ROW_UUID
        assert ref["canonical"] == f"{DEP_ROW_UUID}:Server-side publish model"

    def test_external_ref_missing_warns(self):
        db = _make_cross_project_db()
        ref = _resolve_dep_ref(db, "ref:pipeline:nope:missing", "Nous")
        assert ref["row"] is None
        assert "matches no External Ref" in ref["warning"]

    def test_title_unique_cross_project_resolves_with_note(self):
        db = _make_cross_project_db()
        ref = _resolve_dep_ref(db, "Server-side publish model", "Nous")
        assert ref["row"]["id"] == DEP_ROW_UUID
        assert "cross-project" in ref["note"]
        assert "Astra" in ref["note"]

    def test_title_prefers_same_project(self):
        db = _make_cross_project_db()
        db["rows"].append(
            {
                "id": "bbbbbbbb-0000-4000-8000-000000000009",
                "cells": {
                    "prop-task": "Server-side publish model",
                    "prop-project": "opt-proj-nous",
                    "prop-status": "opt-ready",
                },
            }
        )
        ref = _resolve_dep_ref(db, "Server-side publish model", "Nous")
        assert ref["row"]["id"] == "bbbbbbbb-0000-4000-8000-000000000009"
        assert ref["warning"] is None

    def test_ambiguous_title_fails_closed(self):
        db = _make_cross_project_db()
        db["rows"].append(
            {
                "id": "bbbbbbbb-0000-4000-8000-000000000009",
                "cells": {
                    "prop-task": "Server-side publish model",
                    "prop-project": "opt-proj-astra",
                    "prop-status": "opt-ready",
                },
            }
        )
        # No same-project match for Nous; two Astra rows share the title.
        ref = _resolve_dep_ref(db, "Server-side publish model", "Nous")
        assert ref["row"] is None
        assert ref["canonical"] == "Server-side publish model"
        assert "ambiguous" in ref["warning"]

    def test_title_containing_colon_resolves_as_title(self):
        db = _make_cross_project_db()
        db["rows"].append(
            {
                "id": "cccccccc-0000-4000-8000-000000000004",
                "cells": {
                    "prop-task": "Tier 4: indent and motions",
                    "prop-project": "opt-proj-nous",
                    "prop-status": "opt-ready",
                },
            }
        )
        ref = _resolve_dep_ref(db, "Tier 4: indent and motions", "Nous")
        assert ref["row"]["id"] == "cccccccc-0000-4000-8000-000000000004"


class TestResolveDepRowRef:
    def test_resolves_by_external_ref(self):
        db = _make_cross_project_db()
        row = _resolve_dep_row(db, None, f"ref:{DEP_REF}")
        assert row["id"] == DEP_ROW_UUID

    def test_ambiguous_external_ref_fails_closed(self):
        db = _make_cross_project_db()
        db["rows"].append(
            {
                "id": "bbbbbbbb-0000-4000-8000-000000000009",
                "cells": {"prop-task": "Copycat", "prop-extref": DEP_REF},
            }
        )
        assert _resolve_dep_row(db, None, f"ref:{DEP_REF}") is None

    def test_missing_external_ref_fails_closed(self):
        db = _make_cross_project_db()
        assert _resolve_dep_row(db, None, "ref:pipeline:nope:missing") is None


class TestCrossProjectBlocking:
    def _setup(self, dep_status: str = "opt-ready"):
        db = _make_cross_project_db(dep_status)
        storage = _make_storage(
            folders=[{"id": "folder-nous", "name": "Nous"}],
            db_content=db,
        )
        daemon = _make_daemon()

        def resolve_page(notebook_id, title_or_id):
            if title_or_id == "Project Tasks":
                return {
                    "id": DB_PAGE_ID,
                    "title": "Project Tasks",
                    "pageType": "database",
                }
            return {
                "id": "page-task-x",
                "title": str(title_or_id),
                "tags": ["task", "nous"],
                "pageType": "standard",
                "content": {"blocks": []},
            }

        daemon.resolve_page.side_effect = resolve_page
        tools = _register_tools(storage, daemon)
        return tools, db, daemon

    def test_unmet_cross_project_dep_blocks(self):
        tools, _, _ = self._setup()
        result = json.loads(tools["query_tasks"](project="Nous", blocked=True))
        names = [t["task"] for t in result["tasks"]]
        assert names == ["Publish event fan-out"]
        assert result["tasks"][0]["blocked_by"] == ["Server-side publish model"]

    def test_blocked_excluded_from_worker_ready(self):
        tools, _, _ = self._setup()
        result = json.loads(tools["query_tasks"](project="Nous", worker_ready=True))
        names = [t["task"] for t in result["tasks"]]
        assert "Publish event fan-out" not in names
        assert "Unrelated ready work" in names

    def test_blocked_excluded_from_get_next_task(self):
        tools, _, _ = self._setup()
        result = tools["get_next_task"](project="Nous")
        # Priority-1 task is blocked cross-project; priority-5 task wins.
        assert "Unrelated ready work" in result

    def test_dep_done_unblocks_without_manual_touch(self):
        tools, _, _ = self._setup(dep_status="opt-done")
        result = json.loads(tools["query_tasks"](project="Nous", worker_ready=True))
        names = [t["task"] for t in result["tasks"]]
        assert "Publish event fan-out" in names

        next_task = tools["get_next_task"](project="Nous")
        assert "Publish event fan-out" in next_task

    def test_check_dependencies_reports_cross_project_dep(self):
        tools, _, _ = self._setup()
        result = json.loads(
            tools["check_dependencies"](task="Publish event fan-out")
        )
        assert result["ready"] is False
        assert result["blocking"] == ["Server-side publish model"]
        dep = result["dependencies"][0]
        assert dep["project"] == "Astra"
        assert dep["status"] == "Ready"

    def test_check_dependencies_ready_after_dep_done(self):
        tools, _, _ = self._setup(dep_status="opt-done")
        result = json.loads(
            tools["check_dependencies"](task="Publish event fan-out")
        )
        assert result["ready"] is True

    def test_create_task_with_cross_project_uuid_dep(self):
        tools, _, daemon = self._setup()
        daemon.create_page.return_value = {"id": "new-page-id"}
        daemon.add_database_rows.return_value = {"rowsAdded": 1}
        result = json.loads(
            tools["create_task"](
                project="Nous",
                title="New downstream work",
                content="Needs the Astra publish model first.",
                depends_on=DEP_ROW_UUID,
            )
        )
        assert result["warnings"] == []
        row_data = daemon.add_database_rows.call_args[0][2][0]
        assert (
            row_data["Depends On"]
            == f"{DEP_ROW_UUID}:Server-side publish model"
        )

    def test_create_task_with_ref_dep(self):
        tools, _, daemon = self._setup()
        daemon.create_page.return_value = {"id": "new-page-id"}
        daemon.add_database_rows.return_value = {"rowsAdded": 1}
        json.loads(
            tools["create_task"](
                project="Nous",
                title="New downstream work",
                content="Needs the Astra publish model first.",
                depends_on=f"ref:{DEP_REF}",
            )
        )
        row_data = daemon.add_database_rows.call_args[0][2][0]
        assert (
            row_data["Depends On"]
            == f"{DEP_ROW_UUID}:Server-side publish model"
        )

    def test_resolve_tasks_mixed_refs(self):
        tools, _, _ = self._setup()
        result = json.loads(
            tools["resolve_tasks"](
                refs=f"{DEP_ROW_UUID}, ref:{DEP_REF}, Unrelated ready work, Ghost",
                project="Nous",
            )
        )
        assert result["resolved_all"] is False
        by_ref = {r["ref"]: r for r in result["results"]}

        assert by_ref[DEP_ROW_UUID]["resolved"] is True
        assert by_ref[DEP_ROW_UUID]["project"] == "Astra"
        assert (
            by_ref[DEP_ROW_UUID]["canonical"]
            == f"{DEP_ROW_UUID}:Server-side publish model"
        )

        assert by_ref[f"ref:{DEP_REF}"]["resolved"] is True
        assert by_ref[f"ref:{DEP_REF}"]["row_id"] == DEP_ROW_UUID

        assert by_ref["Unrelated ready work"]["resolved"] is True
        assert by_ref["Unrelated ready work"]["project"] == "Nous"

        assert by_ref["Ghost"]["resolved"] is False
        assert "not found" in by_ref["Ghost"]["warning"]

    def test_unresolvable_entry_blocks_fail_closed(self):
        tools, db, _ = self._setup()
        # Give the otherwise-unblocked task a dep that matches nothing.
        dep_prop = next(
            p for p in db["properties"] if p["name"].lower() == "depends on"
        )
        other = next(r for r in db["rows"] if r["id"] == OTHER_ROW_UUID)
        other["cells"][dep_prop["id"]] = "Ghost external prerequisite (firmware 3.2)"

        result = json.loads(tools["query_tasks"](project="Nous", blocked=True))
        by_name = {t["task"]: t for t in result["tasks"]}
        assert "Unrelated ready work" in by_name
        assert by_name["Unrelated ready work"]["blocked_by"] == [
            "Ghost external prerequisite (firmware 3.2)"
        ]

        ready = json.loads(tools["query_tasks"](project="Nous", worker_ready=True))
        assert all(t["task"] != "Unrelated ready work" for t in ready["tasks"])

    def test_dead_uuid_entry_surfaces_raw_entry(self):
        tools, db, _ = self._setup()
        dep_prop = next(
            p for p in db["properties"] if p["name"].lower() == "depends on"
        )
        dead = "99999999-9999-4999-8999-999999999999:Retired old task"
        other = next(r for r in db["rows"] if r["id"] == OTHER_ROW_UUID)
        other["cells"][dep_prop["id"]] = dead

        result = json.loads(
            tools["check_dependencies"](task="Unrelated ready work")
        )
        assert result["ready"] is False
        assert result["blocking"] == [dead]
        assert result["unresolved"] == [dead]
        assert result["dependencies"][0]["status"] == "Not Found"
        assert result["dependencies"][0]["resolved"] is False

    def test_unmet_vs_unresolved_distinguished(self):
        tools, db, _ = self._setup()
        dep_prop = next(
            p for p in db["properties"] if p["name"].lower() == "depends on"
        )
        blocked = next(r for r in db["rows"] if r["id"] == BLOCKED_ROW_UUID)
        blocked["cells"][dep_prop["id"]] = (
            f"{DEP_ROW_UUID}:Server-side publish model, Ghost prerequisite"
        )

        result = json.loads(
            tools["check_dependencies"](task="Publish event fan-out")
        )
        # Both block, only the ghost is unresolved.
        assert set(result["blocking"]) == {
            "Server-side publish model",
            "Ghost prerequisite",
        }
        assert result["unresolved"] == ["Ghost prerequisite"]
        known = next(
            d for d in result["dependencies"]
            if d["task"] == "Server-side publish model"
        )
        assert known["status"] == "Ready"
        assert "resolved" not in known or known.get("resolved") is not False

    def test_resolve_tasks_flags_ambiguity(self):
        tools, db, _ = self._setup()
        db["rows"].append(
            {
                "id": "bbbbbbbb-0000-4000-8000-000000000009",
                "cells": {
                    "prop-task": "Server-side publish model",
                    "prop-project": "opt-proj-astra",
                    "prop-status": "opt-ready",
                },
            }
        )
        result = json.loads(
            tools["resolve_tasks"](refs="Server-side publish model", project="Nous")
        )
        assert result["resolved_all"] is False
        assert "ambiguous" in result["results"][0]["warning"]


# ---------------------------------------------------------------------------
# Archive workflow
# ---------------------------------------------------------------------------

ARCHIVE_PAGE_ID = "db-archive-001"
ARCHIVED_ROW_UUID = "dddddddd-0000-4000-8000-000000000007"


def _make_archive_content(base_db: dict) -> dict:
    """Archive db holding one Done row, mirroring the active properties."""
    return {
        "version": 2,
        "properties": base_db["properties"],
        "rows": [
            {
                "id": ARCHIVED_ROW_UUID,
                "cells": {
                    "prop-task": "Ancient shipped work",
                    "prop-project": "opt-proj-astra",
                    "prop-status": "opt-done",
                    "prop-extref": "pipeline:old:ancient-shipped-work",
                    "prop-completed": "2026-01-15",
                    "prop-depends": "None",
                },
            },
        ],
        "views": [],
    }


class TestArchiveWorkflow:
    def _setup(self, with_archive: bool = True, extra_active_rows: list | None = None):
        db = _make_cross_project_db()
        # Completed column + a stale Done row in the active db
        db["properties"].append(
            {"id": "prop-completed", "name": "Completed", "type": "date"}
        )
        db["rows"].append(
            {
                "id": "eeeeeeee-0000-4000-8000-000000000008",
                "cells": {
                    "prop-task": "Old done thing",
                    "prop-project": "opt-proj-nous",
                    "prop-status": "opt-done",
                    "prop-completed": "2026-02-01",
                    "prop-depends": "None",
                },
            }
        )
        for r in extra_active_rows or []:
            db["rows"].append(r)

        archive = _make_archive_content(db) if with_archive else None

        storage = _make_storage(
            folders=[{"id": "folder-nous", "name": "Nous"}],
            db_content=db,
        )

        def read_db(notebook_id, page_id):
            if page_id == DB_PAGE_ID:
                return db
            if archive is not None and page_id == ARCHIVE_PAGE_ID:
                return archive
            return None

        storage.read_database_content.side_effect = read_db
        daemon = _make_daemon()

        def resolve_page(notebook_id, title_or_id):
            if title_or_id in ("Project Tasks", DB_PAGE_ID):
                return {
                    "id": DB_PAGE_ID,
                    "title": "Project Tasks",
                    "pageType": "database",
                    "folderId": "folder-forge",
                }
            if with_archive and title_or_id in (
                "Project Tasks Archive",
                ARCHIVE_PAGE_ID,
            ):
                return {
                    "id": ARCHIVE_PAGE_ID,
                    "title": "Project Tasks Archive",
                    "pageType": "database",
                }
            if title_or_id == "Project Tasks Archive":
                raise DaemonError(
                    "Daemon API error (404): No page matching 'Project Tasks Archive'"
                )
            return {
                "id": "page-task-x",
                "title": str(title_or_id),
                "tags": ["task", "nous"],
                "pageType": "standard",
                "content": {"blocks": []},
            }

        daemon.resolve_page.side_effect = resolve_page
        daemon.update_database_rows.return_value = {"rowsUpdated": 1}
        daemon.delete_database_rows.return_value = {"rowsDeleted": 1}
        daemon.create_database.return_value = {"id": ARCHIVE_PAGE_ID}
        tools = _register_tools(storage, daemon)
        return tools, db, archive, storage, daemon

    # --- archive_tasks tool ---

    def test_dry_run_reports_candidates_only(self):
        tools, _, _, storage, daemon = self._setup()
        result = json.loads(tools["archive_tasks"](before="2026-06-01"))
        assert result["dry_run"] is True
        assert result["moved"] == 0
        names = [c["task"] for c in result["candidates"]]
        assert names == ["Old done thing"]
        storage.write_database_content.assert_not_called()
        daemon.delete_database_rows.assert_not_called()

    def test_cutoff_excludes_recent_done(self):
        tools, _, _, _, _ = self._setup()
        result = json.loads(tools["archive_tasks"](before="2026-01-01"))
        assert result["candidates"] == []

    def test_real_run_moves_rows(self):
        tools, db, archive, storage, daemon = self._setup()
        result = json.loads(
            tools["archive_tasks"](before="2026-06-01", dry_run=False)
        )
        assert result["moved"] == 1

        # Archive written first, with active's properties verbatim
        write_call = storage.write_database_content.call_args
        assert write_call[0][1] == ARCHIVE_PAGE_ID
        written = write_call[0][2]
        assert written["properties"] is db["properties"]
        written_ids = {r["id"] for r in written["rows"]}
        assert ARCHIVED_ROW_UUID in written_ids  # pre-existing kept
        assert "eeeeeeee-0000-4000-8000-000000000008" in written_ids

        # Then deleted from active
        del_call = daemon.delete_database_rows.call_args
        assert del_call[0][2] == ["eeeeeeee-0000-4000-8000-000000000008"]

    def test_idempotent_when_row_already_archived(self):
        tools, db, archive, storage, daemon = self._setup()
        # Simulate a crash after archive write, before active delete.
        archive["rows"].append(
            next(
                r for r in db["rows"]
                if r["id"] == "eeeeeeee-0000-4000-8000-000000000008"
            )
        )
        result = json.loads(
            tools["archive_tasks"](before="2026-06-01", dry_run=False)
        )
        assert result["already_archived"] == 1
        written = storage.write_database_content.call_args[0][2]
        ids = [r["id"] for r in written["rows"]]
        assert ids.count("eeeeeeee-0000-4000-8000-000000000008") == 1

    def test_creates_archive_db_when_missing(self):
        tools, _, _, storage, daemon = self._setup(with_archive=False)
        result = json.loads(
            tools["archive_tasks"](before="2026-06-01", dry_run=False)
        )
        assert result["moved"] == 1
        daemon.create_database.assert_called_once()
        assert daemon.create_database.call_args[0][1] == "Project Tasks Archive"

    # --- read-path fallbacks ---

    def test_dep_on_archived_row_is_satisfied(self):
        extra = [
            {
                "id": "ffffffff-0000-4000-8000-000000000010",
                "cells": {
                    "prop-task": "Successor work",
                    "prop-project": "opt-proj-nous",
                    "prop-status": "opt-ready",
                    "prop-depends": f"{ARCHIVED_ROW_UUID}:Ancient shipped work",
                    "prop-execution-mode": "opt-auto-ok",
                },
            }
        ]
        tools, _, _, _, _ = self._setup(extra_active_rows=extra)

        res = json.loads(tools["check_dependencies"](task="Successor work"))
        assert res["ready"] is True
        dep = res["dependencies"][0]
        assert dep["status"] == "Done (archived)"
        assert dep["satisfied"] is True
        assert dep["archived"] is True

        ready = json.loads(tools["query_tasks"](project="Nous", worker_ready=True))
        assert any(t["task"] == "Successor work" for t in ready["tasks"])

    def test_missing_dep_still_blocks_with_archive_present(self):
        extra = [
            {
                "id": "ffffffff-0000-4000-8000-000000000010",
                "cells": {
                    "prop-task": "Successor work",
                    "prop-project": "opt-proj-nous",
                    "prop-status": "opt-ready",
                    "prop-depends": "Truly ghost prerequisite",
                    "prop-execution-mode": "opt-auto-ok",
                },
            }
        ]
        tools, _, _, _, _ = self._setup(extra_active_rows=extra)
        res = json.loads(tools["check_dependencies"](task="Successor work"))
        assert res["ready"] is False
        assert res["unresolved"] == ["Truly ghost prerequisite"]

    def test_resolve_tasks_resolves_archived(self):
        tools, _, _, _, _ = self._setup()
        res = json.loads(
            tools["resolve_tasks"](refs="ref:pipeline:old:ancient-shipped-work")
        )
        assert res["resolved_all"] is True
        entry = res["results"][0]
        assert entry["archived"] is True
        assert entry["row_id"] == ARCHIVED_ROW_UUID
        assert entry["status"] == "Done"

    def test_query_tasks_include_archived(self):
        tools, _, _, _, _ = self._setup()
        default = json.loads(
            tools["query_tasks"](project="Astra", status="Done", limit=0)
        )
        assert all(t["task"] != "Ancient shipped work" for t in default["tasks"])

        merged = json.loads(
            tools["query_tasks"](
                project="Astra", status="Done", include_archived=True, limit=0
            )
        )
        arch = [t for t in merged["tasks"] if t.get("archived")]
        assert [t["task"] for t in arch] == ["Ancient shipped work"]

    def test_get_task_spec_archive_fallback(self):
        tools, _, _, _, _ = self._setup()
        spec = tools["get_task_spec"](task="Ancient shipped work")
        assert "**Archived:** Yes" in spec
        assert f"**Row ID:** {ARCHIVED_ROW_UUID}" in spec
        assert "**Project:** Astra" in spec
        assert "**Status:** Done" in spec


class TestQueryTasksSearch:
    def _setup(self):
        db = _make_cross_project_db()
        # A Done row to exercise search-includes-Done
        db["rows"].append(
            {
                "id": "eeeeeeee-0000-4000-8000-000000000008",
                "cells": {
                    "prop-task": "Dependabot vulnerability triage",
                    "prop-project": "opt-proj-nous",
                    "prop-status": "opt-done",
                    "prop-notes": "Sweep the 249 GitHub alerts",
                    "prop-depends": "None",
                },
            }
        )
        storage = _make_storage(
            folders=[{"id": "folder-nous", "name": "Nous"}],
            db_content=db,
        )
        daemon = _make_daemon()

        def resolve_page(notebook_id, title_or_id):
            if title_or_id == "Project Tasks":
                return {
                    "id": DB_PAGE_ID,
                    "title": "Project Tasks",
                    "pageType": "database",
                }
            raise DaemonError(
                f"Daemon API error (404): No page matching '{title_or_id}'"
            )

        daemon.resolve_page.side_effect = resolve_page
        tools = _register_tools(storage, daemon)
        return tools["query_tasks"]

    def test_title_substring_case_insensitive(self):
        query = self._setup()
        result = json.loads(query(search="PUBLISH"))
        names = [t["task"] for t in result["tasks"]]
        assert names == ["Server-side publish model", "Publish event fan-out"]

    def test_multi_term_and_semantics(self):
        query = self._setup()
        result = json.loads(query(search="publish fan-out"))
        names = [t["task"] for t in result["tasks"]]
        assert names == ["Publish event fan-out"]

    def test_matches_notes_cell(self):
        query = self._setup()
        result = json.loads(query(search="github alerts"))
        names = [t["task"] for t in result["tasks"]]
        assert names == ["Dependabot vulnerability triage"]

    def test_search_includes_done_by_default(self):
        query = self._setup()
        result = json.loads(query(search="dependabot"))
        assert [t["task"] for t in result["tasks"]] == [
            "Dependabot vulnerability triage"
        ]
        # Status filter still narrows
        narrowed = json.loads(query(search="dependabot", status="Ready"))
        assert narrowed["tasks"] == []

    def test_composes_with_project_filter(self):
        query = self._setup()
        result = json.loads(query(search="publish", project="Astra"))
        names = [t["task"] for t in result["tasks"]]
        assert names == ["Server-side publish model"]

    def test_no_match_returns_empty_not_everything(self):
        query = self._setup()
        result = json.loads(query(search="zzz-nonexistent-keyword"))
        assert result["total"] == 0


# ---------------------------------------------------------------------------
# update_task_fields (registered tool)
# ---------------------------------------------------------------------------


class TestUpdateTaskFields:
    def _setup(self):
        db = _make_cross_project_db()
        storage = _make_storage(
            folders=[{"id": "folder-nous", "name": "Nous"}],
            db_content=db,
        )
        daemon = _make_daemon()

        def resolve_page(notebook_id, title_or_id):
            if title_or_id == "Project Tasks":
                return {
                    "id": DB_PAGE_ID,
                    "title": "Project Tasks",
                    "pageType": "database",
                }
            return {
                "id": "page-task-x",
                "title": str(title_or_id),
                "tags": ["task", "nous"],
                "pageType": "standard",
                "content": {"blocks": []},
            }

        daemon.resolve_page.side_effect = resolve_page
        daemon.update_database_rows.return_value = {"rowsUpdated": 1}
        tools = _register_tools(storage, daemon)
        return tools["update_task_fields"], db, daemon

    def _sent_cells(self, daemon):
        return daemon.update_database_rows.call_args[0][2][0]["cells"]

    def test_set_feature(self):
        update, _, daemon = self._setup()
        result = json.loads(
            update(task="Publish event fan-out", feature="Social features")
        )
        assert result["updated"]["feature"] == "Social features"
        assert self._sent_cells(daemon)["Feature"] == "Social features"

    def test_clear_feature_with_empty_string(self):
        update, _, daemon = self._setup()
        result = json.loads(update(task="Publish event fan-out", feature=""))
        assert result["updated"]["feature"] is None
        assert self._sent_cells(daemon)["Feature"] == ""

    def test_set_phase_case_insensitive(self):
        update, _, daemon = self._setup()
        result = json.loads(
            update(task="Publish event fan-out", phase="infrastructure")
        )
        assert result["updated"]["phase"] == "Infrastructure"
        assert self._sent_cells(daemon)["Phase"] == "Infrastructure"

    def test_invalid_phase_lists_options(self):
        update, _, _ = self._setup()
        with pytest.raises(ValueError, match="Valid phases: .*Feature"):
            update(task="Publish event fan-out", phase="Nonsense")

    def test_add_dep_by_title(self):
        update, _, daemon = self._setup()
        result = json.loads(
            update(
                task="Unrelated ready work",
                depends_on_add=["Publish event fan-out"],
                project="Nous",
            )
        )
        expected = f"{BLOCKED_ROW_UUID}:Publish event fan-out"
        assert result["updated"]["depends_on"] == expected
        assert self._sent_cells(daemon)["Depends On"] == expected

    def test_add_dep_by_uuid_preserves_existing(self):
        update, _, daemon = self._setup()
        result = json.loads(
            update(
                task="Publish event fan-out",
                depends_on_add=[OTHER_ROW_UUID],
            )
        )
        value = result["updated"]["depends_on"]
        assert value == (
            f"{DEP_ROW_UUID}:Server-side publish model, "
            f"{OTHER_ROW_UUID}:Unrelated ready work"
        )

    def test_add_already_present_is_noop_warning(self):
        update, _, _ = self._setup()
        result = json.loads(
            update(
                task="Publish event fan-out",
                depends_on_add=["Server-side publish model"],
            )
        )
        assert any("already present" in w for w in result["warnings"])
        assert result["updated"]["depends_on"].count(DEP_ROW_UUID) == 1

    def test_add_comma_entry_rejected(self):
        update, _, _ = self._setup()
        with pytest.raises(ValueError, match="contains a comma"):
            update(
                task="Publish event fan-out",
                depends_on_add=["Task A, Task B"],
            )

    def test_remove_dep_by_title(self):
        update, _, daemon = self._setup()
        result = json.loads(
            update(
                task="Publish event fan-out",
                depends_on_remove=["Server-side publish model"],
            )
        )
        assert result["updated"]["depends_on"] == "None"
        assert self._sent_cells(daemon)["Depends On"] == "None"

    def test_remove_dep_by_uuid(self):
        update, _, _ = self._setup()
        result = json.loads(
            update(
                task="Publish event fan-out",
                depends_on_remove=[DEP_ROW_UUID],
            )
        )
        assert result["updated"]["depends_on"] == "None"

    def test_remove_not_present_is_noop_warning(self):
        update, _, _ = self._setup()
        result = json.loads(
            update(
                task="Publish event fan-out",
                depends_on_remove=["Ghost dependency"],
            )
        )
        assert any("no-op" in w for w in result["warnings"])
        assert DEP_ROW_UUID in result["updated"]["depends_on"]

    def test_nothing_to_update_raises(self):
        update, _, _ = self._setup()
        with pytest.raises(ValueError, match="Nothing to update"):
            update(task="Publish event fan-out")

    def test_status_and_tags_untouched(self):
        update, _, daemon = self._setup()
        update(task="Publish event fan-out", feature="X")
        assert "Status" not in self._sent_cells(daemon)
        daemon.update_page.assert_not_called()
        daemon.append_to_page.assert_not_called()

    def test_comma_title_sanitized_in_canonical(self):
        db = _make_cross_project_db()
        db["rows"].append(
            {
                "id": "cccccccc-0000-4000-8000-000000000004",
                "cells": {
                    "prop-task": "Tier 4: indent, blockwise visual, motions",
                    "prop-project": "opt-proj-nous",
                    "prop-status": "opt-ready",
                },
            }
        )
        ref = _resolve_dep_ref(
            db, "cccccccc-0000-4000-8000-000000000004", "Nous"
        )
        assert ref["canonical"] == (
            "cccccccc-0000-4000-8000-000000000004:"
            "Tier 4: indent; blockwise visual; motions"
        )


# ---------------------------------------------------------------------------
# _migrate_dependencies
# ---------------------------------------------------------------------------


MIG_SETUP_ID = "eeeeeeee-0000-4000-8000-000000000001"
MIG_API_ID = "eeeeeeee-0000-4000-8000-000000000002"


class TestMigrateDependencies:
    def _make_db_for_migration(self):
        return _make_db_content(
            project_options=["Nous"],
            rows=[
                {
                    "id": MIG_SETUP_ID,
                    "cells": {"prop-task": "Setup database", "prop-depends": ""},
                },
                {
                    "id": MIG_API_ID,
                    "cells": {"prop-task": "Add API", "prop-depends": "Setup database"},
                },
                {
                    "id": "r-tests",
                    "cells": {
                        "prop-task": "Add tests",
                        "prop-depends": "Setup database, Add API",
                    },
                },
                {
                    "id": "r-already",
                    "cells": {
                        "prop-task": "Deploy",
                        "prop-depends": f"{MIG_API_ID}:Add API",
                    },
                },
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
        assert f"{MIG_SETUP_ID}:Setup database" == api_row["cells"]["prop-depends"]

        tests_row = db["rows"][2]
        assert f"{MIG_SETUP_ID}:Setup database" in tests_row["cells"]["prop-depends"]
        assert f"{MIG_API_ID}:Add API" in tests_row["cells"]["prop-depends"]

    def test_already_uuid_format_unchanged(self):
        db = self._make_db_for_migration()
        storage = _make_storage(db_content=db)
        result = _migrate_dependencies(storage, NOTEBOOK_ID, DB_PAGE_ID)

        # Deploy row already had UUID format — should not be in migrated count
        deploy_row = db["rows"][3]
        assert deploy_row["cells"]["prop-depends"] == f"{MIG_API_ID}:Add API"

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
                        "id": DEP_ROW_ID,
                        "cells": {
                            "prop-task": "Prerequisite Done",
                            "prop-status": "opt-done",
                        },
                    },
                    {
                        "id": DEP_ROW_ID2,
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
                            "prop-depends": (
                                f"{DEP_ROW_ID}:Prerequisite Done, "
                                f"{DEP_ROW_ID2}:Prerequisite Ready"
                            ),
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
                {"id": DEP_ROW_ID, "cells": {"prop-task": "Dep A", "prop-status": "opt-done"}},
                {
                    "id": "row-main",
                    "cells": {
                        "prop-task": "Main Task",
                        "prop-status": "opt-ready",
                        "prop-depends": f"{DEP_ROW_ID}:Dep A",
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
                {"id": DEP_ROW_ID, "cells": {"prop-task": "Setup", "prop-status": "opt-done"}},
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
        assert "**Row ID:** row-1" in result
        assert "**Page ID:** page-task-1" in result
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
                {"id": DEP_ROW_ID, "cells": {"prop-task": "Setup", "prop-status": "opt-done"}},
                {
                    "id": "row-1",
                    "cells": {
                        "prop-task": "My Task",
                        "prop-project": "opt-proj-nous",
                        "prop-status": "opt-ready",
                        "prop-depends": f"{DEP_ROW_ID}:Setup",
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
                {"id": DEP_ROW_ID, "cells": {"prop-task": "Blocker", "prop-status": "opt-ready"}},
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

        def resolver(notebook_id, title_or_id):
            if title_or_id == "Project Tasks":
                return {
                    "id": DB_PAGE_ID,
                    "title": "Project Tasks",
                    "pageType": "database",
                }
            raise DaemonError(f"Daemon API error (404): No page matching '{title_or_id}'")

        daemon.resolve_page.side_effect = resolver
        with pytest.raises(ValueError, match="not found"):
            get_spec(task="Ghost Task")

    def test_task_prefix_stripped(self):
        get_spec, _, _ = self._setup()
        result = get_spec(task="Task: My Task")
        assert "## Task Metadata" in result


# ---------------------------------------------------------------------------
# Duplicate task titles across projects (the Nous/Astra collision)
# ---------------------------------------------------------------------------

NOUS_PAGE_UUID = "11111111-1111-4111-8111-111111111111"
ASTRA_PAGE_UUID = "22222222-2222-4222-8222-222222222222"
NOUS_ROW_UUID = "33333333-3333-4333-8333-333333333333"
ASTRA_ROW_UUID = "44444444-4444-4444-8444-444444444444"


def _make_duplicate_db() -> dict:
    """Two rows titled 'Web parity' in different projects."""
    return _make_db_content(
        project_options=["Nous", "Astra"],
        include_external_ref=True,
        rows=[
            {
                "id": NOUS_ROW_UUID,
                "cells": {
                    "prop-task": "Web parity",
                    "prop-project": "opt-proj-nous",
                    "prop-status": "opt-ready",
                    "prop-depends": "None",
                },
            },
            {
                "id": ASTRA_ROW_UUID,
                "cells": {
                    "prop-task": "Web parity",
                    "prop-project": "opt-proj-astra",
                    "prop-status": "opt-inprogress",
                    "prop-depends": "None",
                },
            },
        ],
    )


def _make_duplicate_pages() -> list[dict]:
    return [
        {
            "id": NOUS_PAGE_UUID,
            "title": "Task: Web parity",
            "tags": ["task", "nous", "ready"],
            "pageType": "standard",
            "content": {"blocks": [
                {"type": "paragraph", "data": {"text": "Nous version."}},
            ]},
        },
        {
            "id": ASTRA_PAGE_UUID,
            "title": "Task: Web parity",
            "tags": ["task", "astra", "in-progress"],
            "pageType": "standard",
            "content": {"blocks": [
                {"type": "paragraph", "data": {"text": "Astra version."}},
            ]},
        },
    ]


class TestDuplicateTaskTitles:
    def _setup(self):
        db = _make_duplicate_db()
        pages = _make_duplicate_pages()
        storage = _make_storage(
            folders=[{"id": "folder-nous", "name": "Nous"}],
            db_content=db,
        )
        daemon = _make_daemon()

        def resolve_page(notebook_id, title_or_id):
            # Mirrors daemon semantics: UUID hit, exact title, 409 on dupes.
            if title_or_id == "Project Tasks":
                return {
                    "id": DB_PAGE_ID,
                    "title": "Project Tasks",
                    "pageType": "database",
                }
            for p in pages:
                if p["id"] == title_or_id:
                    return p
            matches = [
                p for p in pages
                if p["title"].lower() == str(title_or_id).lower()
            ]
            if len(matches) > 1:
                raise DaemonError(
                    f"Daemon API error (409): Ambiguous title '{title_or_id}'. "
                    f"Matches: 'Task: Web parity', 'Task: Web parity'"
                )
            if matches:
                return matches[0]
            raise DaemonError(
                f"Daemon API error (404): No page matching '{title_or_id}'"
            )

        daemon.resolve_page.side_effect = resolve_page
        daemon.list_pages.return_value = pages
        daemon.update_page.return_value = {}
        daemon.update_database_rows.return_value = {"rowsUpdated": 1}
        daemon.append_to_page.return_value = {}
        tools = _register_tools(storage, daemon)
        return tools, storage, daemon

    # --- _find_task_row regression: must NOT silently return first match ---

    def test_find_task_row_raises_on_duplicates(self):
        db = _make_duplicate_db()
        with pytest.raises(ValueError, match="2 tasks match 'Web parity'"):
            _find_task_row(db, "Web parity")

    def test_find_task_row_error_names_projects(self):
        db = _make_duplicate_db()
        with pytest.raises(ValueError, match="Nous, Astra"):
            _find_task_row(db, "Web parity")

    def test_find_task_row_project_filter(self):
        db = _make_duplicate_db()
        row, idx, _ = _find_task_row(db, "Web parity", project="Astra")
        assert row["id"] == ASTRA_ROW_UUID
        assert idx == 1

    def test_find_task_rows_returns_all(self):
        db = _make_duplicate_db()
        matches, _ = _find_task_rows(db, "Web parity")
        assert [row["id"] for row, _ in matches] == [NOUS_ROW_UUID, ASTRA_ROW_UUID]

    # --- update_task_status ---

    def test_update_without_project_raises_ambiguity(self):
        tools, _, daemon = self._setup()
        with pytest.raises(ValueError) as exc:
            tools["update_task_status"](task="Web parity", status="Done")
        msg = str(exc.value)
        assert "2 tasks match 'Web parity'" in msg
        assert "Nous" in msg and "Astra" in msg
        assert "project=" in msg
        daemon.update_database_rows.assert_not_called()
        daemon.update_page.assert_not_called()

    def test_update_with_project_hits_right_row_and_page(self):
        tools, _, daemon = self._setup()
        result = json.loads(
            tools["update_task_status"](
                task="Web parity", status="Done", project="Astra"
            )
        )
        assert result["task"] == "Web parity"
        assert result["previous_status"] == "In Progress"

        row_update = daemon.update_database_rows.call_args[0][2]
        assert row_update[0]["row"] == ASTRA_ROW_UUID

        page_call = daemon.update_page.call_args_list[0]
        assert page_call[0][1] == ASTRA_PAGE_UUID

    def test_update_with_page_uuid(self):
        tools, _, daemon = self._setup()
        result = json.loads(
            tools["update_task_status"](task=NOUS_PAGE_UUID, status="Done")
        )
        assert result["task"] == "Web parity"
        assert result["previous_status"] == "Ready"

        row_update = daemon.update_database_rows.call_args[0][2]
        assert row_update[0]["row"] == NOUS_ROW_UUID

        page_call = daemon.update_page.call_args_list[0]
        assert page_call[0][1] == NOUS_PAGE_UUID

    def test_update_with_row_uuid(self):
        tools, _, daemon = self._setup()
        result = json.loads(
            tools["update_task_status"](task=ASTRA_ROW_UUID, status="Done")
        )
        assert result["task"] == "Web parity"

        row_update = daemon.update_database_rows.call_args[0][2]
        assert row_update[0]["row"] == ASTRA_ROW_UUID

        # Page picked via the row's project tag.
        page_call = daemon.update_page.call_args_list[0]
        assert page_call[0][1] == ASTRA_PAGE_UUID

    # --- get_task_spec ---

    def test_spec_without_project_raises_ambiguity(self):
        tools, _, _ = self._setup()
        with pytest.raises(ValueError, match="2 tasks match 'Web parity'"):
            tools["get_task_spec"](task="Web parity")

    def test_spec_with_project(self):
        tools, _, _ = self._setup()
        result = tools["get_task_spec"](task="Web parity", project="Astra")
        assert "**Project:** Astra" in result
        assert "Astra version." in result

    def test_spec_with_page_uuid(self):
        tools, _, _ = self._setup()
        result = tools["get_task_spec"](task=NOUS_PAGE_UUID)
        assert "**Project:** Nous" in result
        assert "Nous version." in result

    def test_spec_with_row_uuid(self):
        tools, _, _ = self._setup()
        result = tools["get_task_spec"](task=ASTRA_ROW_UUID)
        assert "**Project:** Astra" in result
        assert "Astra version." in result

    # --- check_dependencies ---

    def test_check_deps_without_project_raises_ambiguity(self):
        tools, _, _ = self._setup()
        with pytest.raises(ValueError, match="2 tasks match 'Web parity'"):
            tools["check_dependencies"](task="Web parity")

    def test_check_deps_with_project(self):
        tools, _, _ = self._setup()
        result = json.loads(
            tools["check_dependencies"](task="Web parity", project="Nous")
        )
        assert result["task"] == "Web parity"
        assert result["ready"] is True

    def test_check_deps_with_row_uuid(self):
        tools, _, _ = self._setup()
        result = json.loads(tools["check_dependencies"](task=NOUS_ROW_UUID))
        assert result["task"] == "Web parity"

    # --- query_tasks escape hatch ---

    def test_query_tasks_rows_carry_row_id(self):
        tools, _, _ = self._setup()
        result = json.loads(tools["query_tasks"](project="Nous"))
        assert result["total"] == 1
        assert result["tasks"][0]["row_id"] == NOUS_ROW_UUID

    def test_unknown_uuid_raises(self):
        tools, _, _ = self._setup()
        ghost = "99999999-9999-4999-8999-999999999999"
        with pytest.raises(ValueError, match="No task row or page found"):
            tools["update_task_status"](task=ghost, status="Done")


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
            ("b", "B", 1, "A"),
            ("c", "C", 1, "B"),
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
            ("b", "B", 1, "A"),
            ("c", "C", 1, "A"),
            ("d", "D", 1, "B, C"),
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
            ("a", "A", 1, "B"),
            ("b", "B", 1, "A"),
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
                        "prop-depends": "Task A",
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
                            "prop-depends": "Setup",
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
                            "prop-depends": "Build API",
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
                        "prop-depends": "Task B",
                    },
                },
                {
                    "id": "r2",
                    "cells": {
                        "prop-task": "Task B",
                        "prop-project": "opt-proj-nous",
                        "prop-status": "opt-ready",
                        "prop-priority": 1,
                        "prop-depends": "Task A",
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


# ---------------------------------------------------------------------------
# Comma-in-title hardening (create_task validation + list deps + lint tool)
# ---------------------------------------------------------------------------

COMMA_DEP_ID = "cccccccc-0000-4000-8000-000000000001"
COMMA_TITLE = "Web build target: vite config, dist-web, just recipes"
COMMA_TITLE_SOFTENED = "Web build target: vite config; dist-web; just recipes"


class TestCreateTaskCommaHardening:
    def _setup(self):
        db = _make_db_content(
            project_options=["Nous"],
            include_external_ref=True,
            rows=[
                {
                    "id": COMMA_DEP_ID,
                    "cells": {
                        "prop-task": COMMA_TITLE,
                        "prop-project": "opt-proj-nous",
                    },
                },
            ],
        )
        storage = _make_storage(
            folders=[{"id": "folder-nous", "name": "Nous"}], db_content=db
        )
        daemon = _make_daemon()
        daemon.create_page.return_value = {"id": "page-123", "title": "Task: X"}
        daemon.add_database_rows.return_value = {
            "databaseId": DB_PAGE_ID,
            "rowsAdded": 1,
            "totalRows": 1,
        }
        tools = _register_tools(storage, daemon)
        return tools["create_task"], daemon

    def test_comma_in_title_rejected(self):
        create_task, daemon = self._setup()
        with pytest.raises(ValueError, match="comma"):
            create_task(
                project="Nous", title="CLI — init, put, get", content="x"
            )
        daemon.create_page.assert_not_called()

    def test_comma_free_title_unchanged(self):
        create_task, _ = self._setup()
        result = json.loads(
            create_task(project="Nous", title="Clean title", content="x")
        )
        assert result["page_id"] == "page-123"

    def test_list_deps_reference_comma_title(self):
        # The original agent-feedback repro, as a list of one — resolves as
        # a single dependency with the stored title comma-softened.
        create_task, daemon = self._setup()
        result = json.loads(
            create_task(
                project="Nous",
                title="Dependent work",
                content="x",
                depends_on=[COMMA_TITLE],
            )
        )
        rows_arg = daemon.add_database_rows.call_args[0][2]
        assert rows_arg[0]["Depends On"] == f"{COMMA_DEP_ID}:{COMMA_TITLE_SOFTENED}"
        assert result["warnings"] == []

    def test_list_deps_mixed_with_unresolved(self):
        create_task, daemon = self._setup()
        result = json.loads(
            create_task(
                project="Nous",
                title="Dependent work",
                content="x",
                depends_on=[COMMA_TITLE, "Ghost Task"],
            )
        )
        assert any("Ghost Task" in w for w in result["warnings"])
        rows_arg = daemon.add_database_rows.call_args[0][2]
        assert rows_arg[0]["Depends On"].startswith(f"{COMMA_DEP_ID}:")

    def test_string_deps_still_split_on_commas(self):
        # String form keeps its historical contract: commas separate refs.
        # The comma title fragments — but loudly (one warning per fragment).
        create_task, _ = self._setup()
        result = json.loads(
            create_task(
                project="Nous",
                title="Dependent work",
                content="x",
                depends_on=COMMA_TITLE,
            )
        )
        assert len(result["warnings"]) == 3


class TestDetectFragmentation:
    FRAG_A_ID = "11111111-0000-4000-8000-00000000000a"
    FRAG_B_ID = "11111111-0000-4000-8000-00000000000b"
    TITLES = {
        "cli — init, put, get": (FRAG_A_ID, "CLI — init, put, get"),
        "fix dashboard: filtering, sorting": (
            FRAG_B_ID,
            "Fix dashboard: filtering, sorting",
        ),
    }

    def test_two_fragment_rejoin(self):
        found = _detect_fragmentation(
            ["Fix dashboard: filtering", "sorting"], [False, False], self.TITLES
        )
        assert len(found) == 1
        assert found[0]["matches_title"] == "Fix dashboard: filtering, sorting"
        assert found[0]["suggested_entry"] == (
            f"{self.FRAG_B_ID}:Fix dashboard: filtering; sorting"
        )

    def test_three_fragment_rejoin(self):
        found = _detect_fragmentation(
            ["CLI — init", "put", "get"], [False, False, False], self.TITLES
        )
        assert any(f["matches_title"] == "CLI — init, put, get" for f in found)

    def test_uuid_anchored_prefix_join(self):
        # "uuid:Fix dashboard: filtering, sorting" fragments into a resolved
        # uuid segment plus debris — the join uses only the title part.
        row_id = "22222222-0000-4000-8000-000000000002"
        segs = [f"{row_id}:Fix dashboard: filtering", "sorting"]
        found = _detect_fragmentation(segs, [True, False], self.TITLES)
        assert len(found) == 1
        assert found[0]["fragments"] == segs
        assert found[0]["matches_title"] == "Fix dashboard: filtering, sorting"

    def test_no_match_returns_empty(self):
        found = _detect_fragmentation(["alpha", "beta"], [False, False], self.TITLES)
        assert found == []

    def test_fully_resolved_windows_skipped(self):
        found = _detect_fragmentation(
            ["Fix dashboard: filtering", "sorting"], [True, True], self.TITLES
        )
        assert found == []


class TestLintDependencies:
    LINT_OK_DEP_ID = "ffffffff-0000-4000-8000-000000000002"

    def _setup(self, rows):
        db = _make_db_content(
            project_options=["Nous", "Astra"],
            include_external_ref=True,
            rows=rows,
        )
        storage = _make_storage(
            folders=[{"id": "folder-nous", "name": "Nous"}], db_content=db
        )
        daemon = _make_daemon()
        tools = _register_tools(storage, daemon)
        return tools["lint_dependencies"]

    def test_clean_database_reports_zero(self):
        lint = self._setup(
            rows=[
                {
                    "id": self.LINT_OK_DEP_ID,
                    "cells": {"prop-task": "Prerequisite", "prop-status": "opt-done"},
                },
                {
                    "id": "r-consumer",
                    "cells": {
                        "prop-task": "Consumer",
                        "prop-depends": f"{self.LINT_OK_DEP_ID}:Prerequisite",
                    },
                },
                {
                    "id": "r-nodeps",
                    "cells": {"prop-task": "Loner", "prop-depends": "None"},
                },
            ]
        )
        result = json.loads(lint())
        assert result["rows_checked"] == 1  # only the row with a real dep cell
        assert result["rows_with_issues"] == 0
        assert result["issues"] == []

    def test_fragmented_dep_reported_with_repair(self):
        lint = self._setup(
            rows=[
                {"id": COMMA_DEP_ID, "cells": {"prop-task": COMMA_TITLE}},
                {
                    "id": "r-consumer",
                    "cells": {
                        "prop-task": "Consumer",
                        "prop-project": "opt-proj-nous",
                        "prop-depends": COMMA_TITLE,
                    },
                },
            ]
        )
        result = json.loads(lint())
        assert result["rows_with_issues"] == 1
        issue = result["issues"][0]
        assert issue["task"] == "Consumer"
        assert issue["unresolved"]  # the fragments, fail-closed
        suggested = [
            f["suggested_entry"]
            for f in issue["fragmentation"]
            if f["matches_title"] == COMMA_TITLE
        ]
        assert suggested == [f"{COMMA_DEP_ID}:{COMMA_TITLE_SOFTENED}"]

    def test_simple_typo_reported_without_fragmentation(self):
        lint = self._setup(
            rows=[
                {
                    "id": "r-consumer",
                    "cells": {
                        "prop-task": "Consumer",
                        "prop-depends": "Ghost Task",
                    },
                },
            ]
        )
        result = json.loads(lint())
        assert result["rows_with_issues"] == 1
        issue = result["issues"][0]
        assert issue["unresolved"] == ["Ghost Task"]
        assert "fragmentation" not in issue

    def test_project_filter(self):
        lint = self._setup(
            rows=[
                {
                    "id": "r-nous",
                    "cells": {
                        "prop-task": "Nous consumer",
                        "prop-project": "opt-proj-nous",
                        "prop-depends": "Ghost A",
                    },
                },
                {
                    "id": "r-astra",
                    "cells": {
                        "prop-task": "Astra consumer",
                        "prop-project": "opt-proj-astra",
                        "prop-depends": "Ghost B",
                    },
                },
            ]
        )
        result = json.loads(lint(project="Nous"))
        assert result["rows_checked"] == 1
        assert result["filters"] == {"project": "Nous"}
        assert [i["task"] for i in result["issues"]] == ["Nous consumer"]


# ---------------------------------------------------------------------------
# List-valued params (tags / status) — the comma-umbrella residue
# ---------------------------------------------------------------------------


class TestListValuedParams:
    def _setup(self, rows=None):
        db = _make_db_content(
            project_options=["Nous"],
            include_external_ref=True,
            rows=rows
            or [
                {
                    "id": "r-ready",
                    "cells": {
                        "prop-task": "Ready task",
                        "prop-project": "opt-proj-nous",
                        "prop-status": "opt-ready",
                    },
                },
                {
                    "id": "r-done",
                    "cells": {
                        "prop-task": "Done task",
                        "prop-project": "opt-proj-nous",
                        "prop-status": "opt-done",
                    },
                },
            ],
        )
        storage = _make_storage(
            folders=[{"id": "folder-nous", "name": "Nous"}], db_content=db
        )
        daemon = _make_daemon()
        daemon.create_page.return_value = {"id": "page-123", "title": "Task: X"}
        daemon.add_database_rows.return_value = {
            "databaseId": DB_PAGE_ID,
            "rowsAdded": 1,
            "totalRows": 1,
        }
        return _register_tools(storage, daemon), daemon

    def test_query_tasks_status_list(self):
        tools, _ = self._setup()
        result = json.loads(tools["query_tasks"](status=["Ready", "Done"]))
        names = {t["task"] for t in result["tasks"]}
        assert names == {"Ready task", "Done task"}

    def test_query_tasks_status_string_unchanged(self):
        tools, _ = self._setup()
        result = json.loads(tools["query_tasks"](status="Ready, Done"))
        names = {t["task"] for t in result["tasks"]}
        assert names == {"Ready task", "Done task"}

    def test_get_feature_tasks_status_list(self):
        tools, _ = self._setup()
        result = json.loads(
            tools["get_feature_tasks"](project="Nous", status=["Done"])
        )
        names = [t["task"] for t in result["execution_order"]]
        assert names == ["Done task"]

    def test_create_task_tags_list_with_comma_tag(self):
        tools, daemon = self._setup()
        tools["create_task"](
            project="Nous",
            title="Tagged work",
            content="x",
            tags=["research, notes", "sdk"],
        )
        tags = daemon.create_page.call_args.kwargs["tags"]
        assert "research, notes" in tags  # entry preserved whole
        assert "sdk" in tags

    def test_create_task_tags_string_unchanged(self):
        tools, daemon = self._setup()
        tools["create_task"](
            project="Nous", title="Tagged work", content="x", tags="workflow,sdk"
        )
        tags = daemon.create_page.call_args.kwargs["tags"]
        assert "workflow" in tags
        assert "sdk" in tags
