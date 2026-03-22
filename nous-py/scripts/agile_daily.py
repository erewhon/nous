#!/usr/bin/env python3
"""Agile Results — Daily Note with Goal Context.

Creates or enhances today's daily note with:
1. Today's Outcomes checklist (Rule of 3)
2. Carried forward incomplete items from recent days
3. Context section: snapshot of current Weekly Plan + Monthly Plan

Usage:
    python scripts/agile_daily.py --notebook "Agile Results"
    python scripts/agile_daily.py --notebook "Agile Results" --date 2026-03-22
    python scripts/agile_daily.py setup --notebook "Agile Results"
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

# Add SDK to path
root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(root / "nous-sdk" / "src"))

from nous_sdk import Nous


def find_page_by_title(app: Nous, notebook: str, title: str):
    """Find a page by exact or prefix title match."""
    pages = app.list_pages(notebook)
    # Exact match first
    for p in pages:
        if p.title.lower() == title.lower():
            return p
    # Prefix match
    for p in pages:
        if p.title.lower().startswith(title.lower()):
            return p
    return None


def extract_text_content(page) -> str:
    """Extract readable text from a page's content blocks."""
    if not page.content:
        return ""
    blocks = page.content.get("blocks", [])
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
                text = strip_html(item.get("content", "") if isinstance(item, dict) else str(item))
                if style == "ordered":
                    lines.append(f"{i}. {text}")
                else:
                    lines.append(f"- {text}")

    return "\n".join(lines)


def strip_html(text: str) -> str:
    """Strip HTML tags from text."""
    return re.sub(r"<[^>]+>", "", text).strip()


def get_incomplete_items(app: Nous, notebook: str, days_back: int = 7) -> list[str]:
    """Get incomplete checklist items from recent daily notes."""
    pages = app.list_pages(notebook)
    today = date.today()
    cutoff = today - timedelta(days=days_back)

    incomplete = []
    for p in pages:
        if not p.is_daily_note:
            continue
        # Check if the daily note is within the date range
        if p.daily_note_date:
            try:
                note_date = date.fromisoformat(p.daily_note_date)
                if note_date < cutoff or note_date >= today:
                    continue
            except ValueError:
                continue
        elif p.updated_at:
            try:
                updated = datetime.fromisoformat(p.updated_at.replace("Z", "+00:00"))
                if updated.date() < cutoff or updated.date() >= today:
                    continue
            except ValueError:
                continue

        # Get the full page content
        full_page = app.get_page(notebook, p.id)
        if not full_page.content:
            continue

        for block in full_page.content.get("blocks", []):
            if block.get("type") == "checklist":
                for item in block.get("data", {}).get("items", []):
                    if not item.get("checked", False):
                        text = strip_html(item.get("text", ""))
                        if text and text not in ["Goal 1", "Goal 2", "Goal 3"]:
                            incomplete.append(text)

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for item in incomplete:
        if item not in seen:
            seen.add(item)
            unique.append(item)
    return unique


def get_week_label(d: date) -> str:
    """Get a week label like 'Mar 17-23'."""
    # Find Monday of this week
    monday = d - timedelta(days=d.weekday())
    sunday = monday + timedelta(days=6)
    if monday.month == sunday.month:
        return f"{monday.strftime('%b')} {monday.day}-{sunday.day}"
    return f"{monday.strftime('%b')} {monday.day} - {sunday.strftime('%b')} {sunday.day}"


def build_daily_note_content(
    target_date: date,
    incomplete_items: list[str],
    weekly_plan_text: str | None,
    monthly_plan_text: str | None,
    yearly_vision_text: str | None,
) -> str:
    """Build the full daily note content as text."""
    lines = []

    # Today's Outcomes (Rule of 3)
    lines.append("## Today's Outcomes")
    lines.append("")
    lines.append("- [ ] ")
    lines.append("- [ ] ")
    lines.append("- [ ] ")
    lines.append("")

    # Carried Forward
    if incomplete_items:
        lines.append("## Carried Forward")
        lines.append("")
        for item in incomplete_items:
            lines.append(f"- [ ] {item}")
        lines.append("")

    # Notes section
    lines.append("## Notes")
    lines.append("")
    lines.append("")

    # Context section (at the bottom, collapsible)
    has_context = weekly_plan_text or monthly_plan_text or yearly_vision_text
    if has_context:
        lines.append("## Context")
        lines.append("")

        if weekly_plan_text:
            week_label = get_week_label(target_date)
            lines.append(f"**Weekly Plan ({week_label}):**")
            lines.append("")
            lines.append(weekly_plan_text.strip())
            lines.append("")

        if monthly_plan_text:
            month_label = target_date.strftime("%B %Y")
            lines.append(f"**Monthly Plan ({month_label}):**")
            lines.append("")
            lines.append(monthly_plan_text.strip())
            lines.append("")

        if yearly_vision_text:
            lines.append(f"**Yearly Vision ({target_date.year}):**")
            lines.append("")
            lines.append(yearly_vision_text.strip())
            lines.append("")

    return "\n".join(lines)


def create_daily_note(app: Nous, notebook: str, target_date: date) -> dict:
    """Create or update the daily note for target_date."""
    # Check if daily note already exists
    date_str = target_date.isoformat()
    existing = app.get_daily_note(notebook, date_str)

    # Read planning pages
    weekly_plan = find_page_by_title(app, notebook, "Weekly Plan")
    monthly_plan = find_page_by_title(app, notebook, "Monthly Plan")
    yearly_vision = find_page_by_title(app, notebook, "Yearly Vision")

    weekly_text = None
    monthly_text = None
    yearly_text = None

    if weekly_plan:
        full = app.get_page(notebook, weekly_plan.id)
        weekly_text = extract_text_content(full)
        # Strip the page title/header from the content
        if weekly_text.startswith("# "):
            weekly_text = "\n".join(weekly_text.split("\n")[1:]).strip()

    if monthly_plan:
        full = app.get_page(notebook, monthly_plan.id)
        monthly_text = extract_text_content(full)
        if monthly_text.startswith("# "):
            monthly_text = "\n".join(monthly_text.split("\n")[1:]).strip()

    if yearly_vision:
        full = app.get_page(notebook, yearly_vision.id)
        yearly_text = extract_text_content(full)
        if yearly_text.startswith("# "):
            yearly_text = "\n".join(yearly_text.split("\n")[1:]).strip()

    # Get incomplete items from recent days
    incomplete = get_incomplete_items(app, notebook)

    if existing:
        # Daily note exists — check if it already has a Context section
        existing_text = extract_text_content(existing)
        if "## Context" in existing_text:
            print(f"Daily note for {date_str} already has context. Skipping.")
            return {"pageId": existing.id, "title": existing.title, "action": "skipped"}

        # Append context section to existing note
        context_lines = []
        if weekly_text or monthly_text or yearly_text:
            context_lines.append("## Context")
            context_lines.append("")
            if weekly_text:
                context_lines.append(f"**Weekly Plan ({get_week_label(target_date)}):**")
                context_lines.append("")
                context_lines.append(weekly_text.strip())
                context_lines.append("")
            if monthly_text:
                context_lines.append(f"**Monthly Plan ({target_date.strftime('%B %Y')}):**")
                context_lines.append("")
                context_lines.append(monthly_text.strip())
                context_lines.append("")

        if context_lines:
            app.append_to_page(notebook, existing.id, "\n".join(context_lines))

        return {"pageId": existing.id, "title": existing.title, "action": "updated"}

    # Create new daily note
    day_name = target_date.strftime("%A")
    date_display = target_date.strftime("%B %d, %Y")
    title = f"{day_name}, {date_display}"

    content = build_daily_note_content(
        target_date, incomplete, weekly_text, monthly_text, yearly_text
    )

    page = app.create_page(notebook, title=title, content=content, tags=["daily-note"])
    return {"pageId": page.id, "title": title, "action": "created"}


def setup_planning_pages(app: Nous, notebook: str) -> None:
    """Create the planning pages if they don't exist."""
    today = date.today()

    pages_to_create = [
        {
            "title": "Weekly Plan",
            "content": (
                f"## Week of {get_week_label(today)}\n\n"
                "### Outcomes (Rule of 3)\n\n"
                "1. \n"
                "2. \n"
                "3. \n\n"
                "### Key Tasks\n\n"
                "- \n\n"
                "### Notes\n\n"
            ),
            "tags": ["planning", "weekly"],
        },
        {
            "title": "Monthly Plan",
            "content": (
                f"## {today.strftime('%B %Y')}\n\n"
                "### Goals (Rule of 3)\n\n"
                "1. \n"
                "2. \n"
                "3. \n\n"
                "### Focus Areas\n\n"
                "- \n\n"
                "### Notes\n\n"
            ),
            "tags": ["planning", "monthly"],
        },
        {
            "title": "Yearly Vision",
            "content": (
                f"## {today.year}\n\n"
                "### Themes\n\n"
                "- \n\n"
                "### Goals\n\n"
                "1. \n"
                "2. \n"
                "3. \n\n"
                "### What does success look like?\n\n"
            ),
            "tags": ["planning", "yearly"],
        },
    ]

    for page_info in pages_to_create:
        existing = find_page_by_title(app, notebook, page_info["title"])
        if existing:
            print(f"  Already exists: {page_info['title']} ({existing.id})")
        else:
            page = app.create_page(
                notebook,
                title=page_info["title"],
                content=page_info["content"],
                tags=page_info["tags"],
            )
            print(f"  Created: {page_info['title']} ({page.id})")


def main():
    parser = argparse.ArgumentParser(description="Agile Results Daily Note")
    parser.add_argument("command", nargs="?", default="daily", help="'daily' (default), 'setup', or 'tomorrow'")
    parser.add_argument("--notebook", default="Agile Results", help="Notebook name")
    parser.add_argument("--date", help="Target date (YYYY-MM-DD, default: today)")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    args = parser.parse_args()

    app = Nous()
    if not app.is_running():
        print("Error: Nous daemon is not running.", file=sys.stderr)
        sys.exit(1)

    if args.command == "setup":
        print(f"Setting up planning pages in '{args.notebook}'...")
        setup_planning_pages(app, args.notebook)
        print("Done! Edit these pages to set your goals.")
        return

    # Determine target date
    if args.command == "tomorrow":
        target = date.today() + timedelta(days=1)
    elif args.date:
        target = date.fromisoformat(args.date)
    else:
        target = date.today()

    try:
        result = create_daily_note(app, args.notebook, target)
        if args.json:
            print(json.dumps(result))
        else:
            print(f"{result['action'].capitalize()}: {result['title']}")
            print(f"  Page ID: {result['pageId']}")
    except Exception as e:
        if args.json:
            print(json.dumps({"error": str(e)}))
        else:
            print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
