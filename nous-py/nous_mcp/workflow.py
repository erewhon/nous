"""Workflow tools for the Nous MCP server.

Composite tools that orchestrate multiple storage/daemon operations
to support project management workflows.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, date, datetime
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

STATUS_TAG_MAP: dict[str, str] = {
    "spec needed": "spec-needed",
    "ready": "ready",
    "in progress": "in-progress",
    "done": "done",
}

ALL_STATUS_TAGS = set(STATUS_TAG_MAP.values())


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


def _find_task_row(
    db_content: dict,
    task_name: str,
) -> tuple[dict | None, int | None, dict]:
    """Find a database row matching a task name.

    Returns (row, row_index, prop_map) where prop_map is {prop_name_lower: prop_dict}.
    Row and row_index are None if not found.
    """
    properties = db_content.get("properties", [])
    prop_map = {p["name"].lower(): p for p in properties}

    task_prop = prop_map.get("task")
    if task_prop is None:
        return None, None, prop_map

    task_prop_id = task_prop["id"]
    name_lower = task_name.lower()

    for i, row in enumerate(db_content.get("rows", [])):
        cell_val = row.get("cells", {}).get(task_prop_id, "")
        clean = re.sub(r"<[^>]+>", "", str(cell_val))
        clean = html_unescape(clean).strip().lower()
        if clean == name_lower:
            return row, i, prop_map

    return None, None, prop_map


def _check_dependency_status(
    db_content: dict,
    depends_on_value: str,
) -> dict | str:
    """Check if all dependencies are Done.

    Returns "all satisfied" or {"warning": "Dependency 'X' is still 'Y'"}.
    """
    if not depends_on_value or depends_on_value == "None":
        return "all satisfied"

    properties = db_content.get("properties", [])
    rows = db_content.get("rows", [])

    # Find property IDs
    task_prop_id = None
    status_prop = None
    for p in properties:
        if p["name"].lower() == "task":
            task_prop_id = p["id"]
        elif p["name"].lower() == "status":
            status_prop = p

    if task_prop_id is None or status_prop is None:
        return "all satisfied"

    status_options = {opt["id"]: opt["label"] for opt in status_prop.get("options", [])}

    # Parse depends_on entries — format: "uuid:Name, uuid:Name" or just "Name"
    entries = [e.strip() for e in depends_on_value.split(",") if e.strip()]
    row_by_id = {r["id"]: r for r in rows}

    warnings: list[str] = []
    for entry in entries:
        if ":" in entry:
            row_id, dep_name = entry.split(":", 1)
            dep_row = row_by_id.get(row_id)
        else:
            dep_name = entry
            dep_row = None
            # Try to find by name
            for r in rows:
                cell_val = r.get("cells", {}).get(task_prop_id, "")
                clean = re.sub(r"<[^>]+>", "", str(cell_val))
                clean = html_unescape(clean).strip()
                if clean.lower() == dep_name.lower():
                    dep_row = r
                    break

        if dep_row is None:
            warnings.append(f"Dependency '{dep_name}' not found in database")
            continue

        status_cell = dep_row.get("cells", {}).get(status_prop["id"], "")
        status_label = status_options.get(status_cell, str(status_cell))
        if status_label.lower() != "done":
            warnings.append(f"Dependency '{dep_name}' is still '{status_label}'")

    if warnings:
        return {"warning": "; ".join(warnings)}
    return "all satisfied"


def _parse_depends_on(value: str) -> list[tuple[str | None, str]]:
    """Parse a depends_on field value into (uuid_or_none, name) tuples.

    Handles both UUID format ("uuid:Name") and free-text ("Name").
    """
    if not value or value.strip().lower() == "none":
        return []

    entries = [e.strip() for e in value.split(",") if e.strip()]
    result: list[tuple[str | None, str]] = []
    for entry in entries:
        if ":" in entry:
            uid, name = entry.split(":", 1)
            result.append((uid.strip(), name.strip()))
        else:
            result.append((None, entry.strip()))
    return result


def _resolve_dep_row(
    db_content: dict,
    uid: str | None,
    name: str,
) -> dict | None:
    """Resolve a dependency to a database row by UUID or name."""
    rows = db_content.get("rows", [])

    # Try UUID first
    if uid:
        for r in rows:
            if r["id"] == uid:
                return r

    # Fall back to name match
    properties = db_content.get("properties", [])
    task_prop_id = None
    for p in properties:
        if p["name"].lower() == "task":
            task_prop_id = p["id"]
            break
    if task_prop_id is None:
        return None

    name_lower = name.lower()
    for r in rows:
        cell_val = r.get("cells", {}).get(task_prop_id, "")
        clean = re.sub(r"<[^>]+>", "", str(cell_val))
        clean = html_unescape(clean).strip()
        if clean.lower() == name_lower:
            return r
    return None


def _get_row_status(row: dict, db_content: dict) -> str:
    """Get the human-readable status label for a database row."""
    properties = db_content.get("properties", [])
    status_prop = None
    for p in properties:
        if p["name"].lower() == "status":
            status_prop = p
            break
    if status_prop is None:
        return "Unknown"
    options = {opt["id"]: opt["label"] for opt in status_prop.get("options", [])}
    cell_val = row.get("cells", {}).get(status_prop["id"], "")
    return options.get(cell_val, str(cell_val) if cell_val else "Unknown")


def _get_row_task_name(row: dict, db_content: dict) -> str:
    """Get the task name from a database row."""
    properties = db_content.get("properties", [])
    for p in properties:
        if p["name"].lower() == "task":
            cell_val = row.get("cells", {}).get(p["id"], "")
            clean = re.sub(r"<[^>]+>", "", str(cell_val))
            return html_unescape(clean).strip()
    return ""


def _migrate_dependencies(
    storage: NousStorage,
    notebook_id: str,
    db_page_id: str,
) -> dict:
    """Migrate free-text dependencies to UUID:Name format.

    Returns {migrated: int, unresolved: int, unresolved_names: list[str], details: list}.
    """
    db_content = storage.read_database_content(notebook_id, db_page_id)
    if db_content is None:
        raise ValueError(f"Database file not found for page {db_page_id}")

    properties = db_content.get("properties", [])
    rows = db_content.get("rows", [])

    # Find property IDs
    task_prop_id = None
    depends_prop_id = None
    for p in properties:
        if p["name"].lower() == "task":
            task_prop_id = p["id"]
        elif p["name"].lower() == "depends on":
            depends_prop_id = p["id"]

    if task_prop_id is None or depends_prop_id is None:
        return {"migrated": 0, "unresolved": 0, "unresolved_names": [], "details": []}

    # Index all rows by task name (lowercased) for lookup
    rows_by_name: dict[str, dict] = {}
    for r in rows:
        cell_val = r.get("cells", {}).get(task_prop_id, "")
        clean = re.sub(r"<[^>]+>", "", str(cell_val))
        clean = html_unescape(clean).strip()
        if clean:
            rows_by_name[clean.lower()] = r

    migrated = 0
    unresolved_names: list[str] = []
    details: list[dict] = []
    modified = False

    for row in rows:
        depends_val = row.get("cells", {}).get(depends_prop_id, "")
        if not depends_val or depends_val.strip().lower() == "none":
            continue

        parsed = _parse_depends_on(depends_val)
        new_entries: list[str] = []
        row_changed = False

        for uid, name in parsed:
            if uid:
                # Already has UUID — keep as-is
                new_entries.append(f"{uid}:{name}")
                continue

            # Free-text — try to resolve
            dep_row = rows_by_name.get(name.lower())
            if dep_row:
                new_entries.append(f"{dep_row['id']}:{name}")
                row_changed = True
            else:
                # Can't resolve — keep original text
                new_entries.append(name)
                if name not in unresolved_names:
                    unresolved_names.append(name)

        if row_changed:
            new_val = ", ".join(new_entries)
            row.setdefault("cells", {})[depends_prop_id] = new_val
            task_name = _get_row_task_name(row, db_content)
            details.append({"task": task_name, "old": depends_val, "new": new_val})
            migrated += 1
            modified = True

    if modified:
        storage.write_database_content(notebook_id, db_page_id, db_content)

    return {
        "migrated": migrated,
        "unresolved": len(unresolved_names),
        "unresolved_names": unresolved_names,
        "details": details,
    }


def _topological_sort(
    tasks: list[dict],
    db_content: dict,
) -> tuple[list[dict], list[str]]:
    """Sort tasks in dependency order using Kahn's algorithm.

    Each task dict must have "id", "task" (name), "deps" (list of dep names),
    and "priority" (int).

    Returns (sorted_tasks, cycle_names) where cycle_names lists tasks
    involved in a cycle (empty if no cycle).
    """
    # Build adjacency: task_id → set of task_ids it depends on
    id_to_task = {t["id"]: t for t in tasks}
    name_to_id: dict[str, str] = {}
    for t in tasks:
        name_to_id[t["task"].lower()] = t["id"]

    # For each task, find which of our task set it depends on
    in_degree: dict[str, int] = {t["id"]: 0 for t in tasks}
    dependents: dict[str, list[str]] = {t["id"]: [] for t in tasks}  # dep_id → [task_ids that depend on it]

    for t in tasks:
        depends_on_cell = t.get("_depends_on_raw", "")
        parsed = _parse_depends_on(depends_on_cell)
        dep_ids_in_set: list[str] = []
        for uid, dep_name in parsed:
            # Try UUID match within our task set
            if uid and uid in id_to_task:
                dep_ids_in_set.append(uid)
            elif dep_name.lower() in name_to_id:
                dep_ids_in_set.append(name_to_id[dep_name.lower()])
        in_degree[t["id"]] = len(dep_ids_in_set)
        for dep_id in dep_ids_in_set:
            dependents[dep_id].append(t["id"])

    # Kahn's algorithm with priority tie-breaking
    queue: list[dict] = []
    for t in tasks:
        if in_degree[t["id"]] == 0:
            queue.append(t)
    # Sort initial queue by priority (lower = higher priority)
    queue.sort(key=lambda t: (t.get("priority", 99), t["task"]))

    result: list[dict] = []
    while queue:
        current = queue.pop(0)
        result.append(current)
        for dep_id in dependents.get(current["id"], []):
            in_degree[dep_id] -= 1
            if in_degree[dep_id] == 0:
                queue.append(id_to_task[dep_id])
                queue.sort(key=lambda t: (t.get("priority", 99), t["task"]))

    # Detect cycles
    cycle_names: list[str] = []
    if len(result) < len(tasks):
        remaining = {t["id"] for t in tasks} - {t["id"] for t in result}
        cycle_names = [id_to_task[tid]["task"] for tid in remaining]

    return result, cycle_names


def _get_project_tasks(
    db_content: dict,
    project_name: str,
    include_done: bool = False,
    feature: str | None = None,
) -> list[dict]:
    """Extract tasks for a project from database content.

    Returns list of dicts with id, task, status, priority, phase, deps, _depends_on_raw.
    """
    properties = db_content.get("properties", [])
    rows = db_content.get("rows", [])
    prop_map = {p["name"].lower(): p for p in properties}

    task_prop = prop_map.get("task")
    project_prop = prop_map.get("project")
    status_prop = prop_map.get("status")
    priority_prop = prop_map.get("priority")
    phase_prop = prop_map.get("phase")
    depends_prop = prop_map.get("depends on")
    notes_prop = prop_map.get("notes")

    if not task_prop or not project_prop:
        return []

    # Build option maps
    proj_options = {o["id"]: o["label"] for o in project_prop.get("options", [])}
    status_options = {o["id"]: o["label"] for o in status_prop.get("options", [])} if status_prop else {}
    phase_options = {o["id"]: o["label"] for o in phase_prop.get("options", [])} if phase_prop else {}

    feature_tag = feature.lower().replace(" ", "-") if feature else None

    result: list[dict] = []
    for row in rows:
        cells = row.get("cells", {})

        # Filter by project
        proj_cell = cells.get(project_prop["id"], "")
        proj_label = proj_options.get(proj_cell, str(proj_cell))
        if proj_label.lower() != project_name.lower():
            continue

        # Get status
        status_cell = cells.get(status_prop["id"], "") if status_prop else ""
        status_label = status_options.get(status_cell, str(status_cell) if status_cell else "Unknown")

        # Filter done
        if not include_done and status_label.lower() == "done":
            continue

        # Task name
        task_cell = cells.get(task_prop["id"], "")
        task_name = re.sub(r"<[^>]+>", "", str(task_cell))
        task_name = html_unescape(task_name).strip()
        if not task_name:
            continue

        # Feature filter (heuristic: check notes and task name)
        if feature:
            match = False
            notes_cell = cells.get(notes_prop["id"], "") if notes_prop else ""
            if feature.lower() in str(notes_cell).lower():
                match = True
            elif feature.lower() in task_name.lower():
                match = True
            elif feature_tag and feature_tag in task_name.lower().replace(" ", "-"):
                match = True
            if not match:
                continue

        # Priority
        prio_cell = cells.get(priority_prop["id"], 99) if priority_prop else 99
        try:
            priority_val = int(prio_cell) if prio_cell else 99
        except (ValueError, TypeError):
            priority_val = 99

        # Phase
        phase_cell = cells.get(phase_prop["id"], "") if phase_prop else ""
        phase_label = phase_options.get(phase_cell, str(phase_cell) if phase_cell else "—")

        # Depends on
        depends_raw = cells.get(depends_prop["id"], "") if depends_prop else ""
        parsed_deps = _parse_depends_on(depends_raw)
        dep_names = [name for _, name in parsed_deps]

        result.append({
            "id": row["id"],
            "task": task_name,
            "status": status_label,
            "priority": priority_val,
            "phase": phase_label,
            "deps": dep_names,
            "_depends_on_raw": depends_raw,
        })

    return result


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

    @mcp.tool()
    def update_task_status(
        task: str,
        status: str,
        notes: str | None = None,
        external_ref: str | None = None,
        completed_date: str | None = None,
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """Update a task's status in both the page tags and database row.

        Optionally appends implementation notes to the task page.
        When setting status to "Done", auto-sets completed_date to today if not provided.
        When setting status to "In Progress", checks dependency status (advisory, not blocking).

        Args:
            task: Task name (supports "Task: " prefix or bare name, prefix match).
            status: New status — "Spec Needed", "Ready", "In Progress", or "Done".
            notes: Implementation notes to append to the page (optional).
            external_ref: Set or update the External Ref field (optional).
            completed_date: Completed date in YYYY-MM-DD format (auto-set for Done).
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns JSON with task, previous_status, new_status, notes_appended,
        dependencies, completed_date.
        """
        from nous_mcp.markdown import markdown_to_blocks

        storage = get_storage()
        daemon = get_daemon()
        nb = storage.resolve_notebook(notebook)
        notebook_id = nb["id"]

        # --- Normalize task name ---
        task_name = task.strip()
        if task_name.lower().startswith("task: "):
            task_name = task_name[6:].strip()

        # --- Resolve task page ---
        page_title = f"Task: {task_name}"
        try:
            page = daemon.resolve_page(notebook_id, page_title)
        except Exception:
            # Try bare name as fallback
            try:
                page = daemon.resolve_page(notebook_id, task_name)
            except Exception:
                raise ValueError(
                    f"Task '{task_name}' not found. "
                    f"Tried both 'Task: {task_name}' and '{task_name}'."
                )

        # --- Resolve database and find row ---
        db_page = daemon.resolve_page(notebook_id, database)
        if db_page.get("pageType") != "database":
            raise ValueError(f"Page '{db_page.get('title')}' is not a database")

        db_content = storage.read_database_content(notebook_id, db_page["id"])
        if db_content is None:
            raise ValueError(f"Database file not found for '{database}'")

        row, row_index, prop_map = _find_task_row(db_content, task_name)

        # --- Determine previous status ---
        previous_status = "Unknown"
        if row and "status" in prop_map:
            status_prop = prop_map["status"]
            status_cell = row.get("cells", {}).get(status_prop["id"], "")
            status_options = {
                opt["id"]: opt["label"]
                for opt in status_prop.get("options", [])
            }
            previous_status = status_options.get(status_cell, str(status_cell))

        # --- Update page tags ---
        current_tags = page.get("tags", [])
        new_tags = [t for t in current_tags if t.lower() not in ALL_STATUS_TAGS]
        new_status_tag = STATUS_TAG_MAP.get(status.lower(), status.lower().replace(" ", "-"))
        new_tags.append(new_status_tag)
        daemon.update_page(notebook_id, page["id"], tags=new_tags)

        # --- Update database row ---
        if row is not None:
            update_cells: dict[str, str | int] = {"Status": status}

            # Auto-set completed date
            if status.lower() == "done":
                if completed_date is None:
                    completed_date = date.today().isoformat()
                update_cells["Completed"] = completed_date

            if external_ref is not None:
                update_cells["External Ref"] = external_ref

            daemon.update_database_rows(
                notebook_id,
                db_page["id"],
                [{"row": row["id"], "cells": update_cells}],
            )

        # --- Append implementation notes ---
        notes_appended = False
        if notes:
            today_iso = date.today().isoformat()
            notes_md = (
                f"\n\n## Implementation Notes\n\n"
                f"### {today_iso} — Status: {status}\n\n"
                f"{notes}\n"
            )
            blocks = markdown_to_blocks(notes_md)
            daemon.append_to_page(notebook_id, page["id"], blocks=blocks)
            notes_appended = True
            logger.info("Appended implementation notes to '%s'", page_title)

        # --- Check dependencies (advisory) ---
        dependencies: dict | str = "all satisfied"
        if status.lower() == "in progress" and row:
            depends_on_cell = ""
            if "depends on" in prop_map:
                depends_prop = prop_map["depends on"]
                depends_on_cell = row.get("cells", {}).get(depends_prop["id"], "")
            dependencies = _check_dependency_status(db_content, depends_on_cell)

        return json.dumps(
            {
                "task": task_name,
                "previous_status": previous_status,
                "new_status": status,
                "notes_appended": notes_appended,
                "dependencies": dependencies,
                "completed_date": completed_date,
            },
            indent=2,
        )

    @mcp.tool()
    def check_dependencies(
        task: str,
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """Check the dependency status of a task.

        Resolves each dependency (UUID or free-text) and reports its status.

        Args:
            task: Task name (supports "Task: " prefix or bare name).
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns JSON with task, status, ready (bool), dependencies list, and blocking list.
        """
        storage = get_storage()
        daemon = get_daemon()
        nb = storage.resolve_notebook(notebook)
        notebook_id = nb["id"]

        # Resolve database
        db_page = daemon.resolve_page(notebook_id, database)
        if db_page.get("pageType") != "database":
            raise ValueError(f"Page '{db_page.get('title')}' is not a database")

        db_content = storage.read_database_content(notebook_id, db_page["id"])
        if db_content is None:
            raise ValueError(f"Database file not found for '{database}'")

        # Normalize task name
        task_name = task.strip()
        if task_name.lower().startswith("task: "):
            task_name = task_name[6:].strip()

        # Find the task row
        row, _, prop_map = _find_task_row(db_content, task_name)
        if row is None:
            raise ValueError(
                f"Task '{task_name}' not found in database '{database}'."
            )

        task_status = _get_row_status(row, db_content)

        # Parse depends_on
        depends_on_cell = ""
        if "depends on" in prop_map:
            depends_prop = prop_map["depends on"]
            depends_on_cell = row.get("cells", {}).get(depends_prop["id"], "")

        parsed = _parse_depends_on(depends_on_cell)

        dep_results: list[dict] = []
        blocking: list[str] = []

        for uid, dep_name in parsed:
            dep_row = _resolve_dep_row(db_content, uid, dep_name)
            if dep_row is None:
                dep_results.append({
                    "task": dep_name,
                    "status": "Not Found",
                    "satisfied": False,
                })
                blocking.append(dep_name)
                continue

            dep_status = _get_row_status(dep_row, db_content)
            satisfied = dep_status.lower() == "done"
            dep_results.append({
                "task": dep_name,
                "status": dep_status,
                "satisfied": satisfied,
            })
            if not satisfied:
                blocking.append(dep_name)

        return json.dumps(
            {
                "task": task_name,
                "status": task_status,
                "ready": len(blocking) == 0,
                "dependencies": dep_results,
                "blocking": blocking,
            },
            indent=2,
        )

    @mcp.tool()
    def migrate_dependencies(
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """Migrate free-text dependency references to UUID:Name format.

        Scans all rows, resolves free-text dependency names to row UUIDs,
        and updates the Depends On field. Idempotent — safe to run multiple times.

        Args:
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns JSON with migrated count, unresolved count, and details.
        """
        storage = get_storage()
        daemon = get_daemon()
        nb = storage.resolve_notebook(notebook)
        notebook_id = nb["id"]

        db_page = daemon.resolve_page(notebook_id, database)
        if db_page.get("pageType") != "database":
            raise ValueError(f"Page '{db_page.get('title')}' is not a database")

        result = _migrate_dependencies(storage, notebook_id, db_page["id"])

        # Touch page if anything changed
        if result["migrated"] > 0:
            daemon.update_page(notebook_id, db_page["id"])
            logger.info(
                "Migrated %d dependency references (%d unresolved)",
                result["migrated"],
                result["unresolved"],
            )

        return json.dumps(result, indent=2)

    @mcp.tool()
    def get_task_spec(
        task: str,
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """Get the full spec for a task: page content, metadata, and dependency status.

        Single call for agents starting work on a task. Returns markdown
        combining metadata header, guardrails, dependency status, and page content.

        Args:
            task: Task name (supports "Task: " prefix or bare name).
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns markdown with metadata, guardrails, and full page content.
        """
        from nous_mcp.markdown import export_page_to_markdown

        storage = get_storage()
        daemon = get_daemon()
        nb = storage.resolve_notebook(notebook)
        notebook_id = nb["id"]

        # --- Normalize task name ---
        task_name = task.strip()
        if task_name.lower().startswith("task: "):
            task_name = task_name[6:].strip()

        # --- Resolve task page ---
        page_title = f"Task: {task_name}"
        try:
            page = daemon.resolve_page(notebook_id, page_title)
        except Exception:
            try:
                page = daemon.resolve_page(notebook_id, task_name)
            except Exception:
                raise ValueError(
                    f"Task '{task_name}' not found. "
                    f"Tried both 'Task: {task_name}' and '{task_name}'."
                )

        # --- Get page content as markdown ---
        page_content = export_page_to_markdown(page)

        # --- Get database metadata ---
        db_page = daemon.resolve_page(notebook_id, database)
        db_content = None
        row = None
        prop_map: dict = {}
        if db_page.get("pageType") == "database":
            db_content = storage.read_database_content(notebook_id, db_page["id"])
            if db_content:
                row, _, prop_map = _find_task_row(db_content, task_name)

        # --- Extract metadata from row ---
        project = "Unknown"
        status = "Unknown"
        priority = "—"
        phase = "—"
        external_ref = "None"

        if row and db_content:
            status = _get_row_status(row, db_content)
            cells = row.get("cells", {})

            if "project" in prop_map:
                proj_prop = prop_map["project"]
                proj_cell = cells.get(proj_prop["id"], "")
                proj_options = {
                    o["id"]: o["label"] for o in proj_prop.get("options", [])
                }
                project = proj_options.get(proj_cell, str(proj_cell) if proj_cell else "Unknown")

            if "priority" in prop_map:
                prio_cell = cells.get(prop_map["priority"]["id"], "")
                priority = str(prio_cell) if prio_cell else "—"

            if "phase" in prop_map:
                phase_prop = prop_map["phase"]
                phase_cell = cells.get(phase_prop["id"], "")
                phase_options = {
                    o["id"]: o["label"] for o in phase_prop.get("options", [])
                }
                phase = phase_options.get(phase_cell, str(phase_cell) if phase_cell else "—")

            if "external ref" in prop_map:
                ext_cell = cells.get(prop_map["external ref"]["id"], "")
                if ext_cell:
                    external_ref = str(ext_cell)

        # --- Dependency status ---
        dep_section = "None"
        blocking: list[str] = []
        if row and db_content:
            depends_on_cell = ""
            if "depends on" in prop_map:
                depends_prop = prop_map["depends on"]
                depends_on_cell = row.get("cells", {}).get(depends_prop["id"], "")

            parsed = _parse_depends_on(depends_on_cell)
            if parsed:
                dep_parts: list[str] = []
                for uid, dep_name in parsed:
                    dep_row = _resolve_dep_row(db_content, uid, dep_name)
                    if dep_row:
                        dep_status = _get_row_status(dep_row, db_content)
                        satisfied = dep_status.lower() == "done"
                        marker = "done" if satisfied else f"**{dep_status}**"
                        dep_parts.append(f"- {dep_name}: {marker}")
                        if not satisfied:
                            blocking.append(dep_name)
                    else:
                        dep_parts.append(f"- {dep_name}: **Not Found**")
                        blocking.append(dep_name)
                dep_section = "\n".join(dep_parts)
            else:
                dep_section = "None"

        # --- Build guardrails ---
        guardrails: list[str] = []
        if status.lower() == "done":
            guardrails.append("> **Note:** This task is already marked Done.")
        elif status.lower() == "in progress":
            guardrails.append(
                "> **Warning:** This task is already In Progress "
                "— another agent may be working on it."
            )
        if blocking:
            guardrails.append(
                f"> **Blocked:** Dependencies not yet Done: {', '.join(blocking)}"
            )

        # --- Assemble output ---
        parts: list[str] = []

        if guardrails:
            parts.append("\n".join(guardrails))
            parts.append("")

        parts.append("## Task Metadata")
        parts.append(f"- **Project:** {project}")
        parts.append(f"- **Status:** {status}")
        parts.append(f"- **Priority:** {priority}")
        parts.append(f"- **Phase:** {phase}")
        parts.append(f"- **External Ref:** {external_ref}")
        parts.append(f"- **Dependencies:**")
        if dep_section == "None":
            parts.append("  None")
        else:
            # Indent dep lines under the Dependencies bullet
            for line in dep_section.split("\n"):
                parts.append(f"  {line}")

        parts.append("")
        parts.append("---")
        parts.append("")
        parts.append(page_content)

        return "\n".join(parts)

    @mcp.tool()
    def get_feature_tasks(
        project: str,
        feature: str | None = None,
        include_done: bool = False,
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """Get all tasks for a project/feature in dependency-resolved execution order.

        Returns tasks topologically sorted so no task appears before its dependencies.
        Tasks at the same dependency level are sorted by priority.

        Args:
            project: Project name.
            feature: Optional feature name to filter tasks (matches in notes or task name).
            include_done: Include completed tasks (default: False).
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns JSON with project, feature, task counts, and execution_order list.
        """
        storage = get_storage()
        daemon = get_daemon()
        nb = storage.resolve_notebook(notebook)
        notebook_id = nb["id"]

        db_page = daemon.resolve_page(notebook_id, database)
        if db_page.get("pageType") != "database":
            raise ValueError(f"Page '{db_page.get('title')}' is not a database")

        db_content = storage.read_database_content(notebook_id, db_page["id"])
        if db_content is None:
            raise ValueError(f"Database file not found for '{database}'")

        tasks = _get_project_tasks(
            db_content, project,
            include_done=include_done,
            feature=feature,
        )

        # Topological sort
        sorted_tasks, cycle_names = _topological_sort(tasks, db_content)

        # Build execution order
        completed = sum(1 for t in sorted_tasks if t["status"].lower() == "done")
        execution_order: list[dict] = []
        for i, t in enumerate(sorted_tasks, 1):
            entry: dict = {
                "position": i,
                "task": t["task"],
                "status": t["status"],
                "priority": t["priority"],
                "phase": t["phase"],
                "deps": t["deps"],
            }
            execution_order.append(entry)

        result: dict = {
            "project": project,
            "feature": feature,
            "total_tasks": len(sorted_tasks) + len(cycle_names),
            "completed": completed,
            "remaining": len(sorted_tasks) - completed + len(cycle_names),
            "execution_order": execution_order,
        }

        if cycle_names:
            result["cycle_error"] = (
                f"Dependency cycle detected involving: {', '.join(cycle_names)}"
            )

        return json.dumps(result, indent=2)
