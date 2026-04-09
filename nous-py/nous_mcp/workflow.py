"""Workflow tools for the Nous MCP server.

Composite tools that orchestrate multiple storage/daemon operations
to support project management workflows.
"""

from __future__ import annotations

import json
import logging
import re
from html import unescape as html_unescape
from uuid import uuid4

from nous_mcp.daemon_client import NousDaemonClient
from nous_mcp.storage import NousStorage

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Schema: columns that workflow tools expect on the Project Tasks database.
# Each entry is (column_name, column_type, options_or_None).
# _ensure_schema() adds any missing columns automatically.
# ---------------------------------------------------------------------------

REQUIRED_COLUMNS: list[tuple[str, str, list[str] | None]] = [
    ("External Ref", "text", None),
]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _resolve_project_folder(
    storage: NousStorage,
    notebook_id: str,
    project_name: str,
) -> dict:
    """Find a folder by name in a notebook.

    Returns the folder dict on success.
    Raises ValueError with a helpful message if not found.
    """
    folders = storage.list_folders(notebook_id)
    name_lower = project_name.lower()

    for f in folders:
        if f["name"].lower() == name_lower:
            return f

    raise ValueError(
        f"Project folder '{project_name}' not found. "
        f"Create it first with: create_project(name='{project_name}')"
    )


def _ensure_select_option(
    storage: NousStorage,
    notebook_id: str,
    page_id: str,
    property_name: str,
    option_label: str,
) -> tuple[dict, bool]:
    """Ensure a select property has a specific option.

    Returns (db_content, was_added) where was_added is True if the option
    was newly created, False if it already existed.

    Raises ValueError if the database or property is not found.
    """
    db_content = storage.read_database_content(notebook_id, page_id)
    if db_content is None:
        raise ValueError(f"Database file not found for page {page_id}")

    properties = db_content.get("properties", [])
    prop = None
    for p in properties:
        if p["name"].lower() == property_name.lower():
            prop = p
            break

    if prop is None:
        raise ValueError(
            f"Property '{property_name}' not found in database. "
            f"Available: {[p['name'] for p in properties]}"
        )

    if prop["type"] not in ("select", "multiSelect"):
        raise ValueError(
            f"Property '{property_name}' is type '{prop['type']}', not select/multiSelect"
        )

    options = prop.get("options", [])
    label_lower = option_label.lower()
    for opt in options:
        if opt["label"].lower() == label_lower:
            return db_content, False

    # Add new option
    colors = [
        "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
        "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1",
        "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e",
    ]
    color = colors[len(options) % len(colors)]

    new_option = {
        "id": str(uuid4()),
        "label": option_label,
        "color": color,
    }
    options.append(new_option)
    prop["options"] = options

    storage.write_database_content(notebook_id, page_id, db_content)
    return db_content, True


def _ensure_database_column(
    storage: NousStorage,
    notebook_id: str,
    page_id: str,
    column_name: str,
    column_type: str,
    options: list[str] | None = None,
) -> tuple[dict, bool]:
    """Ensure a database has a specific column/property.

    Returns (db_content, was_added).
    """
    db_content = storage.read_database_content(notebook_id, page_id)
    if db_content is None:
        raise ValueError(f"Database file not found for page {page_id}")

    properties = db_content.get("properties", [])
    name_lower = column_name.lower()
    for p in properties:
        if p["name"].lower() == name_lower:
            return db_content, False

    colors = [
        "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
        "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1",
    ]

    new_prop: dict = {
        "id": str(uuid4()),
        "name": column_name,
        "type": column_type,
    }

    if column_type in ("select", "multiSelect") and options:
        new_prop["options"] = [
            {
                "id": str(uuid4()),
                "label": label,
                "color": colors[i % len(colors)],
            }
            for i, label in enumerate(options)
        ]

    properties.append(new_prop)
    db_content["properties"] = properties
    storage.write_database_content(notebook_id, page_id, db_content)
    return db_content, True


def _resolve_dependencies(
    storage: NousStorage,
    notebook_id: str,
    db_page_id: str,
    project_name: str,
    dep_names: list[str],
) -> tuple[str, list[str]]:
    """Resolve dependency task names to a stored string and collect warnings.

    Searches the database rows for tasks matching each name. Searches within
    the same project first, then across all projects.

    Returns (depends_on_value, warnings) where depends_on_value is a
    human-readable string like "uuid1:Task Name, uuid2:Other Task" and
    warnings lists any unresolvable names.
    """
    db_content = storage.read_database_content(notebook_id, db_page_id)
    if db_content is None:
        return ", ".join(dep_names), [f"Could not read database to resolve dependencies"]

    properties = db_content.get("properties", [])
    rows = db_content.get("rows", [])

    # Find the Task and Project property IDs
    task_prop_id = None
    project_prop_id = None
    for p in properties:
        if p["name"].lower() == "task":
            task_prop_id = p["id"]
        elif p["name"].lower() == "project":
            project_prop_id = p["id"]
            # Build option_id → label map for select
            project_options = {
                opt["id"]: opt["label"]
                for opt in p.get("options", [])
            }

    if task_prop_id is None:
        return ", ".join(dep_names), ["Task property not found in database"]

    # Index rows by task name (lowercased) → (row_id, project_label)
    rows_by_name: dict[str, list[tuple[str, str]]] = {}
    for row in rows:
        cells = row.get("cells", {})
        task_val = cells.get(task_prop_id, "")
        if not task_val:
            continue
        # Strip HTML tags if present
        clean_name = re.sub(r"<[^>]+>", "", str(task_val))
        clean_name = html_unescape(clean_name).strip()
        proj_val = ""
        if project_prop_id:
            raw_proj = cells.get(project_prop_id, "")
            proj_val = project_options.get(raw_proj, str(raw_proj))
        rows_by_name.setdefault(clean_name.lower(), []).append(
            (row["id"], proj_val)
        )

    resolved: list[str] = []
    warnings: list[str] = []

    for dep_name in dep_names:
        dep_lower = dep_name.strip().lower()
        candidates = rows_by_name.get(dep_lower, [])

        if not candidates:
            warnings.append(f"Dependency '{dep_name}' not found in database")
            resolved.append(dep_name)
            continue

        # Prefer same-project match
        same_project = [
            (rid, proj) for rid, proj in candidates
            if proj.lower() == project_name.lower()
        ]
        if same_project:
            rid, _ = same_project[0]
            resolved.append(f"{rid}:{dep_name}")
        else:
            rid, _ = candidates[0]
            resolved.append(f"{rid}:{dep_name}")

    return ", ".join(resolved), warnings


def _format_task_content(
    title: str,
    project: str,
    notebook: str,
    status: str,
    priority: int,
    depends_on: str,
    content: str,
) -> str:
    """Prepend metadata header to task content if not already present."""
    metadata = (
        f"**Project:** {project} ({notebook})\n"
        f"**Status:** {status}\n"
        f"**Priority:** {priority}\n"
        f"**Depends on:** {depends_on}\n"
    )

    # If content already starts with a header, insert metadata after it
    if content.startswith("#"):
        lines = content.split("\n", 1)
        header = lines[0]
        rest = lines[1] if len(lines) > 1 else ""
        return f"{header}\n\n{metadata}\n---\n\n{rest}".rstrip()

    # Otherwise prepend both header and metadata
    return f"## Task: {title}\n\n{metadata}\n---\n\n{content}".rstrip()


def _ensure_schema(
    storage: NousStorage,
    notebook_id: str,
    db_page_id: str,
) -> list[str]:
    """Auto-ensure all REQUIRED_COLUMNS exist on the database.

    Returns a list of column names that were added (empty if schema was
    already up to date).
    """
    added: list[str] = []
    for col_name, col_type, col_options in REQUIRED_COLUMNS:
        _, was_added = _ensure_database_column(
            storage, notebook_id, db_page_id, col_name, col_type, col_options
        )
        if was_added:
            added.append(col_name)
            logger.info("Auto-added column '%s' (%s) to database", col_name, col_type)
    return added


# ---------------------------------------------------------------------------
# MCP tool registration
# ---------------------------------------------------------------------------


def register_workflow_tools(mcp, get_storage, get_daemon, daemon_available):
    """Register workflow tools with the FastMCP server.

    Args:
        mcp: The FastMCP server instance.
        get_storage: Callable returning the NousStorage instance.
        get_daemon: Callable returning the NousDaemonClient instance.
        daemon_available: Callable returning True if daemon is reachable.
    """

    @mcp.tool()
    def create_project(
        name: str,
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """Create a project: ensures a folder exists and the project name is a select option in the task database.

        Idempotent — safe to call multiple times with the same name.

        Args:
            name: Project name (used for both the folder and the database select option).
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns JSON with folder_id, project_name, created (folder), database_updated.
        """
        storage = get_storage()
        daemon = get_daemon()
        nb = storage.resolve_notebook(notebook)
        notebook_id = nb["id"]

        # --- Ensure folder exists ---
        folders = storage.list_folders(notebook_id)
        name_lower = name.lower()
        folder = None
        for f in folders:
            if f["name"].lower() == name_lower:
                folder = f
                break

        folder_created = False
        if folder is None:
            folder = storage.create_folder(notebook_id, name)
            folder_created = True
            logger.info("Created project folder '%s' (%s)", name, folder["id"])
        else:
            logger.info("Project folder '%s' already exists (%s)", name, folder["id"])

        # --- Ensure database schema (auto-add missing columns) ---
        pg = daemon.resolve_page(notebook_id, database)
        if pg.get("pageType") != "database":
            raise ValueError(f"Page '{pg.get('title')}' is not a database")

        schema_added = _ensure_schema(storage, notebook_id, pg["id"])

        # --- Ensure database select option ---
        _, option_added = _ensure_select_option(
            storage, notebook_id, pg["id"], "Project", name
        )

        if option_added or schema_added:
            # Touch page updatedAt so desktop app picks up the change
            daemon.update_page(notebook_id, pg["id"])
            if option_added:
                logger.info("Added '%s' to Project select options", name)

        return json.dumps(
            {
                "folder_id": folder["id"],
                "project_name": name,
                "created": folder_created,
                "database_updated": option_added,
                "columns_added": schema_added,
            },
            indent=2,
        )

    @mcp.tool()
    def create_task(
        project: str,
        title: str,
        content: str,
        priority: int = 5,
        phase: str = "Feature",
        depends_on: str | None = None,
        status: str = "Ready",
        external_ref: str | None = None,
        tags: str | None = None,
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """Create a task: creates a page in the project folder and a row in the task database.

        Args:
            project: Project name (must already exist — use create_project first).
            title: Task title (page will be named "Task: {title}").
            content: Task description/spec in markdown.
            priority: Priority 1-10 (default 5).
            phase: Phase — Feature, Infrastructure, Polish, Bugfix, or Launch (default "Feature").
            depends_on: Comma-separated task names this depends on (optional).
            status: Status — Spec Needed, Ready, In Progress, or Done (default "Ready").
            external_ref: External reference like a Jira key or GitHub issue (optional).
            tags: Comma-separated extra tags (optional). "task" and project name are auto-added.
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns JSON with page_id, row_id, title, project, status, warnings.
        """
        from nous_mcp.markdown import markdown_to_blocks

        storage = get_storage()
        daemon = get_daemon()
        nb = storage.resolve_notebook(notebook)
        notebook_id = nb["id"]

        # --- Resolve project folder ---
        folder = _resolve_project_folder(storage, notebook_id, project)

        # --- Resolve database and ensure schema ---
        db_page = daemon.resolve_page(notebook_id, database)
        if db_page.get("pageType") != "database":
            raise ValueError(f"Page '{db_page.get('title')}' is not a database")

        _ensure_schema(storage, notebook_id, db_page["id"])

        # --- Resolve dependencies ---
        warnings: list[str] = []
        depends_on_value = "None"
        if depends_on:
            dep_names = [d.strip() for d in depends_on.split(",") if d.strip()]
            if dep_names:
                depends_on_value, dep_warnings = _resolve_dependencies(
                    storage, notebook_id, db_page["id"], project, dep_names
                )
                warnings.extend(dep_warnings)

        # --- Build tags ---
        tag_list = ["task", project.lower()]
        if status:
            tag_list.append(status.lower().replace(" ", "-"))
        if tags:
            for t in tags.split(","):
                t = t.strip()
                if t and t.lower() not in [x.lower() for x in tag_list]:
                    tag_list.append(t)

        # --- Format content and create page ---
        formatted = _format_task_content(
            title, project, notebook, status, priority, depends_on_value, content
        )
        blocks = markdown_to_blocks(formatted)

        page_title = f"Task: {title}"
        page = daemon.create_page(
            notebook_id,
            page_title,
            blocks=blocks,
            tags=tag_list,
            folder_id=folder["id"],
        )
        page_id = page["id"]
        logger.info("Created task page '%s' (%s)", page_title, page_id)

        # --- Add database row ---
        notes_summary = content[:200].strip()
        # Strip markdown formatting for the notes field
        notes_summary = re.sub(r"[#*_`>\[\]]", "", notes_summary).strip()
        if len(content) > 200:
            notes_summary += "..."

        row_data: dict[str, str | int] = {
            "Task": title,
            "Project": project,
            "Status": status,
            "Priority": priority,
            "Phase": phase,
            "Depends On": depends_on_value,
            "Notes": notes_summary,
        }
        if external_ref:
            row_data["External Ref"] = external_ref

        row_id: str | None = None
        try:
            result = daemon.add_database_rows(
                notebook_id, db_page["id"], [row_data]
            )
            # Daemon returns {databaseId, rowsAdded, totalRows} or
            # may include row IDs depending on version
            row_id = result.get("rowIds", [None])[0] if "rowIds" in result else None
            logger.info("Added database row for task '%s'", title)
        except Exception as e:
            warnings.append(f"Page created but database row failed: {e}")
            logger.error("Failed to add database row for task '%s': %s", title, e)

        return json.dumps(
            {
                "page_id": page_id,
                "row_id": row_id,
                "title": page_title,
                "project": project,
                "status": status,
                "warnings": warnings,
            },
            indent=2,
        )
