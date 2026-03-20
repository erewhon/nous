"""Artwork import pipeline for the Art Research Gallery.

Takes a URL, extracts the primary image and page text,
optionally enriches with AI research, and creates a Nous page.

Site-specific extractors handle structured data from major museum
and art sites. Falls back to generic OpenGraph/HTML extraction.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# Site-specific extractors
# ═══════════════════════════════════════════════════════════════════════


def _extract_met_museum(html: str, url: str) -> dict[str, Any] | None:
    """Metropolitan Museum of Art — uses embedded JSON-LD and structured HTML."""
    # Met pages have JSON-LD with detailed artwork info
    ld_match = re.search(
        r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
        html, re.DOTALL,
    )
    if ld_match:
        try:
            ld = json.loads(ld_match.group(1))
            items = ld if isinstance(ld, list) else [ld]
            for item in items:
                if item.get("@type") == "VisualArtwork":
                    artist_data = item.get("creator", {})
                    artist = artist_data.get("name") if isinstance(artist_data, dict) else str(artist_data)
                    return {
                        "title": item.get("name", ""),
                        "artist": artist,
                        "image_url": item.get("image"),
                        "date": item.get("dateCreated", ""),
                        "medium": item.get("artMedium", ""),
                        "dimensions": item.get("width", ""),
                    }
        except (json.JSONDecodeError, TypeError):
            pass

    # Parse from og:title — format: "Artist - Title - The Metropolitan Museum of Art"
    og_title = _og_content(html, "og:title")
    title = None
    artist = None
    if og_title:
        parts = og_title.split(" - ")
        if len(parts) >= 3 and "Metropolitan" in parts[-1]:
            artist = parts[0].strip()
            title = parts[1].strip()
        elif len(parts) >= 2:
            title = parts[0].strip()

    # Also try HTML structure for artist
    if not artist:
        artist_match = re.search(
            r'<span[^>]*class="[^"]*artist[^"]*"[^>]*>([^<]+)</span>', html, re.IGNORECASE,
        )
        if artist_match:
            artist = _clean_text(artist_match.group(1))

    return {
        "title": title or og_title,
        "artist": artist,
        "image_url": _og_content(html, "og:image"),
    } if (title or og_title) else None


def _extract_wikiart(html: str, url: str) -> dict[str, Any] | None:
    """WikiArt — structured painting data."""
    title = _og_content(html, "og:title")
    image = _og_content(html, "og:image")
    if not title:
        return None

    # WikiArt titles are "Title - Artist"
    artist = None
    if " - " in title:
        parts = title.rsplit(" - ", 1)
        if len(parts) == 2:
            title, artist = parts[0].strip(), parts[1].strip()

    # Try to extract details from structured data
    details: dict[str, str] = {}
    for label in ["Style", "Genre", "Media", "Dimensions", "Period", "Date"]:
        m = re.search(
            rf'<s[^>]*>\s*{label}\s*</s[^>]*>\s*(?:<[^>]*>)*\s*([^<]+)',
            html, re.IGNORECASE,
        )
        if m:
            details[label.lower()] = _clean_text(m.group(1))

    return {
        "title": title,
        "artist": artist,
        "image_url": image,
        "medium": details.get("media"),
        "style": details.get("style"),
        "genre": details.get("genre"),
        "date": details.get("date"),
    }


def _extract_wikipedia(html: str, url: str) -> dict[str, Any] | None:
    """Wikipedia — extract from infobox and article."""
    title = _og_content(html, "og:title")
    if title:
        title = title.replace(" - Wikipedia", "").strip()

    image = _og_content(html, "og:image")

    # Parse infobox for artist info
    artist = None
    # Look for "Artist" row in infobox
    artist_match = re.search(
        r'<th[^>]*>\s*Artist\s*</th>\s*<td[^>]*>(.*?)</td>',
        html, re.IGNORECASE | re.DOTALL,
    )
    if artist_match:
        # Strip HTML tags from the artist cell
        artist_html = artist_match.group(1)
        # Try to get the first link text
        link_match = re.search(r'<a[^>]*>([^<]+)</a>', artist_html)
        artist = _clean_text(link_match.group(1) if link_match else re.sub(r'<[^>]+>', '', artist_html))

    # Also check for "by ARTIST" in the first paragraph
    if not artist:
        first_para = re.search(r'<p[^>]*>(.*?)</p>', html, re.DOTALL)
        if first_para:
            by_match = re.search(r'(?:by|painting by)\s+<a[^>]*>([^<]+)</a>', first_para.group(1), re.IGNORECASE)
            if by_match:
                artist = _clean_text(by_match.group(1))

    # Extract medium, date, dimensions from infobox
    details: dict[str, str] = {}
    for field in ["Medium", "Dimensions", "Year", "Type"]:
        m = re.search(
            rf'<th[^>]*>\s*{field}\s*</th>\s*<td[^>]*>(.*?)</td>',
            html, re.IGNORECASE | re.DOTALL,
        )
        if m:
            details[field.lower()] = _clean_text(re.sub(r'<[^>]+>', '', m.group(1)))

    return {
        "title": title,
        "artist": artist,
        "image_url": image,
        "medium": details.get("medium") or details.get("type"),
        "date": details.get("year"),
        "dimensions": details.get("dimensions"),
    }


def _extract_artic(html: str, url: str) -> dict[str, Any] | None:
    """Art Institute of Chicago — JSON-LD structured data."""
    ld_match = re.search(
        r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
        html, re.DOTALL,
    )
    if ld_match:
        try:
            ld = json.loads(ld_match.group(1))
            if ld.get("@type") == "VisualArtwork":
                creator = ld.get("creator", [])
                artist = None
                if isinstance(creator, list) and creator:
                    artist = creator[0].get("name") if isinstance(creator[0], dict) else str(creator[0])
                elif isinstance(creator, dict):
                    artist = creator.get("name")
                return {
                    "title": ld.get("name", ""),
                    "artist": artist,
                    "image_url": ld.get("image"),
                    "date": ld.get("dateCreated", ""),
                }
        except (json.JSONDecodeError, TypeError):
            pass
    return None


def _extract_google_arts(html: str, url: str) -> dict[str, Any] | None:
    """Google Arts & Culture."""
    title = _og_content(html, "og:title")
    image = _og_content(html, "og:image")
    description = _og_content(html, "og:description") or ""

    if not title:
        return None

    # Title format is often "Title - Artist - Google Arts & Culture"
    artist = None
    parts = title.split(" - ")
    if len(parts) >= 3 and "Google" in parts[-1]:
        title = parts[0].strip()
        artist = parts[1].strip()
    elif len(parts) >= 2 and "Google" in parts[-1]:
        title = parts[0].strip()

    return {
        "title": title,
        "artist": artist,
        "image_url": image,
        "description": description,
    }


# Map domain patterns to extractors
SITE_EXTRACTORS: list[tuple[str, Any]] = [
    ("metmuseum.org", _extract_met_museum),
    ("wikiart.org", _extract_wikiart),
    ("wikipedia.org", _extract_wikipedia),
    ("artic.edu", _extract_artic),
    ("artchicago.edu", _extract_artic),
    ("artsandculture.google.com", _extract_google_arts),
]


# ═══════════════════════════════════════════════════════════════════════
# Generic extraction (fallback)
# ═══════════════════════════════════════════════════════════════════════


def _extract_generic(html: str, url: str) -> dict[str, Any]:
    """Generic extraction using OpenGraph, JSON-LD, and HTML heuristics."""
    result: dict[str, Any] = {
        "title": None,
        "artist": None,
        "image_url": None,
    }

    # Try JSON-LD first
    ld_matches = re.findall(
        r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
        html, re.DOTALL,
    )
    for ld_text in ld_matches:
        try:
            ld = json.loads(ld_text)
            items = ld if isinstance(ld, list) else [ld]
            for item in items:
                if item.get("@type") in ("VisualArtwork", "Painting", "Photograph", "Sculpture"):
                    result["title"] = item.get("name")
                    creator = item.get("creator", {})
                    if isinstance(creator, dict):
                        result["artist"] = creator.get("name")
                    elif isinstance(creator, str):
                        result["artist"] = creator
                    result["image_url"] = item.get("image")
                    if isinstance(result["image_url"], list):
                        result["image_url"] = result["image_url"][0] if result["image_url"] else None
                    result["date"] = item.get("dateCreated")
                    result["medium"] = item.get("artMedium")
                    break
        except (json.JSONDecodeError, TypeError):
            continue

    # OpenGraph fallbacks
    if not result["title"]:
        result["title"] = _og_content(html, "og:title") or _html_title(html)
    if not result["image_url"]:
        result["image_url"] = _og_content(html, "og:image") or _twitter_image(html) or _first_large_image(html, url)
    if not result["artist"]:
        # Try citation_author meta tag (used by museums/academic sites)
        result["artist"] = _og_content(html, "citation_author")
    if not result["artist"]:
        # Try og:description — many art sites start with "Artist Name, date"
        desc = _og_content(html, "og:description") or ""
        if desc:
            # Pattern: "Name Name, YYYY" at the start
            desc_match = re.match(r'^([A-Z][a-zà-ÿ]+(?: (?:de |van |von |di |del |la |le )?[A-Z][a-zà-ÿ]+)+)\s*,\s*\d{4}', desc)
            if desc_match:
                result["artist"] = desc_match.group(1)
    if not result["artist"]:
        result["artist"] = _guess_artist_from_html(result["title"] or "", html)

    # Clean up title — strip common site suffixes
    if result["title"]:
        for sep in [" | ", " — ", " :: ", " >> "]:
            if sep in result["title"]:
                result["title"] = result["title"].split(sep)[0].strip()
        # Don't strip " - " universally as "Artist - Title" is common
        # Only strip if the suffix looks like a site name
        if " - " in result["title"]:
            parts = result["title"].rsplit(" - ", 1)
            suffix_lower = parts[-1].strip().lower()
            site_words = ["museum", "gallery", "collection", "wikipedia", "wikiart",
                         "google", "artnet", "christie", "sotheby", "the met"]
            if any(w in suffix_lower for w in site_words):
                result["title"] = parts[0].strip()

    return result


# ═══════════════════════════════════════════════════════════════════════
# Main import function
# ═══════════════════════════════════════════════════════════════════════


def import_artwork(
    url: str,
    ai_enrich: bool = True,
    ai_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Import artwork from a URL.

    Returns a dict with:
        title, image_url, source_url, extracted_text, artist,
        research (if AI enriched), tags, medium, date, dimensions
    """
    logger.info(f"Importing artwork from: {url}")

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
    domain = urlparse(url).netloc.lower()

    # Try site-specific extractor first
    extracted = None
    for pattern, extractor in SITE_EXTRACTORS:
        if pattern in domain:
            try:
                extracted = extractor(html, url)
            except Exception as e:
                logger.warning(f"Site extractor for {pattern} failed: {e}")
            break

    # Fall back to generic extraction
    if not extracted or not extracted.get("title"):
        extracted = _extract_generic(html, url)

    # Ensure absolute image URL
    if extracted.get("image_url"):
        extracted["image_url"] = urljoin(url, extracted["image_url"])

    # Extract body text
    text = _extract_body_text(html)

    # Generate tags
    title = extracted.get("title") or "Untitled Artwork"
    artist = extracted.get("artist")
    tags = _generate_tags(title, artist, text, extracted)

    # AI enrichment
    research = None
    if ai_enrich and ai_config:
        try:
            research, ai_tags = _ai_research(
                url=url,
                title=title,
                artist=artist,
                text=text[:3000],
                extracted=extracted,
                config=ai_config,
            )
            tags.extend(ai_tags)
            # AI might identify the artist better
            if not artist and research:
                ai_artist = _extract_artist_from_research(research)
                if ai_artist:
                    artist = ai_artist
                    tags.append(ai_artist.lower().replace(" ", "-"))
        except Exception as e:
            logger.warning(f"AI enrichment failed: {e}")

    # Format page title
    page_title = title
    if artist and artist.lower() not in title.lower():
        page_title = f"{artist} — {title}"

    return {
        "title": page_title,
        "image_url": extracted.get("image_url", ""),
        "source_url": url,
        "extracted_text": text[:5000],
        "artist": artist,
        "research": research,
        "tags": list(set(tags)),
        "medium": extracted.get("medium"),
        "date": extracted.get("date"),
        "dimensions": extracted.get("dimensions"),
    }


def format_artwork_page(result: dict[str, Any]) -> str:
    """Format import result as page content."""
    lines = []

    if result.get("image_url"):
        lines.append(f"![{result['title']}]({result['image_url']})")
        lines.append("")

    lines.append(f"Source: {result['source_url']}")
    lines.append("")

    # Metadata
    meta = []
    if result.get("artist"):
        meta.append(f"**Artist:** {result['artist']}")
    if result.get("date"):
        meta.append(f"**Date:** {result['date']}")
    if result.get("medium"):
        meta.append(f"**Medium:** {result['medium']}")
    if result.get("dimensions"):
        meta.append(f"**Dimensions:** {result['dimensions']}")
    if meta:
        lines.extend(meta)
        lines.append("")

    if result.get("research"):
        lines.append("## Research")
        lines.append("")
        lines.append(result["research"])
        lines.append("")

    if result.get("extracted_text"):
        lines.append("## Source Text")
        lines.append("")
        text = result["extracted_text"]
        if len(text) > 2000:
            text = text[:2000] + "..."
        lines.append(text)

    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════
# HTML helpers
# ═══════════════════════════════════════════════════════════════════════


def _og_content(html: str, prop: str) -> str | None:
    """Extract OpenGraph meta content."""
    # property="og:X" content="..."
    m = re.search(
        rf'<meta\s+(?:property|name)=["\'](?:{re.escape(prop)})["\']\s+content=["\']([^"\']+)["\']',
        html, re.IGNORECASE,
    )
    if not m:
        # content="..." property="og:X"
        m = re.search(
            rf'<meta\s+content=["\']([^"\']+)["\']\s+(?:property|name)=["\'](?:{re.escape(prop)})["\']',
            html, re.IGNORECASE,
        )
    return _clean_text(m.group(1)) if m else None


def _twitter_image(html: str) -> str | None:
    return _og_content(html, "twitter:image")


def _html_title(html: str) -> str | None:
    m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
    return _clean_text(m.group(1)) if m else None


def _first_large_image(html: str, base_url: str) -> str | None:
    """Find the first likely artwork image on the page."""
    imgs = re.findall(r'<img[^>]+src=["\']([^"\']+)["\'][^>]*>', html, re.IGNORECASE)
    skip_patterns = ["logo", "icon", "favicon", "avatar", "thumb", "1x1",
                     "pixel", "tracking", "button", "badge", "spinner"]
    for img_url in imgs:
        lower = img_url.lower()
        if any(s in lower for s in skip_patterns):
            continue
        if any(ext in lower for ext in [".jpg", ".jpeg", ".png", ".webp"]):
            return urljoin(base_url, img_url)
    return None


def _extract_body_text(html: str) -> str:
    """Extract readable text from HTML."""
    # Remove noise elements
    cleaned = re.sub(
        r"<(script|style|nav|header|footer|aside|noscript)[^>]*>.*?</\1>",
        "", html, flags=re.IGNORECASE | re.DOTALL,
    )
    text = re.sub(r"<[^>]+>", " ", cleaned)
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _clean_text(text: str) -> str:
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&quot;", '"').replace("&#39;", "'")
    return text.strip()


def _guess_artist_from_html(title: str, html: str) -> str | None:
    """Try to guess artist from HTML structure."""
    # Look for JSON-LD creator (may have been missed by generic extractor)
    for ld_text in re.findall(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', html, re.DOTALL):
        try:
            ld = json.loads(ld_text)
            items = ld if isinstance(ld, list) else [ld]
            for item in items:
                creator = item.get("creator") or item.get("author")
                if isinstance(creator, dict) and creator.get("name"):
                    return creator["name"]
                if isinstance(creator, str):
                    return creator
        except (json.JSONDecodeError, TypeError):
            continue

    # Look for common HTML patterns
    patterns = [
        # "by Artist Name" in visible text near the top
        (r'(?:by|By|BY)\s+([A-Z][a-zà-ÿ]+(?: (?:de |van |von |di |del |la |le )?[A-Z][a-zà-ÿ]+)+)', html[:3000]),
        # Explicit artist label
        (r'(?:artist|Artist|painter|Painter)\s*:\s*([A-Z][a-zà-ÿ]+(?: [A-Z][a-zà-ÿ]+)+)', html[:5000]),
    ]
    for pattern, text in patterns:
        m = re.search(pattern, text)
        if m:
            name = _clean_text(m.group(1))
            # Filter out common false positives
            if name.lower() not in ("the artist", "the painter", "an artist", "unknown artist"):
                return name

    return None


def _extract_artist_from_research(research: str) -> str | None:
    """Try to extract artist name from AI research text."""
    # Look for "Artist: Name" or "by Name" patterns in the research
    m = re.search(r'(?:Artist|Painted by|Created by)[:\s]+([A-Z][a-zà-ÿ]+(?: (?:de |van |von |di )?[A-Z][a-zà-ÿ]+)+)', research)
    if m:
        return m.group(1)
    return None


# ═══════════════════════════════════════════════════════════════════════
# Tagging
# ═══════════════════════════════════════════════════════════════════════


def _generate_tags(
    title: str,
    artist: str | None,
    text: str,
    extracted: dict[str, Any],
) -> list[str]:
    """Generate tags from extracted content."""
    tags = ["artwork"]
    if artist:
        tags.append(artist.lower().replace(" ", "-"))

    text_lower = text.lower()

    # Medium detection
    medium = (extracted.get("medium") or "").lower()
    combined = medium + " " + text_lower[:2000]
    for m in ["oil on canvas", "watercolor", "acrylic", "tempera", "fresco", "pastel",
              "charcoal", "ink", "sculpture", "bronze", "marble", "photograph",
              "woodcut", "etching", "lithograph", "gouache", "mixed media"]:
        if m in combined:
            tags.append(m.replace(" ", "-"))
            break

    # Period/movement detection
    for period in ["renaissance", "baroque", "rococo", "neoclassical",
                   "romantic", "romanticism", "impressionist", "impressionism",
                   "post-impressionist", "post-impressionism",
                   "art nouveau", "art deco",
                   "expressionist", "expressionism",
                   "cubist", "cubism",
                   "surrealist", "surrealism",
                   "abstract", "abstract expressionism",
                   "pop art", "minimalist", "minimalism",
                   "contemporary", "modern", "realist", "realism",
                   "pre-raphaelite", "mannerism"]:
        if period in text_lower[:5000]:
            tags.append(period.replace(" ", "-"))
            break

    # Subject type detection
    for subject in ["portrait", "landscape", "still life", "seascape",
                    "nude", "self-portrait", "religious", "mythological",
                    "historical", "genre scene", "cityscape"]:
        if subject in text_lower[:3000]:
            tags.append(subject.replace(" ", "-"))
            break

    # Style from extracted metadata
    style = extracted.get("style", "")
    if style and style.lower() not in [t.replace("-", " ") for t in tags]:
        tags.append(style.lower().replace(" ", "-"))

    return tags


# ═══════════════════════════════════════════════════════════════════════
# AI Research
# ═══════════════════════════════════════════════════════════════════════


def _ai_research(
    url: str,
    title: str,
    artist: str | None,
    text: str,
    extracted: dict[str, Any],
    config: dict[str, Any],
) -> tuple[str, list[str]]:
    """Query an AI model for artwork research."""
    from openai import OpenAI

    # Build context from what we already know
    known_parts = []
    if artist:
        known_parts.append(f"Artist: {artist}")
    if extracted.get("date"):
        known_parts.append(f"Date: {extracted['date']}")
    if extracted.get("medium"):
        known_parts.append(f"Medium: {extracted['medium']}")
    if extracted.get("dimensions"):
        known_parts.append(f"Dimensions: {extracted['dimensions']}")
    known_info = "\n".join(known_parts) if known_parts else "No structured metadata found."

    prompt = f"""I'm researching this artwork. Here's what I have:

URL: {url}
Title: {title}
{known_info}

Page text excerpt:
{text[:2000]}

Please provide a concise research summary (200-300 words) covering:
1. **Artist**: biography (dates, nationality, movement) — identify them if not provided above
2. **Period/Movement**: what art period or movement this belongs to
3. **Subject & Composition**: what is depicted and how
4. **Medium & Technique**: materials and approach (if determinable)
5. **Historical Context**: why this work matters
6. **Related Works**: 2-3 similar works by this or other artists

On the final line, provide tags as a JSON array prefixed with "TAGS: "
Tags should include: artist name, art period, medium, subject type (portrait/landscape/etc)."""

    base_url = config.get("base_url")
    api_key = config.get("api_key", "not-needed")
    model = config.get("model", "gpt-4o-mini")

    client = OpenAI(api_key=api_key, base_url=base_url)
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are an art historian and researcher. Be concise and factual."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.7,
        max_tokens=1000,
    )

    content = response.choices[0].message.content or ""

    # Extract tags from the last line
    tags: list[str] = []
    lines = content.strip().split("\n")
    for line in reversed(lines):
        stripped = line.strip()
        if stripped.startswith("TAGS:"):
            try:
                tag_json = stripped[5:].strip()
                tags = json.loads(tag_json)
                content = "\n".join(lines[:lines.index(line)]).strip()
            except (json.JSONDecodeError, ValueError):
                pass
            break

    return content, [t.lower().replace(" ", "-") for t in tags if isinstance(t, str)]
