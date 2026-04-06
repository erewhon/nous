"""Workflow tools for the Nous MCP server.

Composite tools that orchestrate multiple storage/daemon operations
to support project management workflows.
"""

from __future__ import annotations

import json
import logging
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
