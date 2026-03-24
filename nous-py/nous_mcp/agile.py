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
    """Build the prompt for the AI alignment review."""
    parts = ["Review my planning alignment. Be brief, direct, and encouraging.\n"]

    parts.append("## Today's Daily Note\n")
    parts.append(daily_text[:2000])

    if weekly_text:
        parts.append("\n## Current Weekly Plan\n")
        parts.append(weekly_text[:1000])

    if monthly_text:
        parts.append("\n## Current Monthly Plan\n")
        parts.append(monthly_text[:1000])

    if yearly_text:
        parts.append("\n## Yearly Vision\n")
        parts.append(yearly_text[:500])

    if week_summary:
        parts.append("\n## This Week So Far\n")
        for day in week_summary:
            done = day["completed"]
            total = day["total_items"]
            parts.append(f"- {day['day']}: {done}/{total} items done")
            if day["outcomes"]:
                for o in day["outcomes"][:3]:
                    parts.append(f"  - {o}")

    parts.append("""
\nPlease provide:
1. **Alignment check**: Are today's outcomes supporting the weekly and monthly goals? (1-2 sentences)
2. **Blind spots**: Any weekly/monthly goals getting no attention this week? (brief list)
3. **One suggestion**: One concrete small action I could add or adjust today. (1 sentence)

Keep it under 150 words total. Be a supportive coach, not a critic.""")

    return "\n".join(parts)
