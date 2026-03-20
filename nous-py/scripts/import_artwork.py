#!/usr/bin/env python3
"""Import artwork from a URL into a Nous notebook.

Usage:
    python scripts/import_artwork.py <url> --notebook "Art Research" [--no-ai] [--folder-id ...] [--section-id ...]

Can also be called as a module for the daemon API integration.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Add SDK and nous_mcp to path
root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(root / "nous-sdk" / "src"))
sys.path.insert(0, str(root / "nous-py"))

from nous_sdk import Nous
from nous_mcp.artwork import import_artwork, format_artwork_page


def run_import(
    url: str,
    notebook: str,
    ai_enrich: bool = True,
    folder_id: str | None = None,
    section_id: str | None = None,
    ai_config: dict | None = None,
) -> dict:
    """Import artwork and create a Nous page. Returns page info."""
    app = Nous()

    # Default AI config — use the user's configured provider if available
    if ai_enrich and not ai_config:
        # Try to read AI settings from the daemon
        # For now, use a sensible default
        ai_config = {
            "base_url": "https://llm.peacock-bramble.ts.net/v1",
            "api_key": "sk-litellm-master",
            "model": "research",
        }

    result = import_artwork(url, ai_enrich=ai_enrich, ai_config=ai_config)
    content = format_artwork_page(result)

    page = app.create_page(
        notebook,
        title=result["title"],
        content=content,
        tags=result["tags"],
        folder_id=folder_id,
        section_id=section_id,
    )

    return {
        "pageId": page.id,
        "title": result["title"],
        "imageUrl": result["image_url"],
        "artist": result.get("artist"),
        "tags": result["tags"],
    }


def main():
    parser = argparse.ArgumentParser(description="Import artwork from a URL into Nous")
    parser.add_argument("url", help="URL of the artwork page")
    parser.add_argument("--notebook", required=True, help="Target notebook name")
    parser.add_argument("--no-ai", action="store_true", help="Skip AI research enrichment")
    parser.add_argument("--folder-id", help="Folder UUID to place the page in")
    parser.add_argument("--section-id", help="Section UUID to place the page in")
    parser.add_argument("--json", action="store_true", help="Output result as JSON")
    args = parser.parse_args()

    try:
        result = run_import(
            url=args.url,
            notebook=args.notebook,
            ai_enrich=not args.no_ai,
            folder_id=args.folder_id,
            section_id=args.section_id,
        )
        if args.json:
            print(json.dumps(result))
        else:
            print(f"Created: {result['title']}")
            print(f"  Page ID: {result['pageId']}")
            if result.get("artist"):
                print(f"  Artist: {result['artist']}")
            if result.get("imageUrl"):
                print(f"  Image: {result['imageUrl']}")
            print(f"  Tags: {', '.join(result['tags'])}")
    except Exception as e:
        if args.json:
            print(json.dumps({"error": str(e)}))
        else:
            print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
