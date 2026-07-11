"""Parameter normalization shared by MCP tool signatures.

List-valued tool params accept either a real list (canonical for
programmatic callers — values are taken verbatim, so entries containing
commas work) or a comma-separated string (kept for backward compatibility
with existing agent prompts, fine for values that never contain commas).
"""


def as_list(value: str | list[str] | None) -> list[str]:
    """Normalize a str-or-list param to a list of stripped, non-empty strings.

    Strings split on commas; list entries are taken whole.
    """
    if value is None:
        return []
    if isinstance(value, str):
        return [v.strip() for v in value.split(",") if v.strip()]
    return [str(v).strip() for v in value if v is not None and str(v).strip()]
