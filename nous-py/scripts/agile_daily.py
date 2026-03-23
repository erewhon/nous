#!/usr/bin/env python3
"""Agile Results — Goal Context for Daily Notes.

Works WITH the existing Daily Note + Carry Forward action:
1. The existing action creates the daily note with template + carry forward
2. This script appends a Context section with snapshotted Weekly/Monthly/Yearly goals

For evening planning ("tomorrow"), creates the daily note via the daemon's
daily note API (which matches the existing format), then appends context.

Usage:
    python scripts/agile_daily.py --notebook "Agile Results"
    python scripts/agile_daily.py tomorrow --notebook "Agile Results"
    python scripts/agile_daily.py setup --notebook "Agile Results"
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

# Add SDK to path
root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(root / "nous-sdk" / "src"))

from nous_sdk import Nous


def find_page_by_title(app: Nous, notebook: str, title: str):
    """Find a page by exact or prefix title match."""
    pages = app.list_pages(notebook)
    for p in pages:
        if p.title.lower() == title.lower():
            return p
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
    return re.sub(r"<[^>]+>", "", text).strip()


def get_week_label(d: date) -> str:
    monday = d - timedelta(days=d.weekday())
    sunday = monday + timedelta(days=6)
    if monday.month == sunday.month:
        return f"{monday.strftime('%b')} {monday.day}-{sunday.day}"
    return f"{monday.strftime('%b')} {monday.day} - {sunday.strftime('%b')} {sunday.day}"


def build_context_content(
    target_date: date,
    weekly_text: str | None,
    monthly_text: str | None,
    yearly_text: str | None,
) -> str | None:
    """Build the Context section content to append."""
    if not weekly_text and not monthly_text and not yearly_text:
        return None

    lines = ["## Context", ""]

    if weekly_text:
        week_label = get_week_label(target_date)
        lines.append(f"**Weekly Plan ({week_label}):**")
        lines.append("")
        lines.append(weekly_text.strip())
        lines.append("")

    if monthly_text:
        month_label = target_date.strftime("%B %Y")
        lines.append(f"**Monthly Plan ({month_label}):**")
        lines.append("")
        lines.append(monthly_text.strip())
        lines.append("")

    if yearly_text:
        lines.append(f"**Yearly Vision ({target_date.year}):**")
        lines.append("")
        lines.append(yearly_text.strip())
        lines.append("")

    return "\n".join(lines)


def read_plan_page(app: Nous, notebook: str, title: str) -> str | None:
    """Read a planning page and return its text content (without the title header)."""
    page = find_page_by_title(app, notebook, title)
    if not page:
        return None
    full = app.get_page(notebook, page.id)
    text = extract_text_content(full)
    # Strip the page title/header from the content
    if text.startswith("# "):
        text = "\n".join(text.split("\n")[1:]).strip()
    return text if text else None


def add_context_to_daily(app: Nous, notebook: str, target_date: date) -> dict:
    """Add goal context to a daily note for the target date."""
    date_str = target_date.isoformat()

    # Get or create the daily note via the daemon API
    daily = app.get_daily_note(notebook, date_str)
    if not daily:
        daily = app.create_daily_note(notebook, date_str)
        action = "created"
    else:
        action = "updated"

    # Check if context already exists
    existing_text = extract_text_content(daily)
    if "## Context" in existing_text:
        return {"pageId": daily.id, "title": daily.title, "action": "skipped",
                "reason": "Context section already exists"}

    # Read planning pages
    weekly_text = read_plan_page(app, notebook, "Weekly Plan")
    monthly_text = read_plan_page(app, notebook, "Monthly Plan")
    yearly_text = read_plan_page(app, notebook, "Yearly Vision")

    context = build_context_content(target_date, weekly_text, monthly_text, yearly_text)
    if context:
        app.append_to_page(notebook, daily.id, context)

    return {"pageId": daily.id, "title": daily.title, "action": action}


def setup_planning_pages(app: Nous, notebook: str) -> None:
    """Create the planning pages if they don't exist."""
    today = date.today()

    pages_to_create = [
        {
            "title": "Weekly Plan",
            "content": (
                f"Week of {get_week_label(today)}\n\n"
                "Outcomes (Rule of 3)\n\n"
                "1. \n2. \n3. \n\n"
                "Key Tasks\n\n"
                "- \n"
            ),
            "tags": ["planning", "weekly"],
        },
        {
            "title": "Monthly Plan",
            "content": (
                f"{today.strftime('%B %Y')}\n\n"
                "Goals (Rule of 3)\n\n"
                "1. \n2. \n3. \n\n"
                "Focus Areas\n\n"
                "- \n"
            ),
            "tags": ["planning", "monthly"],
        },
        {
            "title": "Yearly Vision",
            "content": (
                f"{today.year}\n\n"
                "Themes\n\n"
                "- \n\n"
                "Goals\n\n"
                "1. \n2. \n3. \n\n"
                "What does success look like?\n\n"
            ),
            "tags": ["planning", "yearly"],
        },
    ]

    for page_info in pages_to_create:
        existing = find_page_by_title(app, notebook, page_info["title"])
        if existing:
            print(f"  Already exists: {page_info['title']}")
        else:
            page = app.create_page(
                notebook,
                title=page_info["title"],
                content=page_info["content"],
                tags=page_info["tags"],
            )
            print(f"  Created: {page_info['title']}")


def main():
    parser = argparse.ArgumentParser(description="Agile Results — Goal Context for Daily Notes")
    parser.add_argument("command", nargs="?", default="daily",
                       help="'daily' (default), 'tomorrow', or 'setup'")
    parser.add_argument("--notebook", default="Agile Results", help="Notebook name")
    parser.add_argument("--date", help="Target date (YYYY-MM-DD)")
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
        result = add_context_to_daily(app, args.notebook, target)
        if args.json:
            print(json.dumps(result))
        else:
            print(f"{result['action'].capitalize()}: {result['title']}")
            if result.get("reason"):
                print(f"  ({result['reason']})")
    except Exception as e:
        if args.json:
            print(json.dumps({"error": str(e)}))
        else:
            print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
