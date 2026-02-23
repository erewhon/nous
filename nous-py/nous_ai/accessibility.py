"""AT-SPI2 accessibility tree scraping for app monitoring.

Uses the AT-SPI2 accessibility framework to extract text content,
labels, and notification counts from desktop application windows.
"""

import json
from typing import Any

ATSPI_AVAILABLE = False

try:
    import gi

    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi

    ATSPI_AVAILABLE = True
except (ImportError, ValueError):
    pass


def scrape_window_atspi(window_name: str) -> dict[str, Any]:
    """Scrape accessible content from a window using AT-SPI2.

    Args:
        window_name: Window title substring to match.

    Returns:
        Dict with extracted content:
        {
            "window_title": str,
            "app_name": str,
            "labels": [str],
            "text_content": [str],
            "list_items": [str],
            "notification_count": int | None,
            "buttons": [str],
        }
    """
    if not ATSPI_AVAILABLE:
        return {
            "error": "AT-SPI2 not available. Install PyGObject: pip install PyGObject",
            "window_title": "",
            "app_name": "",
            "labels": [],
            "text_content": [],
            "list_items": [],
            "notification_count": None,
            "buttons": [],
        }

    desktop = Atspi.get_desktop(0)
    if desktop is None:
        return _empty_result("Could not access desktop")

    # Search for the target window across all applications
    for i in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(i)
        if app is None:
            continue

        app_name = app.get_name() or ""

        for j in range(app.get_child_count()):
            window = app.get_child_at_index(j)
            if window is None:
                continue

            title = window.get_name() or ""
            if window_name.lower() in title.lower():
                return _extract_window_content(window, title, app_name)

    return _empty_result(f"Window not found: {window_name}")


def _extract_window_content(
    node: Any, window_title: str, app_name: str
) -> dict[str, Any]:
    """Walk the accessibility tree and extract content."""
    result: dict[str, Any] = {
        "window_title": window_title,
        "app_name": app_name,
        "labels": [],
        "text_content": [],
        "list_items": [],
        "notification_count": None,
        "buttons": [],
    }

    _walk_tree(node, result, depth=0, max_depth=15)
    return result


def _walk_tree(
    node: Any,
    result: dict[str, Any],
    depth: int,
    max_depth: int,
) -> None:
    """Recursively walk the accessibility tree."""
    if node is None or depth > max_depth:
        return

    try:
        role = node.get_role()
        name = node.get_name() or ""
        description = node.get_description() or ""

        # Extract based on role
        if role == Atspi.Role.LABEL and name:
            result["labels"].append(name)

        elif role == Atspi.Role.TEXT and name:
            result["text_content"].append(name)

        elif role == Atspi.Role.LIST_ITEM and name:
            result["list_items"].append(name)

        elif role == Atspi.Role.PUSH_BUTTON and name:
            result["buttons"].append(name)

        elif role == Atspi.Role.STATUS_BAR and name:
            # Try to extract notification counts from status bar
            _try_extract_count(name, result)

        # Also try to get text from accessible text interface
        if role in (
            Atspi.Role.TEXT,
            Atspi.Role.PARAGRAPH,
            Atspi.Role.DOCUMENT_TEXT,
            Atspi.Role.DOCUMENT_WEB,
        ):
            try:
                text_iface = node.get_text()
                if text_iface:
                    char_count = text_iface.get_character_count()
                    if 0 < char_count <= 5000:
                        text = text_iface.get_text(0, char_count)
                        if text and text.strip():
                            result["text_content"].append(text.strip())
            except Exception:
                pass

        # Try to detect notification badges/counts from description
        if description:
            _try_extract_count(description, result)

        # Recurse into children
        child_count = node.get_child_count()
        for i in range(child_count):
            child = node.get_child_at_index(i)
            _walk_tree(child, result, depth + 1, max_depth)

    except Exception:
        # AT-SPI2 can throw on stale references; silently skip
        pass


def _try_extract_count(text: str, result: dict[str, Any]) -> None:
    """Try to extract a notification count from text."""
    import re

    # Look for patterns like "3 unread", "(5)", "Badge: 2"
    patterns = [
        r"(\d+)\s*(?:unread|new|notification|message)",
        r"\((\d+)\)",
        r"badge[:\s]*(\d+)",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            count = int(match.group(1))
            if count > 0:
                result["notification_count"] = count
                return


def _empty_result(error: str | None = None) -> dict[str, Any]:
    """Return an empty result."""
    result: dict[str, Any] = {
        "window_title": "",
        "app_name": "",
        "labels": [],
        "text_content": [],
        "list_items": [],
        "notification_count": None,
        "buttons": [],
    }
    if error:
        result["error"] = error
    return result


def scrape_window_atspi_sync(window_name: str) -> dict[str, Any]:
    """Synchronous wrapper for AT-SPI2 scraping (PyO3-compatible).

    AT-SPI2 is already synchronous, so this is a direct call.
    """
    return scrape_window_atspi(window_name)
