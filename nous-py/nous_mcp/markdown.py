"""Convert Editor.js blocks to Markdown.

Port of src-tauri/src/markdown/export.rs to Python.
"""

from __future__ import annotations

import re
from typing import Any


def export_page_to_markdown(page: dict) -> str:
    """Export a page dict to Markdown with YAML frontmatter."""
    lines: list[str] = []

    # YAML frontmatter
    lines.append("---")
    lines.append(f'title: "{_escape_yaml(page.get("title", ""))}"')

    tags = page.get("tags", [])
    if tags:
        lines.append("tags:")
        for tag in tags:
            lines.append(f'  - "{_escape_yaml(tag)}"')

    if page.get("createdAt"):
        lines.append(f"created: {page['createdAt']}")
    if page.get("updatedAt"):
        lines.append(f"updated: {page['updatedAt']}")

    lines.append("---")
    lines.append("")

    # Blocks
    blocks = page.get("content", {}).get("blocks", [])
    for block in blocks:
        block_md = _convert_block(block)
        if block_md:
            lines.append(block_md)
            lines.append("")

    result = "\n".join(lines)
    return result.rstrip() + "\n"


def blocks_to_markdown(blocks: list[dict]) -> str:
    """Convert a list of Editor.js blocks to Markdown (no frontmatter)."""
    parts: list[str] = []
    for block in blocks:
        block_md = _convert_block(block)
        if block_md:
            parts.append(block_md)
    return "\n\n".join(parts)


def _convert_block(block: dict) -> str:
    block_type = block.get("type", "")
    data: dict[str, Any] = block.get("data", {})

    match block_type:
        case "header":
            return _convert_header(data)
        case "paragraph":
            return _convert_paragraph(data)
        case "list":
            return _convert_list(data)
        case "checklist":
            return _convert_checklist(data)
        case "code":
            return _convert_code(data)
        case "quote":
            return _convert_quote(data)
        case "delimiter":
            return "---"
        case "table":
            return _convert_table(data)
        case "callout":
            return _convert_callout(data)
        case "image":
            return _convert_image(data)
        case _:
            return ""


def _convert_header(data: dict) -> str:
    text = _strip_html(data.get("text", ""))
    level = min(int(data.get("level", 2)), 6)
    return f"{'#' * level} {text}"


def _convert_paragraph(data: dict) -> str:
    return _inline_html_to_md(data.get("text", ""))


def _convert_list(data: dict) -> str:
    items = data.get("items", [])
    is_ordered = data.get("style") == "ordered"
    lines: list[str] = []
    for i, item in enumerate(items):
        text = _inline_html_to_md(_extract_list_item_text(item))
        if is_ordered:
            lines.append(f"{i + 1}. {text}")
        else:
            lines.append(f"- {text}")
    return "\n".join(lines)


def _convert_checklist(data: dict) -> str:
    items = data.get("items", [])
    lines: list[str] = []
    for item in items:
        text = _inline_html_to_md(item.get("text", ""))
        checked = item.get("checked", False)
        marker = "[x]" if checked else "[ ]"
        lines.append(f"- {marker} {text}")
    return "\n".join(lines)


def _convert_code(data: dict) -> str:
    code = data.get("code", "")
    language = data.get("language", "")
    return f"```{language}\n{code}\n```"


def _convert_quote(data: dict) -> str:
    text = _inline_html_to_md(data.get("text", ""))
    return "\n".join(f"> {line}" for line in text.splitlines())


def _convert_table(data: dict) -> str:
    content = data.get("content", [])
    if not content:
        return ""

    with_headings = data.get("withHeadings", False)
    lines: list[str] = []

    for row_idx, row in enumerate(content):
        if not isinstance(row, list):
            continue
        cells = [_inline_html_to_md(c) if isinstance(c, str) else "" for c in row]
        lines.append(f"| {' | '.join(cells)} |")
        if row_idx == 0 and with_headings:
            lines.append(f"| {' | '.join('---' for _ in cells)} |")

    return "\n".join(lines)


def _convert_callout(data: dict) -> str:
    callout_type = data.get("type", "info").upper()
    title = data.get("title", "")
    content = _inline_html_to_md(data.get("content", ""))

    lines: list[str] = []
    if title:
        lines.append(f"> [!{callout_type}] {title}")
    else:
        lines.append(f"> [!{callout_type}]")

    for line in content.splitlines():
        lines.append(f"> {line}")

    return "\n".join(lines)


def _convert_image(data: dict) -> str:
    file_data = data.get("file", {})
    url = file_data.get("url", "") if isinstance(file_data, dict) else ""
    caption = data.get("caption", "")

    if not url:
        return ""

    # Convert asset:// URLs to relative paths
    if "/assets/" in url:
        pos = url.rfind("/assets/")
        url = url[pos + 1:]  # Skip the leading /

    return f"![{caption}]({url})"


def _extract_list_item_text(item: Any) -> str:
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        return item.get("content", item.get("text", ""))
    return ""


# --- Inline HTML → Markdown ---

_WIKI_LINK_RE = re.compile(
    r'<wiki-link[^>]*data-page-title="([^"]*)"[^>]*>[^<]*</wiki-link>'
)
_BLOCK_REF_RE = re.compile(
    r'<block-ref[^>]*data-block-id="([^"]*)"[^>]*>[^<]*</block-ref>'
)
_BOLD_RE = re.compile(r"<(?:b|strong)>(.*?)</(?:b|strong)>", re.DOTALL)
_ITALIC_RE = re.compile(r"<(?:i|em)>(.*?)</(?:i|em)>", re.DOTALL)
_CODE_RE = re.compile(r"<code>(.*?)</code>", re.DOTALL)
_LINK_RE = re.compile(r'<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>', re.DOTALL)
_MARK_RE = re.compile(r"<mark[^>]*>(.*?)</mark>", re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")


def _inline_html_to_md(text: str) -> str:
    if not text:
        return ""

    result = text

    # Custom elements first (before generic tag stripping)
    result = _WIKI_LINK_RE.sub(r"[[\1]]", result)
    result = _BLOCK_REF_RE.sub(r"((\1))", result)

    # Inline formatting
    result = _BOLD_RE.sub(r"**\1**", result)
    result = _ITALIC_RE.sub(r"*\1*", result)
    result = _CODE_RE.sub(r"`\1`", result)
    result = _LINK_RE.sub(r"[\2](\1)", result)
    result = _MARK_RE.sub(r"==\1==", result)

    # Strip remaining HTML tags
    result = _TAG_RE.sub("", result)

    # Decode HTML entities
    result = (
        result.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&nbsp;", " ")
    )

    return result


def _strip_html(text: str) -> str:
    """Strip all HTML tags (used for headers where we don't want formatting)."""
    if not text:
        return ""
    result = _WIKI_LINK_RE.sub(r"[[\1]]", text)
    result = _BLOCK_REF_RE.sub(r"((\1))", result)
    result = _TAG_RE.sub("", result)
    result = (
        result.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&nbsp;", " ")
    )
    return result


def _escape_yaml(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')
