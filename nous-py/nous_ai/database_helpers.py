"""Shared database helpers used by both the MCP server and the in-app AI agent.

Provides property building, cell value resolution, option label resolution,
and markdown table formatting for Nous database pages.
"""

from __future__ import annotations

from uuid import uuid4

OPTION_COLORS = [
    "#ef4444",
    "#f97316",
    "#eab308",
    "#22c55e",
    "#06b6d4",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
    "#6b7280",
    "#a855f7",
]


def build_property(spec: dict, color_index: int) -> tuple[dict, int]:
    """Convert a user-friendly property spec to a full PropertyDef with UUIDs.

    Returns (property_dict, updated_color_index).
    """
    prop: dict = {
        "id": str(uuid4()),
        "name": spec["name"],
        "type": spec["type"],
    }
    if spec["type"] in ("select", "multiSelect") and "options" in spec:
        options = []
        for label in spec["options"]:
            options.append(
                {
                    "id": str(uuid4()),
                    "label": label,
                    "color": OPTION_COLORS[color_index % len(OPTION_COLORS)],
                }
            )
            color_index += 1
        prop["options"] = options
    return prop, color_index


def resolve_cell_value(value: object, prop: dict) -> object:
    """Resolve a user-friendly cell value to the internal storage format.

    For select: label string -> option ID string.
    For multiSelect: list of label strings -> list of option ID strings.
    Auto-creates missing options.
    """
    if prop["type"] == "select" and isinstance(value, str):
        options = prop.get("options", [])
        for opt in options:
            if opt["label"].lower() == value.lower():
                return opt["id"]
        # Auto-create option
        new_opt = {
            "id": str(uuid4()),
            "label": value,
            "color": OPTION_COLORS[len(options) % len(OPTION_COLORS)],
        }
        options.append(new_opt)
        prop["options"] = options
        return new_opt["id"]

    if prop["type"] == "multiSelect" and isinstance(value, list):
        options = prop.get("options", [])
        result_ids = []
        for label in value:
            found = False
            for opt in options:
                if opt["label"].lower() == label.lower():
                    result_ids.append(opt["id"])
                    found = True
                    break
            if not found:
                new_opt = {
                    "id": str(uuid4()),
                    "label": label,
                    "color": OPTION_COLORS[len(options) % len(OPTION_COLORS)],
                }
                options.append(new_opt)
                prop["options"] = options
                result_ids.append(new_opt["id"])
        return result_ids

    return value


def resolve_option_label(value: object, prop: dict) -> object:
    """Resolve internal cell value to display labels (for table output)."""
    if prop["type"] == "select" and isinstance(value, str):
        for opt in prop.get("options", []):
            if opt["id"] == value:
                return opt["label"]
        return value

    if prop["type"] == "multiSelect" and isinstance(value, list):
        labels = []
        opt_map = {opt["id"]: opt["label"] for opt in prop.get("options", [])}
        for v in value:
            labels.append(opt_map.get(v, v))
        return ", ".join(labels)

    if isinstance(value, bool):
        return str(value).lower()

    return value if value is not None else ""


def format_database_as_table(db_content: dict, title: str) -> str:
    """Render database content as a markdown table with YAML frontmatter."""
    properties = db_content.get("properties", [])
    rows = db_content.get("rows", [])

    # Frontmatter
    prop_summary = ", ".join(f"{p['name']} ({p['type']})" for p in properties)
    lines = [
        "---",
        f"title: {title}",
        f"properties: {prop_summary}",
        f"rows: {len(rows)}",
        "---",
        "",
    ]

    if not properties:
        lines.append("(no properties defined)")
        return "\n".join(lines)

    # Header row
    headers = [p["name"] for p in properties]
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("|" + "|".join("---" for _ in headers) + "|")

    # Data rows
    for row in rows:
        cells = row.get("cells", {})
        values = []
        for p in properties:
            raw = cells.get(p["id"])
            display = resolve_option_label(raw, p)
            # Escape pipes in cell values
            values.append(str(display).replace("|", "\\|"))
        lines.append("| " + " | ".join(values) + " |")

    return "\n".join(lines)
