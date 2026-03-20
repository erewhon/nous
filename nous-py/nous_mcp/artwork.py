"""Artwork import pipeline for the Art Research Gallery.

Takes a URL, extracts the primary image and page text,
optionally enriches with AI research, and creates a Nous page.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

logger = logging.getLogger(__name__)

# Known site patterns for better image extraction
SITE_PATTERNS: dict[str, dict[str, str]] = {
    "metmuseum.org": {"image_selector": "og:image"},
    "nga.gov": {"image_selector": "og:image"},
    "louvre.fr": {"image_selector": "og:image"},
    "rijksmuseum.nl": {"image_selector": "og:image"},
    "wikiart.org": {"image_selector": "og:image"},
    "artic.edu": {"image_selector": "og:image"},
    "wikipedia.org": {"image_selector": "og:image"},
}


def import_artwork(
    url: str,
    ai_enrich: bool = True,
    ai_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Import artwork from a URL.

    Returns a dict with:
        title: str — suggested page title
        image_url: str — URL of the primary artwork image
        source_url: str — original URL
        extracted_text: str — text content from the page
        artist: str | None — detected artist name
        research: str | None — AI-generated research (if ai_enrich=True)
        tags: list[str] — suggested tags
    """
    logger.info(f"Importing artwork from: {url}")

    # Fetch the page
    resp = httpx.get(
        url,
        follow_redirects=True,
        timeout=30,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; NousBot/1.0; +https://nous.page)",
        },
    )
    resp.raise_for_status()
    html = resp.text

    # Extract metadata
    image_url = _extract_image(html, url)
    title = _extract_title(html)
    text = _extract_text(html)
    artist = _guess_artist(title, text)

    # AI enrichment
    research = None
    tags = _generate_tags(title, artist, text)

    if ai_enrich and ai_config:
        try:
            research, ai_tags = _ai_research(
                url=url,
                title=title,
                artist=artist,
                text=text[:3000],  # Limit context size
                config=ai_config,
            )
            tags.extend(ai_tags)
        except Exception as e:
            logger.warning(f"AI enrichment failed: {e}")

    # Format the page title
    page_title = title
    if artist and artist.lower() not in title.lower():
        page_title = f"{artist} — {title}"

    return {
        "title": page_title,
        "image_url": image_url or "",
        "source_url": url,
        "extracted_text": text[:5000],
        "artist": artist,
        "research": research,
        "tags": list(set(tags)),  # dedupe
    }


def format_artwork_page(result: dict[str, Any]) -> str:
    """Format import result as page content (markdown-style text)."""
    lines = []

    if result.get("image_url"):
        lines.append(f"![{result['title']}]({result['image_url']})")
        lines.append("")

    lines.append(f"Source: {result['source_url']}")
    lines.append("")

    if result.get("artist"):
        lines.append(f"**Artist:** {result['artist']}")
        lines.append("")

    if result.get("research"):
        lines.append("## Research")
        lines.append("")
        lines.append(result["research"])
        lines.append("")

    if result.get("extracted_text"):
        lines.append("## Source Text")
        lines.append("")
        # Truncate long text
        text = result["extracted_text"]
        if len(text) > 2000:
            text = text[:2000] + "..."
        lines.append(text)

    return "\n".join(lines)


# ─── HTML Extraction Helpers ────────────────────────────────────────────


def _extract_image(html: str, base_url: str) -> str | None:
    """Extract the primary artwork image URL from HTML."""
    # Try OpenGraph image first (most reliable across sites)
    og_match = re.search(
        r'<meta\s+(?:property|name)=["\']og:image["\']\s+content=["\']([^"\']+)["\']',
        html,
        re.IGNORECASE,
    )
    if not og_match:
        og_match = re.search(
            r'<meta\s+content=["\']([^"\']+)["\']\s+(?:property|name)=["\']og:image["\']',
            html,
            re.IGNORECASE,
        )
    if og_match:
        img_url = og_match.group(1)
        return urljoin(base_url, img_url)

    # Try Twitter card image
    tw_match = re.search(
        r'<meta\s+(?:name|property)=["\']twitter:image["\']\s+content=["\']([^"\']+)["\']',
        html,
        re.IGNORECASE,
    )
    if tw_match:
        return urljoin(base_url, tw_match.group(1))

    # Try schema.org ImageObject
    schema_match = re.search(
        r'"image"\s*:\s*"([^"]+)"',
        html,
    )
    if schema_match:
        return urljoin(base_url, schema_match.group(1))

    # Fallback: find largest image by looking at common art page patterns
    img_matches = re.findall(
        r'<img[^>]+src=["\']([^"\']+)["\'][^>]*>',
        html,
        re.IGNORECASE,
    )
    # Filter out tiny images, icons, logos
    for img_url in img_matches:
        lower = img_url.lower()
        if any(skip in lower for skip in ["logo", "icon", "favicon", "avatar", "thumb", "1x1", "pixel"]):
            continue
        if any(ext in lower for ext in [".jpg", ".jpeg", ".png", ".webp"]):
            return urljoin(base_url, img_url)

    return None


def _extract_title(html: str) -> str:
    """Extract the page title."""
    # Try og:title first
    og_match = re.search(
        r'<meta\s+(?:property|name)=["\']og:title["\']\s+content=["\']([^"\']+)["\']',
        html,
        re.IGNORECASE,
    )
    if og_match:
        return _clean_text(og_match.group(1))

    # Fall back to <title>
    title_match = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
    if title_match:
        title = _clean_text(title_match.group(1))
        # Strip common suffixes like " | Museum Name" or " - WikiArt"
        for sep in [" | ", " — ", " - ", " :: "]:
            if sep in title:
                title = title.split(sep)[0].strip()
        return title

    return "Untitled Artwork"


def _extract_text(html: str) -> str:
    """Extract readable text from HTML, stripping tags."""
    # Remove script, style, nav, header, footer elements
    cleaned = re.sub(
        r"<(script|style|nav|header|footer|aside)[^>]*>.*?</\1>",
        "",
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    # Remove all HTML tags
    text = re.sub(r"<[^>]+>", " ", cleaned)
    # Decode HTML entities
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " ")
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _clean_text(text: str) -> str:
    """Clean extracted text."""
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&quot;", '"').replace("&#39;", "'")
    return text.strip()


def _guess_artist(title: str, text: str) -> str | None:
    """Try to guess the artist name from title and text."""
    # Common patterns: "Title by Artist", "Artist - Title", "Artist. Title"
    patterns = [
        r"(?:by|By|BY)\s+([A-Z][a-z]+(?: [A-Z][a-z]+)+)",
        r"^([A-Z][a-z]+(?: [A-Z][a-z]+)+)\s*[-—–]\s",
        r"(?:artist|Artist|painter|Painter):\s*([A-Z][a-z]+(?: [A-Z][a-z]+)+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, title)
        if match:
            return match.group(1)
        match = re.search(pattern, text[:500])
        if match:
            return match.group(1)
    return None


def _generate_tags(title: str, artist: str | None, text: str) -> list[str]:
    """Generate basic tags from extracted content."""
    tags = ["artwork"]
    if artist:
        tags.append(artist.lower())

    # Detect medium from text
    text_lower = text.lower()
    for medium in ["oil on canvas", "watercolor", "acrylic", "tempera", "fresco", "pastel",
                    "charcoal", "ink", "sculpture", "photograph", "woodcut", "etching", "lithograph"]:
        if medium in text_lower:
            tags.append(medium.replace(" ", "-"))
            break

    # Detect period/movement
    for period in ["renaissance", "baroque", "impressionist", "impressionism", "modernist", "modern",
                   "contemporary", "romantic", "romanticism", "cubist", "cubism", "surrealist",
                   "surrealism", "abstract", "expressionist", "expressionism", "realist", "realism",
                   "art nouveau", "art deco", "post-impressionist", "pre-raphaelite", "neoclassical"]:
        if period in text_lower:
            tags.append(period)
            break

    return tags


# ─── AI Research Enrichment ─────────────────────────────────────────────


def _ai_research(
    url: str,
    title: str,
    artist: str | None,
    text: str,
    config: dict[str, Any],
) -> tuple[str, list[str]]:
    """Query an AI model for artwork research.

    Returns (research_text, suggested_tags).
    """
    from openai import OpenAI

    prompt = f"""I'm researching this artwork. Based on the following information extracted from {url}:

Title: {title}
{f'Artist: {artist}' if artist else 'Artist: Unknown'}
Page text (excerpt): {text[:2000]}

Please provide a concise research summary covering:
1. Artist: brief biography (dates, nationality, movement) — if identifiable
2. Art period or movement this belongs to
3. Subject matter and composition
4. Medium and technique (if determinable from the text)
5. Historical significance or context
6. 2-3 related works or influences

Also suggest 3-5 tags for organizing this piece (e.g., the art period, subject type like "landscape" or "portrait", technique).
Format the tags as a JSON array on the last line, prefixed with "TAGS: "

Keep the research section to about 200-300 words."""

    base_url = config.get("base_url")
    api_key = config.get("api_key", "not-needed")
    model = config.get("model", "gpt-4o-mini")

    client = OpenAI(api_key=api_key, base_url=base_url)
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are an art historian and researcher."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.7,
        max_tokens=1000,
    )

    content = response.choices[0].message.content or ""

    # Extract tags from the last line if present
    tags: list[str] = []
    lines = content.strip().split("\n")
    for line in reversed(lines):
        if line.strip().startswith("TAGS:"):
            try:
                tag_json = line.strip()[5:].strip()
                tags = json.loads(tag_json)
                content = "\n".join(lines[:lines.index(line)]).strip()
            except (json.JSONDecodeError, ValueError):
                pass
            break

    return content, [t.lower().replace(" ", "-") for t in tags if isinstance(t, str)]
