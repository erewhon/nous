"""Workflow tools for the Nous MCP server.

Composite tools that orchestrate multiple storage/daemon operations
to support project management workflows.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from datetime import UTC, date, datetime, timedelta
from html import unescape as html_unescape
from uuid import uuid4

import httpx

from nous_mcp.daemon_client import DaemonError
from nous_mcp.params import as_list
from nous_mcp.storage import UUID_RE, NousStorage

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Schema: columns that workflow tools expect on the Project Tasks database.
# Each entry is (column_name, column_type, options_or_None).
# _ensure_schema() adds any missing columns automatically.
# ---------------------------------------------------------------------------

REQUIRED_COLUMNS: list[tuple[str, str, list[str] | None]] = [
    ("External Ref", "text", None),
    ("Feature", "text", None),
    # --- Autonomy / worker metadata (null-as-manual; worker ignores tasks
    # without Execution Mode = Auto-OK or Auto-Preferred) ---
    ("Execution Mode", "select", ["Manual", "Auto-OK", "Auto-Preferred"]),
    ("Model Tier", "select", ["auto", "auto-free", "auto-full"]),
    ("Estimate", "select", ["xs", "s", "m", "l", "xl"]),
    ("Complexity", "select", ["routine", "novel"]),
    ("Task Type", "select", ["bug-fix", "feature", "refactor", "docs", "test", "chore"]),
    ("Max Files", "number", None),
    ("Requires Tests", "select", ["Yes", "No"]),
]

# Fields in REQUIRED_COLUMNS with select type — used by read helpers
AUTONOMY_SELECT_FIELDS = (
    "execution mode",
    "model tier",
    "estimate",
    "complexity",
    "task type",
    "requires tests",
)

STATUS_TAG_MAP: dict[str, str] = {
    "spec needed": "spec-needed",
    "ready": "ready",
    "in progress": "in-progress",
    "done": "done",
}

ALL_STATUS_TAGS = set(STATUS_TAG_MAP.values())

# Nous status → Kanban column mapping for agent-monitor
STATUS_TO_KANBAN: dict[str, str] = {
    "spec needed": "Backlog",
    "ready": "Backlog",
    "in progress": "Active",
    "done": "Done",
}


# ---------------------------------------------------------------------------
# Webhook
# ---------------------------------------------------------------------------


def _fire_webhook(
    task: str,
    project: str,
    status: str,
    previous_status: str,
    external_ref: str | None = None,
) -> None:
    """POST a status-change notification to agent-monitor (fire-and-forget).

    Reads AGENT_MONITOR_WEBHOOK_URL from env. Silently no-ops if not set.
    Runs in a daemon thread so it never blocks the caller.
    """
    url = os.environ.get("AGENT_MONITOR_WEBHOOK_URL")
    if not url:
        return

    payload = {
        "source": "nous",
        "task": task,
        "project": project,
        "status": status,
        "previous_status": previous_status,
        "kanban_column": STATUS_TO_KANBAN.get(status.lower(), status),
        "timestamp": datetime.now(UTC).isoformat(),
    }
    if external_ref:
        payload["external_ref"] = external_ref

    key = os.environ.get("AGENT_MONITOR_WEBHOOK_KEY")
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"

    def _send() -> None:
        attempts = 2
        for attempt in range(attempts):
            try:
                resp = httpx.post(url, json=payload, headers=headers, timeout=5)
                if resp.status_code < 400:
                    logger.info("Webhook sent: %s → %s", task, status)
                    return
                logger.warning(
                    "Webhook %d: HTTP %d", attempt + 1, resp.status_code
                )
            except Exception as e:
                logger.warning("Webhook %d failed: %s", attempt + 1, e)
            if attempt < attempts - 1:
                time.sleep(2)

    thread = threading.Thread(target=_send, daemon=True)
    thread.start()


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


def _resolve_dep_ref(
    db_content: dict,
    entry: str,
    project_name: str | None = None,
    get_archive=None,
) -> dict:
    """Resolve one dependency reference to a database row.

    Accepted forms (the database holds every project's tasks, so all forms
    reach across projects and epics):

    - task title — same-project match preferred (project_name), else a
      unique cross-project match; ambiguous titles fail closed with a warning
    - bare row UUID
    - "uuid:Title" — the canonical stored form; the UUID wins, title refreshed
    - "ref:<external-ref>" — looked up in the External Ref column

    Entries that don't resolve in the active database fall back to the
    archive database (get_archive loader) — archived rows are Done by
    construction, so they're valid, always-satisfied dep targets.

    Returns {"entry", "row": dict|None, "source": dict|None, "archived": bool,
    "canonical": str, "warning": str|None, "note": str|None}. source is the
    database content the row was found in. canonical is "uuid:Title" when
    resolved, else the original entry (which blocked-resolution treats as
    unmet — fail closed).
    """
    entry = entry.strip()
    result: dict = {
        "entry": entry,
        "row": None,
        "source": None,
        "archived": False,
        "canonical": entry,
        "warning": None,
        "note": None,
    }
    rows = db_content.get("rows", [])
    row_by_id = {r["id"]: r for r in rows}

    def _accept(
        row: dict, note: str | None = None, source: dict | None = None
    ) -> dict:
        source = source or db_content
        title = _get_row_task_name(row, source) or entry
        # Commas are the cell separator — a comma in the title would corrupt
        # the cell on read. The UUID drives resolution, so soften the display
        # title. (Fuller handling: the comma-in-title footgun task.)
        title = title.replace(",", ";")
        result["row"] = row
        result["source"] = source
        result["archived"] = source is not db_content
        result["canonical"] = f"{row['id']}:{title}"
        result["note"] = note
        result["warning"] = None
        return result

    def _try_archive() -> dict | None:
        """Re-run resolution against the archive database, if any."""
        archive = get_archive() if get_archive else None
        if not archive:
            return None
        ref = _resolve_dep_ref(archive, entry, project_name)
        if ref["row"] is not None:
            return _accept(ref["row"], note="archived (Done)", source=archive)
        return None

    # --- bare row UUID ---
    if UUID_RE.match(entry):
        row = row_by_id.get(entry)
        if row is not None:
            return _accept(row)
        if _try_archive():
            return result
        result["warning"] = f"Dependency row UUID '{entry}' not found in database"
        return result

    # --- ref:<external-ref> ---
    if entry.lower().startswith("ref:"):
        matches = _rows_by_external_ref(db_content, entry[4:])
        if len(matches) == 1:
            return _accept(matches[0])
        if len(matches) > 1:
            prop_map = {p["name"].lower(): p for p in db_content.get("properties", [])}
            projects = ", ".join(
                _row_project_label(r, prop_map) or "Unknown" for r in matches
            )
            result["warning"] = (
                f"Dependency '{entry}' matches {len(matches)} tasks "
                f"(projects: {projects}) — use a row UUID"
            )
        else:
            if _try_archive():
                return result
            result["warning"] = f"Dependency '{entry}' matches no External Ref"
        return result

    # --- "uuid:Title" (canonical form; anything else with a colon is a title) ---
    if ":" in entry:
        uid_part, _, title_part = entry.partition(":")
        if UUID_RE.match(uid_part.strip()):
            row = row_by_id.get(uid_part.strip())
            if row is not None:
                return _accept(row)
            if _try_archive():
                return result
            result["warning"] = (
                f"Dependency '{entry}' has a row UUID not found in database"
            )
            return result

    # --- task title ---
    prop_map = {p["name"].lower(): p for p in db_content.get("properties", [])}
    matches, _ = _find_task_rows(db_content, entry)
    if not matches:
        if _try_archive():
            return result
        result["warning"] = f"Dependency '{entry}' not found in database"
        return result

    if project_name:
        same_project = [
            (row, i)
            for row, i in matches
            if _row_project_label(row, prop_map).lower() == project_name.lower()
        ]
        if same_project:
            return _accept(same_project[0][0])

    if len(matches) == 1:
        row = matches[0][0]
        row_project = _row_project_label(row, prop_map)
        note = None
        if project_name and row_project and row_project.lower() != project_name.lower():
            note = f"resolved cross-project to '{row_project}'"
        return _accept(row, note)

    projects = ", ".join(
        _row_project_label(row, prop_map) or "Unknown" for row, _ in matches
    )
    result["warning"] = (
        f"Dependency '{entry}' is ambiguous — {len(matches)} tasks match "
        f"(projects: {projects}); use 'uuid:Title', a row UUID, or ref:<external-ref>"
    )
    return result


def _resolve_dependencies(
    storage: NousStorage,
    notebook_id: str,
    db_page_id: str,
    project_name: str,
    dep_names: list[str],
    get_archive=None,
) -> tuple[str, list[str]]:
    """Resolve dependency references to the canonical stored string.

    Each entry may be a task title, a bare row UUID, "uuid:Title", or
    "ref:<external-ref>" — see _resolve_dep_ref. Resolution spans projects
    and epics (single shared database), falling back to the archive
    database for deps on archived (Done) work.

    Returns (depends_on_value, warnings) where depends_on_value joins the
    canonical "uuid:Title" entries with ", "; unresolved entries keep their
    original text (fail-closed: blocked-resolution reports them unmet).
    """
    db_content = storage.read_database_content(notebook_id, db_page_id)
    if db_content is None:
        return ", ".join(dep_names), ["Could not read database to resolve dependencies"]

    properties = db_content.get("properties", [])
    if not any(p["name"].lower() == "task" for p in properties):
        return ", ".join(dep_names), ["Task property not found in database"]

    resolved: list[str] = []
    warnings: list[str] = []
    for dep_name in dep_names:
        ref = _resolve_dep_ref(db_content, dep_name, project_name, get_archive)
        resolved.append(ref["canonical"])
        if ref["warning"]:
            warnings.append(ref["warning"])
        elif ref["note"]:
            warnings.append(f"Dependency '{dep_name}': {ref['note']}")

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


def _row_project_label(row: dict, prop_map: dict) -> str:
    """Resolve the Project select label for a row. Returns '' if unset."""
    proj_prop = prop_map.get("project")
    if not proj_prop:
        return ""
    cell = row.get("cells", {}).get(proj_prop["id"], "")
    if not cell:
        return ""
    options = {o["id"]: o["label"] for o in proj_prop.get("options", [])}
    return options.get(cell, str(cell))


def _find_task_rows(
    db_content: dict,
    task_name: str,
    project: str | None = None,
) -> tuple[list[tuple[dict, int]], dict]:
    """Find ALL database rows matching a task name (case-insensitive exact).

    Optionally filters by the Project select label. Returns (matches, prop_map)
    where matches is a list of (row, row_index) and prop_map is
    {prop_name_lower: prop_dict}.
    """
    properties = db_content.get("properties", [])
    prop_map = {p["name"].lower(): p for p in properties}

    task_prop = prop_map.get("task")
    if task_prop is None:
        return [], prop_map

    task_prop_id = task_prop["id"]
    name_lower = task_name.lower()
    project_lower = project.strip().lower() if project else None

    matches: list[tuple[dict, int]] = []
    for i, row in enumerate(db_content.get("rows", [])):
        cell_val = row.get("cells", {}).get(task_prop_id, "")
        clean = re.sub(r"<[^>]+>", "", str(cell_val))
        clean = html_unescape(clean).strip().lower()
        if clean != name_lower:
            continue
        if (
            project_lower is not None
            and _row_project_label(row, prop_map).lower() != project_lower
        ):
            continue
        matches.append((row, i))

    return matches, prop_map


def _task_ambiguity_error(
    task_name: str,
    matches: list[tuple[dict, int]],
    prop_map: dict,
) -> ValueError:
    """Build an honest error for a task name matching multiple rows."""
    projects = [_row_project_label(row, prop_map) or "Unknown" for row, _ in matches]
    return ValueError(
        f"{len(matches)} tasks match '{task_name}' "
        f"(projects: {', '.join(projects)}) — pass project= or a page/row UUID"
    )


def _find_task_row(
    db_content: dict,
    task_name: str,
    project: str | None = None,
) -> tuple[dict | None, int | None, dict]:
    """Find the single database row matching a task name.

    Returns (row, row_index, prop_map) where prop_map is {prop_name_lower: prop_dict}.
    Row and row_index are None if not found. Raises ValueError when several
    rows match (duplicate titles across projects) — never silently returns
    the first match; pass project= to disambiguate.
    """
    matches, prop_map = _find_task_rows(db_content, task_name, project)
    if len(matches) > 1:
        raise _task_ambiguity_error(task_name, matches, prop_map)
    if matches:
        row, i = matches[0]
        return row, i, prop_map
    return None, None, prop_map


def _pick_page_by_project(
    daemon,
    notebook_id: str,
    title: str,
    project: str | None,
) -> dict | None:
    """Among pages with a duplicated title, pick the one tagged with project.

    Task pages carry the project name (lowercased) as a tag. Returns the full
    page when exactly one candidate matches, else None.
    """
    if not project:
        return None
    try:
        pages = daemon.list_pages(notebook_id)
    except DaemonError:
        return None

    title_lower = title.lower()
    proj_tag = project.strip().lower()

    def _matches(p: dict, exact: bool) -> bool:
        if p.get("deletedAt"):
            return False
        page_title = str(p.get("title", "")).lower()
        title_ok = page_title == title_lower if exact else page_title.startswith(title_lower)
        return title_ok and proj_tag in [str(t).lower() for t in p.get("tags", [])]

    candidates = [p for p in pages if _matches(p, exact=True)]
    if not candidates:
        candidates = [p for p in pages if _matches(p, exact=False)]
    if len(candidates) == 1:
        # Re-resolve by UUID for the full page (list entries may be trimmed).
        return daemon.resolve_page(notebook_id, candidates[0]["id"])
    return None


def _resolve_task_page(
    daemon,
    notebook_id: str,
    task_name: str,
    project: str | None = None,
) -> dict:
    """Resolve a task's page by title, reporting duplicates honestly.

    Tries 'Task: {name}' then the bare name (the daemon matches exact title
    first, then prefix). When the daemon reports an ambiguous title, tries to
    narrow to a single page by project tag; failing that, raises the honest
    ambiguity error instead of masking it as "not found".
    """
    ambiguous: str | None = None
    for title in (f"Task: {task_name}", task_name):
        try:
            return daemon.resolve_page(notebook_id, title)
        except (DaemonError, ValueError) as e:
            msg = str(e)
            if "ambiguous title" in msg.lower():
                page = _pick_page_by_project(daemon, notebook_id, title, project)
                if page is not None:
                    return page
                ambiguous = ambiguous or msg
            elif (
                "no page matching" in msg.lower()
                or "not found" in msg.lower()
                or "(404)" in msg
            ):
                continue
            else:
                raise

    if ambiguous:
        hint = f" (project '{project}' did not narrow it down)" if project else ""
        raise ValueError(
            f"Multiple pages match task '{task_name}'{hint} — "
            f"pass project= or a page UUID. Daemon said: {ambiguous}"
        )
    raise ValueError(
        f"Task '{task_name}' not found. "
        f"Tried both 'Task: {task_name}' and '{task_name}'."
    )


def _resolve_task_target(
    daemon,
    notebook_id: str,
    db_content: dict,
    task: str,
    project: str | None = None,
) -> tuple[str, dict | None, int | None, dict, dict | None]:
    """Resolve a task identifier (name, page UUID, or row UUID) row-first.

    Returns (task_name, row, row_index, prop_map, page). page is only set when
    task was a page UUID (already fetched); otherwise callers resolve it via
    _resolve_task_page. row is None when no database row matches (page-only
    task). Raises ValueError with an honest ambiguity message when several
    rows match and neither project= nor a UUID disambiguates.
    """
    task_str = task.strip()

    if UUID_RE.match(task_str):
        # Row UUID?
        prop_map = {p["name"].lower(): p for p in db_content.get("properties", [])}
        for i, row in enumerate(db_content.get("rows", [])):
            if row.get("id") == task_str:
                name = _get_row_task_name(row, db_content)
                return name, row, i, prop_map, None
        # Page UUID?
        try:
            page = daemon.resolve_page(notebook_id, task_str)
        except (DaemonError, ValueError):
            page = None
        if page is None:
            raise ValueError(f"No task row or page found for UUID '{task_str}'")
        name = str(page.get("title", "")).strip()
        if name.lower().startswith("task: "):
            name = name[6:].strip()
        matches, prop_map = _find_task_rows(db_content, name, project)
        if len(matches) > 1:
            # Use the page's project tag to pick the matching row.
            page_tags = {str(t).lower() for t in page.get("tags", [])}
            narrowed = [
                (r, i)
                for r, i in matches
                if _row_project_label(r, prop_map).lower() in page_tags
            ]
            if len(narrowed) == 1:
                matches = narrowed
        if len(matches) > 1:
            raise _task_ambiguity_error(name, matches, prop_map)
        row, idx = matches[0] if matches else (None, None)
        return name, row, idx, prop_map, page

    # Name path — strip optional "Task: " prefix.
    name = task_str
    if name.lower().startswith("task: "):
        name = name[6:].strip()
    row, idx, prop_map = _find_task_row(db_content, name, project)
    return name, row, idx, prop_map, None


def _check_dependency_status(
    db_content: dict,
    depends_on_value: str,
    get_archive=None,
) -> dict | str:
    """Check if all dependencies are Done.

    Returns "all satisfied" or {"warning": "Dependency 'X' is still 'Y'"}.
    Deps resolving only in the archive database count as satisfied.
    """
    parsed = _parse_depends_on(depends_on_value)
    if not parsed:
        return "all satisfied"

    properties = db_content.get("properties", [])
    has_props = any(p["name"].lower() == "task" for p in properties) and any(
        p["name"].lower() == "status" for p in properties
    )
    if not has_props:
        return "all satisfied"

    warnings: list[str] = []
    for uid, dep_name in parsed:
        dep_row = _resolve_dep_row(db_content, uid, dep_name)
        if dep_row is None:
            archive = get_archive() if get_archive else None
            if archive and _resolve_dep_row(archive, uid, dep_name):
                continue  # archived ⇒ Done ⇒ satisfied
            raw = _raw_dep_entry(uid, dep_name)
            warnings.append(f"Dependency '{raw}' not found in database")
            continue

        status_label = _get_row_status(dep_row, db_content)
        if status_label.lower() != "done":
            warnings.append(f"Dependency '{dep_name}' is still '{status_label}'")

    if warnings:
        return {"warning": "; ".join(warnings)}
    return "all satisfied"


def _parse_depends_on(value: str) -> list[tuple[str | None, str]]:
    """Parse a depends_on field value into (uuid_or_none, name) tuples.

    Handles the canonical "uuid:Name" form, free-text ("Name"), and
    "ref:<external-ref>" entries (kept whole in the name slot — resolved
    against the External Ref column by _resolve_dep_row).
    """
    if not value or value.strip().lower() == "none":
        return []

    entries = [e.strip() for e in value.split(",") if e.strip()]
    result: list[tuple[str | None, str]] = []
    for entry in entries:
        if entry.lower().startswith("ref:"):
            result.append((None, entry))
        elif ":" in entry and UUID_RE.match(entry.partition(":")[0].strip()):
            uid, _, name = entry.partition(":")
            result.append((uid.strip(), name.strip()))
        else:
            # Free text — colons stay part of the name ("External: firmware
            # 3.2 release"), so the entry round-trips through _raw_dep_entry.
            result.append((None, entry))
    return result


def _rows_by_external_ref(db_content: dict, ref_value: str) -> list[dict]:
    """Find rows whose External Ref cell equals ref_value (case-insensitive)."""
    properties = db_content.get("properties", [])
    ext_prop = next(
        (p for p in properties if p["name"].lower() == "external ref"), None
    )
    if ext_prop is None:
        return []
    ref_lower = ref_value.strip().lower()
    if not ref_lower:
        return []
    return [
        r
        for r in db_content.get("rows", [])
        if str(r.get("cells", {}).get(ext_prop["id"], "")).strip().lower() == ref_lower
    ]


def _resolve_dep_row(
    db_content: dict,
    uid: str | None,
    name: str,
) -> dict | None:
    """Resolve a dependency to a database row by UUID, external ref, or name.

    The database holds all projects' tasks, so resolution naturally spans
    projects and epics. "ref:<external-ref>" names resolve via the External
    Ref column and fail closed (None) when missing or ambiguous.
    """
    rows = db_content.get("rows", [])

    # Try UUID first
    if uid:
        for r in rows:
            if r["id"] == uid:
                return r

    # ref:<external-ref> — resolve via the External Ref column only
    if name.lower().startswith("ref:"):
        matches = _rows_by_external_ref(db_content, name[4:])
        return matches[0] if len(matches) == 1 else None

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


def _query_tasks(
    db_content: dict,
    *,
    project: str | None = None,
    feature: str | None = None,
    status: str | None = None,
    phase: str | None = None,
    priority_max: int | None = None,
    has_external_ref: bool | None = None,
    include_done: bool = False,
    execution_mode: str | None = None,
    model_tier: str | None = None,
    task_type: str | None = None,
    complexity: str | None = None,
    worker_ready: bool = False,
    search: str | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Extract tasks from database content with flexible filtering.

    All filters are optional. When multiple filters are provided, they are
    ANDed together. Returns list of dicts with id, task, project, status,
    priority, phase, feature, external_ref, deps, _depends_on_raw, plus
    execution_mode, model_tier, estimate, complexity, task_type, max_files,
    requires_tests.

    Filters:
    - execution_mode: Match exact label ("Manual", "Auto-OK", "Auto-Preferred"),
      or comma-separated list. Null values match "Manual" (null-as-manual).
    - model_tier / task_type / complexity: Match exact label.
    - worker_ready: Shortcut for execution_mode IN (Auto-OK, Auto-Preferred)
      AND status=Ready AND blocked=False. Post-filters unblocked tasks upstream
      of this function.
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
    feature_prop = prop_map.get("feature")
    ext_ref_prop = prop_map.get("external ref")

    # Autonomy columns (may not exist on older databases yet)
    exec_mode_prop = prop_map.get("execution mode")
    model_tier_prop = prop_map.get("model tier")
    estimate_prop = prop_map.get("estimate")
    complexity_prop = prop_map.get("complexity")
    task_type_prop = prop_map.get("task type")
    max_files_prop = prop_map.get("max files")
    requires_tests_prop = prop_map.get("requires tests")

    if not task_prop or not project_prop:
        return []

    # Build option maps
    proj_options = {o["id"]: o["label"] for o in project_prop.get("options", [])}
    status_options = {o["id"]: o["label"] for o in status_prop.get("options", [])} if status_prop else {}
    phase_options = {o["id"]: o["label"] for o in phase_prop.get("options", [])} if phase_prop else {}

    def _select_label(prop: dict | None, cell_value) -> str:
        """Resolve a select cell id back to its label. Returns '' if null/missing."""
        if not prop or not cell_value:
            return ""
        options = {o["id"]: o["label"] for o in prop.get("options", [])}
        return options.get(cell_value, str(cell_value))

    # --- worker_ready shortcut: apply implicit filters ---
    if worker_ready:
        # Force status = Ready
        if status:
            requested = {s.strip().lower() for s in status.split(",")}
            if "ready" not in requested:
                return []
        status = "Ready"
        # Force execution_mode to the auto-* set unless caller narrowed it
        if execution_mode is None:
            execution_mode = "Auto-OK,Auto-Preferred"

    # Normalize filter sets for fields that support comma-separated
    exec_mode_set: set[str] | None = None
    if execution_mode:
        exec_mode_set = {s.strip().lower() for s in execution_mode.split(",")}

    # Pre-compute status filter set
    status_set: set[str] | None = None
    if status:
        status_set = {s.strip().lower() for s in status.split(",")}

    # Free-text search terms — ALL must appear in title/notes/feature
    search_terms = [t for t in (search or "").lower().split() if t]

    result: list[dict] = []
    for row in rows:
        cells = row.get("cells", {})

        # --- Project filter ---
        proj_cell = cells.get(project_prop["id"], "")
        proj_label = proj_options.get(proj_cell, str(proj_cell))
        if project and proj_label.lower() != project.lower():
            continue

        # --- Status ---
        status_cell = cells.get(status_prop["id"], "") if status_prop else ""
        status_label = status_options.get(status_cell, str(status_cell) if status_cell else "Unknown")

        if not include_done and status_label.lower() == "done" and not status_set:
            continue
        if status_set and status_label.lower() not in status_set:
            continue

        # --- Task name ---
        task_cell = cells.get(task_prop["id"], "")
        task_name = re.sub(r"<[^>]+>", "", str(task_cell))
        task_name = html_unescape(task_name).strip()
        if not task_name:
            continue

        # --- Free-text search (title + notes + feature) ---
        feat_cell = str(cells.get(feature_prop["id"], "")).strip() if feature_prop else ""
        if search_terms:
            notes_val = str(cells.get(notes_prop["id"], "")) if notes_prop else ""
            haystack = f"{task_name} {notes_val} {feat_cell}".lower()
            if not all(t in haystack for t in search_terms):
                continue

        # --- Feature filter ---
        if feature:
            if feat_cell:
                if feat_cell.lower() != feature.lower():
                    continue
            else:
                # Fallback heuristic for rows without a Feature value
                match = False
                notes_cell = cells.get(notes_prop["id"], "") if notes_prop else ""
                if feature.lower() in str(notes_cell).lower():
                    match = True
                elif feature.lower() in task_name.lower():
                    match = True
                if not match:
                    continue

        # --- Priority ---
        prio_cell = cells.get(priority_prop["id"], 99) if priority_prop else 99
        try:
            priority_val = int(prio_cell) if prio_cell else 99
        except (ValueError, TypeError):
            priority_val = 99

        if priority_max is not None and priority_val > priority_max:
            continue

        # --- Phase filter ---
        phase_cell = cells.get(phase_prop["id"], "") if phase_prop else ""
        phase_label = phase_options.get(phase_cell, str(phase_cell) if phase_cell else "—")
        if phase and phase_label.lower() != phase.lower():
            continue

        # --- External ref filter ---
        ext_ref_cell = str(cells.get(ext_ref_prop["id"], "")).strip() if ext_ref_prop else ""
        if has_external_ref is True and not ext_ref_cell:
            continue
        if has_external_ref is False and ext_ref_cell:
            continue

        # --- Autonomy fields ---
        exec_mode_label = _select_label(
            exec_mode_prop, cells.get(exec_mode_prop["id"], "") if exec_mode_prop else ""
        )
        # null-as-manual: unset Execution Mode is treated as "Manual"
        exec_mode_effective = exec_mode_label or "Manual"

        model_tier_label = _select_label(
            model_tier_prop, cells.get(model_tier_prop["id"], "") if model_tier_prop else ""
        )
        estimate_label = _select_label(
            estimate_prop, cells.get(estimate_prop["id"], "") if estimate_prop else ""
        )
        complexity_label = _select_label(
            complexity_prop, cells.get(complexity_prop["id"], "") if complexity_prop else ""
        )
        task_type_label = _select_label(
            task_type_prop, cells.get(task_type_prop["id"], "") if task_type_prop else ""
        )
        requires_tests_label = _select_label(
            requires_tests_prop,
            cells.get(requires_tests_prop["id"], "") if requires_tests_prop else "",
        )
        max_files_cell = cells.get(max_files_prop["id"], "") if max_files_prop else ""
        try:
            max_files_val = int(max_files_cell) if max_files_cell not in ("", None) else None
        except (ValueError, TypeError):
            max_files_val = None

        # --- Autonomy filters ---
        if exec_mode_set and exec_mode_effective.lower() not in exec_mode_set:
            continue
        if model_tier and model_tier_label.lower() != model_tier.lower():
            continue
        if task_type and task_type_label.lower() != task_type.lower():
            continue
        if complexity and complexity_label.lower() != complexity.lower():
            continue

        # --- Dependencies ---
        depends_raw = cells.get(depends_prop["id"], "") if depends_prop else ""
        parsed_deps = _parse_depends_on(depends_raw)
        dep_names = [name for _, name in parsed_deps]

        result.append({
            "id": row["id"],
            "task": task_name,
            "project": proj_label,
            "status": status_label,
            "priority": priority_val,
            "phase": phase_label,
            "feature": feat_cell,
            "external_ref": ext_ref_cell,
            "deps": dep_names,
            "_depends_on_raw": depends_raw,
            "execution_mode": exec_mode_effective,
            "model_tier": model_tier_label,
            "estimate": estimate_label,
            "complexity": complexity_label,
            "task_type": task_type_label,
            "max_files": max_files_val,
            "requires_tests": requires_tests_label,
        })

        if limit is not None and len(result) >= limit:
            break

    return result


def _get_project_tasks(
    db_content: dict,
    project_name: str,
    include_done: bool = False,
    feature: str | None = None,
) -> list[dict]:
    """Extract tasks for a project from database content.

    Thin wrapper around _query_tasks for backward compatibility.
    Returns list of dicts with id, task, status, priority, phase, deps, _depends_on_raw.
    """
    return _query_tasks(
        db_content,
        project=project_name,
        feature=feature,
        include_done=include_done,
    )


def _raw_dep_entry(uid: str | None, dep_name: str) -> str:
    """Reconstruct the original cell entry from a parsed (uid, name) pair."""
    return f"{uid}:{dep_name}" if uid else dep_name


def _detect_fragmentation(
    segments: list[str],
    resolved_flags: list[bool],
    known_titles: dict[str, tuple[str, str]],
) -> list[dict]:
    """Find windows of cell segments that rejoin into an existing task title.

    A comma inside a referenced title splits one Depends-On entry into
    several comma-separated segments that resolve to nothing. Every window
    of consecutive segments that (a) contains at least one unresolved
    segment and (b) rejoined with ", " case-insensitively matches a known
    task title is reported with the canonical repair. When the window
    starts at a "uuid:Title" segment, only its title part joins — the
    trailing fragments are debris of that same entry.
    """
    findings: list[dict] = []
    n = len(segments)
    for start in range(n):
        for end in range(start + 1, n):
            if all(resolved_flags[start : end + 1]):
                continue
            parts = list(segments[start : end + 1])
            uid_part, _, title_part = parts[0].partition(":")
            if title_part and UUID_RE.match(uid_part.strip()):
                parts[0] = title_part.strip()
            hit = known_titles.get(", ".join(parts).lower())
            if hit:
                row_id, title = hit
                findings.append(
                    {
                        "fragments": segments[start : end + 1],
                        "matches_title": title,
                        "suggested_entry": f"{row_id}:{title.replace(',', ';')}",
                    }
                )
    return findings


def _archive_database_title(database: str) -> str:
    """Archive database title for a task database."""
    return f"{database} Archive"


def _load_archive_content(
    storage,
    daemon,
    notebook_id: str,
    database: str,
) -> dict | None:
    """Load the archive database content for a task database, or None.

    Missing archive database is the common case — returns None quietly.
    """
    try:
        page = daemon.resolve_page(notebook_id, _archive_database_title(database))
    except (DaemonError, ValueError):
        return None
    if page.get("pageType") != "database":
        return None
    return storage.read_database_content(notebook_id, page["id"])


def _archive_getter(storage, daemon, notebook_id: str, database: str):
    """Build a memoized zero-arg loader for the archive database content.

    Read paths only pay the archive lookup when a dependency actually fails
    to resolve in the active database.
    """
    memo: list = []

    def get() -> dict | None:
        if not memo:
            memo.append(_load_archive_content(storage, daemon, notebook_id, database))
        return memo[0]

    return get


def _is_task_blocked(
    task: dict,
    db_content: dict,
    get_archive=None,
) -> tuple[bool, list[str]]:
    """Check if a task has unmet dependencies.

    Returns (is_blocked, list_of_blocking_task_names). Entries that resolve
    to no row block too (fail closed) and are surfaced as the raw cell entry
    so a human can see what the task is waiting on. get_archive is an
    optional zero-arg loader for the archive database — a dep resolving
    there is satisfied by construction (only Done rows are archived).
    """
    depends_raw = task.get("_depends_on_raw", "")
    parsed = _parse_depends_on(depends_raw)
    if not parsed:
        return False, []

    blocking: list[str] = []
    for uid, dep_name in parsed:
        dep_row = _resolve_dep_row(db_content, uid, dep_name)
        if dep_row:
            dep_status = _get_row_status(dep_row, db_content)
            if dep_status.lower() != "done":
                blocking.append(dep_name)
            continue
        archive = get_archive() if get_archive else None
        if archive and _resolve_dep_row(archive, uid, dep_name):
            continue  # archived ⇒ Done ⇒ satisfied
        blocking.append(_raw_dep_entry(uid, dep_name))

    return bool(blocking), blocking


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
        depends_on: str | list[str] | None = None,
        status: str = "Ready",
        feature: str | None = None,
        external_ref: str | None = None,
        tags: str | list[str] | None = None,
        execution_mode: str | None = None,
        model_tier: str | None = None,
        estimate: str | None = None,
        complexity: str | None = None,
        task_type: str | None = None,
        max_files: int | None = None,
        requires_tests: bool | None = None,
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
            depends_on: Task references this depends on (optional) — a list of
                strings (canonical for programmatic callers: entries are taken
                whole, so titles containing commas work), or a comma-separated
                string for comma-free refs. Dependencies may live in any project
                or epic. Each entry may be: a task title (same-project match
                preferred; a unique cross-project match also resolves; ambiguous
                titles are stored unresolved with a warning), a row UUID,
                "uuid:Title" (the canonical stored form), or "ref:<external-ref>"
                (matched against the External Ref column). Use resolve_tasks to
                validate references before filing.
            status: Status — Spec Needed, Ready, In Progress, or Done (default "Ready").
            feature: Feature name this task belongs to (optional, used by get_feature_tasks).
            external_ref: External reference like a Jira key or GitHub issue (optional).
            tags: Extra tags (optional) — a list, or a comma-separated string.
                "task" and project name are auto-added.
            execution_mode: "Manual" (default, null-as-manual), "Auto-OK", or "Auto-Preferred".
                Gates whether the autonomous task worker can pick up this task.
            model_tier: "auto" (local), "auto-free" (local + free cloud), or "auto-full"
                (local + free + paid). Only consulted when execution_mode is auto-ok/auto-preferred.
            estimate: Size estimate — "xs", "s", "m", "l", or "xl".
            complexity: "routine" (well-worn territory) or "novel" (needs human attention even if short).
            task_type: "bug-fix", "feature", "refactor", "docs", "test", or "chore".
            max_files: Soft scope guardrail — worker bails if more than this many files change.
            requires_tests: If True, worker requires tests to pass before marking Done.
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns JSON with page_id, row_id, title, project, status, warnings.
        """
        from nous_mcp.markdown import markdown_to_blocks

        if "," in title:
            raise ValueError(
                f"Task title contains a comma: '{title}'. Commas break "
                "Depends-On references to this task (the cell format is "
                "comma-separated) — use '—' or ';' instead."
            )

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
            if isinstance(depends_on, str):
                dep_names = [d.strip() for d in depends_on.split(",") if d.strip()]
            else:
                # List form: entries taken whole — the only way to reference
                # an existing task whose title contains a comma.
                dep_names = [d.strip() for d in depends_on if d and d.strip()]
            if dep_names:
                depends_on_value, dep_warnings = _resolve_dependencies(
                    storage,
                    notebook_id,
                    db_page["id"],
                    project,
                    dep_names,
                    _archive_getter(storage, daemon, notebook_id, database),
                )
                warnings.extend(dep_warnings)

        # --- Build tags ---
        tag_list = ["task", project.lower()]
        if status:
            tag_list.append(status.lower().replace(" ", "-"))
        for t in as_list(tags):
            if t.lower() not in [x.lower() for x in tag_list]:
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
        if feature:
            row_data["Feature"] = feature
        if external_ref:
            row_data["External Ref"] = external_ref
        if execution_mode:
            row_data["Execution Mode"] = execution_mode
        if model_tier:
            row_data["Model Tier"] = model_tier
        if estimate:
            row_data["Estimate"] = estimate
        if complexity:
            row_data["Complexity"] = complexity
        if task_type:
            row_data["Task Type"] = task_type
        if max_files is not None:
            row_data["Max Files"] = max_files
        if requires_tests is not None:
            row_data["Requires Tests"] = "Yes" if requires_tests else "No"

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
    def report_issue(
        kind: str,
        title: str,
        details: str,
        project: str | None = None,
        priority: int = 6,
        reported_by: str | None = None,
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """File a bug report or feature request from an agent into Nous.

        Use this when, while working, you hit a bug in a tool/app or think of an
        improvement worth keeping — instead of only mentioning it in chat, where
        it's lost when the session ends. Creates a "Spec Needed" task in a
        dedicated "Agent Feedback" project (auto-created) so reports flow into the
        normal Forge triage without polluting real project backlogs. Triage later
        with query_tasks(project="Agent Feedback") / task_summary.

        Args:
            kind: "bug" or "feature".
            title: Short summary. A "[bug]"/"[feature]" prefix is added if absent.
            details: Full description in markdown — what happened or what's wanted,
                repro steps, expected vs actual, and why it matters.
            project: The project the report is ABOUT (e.g. "Nous"), for triage.
                Recorded in the body and as a tag; the task itself always lands in
                the "Agent Feedback" project.
            priority: 1-10 (default 6 — these are untriaged).
            reported_by: Optional identifier for the reporting agent/session.
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns the created task JSON (page_id, row_id, project, status, warnings).
        """
        feedback_project = "Agent Feedback"

        kind_norm = kind.strip().lower()
        if kind_norm in ("bug", "bug-fix", "bugfix"):
            label, task_type_value, phase = "bug", "bug-fix", "Bugfix"
        elif kind_norm in ("feature", "feature-request", "enhancement"):
            label, task_type_value, phase = "feature", "feature", "Feature"
        else:
            raise ValueError(f"kind must be 'bug' or 'feature', got '{kind}'")

        # Ensure the feedback project exists (idempotent).
        create_project(feedback_project, notebook, database)

        prefixed_title = (
            title if title.lstrip().startswith("[") else f"[{label}] {title}"
        )

        meta_lines = []
        if project:
            meta_lines.append(f"**About:** {project}")
        if reported_by:
            meta_lines.append(f"**Reported by:** {reported_by}")
        meta_lines.append(f"**Kind:** {label}")
        body = "\n".join(meta_lines) + "\n\n" + details

        tag_list = ["agent-report", label]
        if project:
            tag_list.append(project.strip().lower().replace(" ", "-"))

        return create_task(
            project=feedback_project,
            title=prefixed_title,
            content=body,
            priority=priority,
            phase=phase,
            status="Spec Needed",
            task_type=task_type_value,
            tags=",".join(tag_list),
            notebook=notebook,
            database=database,
        )

    @mcp.tool()
    def update_task_status(
        task: str,
        status: str,
        notes: str | None = None,
        external_ref: str | None = None,
        completed_date: str | None = None,
        priority: int | None = None,
        execution_mode: str | None = None,
        model_tier: str | None = None,
        estimate: str | None = None,
        complexity: str | None = None,
        task_type: str | None = None,
        max_files: int | None = None,
        requires_tests: bool | None = None,
        project: str | None = None,
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """Update a task's status in both the page tags and database row.

        Optionally appends implementation notes to the task page.
        When setting status to "Done", auto-sets completed_date to today if not provided.
        When setting status to "In Progress", checks dependency status (advisory, not blocking).

        Args:
            task: Task name (supports "Task: " prefix or bare name, prefix match),
                or a page/row UUID. When the same title exists in several projects,
                pass project= or a UUID to disambiguate.
            status: New status — "Spec Needed", "Ready", "In Progress", or "Done".
            notes: Implementation notes to append to the page (optional).
            external_ref: Set or update the External Ref field (optional).
            completed_date: Completed date in YYYY-MM-DD format (auto-set for Done).
            priority: Update priority 1-10 (lower = higher priority).
            execution_mode: Update autonomy gate — "Manual", "Auto-OK", or "Auto-Preferred".
            model_tier: Update model routing — "auto", "auto-free", or "auto-full".
            estimate: Update size estimate — "xs", "s", "m", "l", or "xl".
            complexity: Update complexity — "routine" or "novel".
            task_type: Update type — "bug-fix", "feature", "refactor", "docs", "test", or "chore".
            max_files: Update soft scope guardrail.
            requires_tests: Update whether tests must pass before marking Done.
            project: Project name, to disambiguate duplicate task titles (optional).
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

        # --- Resolve database ---
        db_page = daemon.resolve_page(notebook_id, database)
        if db_page.get("pageType") != "database":
            raise ValueError(f"Page '{db_page.get('title')}' is not a database")

        db_content = storage.read_database_content(notebook_id, db_page["id"])
        if db_content is None:
            raise ValueError(f"Database file not found for '{database}'")

        # --- Resolve task: row first (project-aware), then page ---
        task_name, row, row_index, prop_map, page = _resolve_task_target(
            daemon, notebook_id, db_content, task, project
        )
        page_title = f"Task: {task_name}"
        if page is None:
            effective_project = project or (
                _row_project_label(row, prop_map) if row else None
            )
            page = _resolve_task_page(daemon, notebook_id, task_name, effective_project)

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
            if priority is not None:
                update_cells["Priority"] = priority
            if execution_mode is not None:
                update_cells["Execution Mode"] = execution_mode
            if model_tier is not None:
                update_cells["Model Tier"] = model_tier
            if estimate is not None:
                update_cells["Estimate"] = estimate
            if complexity is not None:
                update_cells["Complexity"] = complexity
            if task_type is not None:
                update_cells["Task Type"] = task_type
            if max_files is not None:
                update_cells["Max Files"] = max_files
            if requires_tests is not None:
                update_cells["Requires Tests"] = "Yes" if requires_tests else "No"

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
            dependencies = _check_dependency_status(
                db_content,
                depends_on_cell,
                _archive_getter(storage, daemon, notebook_id, database),
            )

        # --- Fire webhook (fire-and-forget) ---
        project_name = "Unknown"
        ext_ref_val = None
        if row and db_content:
            if "project" in prop_map:
                proj_prop = prop_map["project"]
                proj_cell = row.get("cells", {}).get(proj_prop["id"], "")
                proj_options = {o["id"]: o["label"] for o in proj_prop.get("options", [])}
                project_name = proj_options.get(proj_cell, str(proj_cell) if proj_cell else "Unknown")
            if "external ref" in prop_map:
                ext_ref_val = row.get("cells", {}).get(prop_map["external ref"]["id"], "") or None
        _fire_webhook(
            task=task_name,
            project=project_name,
            status=status,
            previous_status=previous_status,
            external_ref=ext_ref_val,
        )

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
    def update_task_fields(
        task: str,
        feature: str | None = None,
        phase: str | None = None,
        depends_on_add: list[str] | None = None,
        depends_on_remove: list[str] | None = None,
        project: str | None = None,
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """Edit board fields on an existing task without touching its status.

        The companion to update_task_status for fields that aren't status
        transitions: no tags rewrite, no webhook, no completed date. Use this
        instead of update_database_rows — no row-UUID lookup needed.

        Args:
            task: Task name (supports "Task: " prefix or bare name), or a
                page/row UUID. When the same title exists in several projects,
                pass project= or a UUID to disambiguate.
            feature: Set the Feature cell. Pass "" to clear it. Omit to leave
                untouched.
            phase: Set the Phase cell. Validated against the database's Phase
                options (e.g. Feature, Infrastructure, Polish, Bugfix, Launch).
            depends_on_add: Dependency references to add. Each may be a task
                title, row UUID, "uuid:Title", or "ref:<external-ref>" — same
                forms as create_task's depends_on; resolved to the canonical
                "uuid:Title" form (use resolve_tasks to validate first).
                Entries containing a comma are rejected (commas separate cell
                entries). Already-present entries are no-op warnings.
            depends_on_remove: Dependency references to remove, matched by row
                UUID, title, or exact entry text. Not-present entries are
                no-op warnings, not errors.
            project: Project name, to disambiguate duplicate task titles
                (optional). Also the context for resolving added deps by title.
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns JSON with task, row_id, updated field values, and warnings.
        """
        storage = get_storage()
        daemon = get_daemon()
        nb = storage.resolve_notebook(notebook)
        notebook_id = nb["id"]

        if (
            feature is None
            and phase is None
            and not depends_on_add
            and not depends_on_remove
        ):
            raise ValueError(
                "Nothing to update — pass feature, phase, depends_on_add, "
                "or depends_on_remove"
            )

        db_page = daemon.resolve_page(notebook_id, database)
        if db_page.get("pageType") != "database":
            raise ValueError(f"Page '{db_page.get('title')}' is not a database")

        db_content = storage.read_database_content(notebook_id, db_page["id"])
        if db_content is None:
            raise ValueError(f"Database file not found for '{database}'")

        task_name, row, _, prop_map, _page = _resolve_task_target(
            daemon, notebook_id, db_content, task, project
        )
        if row is None:
            raise ValueError(
                f"Task '{task_name}' not found in database '{database}'."
            )

        warnings: list[str] = []
        update_cells: dict[str, str | int] = {}
        updated: dict = {}

        # --- Feature ("" clears) ---
        if feature is not None:
            new_feature = feature.strip()
            update_cells["Feature"] = new_feature
            updated["feature"] = new_feature or None

        # --- Phase (validated against the select's options) ---
        if phase is not None:
            phase_prop = prop_map.get("phase")
            options = (
                [o["label"] for o in phase_prop.get("options", [])]
                if phase_prop
                else []
            )
            match = next(
                (o for o in options if o.lower() == phase.strip().lower()), None
            )
            if match is None:
                raise ValueError(
                    f"Unknown phase '{phase}'. Valid phases: {', '.join(options)}"
                )
            update_cells["Phase"] = match
            updated["phase"] = match

        # --- Depends On add/remove ---
        if depends_on_add or depends_on_remove:
            effective_project = project or _row_project_label(row, prop_map) or None
            get_archive = _archive_getter(storage, daemon, notebook_id, database)
            depends_prop = prop_map.get("depends on")
            raw = (
                str(row.get("cells", {}).get(depends_prop["id"], ""))
                if depends_prop
                else ""
            )
            if raw.strip().lower() in ("", "none"):
                entries: list[str] = []
            else:
                entries = [e.strip() for e in raw.split(",") if e.strip()]

            def _entry_refers_to(existing: str, resolved: dict, ref: str) -> bool:
                """Does an existing cell entry refer to the same task as ref?"""
                if existing.lower() == ref.lower():
                    return True
                dep_row = resolved["row"]
                if dep_row is None:
                    return False
                uid, name = _parse_depends_on(existing)[0]
                if uid == dep_row["id"]:
                    return True
                title = _get_row_task_name(
                    dep_row, resolved.get("source") or db_content
                )
                return bool(title) and name.lower() == title.lower()

            for ref in depends_on_remove or []:
                ref = ref.strip()
                if not ref:
                    continue
                resolved = _resolve_dep_ref(
                    db_content, ref, effective_project, get_archive
                )
                kept = [
                    e for e in entries if not _entry_refers_to(e, resolved, ref)
                ]
                if len(kept) == len(entries):
                    warnings.append(
                        f"Remove: '{ref}' not present in Depends On — no-op"
                    )
                entries = kept

            for ref in depends_on_add or []:
                ref = ref.strip()
                if not ref:
                    continue
                if "," in ref:
                    raise ValueError(
                        f"Dependency entry '{ref}' contains a comma — commas "
                        f"separate Depends On entries. Pass one reference per "
                        f"list item (use a row UUID or ref:<external-ref> for "
                        f"comma-containing titles)."
                    )
                resolved = _resolve_dep_ref(
                    db_content, ref, effective_project, get_archive
                )
                if resolved["warning"]:
                    warnings.append(resolved["warning"])
                elif resolved["note"]:
                    warnings.append(f"Dependency '{ref}': {resolved['note']}")
                if any(_entry_refers_to(e, resolved, ref) for e in entries) or (
                    resolved["canonical"] in entries
                ):
                    warnings.append(
                        f"Add: '{ref}' already present in Depends On — no-op"
                    )
                    continue
                entries.append(resolved["canonical"])

            new_value = ", ".join(entries) if entries else "None"
            update_cells["Depends On"] = new_value
            updated["depends_on"] = new_value

        daemon.update_database_rows(
            notebook_id,
            db_page["id"],
            [{"row": row["id"], "cells": update_cells}],
        )

        return json.dumps(
            {
                "task": task_name,
                "row_id": row["id"],
                "updated": updated,
                "warnings": warnings,
            },
            indent=2,
        )

    @mcp.tool()
    def check_dependencies(
        task: str,
        project: str | None = None,
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """Check the dependency status of a task.

        Resolves each dependency and reports its status. Depends On entries
        may be "uuid:Title" (canonical), a bare title, or "ref:<external-ref>";
        all resolve across projects and epics (one shared database). Entries
        that don't resolve report status "Not Found" and block (fail closed).

        Args:
            task: Task name (supports "Task: " prefix or bare name), or a
                page/row UUID. When the same title exists in several projects,
                pass project= or a UUID to disambiguate.
            project: Project name, to disambiguate duplicate task titles (optional).
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns JSON with task, status, ready (bool), dependencies list,
        blocking list, and unresolved list. unresolved ⊆ blocking: entries
        matching no row, surfaced as the raw cell text — a typo or an
        external prerequisite, as opposed to a known-but-unmet task.
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

        # Find the task row (row-first, project-aware, honest on duplicates)
        task_name, row, _, prop_map, _page = _resolve_task_target(
            daemon, notebook_id, db_content, task, project
        )
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
        unresolved: list[str] = []
        get_archive = _archive_getter(storage, daemon, notebook_id, database)

        for uid, dep_name in parsed:
            dep_row = _resolve_dep_row(db_content, uid, dep_name)
            if dep_row is None:
                archive = get_archive()
                arch_row = (
                    _resolve_dep_row(archive, uid, dep_name) if archive else None
                )
                if arch_row is not None:
                    dep_results.append({
                        "task": _get_row_task_name(arch_row, archive) or dep_name,
                        "status": "Done (archived)",
                        "satisfied": True,
                        "archived": True,
                    })
                    continue
                raw = _raw_dep_entry(uid, dep_name)
                dep_results.append({
                    "task": raw,
                    "status": "Not Found",
                    "satisfied": False,
                    "resolved": False,
                })
                blocking.append(raw)
                unresolved.append(raw)
                continue

            dep_status = _get_row_status(dep_row, db_content)
            satisfied = dep_status.lower() == "done"
            entry: dict = {
                "task": _get_row_task_name(dep_row, db_content) or dep_name,
                "status": dep_status,
                "satisfied": satisfied,
            }
            if dep_name.lower().startswith("ref:"):
                entry["ref"] = dep_name
            dep_project = _row_project_label(dep_row, prop_map)
            if dep_project:
                entry["project"] = dep_project
            dep_results.append(entry)
            if not satisfied:
                blocking.append(entry["task"])

        return json.dumps(
            {
                "task": task_name,
                "status": task_status,
                "ready": len(blocking) == 0,
                "dependencies": dep_results,
                "blocking": blocking,
                "unresolved": unresolved,
            },
            indent=2,
        )

    @mcp.tool()
    def resolve_tasks(
        refs: str,
        project: str | None = None,
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """Validate task references before filing them as dependencies.

        The cheap pre-flight for architect passes and pipeline emitters:
        checks that each reference resolves to exactly one existing Forge
        task, across all projects and epics, and returns the canonical
        "uuid:Title" form to store in Depends On.

        Args:
            refs: Comma-separated task references. Each may be a task title,
                a row UUID, "uuid:Title", or "ref:<external-ref>" (matched
                against the External Ref column, e.g. pipeline:{epic}:{leaf}).
            project: Project context — same-project matches win for bare
                titles duplicated across projects (optional).
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns JSON: {resolved_all, results: [{ref, resolved, canonical,
        row_id, task, project, status, feature, warning}]}. Unresolved or
        ambiguous refs carry a warning explaining how to qualify them.
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

        prop_map = {p["name"].lower(): p for p in db_content.get("properties", [])}
        get_archive = _archive_getter(storage, daemon, notebook_id, database)

        results: list[dict] = []
        for raw in refs.split(","):
            raw = raw.strip()
            if not raw:
                continue
            ref = _resolve_dep_ref(db_content, raw, project, get_archive)
            row = ref["row"]
            source = ref["source"] or db_content
            source_prop_map = (
                prop_map
                if source is db_content
                else {p["name"].lower(): p for p in source.get("properties", [])}
            )
            entry: dict = {
                "ref": raw,
                "resolved": row is not None,
                "canonical": ref["canonical"] if row is not None else None,
            }
            if row is not None:
                entry["row_id"] = row["id"]
                entry["task"] = _get_row_task_name(row, source)
                entry["project"] = _row_project_label(row, source_prop_map) or None
                entry["status"] = _get_row_status(row, source)
                if ref["archived"]:
                    entry["archived"] = True
                feature_prop = source_prop_map.get("feature")
                if feature_prop:
                    feat = str(row.get("cells", {}).get(feature_prop["id"], "")).strip()
                    if feat:
                        entry["feature"] = feat
            if ref["warning"]:
                entry["warning"] = ref["warning"]
            elif ref["note"]:
                entry["note"] = ref["note"]
            results.append(entry)

        return json.dumps(
            {
                "resolved_all": all(r["resolved"] for r in results),
                "results": results,
            },
            indent=2,
        )

    @mcp.tool()
    def lint_dependencies(
        project: str | None = None,
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """Audit every Depends-On cell for silent-failure hazards (read-only).

        Scans all task rows (optionally one project) and reports, per row:

        - unresolved: entries resolving to no task (typo'd title, missing
          UUID, dangling ref:) — fail-closed blocking treats these as unmet.
        - ambiguous: titles matching several tasks across projects.
        - fragmentation: probable comma-in-title damage — consecutive
          segments that rejoined with ", " match an existing task title
          (active or archive), with the suggested canonical "uuid:Title"
          repair.

        Makes no writes. Apply repairs via update_task_fields
        (depends_on_remove the fragments, depends_on_add the suggestion).

        Args:
            project: Only lint rows of this project (optional).
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns JSON: {rows_checked, rows_with_issues, filters, issues:
        [{task, row_id, project, unresolved?, ambiguous?, fragmentation?}]}.
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

        prop_map = {p["name"].lower(): p for p in db_content.get("properties", [])}
        dep_prop = prop_map.get("depends on")
        if dep_prop is None:
            raise ValueError("Depends On property not found in database")
        get_archive = _archive_getter(storage, daemon, notebook_id, database)

        def _titles_of(content: dict | None) -> dict[str, tuple[str, str]]:
            out: dict[str, tuple[str, str]] = {}
            if not content:
                return out
            for r in content.get("rows", []):
                t = _get_row_task_name(r, content)
                if t:
                    out.setdefault(t.lower(), (r["id"], t))
            return out

        # Active titles win over archive titles for repair suggestions.
        known_titles = {**_titles_of(get_archive()), **_titles_of(db_content)}

        rows_checked = 0
        issues: list[dict] = []
        for row in db_content.get("rows", []):
            row_project = _row_project_label(row, prop_map) or None
            if project and (row_project or "").lower() != project.lower():
                continue
            raw_cell = str(row.get("cells", {}).get(dep_prop["id"], "")).strip()
            if not raw_cell or raw_cell.lower() == "none":
                continue
            rows_checked += 1

            segments = [s.strip() for s in raw_cell.split(",") if s.strip()]
            resolved_flags: list[bool] = []
            unresolved: list[str] = []
            ambiguous: list[str] = []
            for seg in segments:
                ref = _resolve_dep_ref(db_content, seg, row_project, get_archive)
                ok = ref["row"] is not None
                resolved_flags.append(ok)
                if not ok:
                    if ref["warning"] and "ambiguous" in ref["warning"].lower():
                        ambiguous.append(ref["warning"])
                    else:
                        unresolved.append(seg)

            fragmentation: list[dict] = []
            if len(segments) > 1 and not all(resolved_flags):
                fragmentation = _detect_fragmentation(
                    segments, resolved_flags, known_titles
                )

            if unresolved or ambiguous or fragmentation:
                issue: dict = {
                    "task": _get_row_task_name(row, db_content),
                    "row_id": row["id"],
                    "project": row_project,
                }
                if unresolved:
                    issue["unresolved"] = unresolved
                if ambiguous:
                    issue["ambiguous"] = ambiguous
                if fragmentation:
                    issue["fragmentation"] = fragmentation
                issues.append(issue)

        filters: dict = {}
        if project:
            filters["project"] = project
        return json.dumps(
            {
                "rows_checked": rows_checked,
                "rows_with_issues": len(issues),
                "filters": filters,
                "issues": issues,
            },
            indent=2,
        )

    @mcp.tool()
    def archive_tasks(
        before: str | None = None,
        project: str | None = None,
        dry_run: bool = True,
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """Move old Done rows to the archive database ("<database> Archive").

        Keeps the active database at working-set size while preserving all
        history: rows move verbatim (same row UUIDs, same property ids) so
        canonical "uuid:Title" dependency references keep resolving — deps
        that resolve into the archive count as satisfied by construction.
        Task pages are not touched; they remain the full historical record.
        Archived rows are visible via query_tasks(include_archived=True),
        get_task_spec, and resolve_tasks.

        Args:
            before: Cutoff date (YYYY-MM-DD). Rows with Status=Done and a
                Completed date strictly before this move. Default: 90 days ago.
            project: Only archive rows of this project (optional).
            dry_run: Default True — report what would move without writing.
                Pass False to actually move rows.
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns JSON with cutoff, candidates (task/project/completed),
        skipped_no_date count, and moved count (0 on dry runs). Idempotent:
        rows already present in the archive are not duplicated, so an
        interrupted run heals on the next invocation.
        """
        storage = get_storage()
        daemon = get_daemon()
        nb = storage.resolve_notebook(notebook)
        notebook_id = nb["id"]

        if before is None:
            before = (date.today() - timedelta(days=90)).isoformat()

        db_page = daemon.resolve_page(notebook_id, database)
        if db_page.get("pageType") != "database":
            raise ValueError(f"Page '{db_page.get('title')}' is not a database")

        db_content = storage.read_database_content(notebook_id, db_page["id"])
        if db_content is None:
            raise ValueError(f"Database file not found for '{database}'")

        prop_map = {p["name"].lower(): p for p in db_content.get("properties", [])}
        completed_prop = prop_map.get("completed")
        if completed_prop is None:
            raise ValueError(
                f"Database '{database}' has no Completed column — nothing to cut on"
            )

        # --- Collect candidates: Done, completed strictly before the cutoff ---
        candidates: list[dict] = []
        skipped_no_date = 0
        for r in db_content.get("rows", []):
            if _get_row_status(r, db_content).lower() != "done":
                continue
            row_project = _row_project_label(r, prop_map)
            if project and row_project.lower() != project.lower():
                continue
            completed = str(r.get("cells", {}).get(completed_prop["id"], "")).strip()
            if not completed:
                skipped_no_date += 1
                continue
            if completed[:10] >= before:
                continue
            candidates.append(r)

        summary = [
            {
                "task": _get_row_task_name(r, db_content),
                "project": _row_project_label(r, prop_map) or None,
                "completed": str(
                    r.get("cells", {}).get(completed_prop["id"], "")
                ).strip(),
            }
            for r in candidates
        ]

        result: dict = {
            "cutoff": before,
            "dry_run": dry_run,
            "candidates": summary,
            "candidate_count": len(candidates),
            "skipped_no_date": skipped_no_date,
            "moved": 0,
        }
        if dry_run or not candidates:
            return json.dumps(result, indent=2)

        # --- Ensure the archive database exists ---
        archive_title = _archive_database_title(database)
        try:
            archive_page = daemon.resolve_page(notebook_id, archive_title)
        except (DaemonError, ValueError):
            archive_page = None
        if archive_page is None:
            created = daemon.create_database(
                notebook_id,
                archive_title,
                [{"name": "Task", "type": "text"}],
                tags=["tasks", "archive"],
                folder_id=db_page.get("folderId"),
            )
            archive_page = {"id": created["id"], "pageType": "database"}
            archive_content: dict | None = None
        else:
            if archive_page.get("pageType") != "database":
                raise ValueError(f"Page '{archive_title}' is not a database")
            archive_content = storage.read_database_content(
                notebook_id, archive_page["id"]
            )

        existing_rows = (archive_content or {}).get("rows", [])
        existing_ids = {r["id"] for r in existing_rows}
        new_rows = [r for r in candidates if r["id"] not in existing_ids]

        # Archive properties mirror the active database verbatim — rows'
        # cells are keyed by property id, so ids must match exactly.
        merged = {
            "version": db_content.get("version", 2),
            "properties": db_content.get("properties", []),
            "rows": existing_rows + new_rows,
            "views": (archive_content or {}).get("views", []),
        }

        # Write archive first, then delete from active: a crash in between
        # duplicates rows (healed by the idempotent rerun) instead of
        # losing them.
        storage.write_database_content(notebook_id, archive_page["id"], merged)
        daemon.delete_database_rows(
            notebook_id, db_page["id"], [r["id"] for r in candidates]
        )

        result["moved"] = len(candidates)
        result["already_archived"] = len(candidates) - len(new_rows)
        result["archive_database_id"] = archive_page["id"]
        logger.info(
            "Archived %d task rows (cutoff %s) to '%s'",
            len(candidates),
            before,
            archive_title,
        )
        return json.dumps(result, indent=2)

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
        project: str | None = None,
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """Get the full spec for a task: page content, metadata, and dependency status.

        Single call for agents starting work on a task. Returns markdown
        combining metadata header, guardrails, dependency status, and page content.

        Args:
            task: Task name (supports "Task: " prefix or bare name), or a
                page/row UUID. When the same title exists in several projects,
                pass project= or a UUID to disambiguate.
            project: Project name, to disambiguate duplicate task titles (optional).
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns markdown with metadata, guardrails, and full page content.
        Metadata includes Row ID and Page ID — both usable as the task
        argument in other task tools (and row ids in update_database_rows).
        """
        from nous_mcp.markdown import export_page_to_markdown

        storage = get_storage()
        daemon = get_daemon()
        nb = storage.resolve_notebook(notebook)
        notebook_id = nb["id"]

        # --- Get database metadata (row-first, project-aware resolution) ---
        db_page = daemon.resolve_page(notebook_id, database)
        db_content = None
        if db_page.get("pageType") == "database":
            db_content = storage.read_database_content(notebook_id, db_page["id"])

        task_name = task.strip()
        if task_name.lower().startswith("task: "):
            task_name = task_name[6:].strip()
        row = None
        prop_map: dict = {}
        page: dict | None = None
        if db_content:
            task_name, row, _, prop_map, page = _resolve_task_target(
                daemon, notebook_id, db_content, task, project
            )

        # --- Archive fallback: metadata for archived tasks ---
        active_content = db_content
        archived_row = False
        get_archive = _archive_getter(storage, daemon, notebook_id, database)
        if row is None and db_content is not None:
            archive = get_archive()
            if archive:
                matches, arch_prop_map = _find_task_rows(archive, task_name, project)
                if len(matches) == 1:
                    row = matches[0][0]
                    prop_map = arch_prop_map
                    db_content = archive
                    archived_row = True

        # --- Resolve task page (unless the task arg was a page UUID) ---
        if page is None:
            effective_project = project or (
                _row_project_label(row, prop_map) if row else None
            )
            page = _resolve_task_page(daemon, notebook_id, task_name, effective_project)

        # --- Get page content as markdown ---
        page_content = export_page_to_markdown(page)

        # --- Extract metadata from row ---
        project = "Unknown"
        status = "Unknown"
        priority = "—"
        phase = "—"
        external_ref = "None"
        # Autonomy fields (empty strings if not set)
        exec_mode = ""
        model_tier_val = ""
        estimate_val = ""
        complexity_val = ""
        task_type_val = ""
        max_files_val = ""
        requires_tests_val = ""

        def _label(prop_name: str) -> str:
            prop = prop_map.get(prop_name)
            if not prop or not row:
                return ""
            cell = row.get("cells", {}).get(prop["id"], "")
            if not cell:
                return ""
            options = {o["id"]: o["label"] for o in prop.get("options", [])}
            return options.get(cell, str(cell))

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

            # Autonomy fields
            exec_mode = _label("execution mode")
            model_tier_val = _label("model tier")
            estimate_val = _label("estimate")
            complexity_val = _label("complexity")
            task_type_val = _label("task type")
            requires_tests_val = _label("requires tests")
            if "max files" in prop_map:
                mf_cell = cells.get(prop_map["max files"]["id"], "")
                if mf_cell not in ("", None):
                    max_files_val = str(mf_cell)

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
                    dep_db = db_content
                    dep_archived = archived_row
                    if dep_row is None:
                        # The other database: archive for active tasks,
                        # active for archived ones.
                        secondary = (
                            active_content if archived_row else get_archive()
                        )
                        if secondary:
                            dep_row = _resolve_dep_row(secondary, uid, dep_name)
                            if dep_row is not None:
                                dep_db = secondary
                                dep_archived = not archived_row
                    if dep_row:
                        dep_status = _get_row_status(dep_row, dep_db)
                        satisfied = dep_status.lower() == "done"
                        if satisfied:
                            marker = "done (archived)" if dep_archived else "done"
                        else:
                            marker = f"**{dep_status}**"
                        dep_parts.append(f"- {dep_name}: {marker}")
                        if not satisfied:
                            blocking.append(dep_name)
                    else:
                        raw = _raw_dep_entry(uid, dep_name)
                        dep_parts.append(f"- {raw}: **Not Found (unresolved)**")
                        blocking.append(raw)
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
        if row is not None:
            parts.append(f"- **Row ID:** {row['id']}")
        parts.append(f"- **Page ID:** {page['id']}")
        if archived_row:
            parts.append("- **Archived:** Yes (row lives in the archive database)")
        parts.append(f"- **Project:** {project}")
        parts.append(f"- **Status:** {status}")
        parts.append(f"- **Priority:** {priority}")
        parts.append(f"- **Phase:** {phase}")
        parts.append(f"- **External Ref:** {external_ref}")
        # Autonomy fields — always show Execution Mode (null-as-manual)
        if exec_mode:
            parts.append(f"- **Execution Mode:** {exec_mode}")
        else:
            parts.append("- **Execution Mode:** Manual (default)")
        if model_tier_val:
            parts.append(f"- **Model Tier:** {model_tier_val}")
        if estimate_val:
            parts.append(f"- **Estimate:** {estimate_val}")
        if complexity_val:
            parts.append(f"- **Complexity:** {complexity_val}")
        if task_type_val:
            parts.append(f"- **Task Type:** {task_type_val}")
        if max_files_val:
            parts.append(f"- **Max Files:** {max_files_val}")
        if requires_tests_val:
            parts.append(f"- **Requires Tests:** {requires_tests_val}")
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
        status: str | list[str] | None = None,
        include_done: bool = False,
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """Get all tasks for a project/feature in dependency-resolved execution order.

        Returns tasks topologically sorted so no task appears before its dependencies.
        Tasks at the same dependency level are sorted by priority.

        Args:
            project: Project name.
            feature: Optional feature name to filter tasks (matches Feature column).
            status: Optional status filter — a list (["Ready", "In Progress"])
                or comma-separated string. Overrides include_done when set.
            include_done: Include completed tasks (default: False). Ignored if status is set.
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns JSON with project, feature, task counts, and execution_order list.
        """
        status = ",".join(as_list(status)) or None
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

        # When status is explicitly provided, include_done is irrelevant
        effective_include_done = include_done
        if status:
            effective_include_done = True  # status filter handles it

        tasks = _query_tasks(
            db_content,
            project=project,
            feature=feature,
            status=status,
            include_done=effective_include_done,
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
                "row_id": t["id"],
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

    @mcp.tool()
    def query_tasks(
        project: str | None = None,
        feature: str | None = None,
        status: str | list[str] | None = None,
        phase: str | None = None,
        priority_max: int | None = None,
        has_external_ref: bool | None = None,
        blocked: bool | None = None,
        execution_mode: str | None = None,
        model_tier: str | None = None,
        task_type: str | None = None,
        complexity: str | None = None,
        worker_ready: bool = False,
        include_archived: bool = False,
        search: str | None = None,
        limit: int = 20,
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """Query tasks with flexible filters. Returns compact rows, not full page content.

        All filters are optional and ANDed together. Omit all filters to get
        an overview of all non-done tasks. Much cheaper than get_database for
        targeted lookups.

        Args:
            project: Filter by project name (optional).
            feature: Filter by Feature column value (optional).
            status: Filter by status — a list (["Ready", "In Progress"]) or
                comma-separated string. By default, Done tasks are excluded
                unless status explicitly includes "Done".
            phase: Filter by phase (e.g. "Feature", "Infrastructure").
            priority_max: Only tasks with priority <= this value (lower = higher priority).
            has_external_ref: True = only tasks with an external ref, False = only without.
            blocked: True = only tasks with unmet deps, False = only unblocked tasks.
                Deps resolve across projects and epics; unresolvable entries
                count as unmet (fail closed).
            execution_mode: Filter by autonomy gate — comma-separated list of
                "Manual", "Auto-OK", "Auto-Preferred". Null values are treated as "Manual".
            model_tier: Filter by model tier — "auto", "auto-free", or "auto-full".
            task_type: Filter by type — "bug-fix", "feature", "refactor", "docs", "test", "chore".
            complexity: Filter by complexity — "routine" or "novel".
            worker_ready: Convenience flag. True = tasks the autonomous worker can run:
                status=Ready AND execution_mode IN (Auto-OK, Auto-Preferred) AND blocked=False.
                Can be combined with other filters (e.g. project, model_tier) to narrow.
            include_archived: Also search the archive database ("<database> Archive",
                Done rows moved by archive_tasks). Archived rows are marked
                "archived": true. Default False — day-to-day queries stay on
                the active working set.
            search: Free-text keyword search. Whitespace-separated terms must
                ALL appear (case-insensitive) in the task title, Notes, or
                Feature. Composable with every other filter. When set, Done
                tasks are included by default (finding past work is the main
                use) — pass status= to narrow, and include_archived=True to
                also span archived history.
            limit: Max results (default 20, use 0 for unlimited).
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns JSON with filters applied, total count, and compact task list.
        Each row carries row_id, which other task tools accept as the task
        argument to bypass title resolution (handy for duplicate titles).
        """
        status = ",".join(as_list(status)) or None
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

        # Determine if Done tasks should be included. Free-text search
        # includes Done by default — finding past work is its main use.
        include_done = bool(search)
        if status:
            status_set = {s.strip().lower() for s in status.split(",")}
            if "done" in status_set:
                include_done = True

        # worker_ready implies blocked=False post-filter
        effective_blocked = blocked
        if worker_ready and effective_blocked is None:
            effective_blocked = False

        effective_limit = limit if limit > 0 else None
        tasks = _query_tasks(
            db_content,
            project=project,
            feature=feature,
            status=status,
            phase=phase,
            priority_max=priority_max,
            has_external_ref=has_external_ref,
            include_done=include_done,
            execution_mode=execution_mode,
            model_tier=model_tier,
            task_type=task_type,
            complexity=complexity,
            worker_ready=worker_ready,
            search=search,
            limit=None if effective_blocked is not None else effective_limit,
        )

        # Merge in archived rows on request (all Done by construction)
        if include_archived:
            archive = _load_archive_content(storage, daemon, notebook_id, database)
            if archive:
                archived_tasks = _query_tasks(
                    archive,
                    project=project,
                    feature=feature,
                    status=status,
                    phase=phase,
                    priority_max=priority_max,
                    has_external_ref=has_external_ref,
                    include_done=True,
                    execution_mode=execution_mode,
                    model_tier=model_tier,
                    task_type=task_type,
                    complexity=complexity,
                    search=search,
                )
                for t in archived_tasks:
                    t["archived"] = True
                tasks = tasks + archived_tasks
                if effective_blocked is None and effective_limit:
                    tasks = tasks[:effective_limit]

        # Post-filter by blocked status (requires dependency resolution)
        if effective_blocked is not None:
            get_archive = _archive_getter(storage, daemon, notebook_id, database)
            filtered: list[dict] = []
            for t in tasks:
                is_blocked, blocking = _is_task_blocked(t, db_content, get_archive)
                t["blocked_by"] = blocking
                if effective_blocked and is_blocked:
                    filtered.append(t)
                elif not effective_blocked and not is_blocked:
                    filtered.append(t)
            tasks = filtered
            if effective_limit:
                tasks = tasks[:effective_limit]

        # Build compact output
        task_list: list[dict] = []
        for t in tasks:
            entry: dict = {
                "task": t["task"],
                "row_id": t["id"],
                "project": t["project"],
                "status": t["status"],
                "priority": t["priority"],
            }
            if t.get("feature"):
                entry["feature"] = t["feature"]
            if t.get("phase") and t["phase"] != "—":
                entry["phase"] = t["phase"]
            if t.get("external_ref"):
                entry["external_ref"] = t["external_ref"]
            if t.get("deps"):
                entry["deps"] = t["deps"]
            if "blocked_by" in t:
                entry["blocked_by"] = t["blocked_by"]
            # Autonomy fields (only include when non-default/non-empty)
            if t.get("execution_mode") and t["execution_mode"] != "Manual":
                entry["execution_mode"] = t["execution_mode"]
            if t.get("model_tier"):
                entry["model_tier"] = t["model_tier"]
            if t.get("estimate"):
                entry["estimate"] = t["estimate"]
            if t.get("complexity"):
                entry["complexity"] = t["complexity"]
            if t.get("task_type"):
                entry["task_type"] = t["task_type"]
            if t.get("max_files") is not None:
                entry["max_files"] = t["max_files"]
            if t.get("requires_tests"):
                entry["requires_tests"] = t["requires_tests"]
            if t.get("archived"):
                entry["archived"] = True
            task_list.append(entry)

        return json.dumps({
            "total": len(task_list),
            "filters": {
                k: v for k, v in {
                    "project": project, "feature": feature,
                    "status": status, "phase": phase,
                    "priority_max": priority_max,
                    "has_external_ref": has_external_ref,
                    "blocked": blocked,
                    "execution_mode": execution_mode,
                    "model_tier": model_tier,
                    "task_type": task_type,
                    "complexity": complexity,
                    "worker_ready": worker_ready if worker_ready else None,
                    "include_archived": include_archived if include_archived else None,
                    "search": search,
                }.items() if v is not None
            },
            "tasks": task_list,
        }, indent=2)

    @mcp.tool()
    def get_next_task(
        project: str,
        feature: str | None = None,
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """Get the highest-priority unblocked task ready for work.

        Returns the single best task to work on next: highest priority among
        Ready tasks whose dependencies are all Done. Includes full spec content
        so an agent can start immediately.

        Args:
            project: Project name.
            feature: Optional feature name to filter by.
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns the task spec (same as get_task_spec) or a message if no tasks
        are available.
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

        tasks = _query_tasks(
            db_content,
            project=project,
            feature=feature,
            status="Ready",
        )

        # Sort by priority (lower = higher priority)
        tasks.sort(key=lambda t: t["priority"])

        # Find first unblocked task
        get_archive = _archive_getter(storage, daemon, notebook_id, database)
        for t in tasks:
            is_blocked, _ = _is_task_blocked(t, db_content, get_archive)
            if not is_blocked:
                # Delegate to get_task_spec for the full output. Pass the row
                # UUID so duplicate titles across projects can't derail it.
                return get_task_spec(
                    task=t["id"],
                    project=project,
                    notebook=notebook,
                    database=database,
                )

        # No unblocked tasks — report what's available
        if tasks:
            blocked_names = []
            for t in tasks:
                _, blocking = _is_task_blocked(t, db_content, get_archive)
                blocked_names.append(
                    f"- {t['task']} (blocked by: {', '.join(blocking)})"
                )
            return json.dumps({
                "status": "all_blocked",
                "message": f"All {len(tasks)} Ready tasks are blocked by unmet dependencies.",
                "blocked_tasks": blocked_names,
            }, indent=2)

        return json.dumps({
            "status": "none_available",
            "message": f"No Ready tasks found for project '{project}'"
            + (f", feature '{feature}'" if feature else "")
            + ".",
        }, indent=2)

    @mcp.tool()
    def task_summary(
        project: str | None = None,
        notebook: str = "Forge",
        database: str = "Project Tasks",
    ) -> str:
        """Get a compact summary of task counts by project, status, and feature.

        Much cheaper than reading the full database. Use for planning sessions
        and status checks.

        Args:
            project: Optional project name. If omitted, summarizes all projects.
            notebook: Notebook name or UUID (default: "Forge").
            database: Task database title (default: "Project Tasks").

        Returns JSON with per-project breakdowns by status and feature.
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

        # Get all tasks including done
        all_tasks = _query_tasks(
            db_content,
            project=project,
            include_done=True,
        )

        # Build per-project summary
        projects: dict[str, dict] = {}
        for t in all_tasks:
            proj = t["project"]
            if proj not in projects:
                projects[proj] = {
                    "total": 0,
                    "by_status": {},
                    "by_feature": {},
                }
            p = projects[proj]
            p["total"] += 1

            st = t["status"]
            p["by_status"][st] = p["by_status"].get(st, 0) + 1

            feat = t.get("feature") or "(none)"
            if feat not in p["by_feature"]:
                p["by_feature"][feat] = {"total": 0, "by_status": {}}
            p["by_feature"][feat]["total"] += 1
            p["by_feature"][feat]["by_status"][st] = (
                p["by_feature"][feat]["by_status"].get(st, 0) + 1
            )

        result: dict = {
            "total_tasks": len(all_tasks),
            "projects": projects,
        }
        if project:
            result["project_filter"] = project

        return json.dumps(result, indent=2)
