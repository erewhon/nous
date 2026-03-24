"""Agile Results helper functions for MCP tools.

Reads planning pages and daily notes to provide alignment checks
and weekly reviews.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any


def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text).strip()


def extract_text_from_blocks(blocks: list[dict]) -> str:
    """Extract readable text from Editor.js blocks."""
    lines = []
    for block in blocks:
        btype = block.get("type", "")
        data = block.get("data", {})

        if btype == "header":
            level = data.get("level", 2)
            text = strip_html(data.get("text", ""))
            lines.append(f"{'#' * level} {text}")
        elif btype == "paragraph":
            text = strip_html(data.get("text", ""))
            if text:
                lines.append(text)
        elif btype == "checklist":
            for item in data.get("items", []):
                checked = item.get("checked", False)
                text = strip_html(item.get("text", ""))
                mark = "x" if checked else " "
                lines.append(f"- [{mark}] {text}")
        elif btype == "list":
            style = data.get("style", "unordered")
            for i, item in enumerate(data.get("items", []), 1):
                text = strip_html(
                    item.get("content", "") if isinstance(item, dict) else str(item)
                )
                if style == "ordered":
                    lines.append(f"{i}. {text}")
                else:
                    lines.append(f"- {text}")

    return "\n".join(lines)


def get_page_text(storage: Any, notebook_id: str, title: str) -> str | None:
    """Get a page's text content by title."""
    pages = storage.list_pages(notebook_id)
    page = None
    for p in pages:
        if p.get("title", "").lower() == title.lower():
            page = p
            break
    if not page:
        for p in pages:
            if p.get("title", "").lower().startswith(title.lower()):
                page = p
                break
    if not page:
        return None

    full = storage.get_page(notebook_id, page["id"])
    if not full:
        return None

    blocks = full.get("content", {}).get("blocks", [])
    return extract_text_from_blocks(blocks)


def get_daily_note_text(storage: Any, notebook_id: str, target_date: date) -> str | None:
    """Get a daily note's text content for a specific date."""
    pages = storage.list_pages(notebook_id)
    date_str = target_date.isoformat()

    for p in pages:
        if p.get("isDailyNote") and p.get("dailyNoteDate") == date_str:
            full = storage.get_page(notebook_id, p["id"])
            if full:
                blocks = full.get("content", {}).get("blocks", [])
                return extract_text_from_blocks(blocks)
    return None


def get_daily_outcomes(text: str) -> list[dict[str, Any]]:
    """Extract checklist items from a daily note."""
    items = []
    in_goals = False
    in_carried = False

    for line in text.split("\n"):
        line = line.strip()

        if line.startswith("## ") or line.startswith("# "):
            section = line.lstrip("#").strip().lower()
            in_goals = section in ("today's goals", "today's outcomes")
            in_carried = section == "carried forward"
            continue

        if line.startswith("- ["):
            checked = line.startswith("- [x]")
            item_text = line[6:].strip() if checked else line[5:].strip()
            if item_text and item_text not in ("Goal 1", "Goal 2", "Goal 3"):
                items.append({
                    "text": item_text,
                    "checked": checked,
                    "section": "outcomes" if in_goals else "carried" if in_carried else "other",
                })

    return items


def get_week_daily_notes(
    storage: Any, notebook_id: str, reference_date: date
) -> list[dict[str, Any]]:
    """Get daily note summaries for the week containing reference_date."""
    monday = reference_date - timedelta(days=reference_date.weekday())
    days = []

    for offset in range(7):
        d = monday + timedelta(days=offset)
        if d > date.today():
            break
        text = get_daily_note_text(storage, notebook_id, d)
        if text:
            items = get_daily_outcomes(text)
            total = len(items)
            done = sum(1 for i in items if i["checked"])
            days.append({
                "date": d.isoformat(),
                "day": d.strftime("%A"),
                "outcomes": [i["text"] for i in items if i["section"] == "outcomes"],
                "carried": [i["text"] for i in items if i["section"] == "carried"],
                "total_items": total,
                "completed": done,
                "completion_rate": round(done / total * 100) if total > 0 else 0,
            })

    return days


def build_alignment_prompt(
    daily_text: str,
    weekly_text: str | None,
    monthly_text: str | None,
    yearly_text: str | None,
    week_summary: list[dict] | None = None,
) -> str:
    """Build a concise alignment review prompt.

    Keeps total size small so local LLMs can handle it.
    """
    parts = []

    # Extract just the outcomes/checklist items from daily note (not full text)
    daily_items = get_daily_outcomes(daily_text)
    if daily_items:
        parts.append("TODAY'S ITEMS:")
        for item in daily_items[:10]:
            status = "DONE" if item["checked"] else "TODO"
            parts.append(f"  [{status}] {item['text'][:80]}")
    else:
        parts.append("TODAY: No items yet")

    if weekly_text:
        # Trim to just the goals lines
        parts.append("\nWEEKLY GOALS:")
        for line in weekly_text.split("\n"):
            line = line.strip()
            if line and (line[0].isdigit() or line.startswith("- ")):
                parts.append(f"  {line[:80]}")

    if monthly_text:
        parts.append("\nMONTHLY GOALS:")
        for line in monthly_text.split("\n"):
            line = line.strip()
            if line and (line[0].isdigit() or line.startswith("- ")):
                parts.append(f"  {line[:80]}")

    if week_summary:
        total_done = sum(d["completed"] for d in week_summary)
        total_items = sum(d["total_items"] for d in week_summary)
        parts.append(f"\nWEEK PROGRESS: {total_done}/{total_items} items done across {len(week_summary)} days")

    parts.append("""
Review alignment. Reply with EXACTLY this format:
ALIGNED: (1-2 sentences on what's on track)
GAPS: (list any weekly/monthly goals getting no attention)
SUGGEST: (one concrete small action for today)""")

    return "\n".join(parts)
