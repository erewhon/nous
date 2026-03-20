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
from ai_config import load_ai_config, has_ai_config


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

    # Load AI config from env/config file if not provided
    if ai_enrich and not ai_config:
        ai_config = load_ai_config()
        if not ai_config:
            import logging
            logging.warning("No AI config found. Skipping AI enrichment. "
                          "Set NOUS_AI_BASE_URL + NOUS_AI_MODEL env vars, "
                          "or create ~/.config/nous/ai.json")
            ai_enrich = False

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


def configure_ai():
    """Interactive AI configuration."""
    from ai_config import save_ai_config, load_ai_config

    existing = load_ai_config()
    print("Configure AI for artwork research enrichment.")
    print("(Press Enter to keep current value)")
    print()

    base_url = input(f"Base URL [{existing.get('base_url', '')}]: ").strip()
    api_key = input(f"API Key [{existing.get('api_key', '')}]: ").strip()
    model = input(f"Model [{existing.get('model', 'gpt-4o-mini')}]: ").strip()

    config = {
        "base_url": base_url or existing.get("base_url", ""),
        "api_key": api_key or existing.get("api_key", "not-needed"),
        "model": model or existing.get("model", "gpt-4o-mini"),
    }

    path = save_ai_config(config)
    print(f"\nSaved to {path}")


def main():
    parser = argparse.ArgumentParser(description="Import artwork from a URL into Nous")
    parser.add_argument("url", nargs="?", help="URL of the artwork page (or 'configure' to set up AI)")
    parser.add_argument("--notebook", default="Nous", help="Target notebook name (default: Nous)")
    parser.add_argument("--no-ai", action="store_true", help="Skip AI research enrichment")
    parser.add_argument("--folder-id", help="Folder UUID to place the page in")
    parser.add_argument("--section-id", help="Section UUID to place the page in")
    parser.add_argument("--ai-base-url", help="Override AI base URL")
    parser.add_argument("--ai-model", help="Override AI model")
    parser.add_argument("--json", action="store_true", help="Output result as JSON")
    args = parser.parse_args()

    if args.url == "configure":
        configure_ai()
        return

    if not args.url:
        parser.error("URL is required (or use 'configure' to set up AI)")

    # Build AI config overrides from CLI args
    ai_config = None
    if args.ai_base_url or args.ai_model:
        from ai_config import load_ai_config
        ai_config = load_ai_config() or {}
        if args.ai_base_url:
            ai_config["base_url"] = args.ai_base_url
        if args.ai_model:
            ai_config["model"] = args.ai_model

    app = Nous()
    if not app.is_running():
        print("Error: Nous daemon is not running. Start it with: nous-cli daemon start")
        sys.exit(1)

    try:
        result = run_import(
            url=args.url,
            notebook=args.notebook,
            ai_enrich=not args.no_ai,
            folder_id=args.folder_id,
            section_id=args.section_id,
            ai_config=ai_config,
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
