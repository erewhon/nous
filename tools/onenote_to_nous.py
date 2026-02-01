"""Convert OneNote desktop backup .one files into .nous.zip archives.

Requires Java 11+ (Tika spawns a JVM server) and the ``tika`` Python package.

Usage::

    uv run onenote_to_nous.py /path/to/OneNote/Backups/Family/ -o Family.nous.zip
    uv run onenote_to_nous.py /path/to/Meals.one -o Meals.nous.zip
    uv run onenote_to_nous.py /path/to/Backups/ --name "Family Notebook" -o family.nous.zip
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import re
import sys
import uuid
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup, NavigableString, Tag
from tika import parser as tika_parser


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _uuid() -> str:
    return str(uuid.uuid4())


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _block_id() -> str:
    """Short random id for Editor.js blocks."""
    return uuid.uuid4().hex[:10]


def _strip_date_suffix(name: str) -> str:
    """Remove trailing ``(On …)`` date annotation from OneNote backup filenames."""
    return re.sub(r"\s*\(On\s+[^)]+\)\s*$", "", name)


def _page_title_from_metadata(metadata: dict[str, Any], fallback: str) -> str:
    """Extract a usable page title from Tika metadata, falling back to *fallback*."""
    for key in ("dc:title", "title", "dc:subject"):
        val = metadata.get(key)
        if val and isinstance(val, str) and val.strip():
            return val.strip()
    return _strip_date_suffix(fallback)


# ---------------------------------------------------------------------------
# XHTML → Editor.js block conversion
# ---------------------------------------------------------------------------

def _inline_html(tag: Tag) -> str:
    """Return the inner HTML of *tag*, preserving inline markup."""
    parts: list[str] = []
    for child in tag.children:
        if isinstance(child, NavigableString):
            parts.append(str(child))
        elif isinstance(child, Tag):
            if child.name == "b" or child.name == "strong":
                parts.append(f"<b>{_inline_html(child)}</b>")
            elif child.name == "i" or child.name == "em":
                parts.append(f"<i>{_inline_html(child)}</i>")
            elif child.name == "u":
                parts.append(f"<u>{_inline_html(child)}</u>")
            elif child.name == "a":
                href = child.get("href", "")
                parts.append(f'<a href="{href}">{_inline_html(child)}</a>')
            elif child.name == "br":
                parts.append("<br>")
            else:
                parts.append(_inline_html(child))
    return "".join(parts)


def _list_items(ul_or_ol: Tag) -> list[str]:
    items: list[str] = []
    for li in ul_or_ol.find_all("li", recursive=False):
        items.append(_inline_html(li))
    return items


def _table_content(table: Tag) -> list[list[str]]:
    rows: list[list[str]] = []
    for tr in table.find_all("tr"):
        cells: list[str] = []
        for td in tr.find_all(["td", "th"]):
            cells.append(_inline_html(td))
        if cells:
            rows.append(cells)
    return rows


def _convert_xhtml_to_blocks(
    xhtml: str,
    notebook_id: str,
    *,
    verbose: bool = False,
) -> tuple[list[dict[str, Any]], list[tuple[str, bytes]]]:
    """Parse Tika XHTML and return (blocks, images).

    *images* is a list of ``(filename, raw_bytes)`` tuples for base64-decoded
    ``<img>`` sources that should be stored under ``assets/images/``.
    """
    soup = BeautifulSoup(xhtml, "html.parser")
    body = soup.find("body") or soup

    blocks: list[dict[str, Any]] = []
    images: list[tuple[str, bytes]] = []

    for el in body.children:
        if isinstance(el, NavigableString):
            text = str(el).strip()
            if text:
                blocks.append({
                    "id": _block_id(),
                    "type": "paragraph",
                    "data": {"text": text},
                })
            continue

        if not isinstance(el, Tag):
            continue

        tag_name = el.name

        # Headers
        if tag_name in ("h1", "h2", "h3", "h4", "h5", "h6"):
            level = int(tag_name[1])
            blocks.append({
                "id": _block_id(),
                "type": "header",
                "data": {"text": _inline_html(el), "level": level},
            })

        # Paragraphs
        elif tag_name == "p":
            # Check for inline images
            img = el.find("img")
            if img and img.get("src", "").startswith("data:"):
                _process_image(img, notebook_id, blocks, images, verbose=verbose)
            text = _inline_html(el)
            if text.strip():
                blocks.append({
                    "id": _block_id(),
                    "type": "paragraph",
                    "data": {"text": text},
                })

        # Unordered list
        elif tag_name == "ul":
            items = _list_items(el)
            if items:
                blocks.append({
                    "id": _block_id(),
                    "type": "list",
                    "data": {"style": "unordered", "items": items},
                })

        # Ordered list
        elif tag_name == "ol":
            items = _list_items(el)
            if items:
                blocks.append({
                    "id": _block_id(),
                    "type": "list",
                    "data": {"style": "ordered", "items": items},
                })

        # Table
        elif tag_name == "table":
            content = _table_content(el)
            if content:
                blocks.append({
                    "id": _block_id(),
                    "type": "table",
                    "data": {"content": content},
                })

        # Standalone image
        elif tag_name == "img":
            _process_image(el, notebook_id, blocks, images, verbose=verbose)

        # Div — may contain mixed content; recurse simply
        elif tag_name == "div":
            inner_blocks, inner_images = _convert_xhtml_to_blocks(
                str(el), notebook_id, verbose=verbose,
            )
            blocks.extend(inner_blocks)
            images.extend(inner_images)

        # Fallback — emit as paragraph with stripped text
        else:
            text = el.get_text(strip=True)
            if text:
                blocks.append({
                    "id": _block_id(),
                    "type": "paragraph",
                    "data": {"text": text},
                })

    return blocks, images


def _process_image(
    img_tag: Tag,
    notebook_id: str,
    blocks: list[dict[str, Any]],
    images: list[tuple[str, bytes]],
    *,
    verbose: bool = False,
) -> None:
    src = img_tag.get("src", "")
    if not src.startswith("data:"):
        if verbose:
            _log(f"  Skipping non-data image src: {src[:80]}...")
        return

    # data:image/png;base64,AAAA...
    try:
        header, b64data = src.split(",", 1)
    except ValueError:
        if verbose:
            _log("  Skipping malformed data URI")
        return

    # Determine extension
    ext = "png"
    mime_match = re.search(r"image/(\w+)", header)
    if mime_match:
        ext = mime_match.group(1).lower()
        if ext == "jpeg":
            ext = "jpg"

    try:
        raw = base64.b64decode(b64data)
    except Exception:
        if verbose:
            _log("  Failed to decode base64 image data")
        return

    img_uuid = _uuid()
    filename = f"{img_uuid}.{ext}"
    images.append((filename, raw))

    blocks.append({
        "id": _block_id(),
        "type": "image",
        "data": {
            "file": {
                "url": f"asset://{notebook_id}/{filename}",
            },
            "caption": "",
            "withBorder": False,
            "stretched": False,
            "withBackground": False,
        },
    })


# ---------------------------------------------------------------------------
# .one file discovery
# ---------------------------------------------------------------------------

def _discover_one_files(path: Path) -> dict[str | None, list[Path]]:
    """Return a mapping of section_name → list of .one file paths.

    If *path* is a single file, section_name is ``None`` (no folder needed).
    If *path* is a directory, section_name is the parent directory name of each
    ``.one`` file (relative grouping).
    """
    sections: dict[str | None, list[Path]] = defaultdict(list)

    if path.is_file():
        if path.suffix.lower() != ".one":
            _fatal(f"Not a .one file: {path}")
        sections[None].append(path)
    elif path.is_dir():
        one_files = sorted(path.rglob("*.one"))
        if not one_files:
            # Also try case-insensitive
            one_files = sorted(p for p in path.rglob("*") if p.suffix.lower() == ".one")
        if not one_files:
            _fatal(f"No .one files found in {path}")
        for f in one_files:
            # Use the immediate parent directory name as the section/folder name
            # unless the parent is the input directory itself
            if f.parent == path:
                sections[None].append(f)
            else:
                section_name = f.parent.name
                sections[section_name].append(f)
    else:
        _fatal(f"Path does not exist: {path}")

    return dict(sections)


# ---------------------------------------------------------------------------
# Tika extraction
# ---------------------------------------------------------------------------

def _extract_one_file(one_path: Path, *, verbose: bool = False) -> dict[str, Any]:
    """Call Tika on a single .one file and return the parsed result."""
    if verbose:
        _log(f"Extracting: {one_path}")
    result = tika_parser.from_file(str(one_path), xmlContent=True)
    return result  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Build .nous.zip
# ---------------------------------------------------------------------------

def build_nous_zip(
    input_path: Path,
    output_path: Path,
    notebook_name: str,
    *,
    verbose: bool = False,
) -> None:
    sections = _discover_one_files(input_path)

    notebook_id = _uuid()
    now_iso = _now_iso()
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

    # Notebook metadata
    notebook_json: dict[str, Any] = {
        "id": notebook_id,
        "name": notebook_name,
        "type": "standard",
        "icon": "\U0001f4d3",
        "sectionsEnabled": False,
        "archived": False,
        "systemPromptMode": "override",
        "isPinned": False,
        "position": 0,
        "createdAt": now_iso,
        "updatedAt": now_iso,
    }

    # Create folders for sections (if more than one section, or if any named section exists)
    folders: list[dict[str, Any]] = []
    section_to_folder_id: dict[str | None, str | None] = {None: None}

    named_sections = [s for s in sections if s is not None]
    if named_sections:
        for idx, section_name in enumerate(sorted(named_sections)):
            folder_id = _uuid()
            folders.append({
                "id": folder_id,
                "notebookId": notebook_id,
                "name": section_name,
                "folderType": "standard",
                "position": idx,
                "createdAt": now_iso,
                "updatedAt": now_iso,
            })
            section_to_folder_id[section_name] = folder_id

    # Process pages
    pages: list[dict[str, Any]] = []
    all_images: list[tuple[str, bytes]] = []  # (filename, raw_bytes)
    page_position = 0

    for section_name, one_files in sections.items():
        folder_id = section_to_folder_id.get(section_name)
        for one_path in one_files:
            try:
                result = _extract_one_file(one_path, verbose=verbose)
            except Exception as exc:
                _log(f"WARNING: Failed to extract {one_path}: {exc}")
                continue

            content_xhtml = result.get("content") or ""
            metadata = result.get("metadata") or {}

            if not content_xhtml.strip():
                _log(f"WARNING: No content extracted from {one_path}")
                continue

            # Determine page title
            title = _page_title_from_metadata(metadata, one_path.stem)

            # Convert XHTML to blocks
            blocks, images = _convert_xhtml_to_blocks(
                content_xhtml, notebook_id, verbose=verbose,
            )
            all_images.extend(images)

            if not blocks:
                _log(f"WARNING: No blocks produced from {one_path}")
                continue

            page_id = _uuid()
            page_json: dict[str, Any] = {
                "id": page_id,
                "notebookId": notebook_id,
                "title": title,
                "content": {
                    "time": now_ms,
                    "version": "2.28.0",
                    "blocks": blocks,
                },
                "tags": [],
                "isArchived": False,
                "isCover": False,
                "position": page_position,
                "systemPromptMode": "override",
                "pageType": "standard",
                "isFavorite": False,
                "createdAt": now_iso,
                "updatedAt": now_iso,
            }
            if folder_id is not None:
                page_json["folderId"] = folder_id

            pages.append(page_json)
            page_position += 1

            if verbose:
                _log(f"  Page: {title!r} ({len(blocks)} blocks, {len(images)} images)")

    if not pages:
        _fatal("No pages could be extracted. Check that the .one files are valid and Tika/Java is working.")

    # Assemble ZIP
    _log(f"Writing {output_path} ({len(pages)} pages, {len(all_images)} images, {len(folders)} folders)")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("notebook.json", json.dumps(notebook_json, indent=2))

        if folders:
            zf.writestr("folders.json", json.dumps(folders, indent=2))

        for page in pages:
            zf.writestr(f"pages/{page['id']}.json", json.dumps(page, indent=2))

        for filename, raw_bytes in all_images:
            zf.writestr(f"assets/images/{filename}", raw_bytes)

        # Backup metadata (optional but helpful)
        backup_meta = {
            "version": "1.0",
            "createdAt": now_iso,
            "notebookId": notebook_id,
            "notebookName": notebook_name,
            "pageCount": len(pages),
            "assetCount": len(all_images),
        }
        zf.writestr("_backup_metadata.json", json.dumps(backup_meta, indent=2))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(buf.getvalue())
    _log("Done.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _log(msg: str) -> None:
    print(msg, file=sys.stderr)


def _fatal(msg: str) -> None:
    _log(f"ERROR: {msg}")
    sys.exit(1)


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Convert OneNote backup .one files to .nous.zip for import.",
    )
    ap.add_argument(
        "path",
        type=Path,
        help="Path to .one file or directory of .one files",
    )
    ap.add_argument(
        "-o", "--output",
        type=Path,
        default=None,
        help="Output .nous.zip path (default: <name>.nous.zip)",
    )
    ap.add_argument(
        "--name",
        default=None,
        help="Notebook name (default: directory/file name)",
    )
    ap.add_argument(
        "--verbose",
        action="store_true",
        help="Show detailed progress",
    )
    args = ap.parse_args()

    input_path: Path = args.path.resolve()
    if not input_path.exists():
        _fatal(f"Path does not exist: {input_path}")

    # Determine notebook name
    if args.name:
        notebook_name = args.name
    elif input_path.is_file():
        notebook_name = _strip_date_suffix(input_path.stem)
    else:
        notebook_name = input_path.name

    # Determine output path
    if args.output:
        output_path: Path = args.output.resolve()
    else:
        safe_name = re.sub(r"[^\w\s-]", "", notebook_name).strip().replace(" ", "_")
        output_path = Path.cwd() / f"{safe_name}.nous.zip"

    build_nous_zip(input_path, output_path, notebook_name, verbose=args.verbose)


if __name__ == "__main__":
    main()
