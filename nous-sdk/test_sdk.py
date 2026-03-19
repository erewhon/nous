#!/usr/bin/env python3
"""Quick test of the Nous SDK against the running daemon."""

import sys
sys.path.insert(0, "src")

from nous_sdk import Nous

app = Nous()

# Status
print("=== Status ===")
print(f"Running: {app.is_running()}")
print(f"Status: {app.status()}")

# Notebooks
print("\n=== Notebooks ===")
notebooks = app.list_notebooks()
for nb in notebooks:
    print(f"  {nb.name} ({nb.id}) — {nb.page_count} pages")

# Pages in Nous notebook
print("\n=== Pages in 'Nous' ===")
pages = app.list_pages("Nous")
for p in pages[:5]:
    print(f"  {p.title} [{', '.join(p.tags)}]")
if len(pages) > 5:
    print(f"  ... and {len(pages) - 5} more")

# Search
print("\n=== Search: 'python' ===")
results = app.search("python", limit=3)
for r in results:
    print(f"  {r.title} (score: {r.score:.2f})")

# Get a specific page
print("\n=== Get page ===")
page = app.get_page("Nous", "Architecture: Daemon")
print(f"  Title: {page.title}")
print(f"  Tags: {page.tags}")
print(f"  Updated: {page.updated_at}")

# Sections
print("\n=== Sections in 'Agile Results' ===")
sections = app.list_sections("Agile Results")
for s in sections:
    print(f"  {s.name} (color: {s.color})")

# Inbox
print("\n=== Inbox ===")
items = app.list_inbox()
print(f"  {len(items)} items")
for item in items[:3]:
    print(f"  - {item.title}")

print("\nDone!")
