"""Infographic generation for Katt — visual summaries from study tools content."""

import io
import math
import os
import time
from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

# ===== Optional dependency checks =====

SVGWRITE_AVAILABLE = False
try:
    import svgwrite

    SVGWRITE_AVAILABLE = True
except ImportError:
    pass

CAIROSVG_AVAILABLE = False
try:
    import cairosvg

    CAIROSVG_AVAILABLE = True
except ImportError:
    pass


# ===== Models =====


class InfographicTemplate(str, Enum):
    """Available infographic templates."""

    KEY_CONCEPTS = "key_concepts"
    EXECUTIVE_SUMMARY = "executive_summary"
    TIMELINE = "timeline"
    CONCEPT_MAP = "concept_map"


class InfographicTheme(str, Enum):
    """Color themes for infographics."""

    LIGHT = "light"
    DARK = "dark"


class InfographicConfig(BaseModel):
    """Configuration for infographic generation."""

    template: InfographicTemplate
    width: int = 1200
    height: int = 800
    theme: InfographicTheme = InfographicTheme.LIGHT
    title: str | None = None


class InfographicResult(BaseModel):
    """Result from infographic generation."""

    svg_content: str
    png_path: str | None = None
    width: int
    height: int
    generation_time_seconds: float


# ===== Theme Colors =====


def get_theme_colors(theme: InfographicTheme) -> dict[str, str]:
    """Get color palette for a theme."""
    if theme == InfographicTheme.DARK:
        return {
            "background": "#1a1a2e",
            "text": "#eaeaea",
            "text_secondary": "#b0b0b0",
            "primary": "#0f4c75",
            "secondary": "#3282b8",
            "accent": "#bbe1fa",
            "border": "#3a3a5a",
            "card": "#252545",
            "highlight": "#f39c12",
        }
    else:  # light
        return {
            "background": "#ffffff",
            "text": "#2c3e50",
            "text_secondary": "#7f8c8d",
            "primary": "#3498db",
            "secondary": "#2980b9",
            "accent": "#e74c3c",
            "border": "#bdc3c7",
            "card": "#ecf0f1",
            "highlight": "#f39c12",
        }


# ===== Text Utilities =====


def wrap_text(text: str, max_chars: int = 40) -> list[str]:
    """Wrap text into lines of approximately max_chars length."""
    words = text.split()
    lines: list[str] = []
    current_line: list[str] = []
    current_length = 0

    for word in words:
        word_length = len(word)
        if current_length + word_length + 1 <= max_chars:
            current_line.append(word)
            current_length += word_length + 1
        else:
            if current_line:
                lines.append(" ".join(current_line))
            current_line = [word]
            current_length = word_length

    if current_line:
        lines.append(" ".join(current_line))

    return lines if lines else [""]


def truncate_text(text: str, max_length: int = 100) -> str:
    """Truncate text to max_length with ellipsis."""
    if len(text) <= max_length:
        return text
    return text[: max_length - 3] + "..."


# ===== Template: Key Concepts =====


def generate_key_concepts_svg(
    key_concepts: list[dict[str, str]],
    config: InfographicConfig,
) -> str:
    """Generate a key concepts infographic as SVG.

    Args:
        key_concepts: List of dicts with 'term' and 'definition' keys
        config: Infographic configuration

    Returns:
        SVG content as string
    """
    if not SVGWRITE_AVAILABLE:
        raise ImportError("svgwrite package is not installed. Install with: pip install svgwrite")

    colors = get_theme_colors(config.theme)
    dwg = svgwrite.Drawing(size=(config.width, config.height))

    # Background
    dwg.add(dwg.rect(insert=(0, 0), size=(config.width, config.height), fill=colors["background"]))

    # Title
    title = config.title or "Key Concepts"
    dwg.add(
        dwg.text(
            title,
            insert=(config.width / 2, 50),
            text_anchor="middle",
            font_size="28px",
            font_family="Arial, sans-serif",
            font_weight="bold",
            fill=colors["text"],
        )
    )

    # Calculate grid layout
    num_concepts = len(key_concepts)
    if num_concepts == 0:
        # No concepts - show placeholder
        dwg.add(
            dwg.text(
                "No concepts to display",
                insert=(config.width / 2, config.height / 2),
                text_anchor="middle",
                font_size="18px",
                font_family="Arial, sans-serif",
                fill=colors["text_secondary"],
            )
        )
        return dwg.tostring()

    # Grid parameters
    cols = min(3, num_concepts)
    rows = math.ceil(num_concepts / cols)
    card_width = (config.width - 100) / cols - 20
    card_height = min(180, (config.height - 120) / rows - 20)
    start_x = 50
    start_y = 90

    for i, concept in enumerate(key_concepts[:12]):  # Limit to 12 concepts
        col = i % cols
        row = i // cols

        x = start_x + col * (card_width + 20)
        y = start_y + row * (card_height + 20)

        # Card background
        dwg.add(
            dwg.rect(
                insert=(x, y),
                size=(card_width, card_height),
                rx=8,
                ry=8,
                fill=colors["card"],
                stroke=colors["border"],
                stroke_width=1,
            )
        )

        # Term (header)
        term = truncate_text(concept.get("term", ""), 30)
        dwg.add(
            dwg.text(
                term,
                insert=(x + 15, y + 30),
                font_size="16px",
                font_family="Arial, sans-serif",
                font_weight="bold",
                fill=colors["primary"],
            )
        )

        # Separator line
        dwg.add(
            dwg.line(
                start=(x + 15, y + 42),
                end=(x + card_width - 15, y + 42),
                stroke=colors["border"],
                stroke_width=1,
            )
        )

        # Definition (wrapped)
        definition = concept.get("definition", "")
        lines = wrap_text(definition, int(card_width / 8))
        for j, line in enumerate(lines[:5]):  # Max 5 lines
            dwg.add(
                dwg.text(
                    truncate_text(line, 45),
                    insert=(x + 15, y + 65 + j * 20),
                    font_size="13px",
                    font_family="Arial, sans-serif",
                    fill=colors["text"],
                )
            )

    return dwg.tostring()


# ===== Template: Executive Summary =====


def generate_executive_summary_svg(
    briefing: dict[str, Any],
    config: InfographicConfig,
) -> str:
    """Generate an executive summary infographic as SVG.

    Args:
        briefing: BriefingDocument dict with title, executive_summary, key_findings, recommendations
        config: Infographic configuration

    Returns:
        SVG content as string
    """
    if not SVGWRITE_AVAILABLE:
        raise ImportError("svgwrite package is not installed. Install with: pip install svgwrite")

    colors = get_theme_colors(config.theme)
    dwg = svgwrite.Drawing(size=(config.width, config.height))

    # Background
    dwg.add(dwg.rect(insert=(0, 0), size=(config.width, config.height), fill=colors["background"]))

    # Title
    title = config.title or briefing.get("title", "Executive Summary")
    dwg.add(
        dwg.text(
            truncate_text(title, 60),
            insert=(config.width / 2, 45),
            text_anchor="middle",
            font_size="26px",
            font_family="Arial, sans-serif",
            font_weight="bold",
            fill=colors["text"],
        )
    )

    # Executive summary section
    summary = briefing.get("executive_summary", "")
    summary_lines = wrap_text(summary, 90)
    y_offset = 80

    dwg.add(
        dwg.rect(
            insert=(40, y_offset),
            size=(config.width - 80, len(summary_lines[:4]) * 22 + 30),
            rx=8,
            ry=8,
            fill=colors["card"],
            stroke=colors["primary"],
            stroke_width=2,
        )
    )

    for i, line in enumerate(summary_lines[:4]):
        dwg.add(
            dwg.text(
                line,
                insert=(60, y_offset + 25 + i * 22),
                font_size="14px",
                font_family="Arial, sans-serif",
                fill=colors["text"],
            )
        )

    y_offset += len(summary_lines[:4]) * 22 + 50

    # Two-column layout for findings and recommendations
    col_width = (config.width - 100) / 2

    # Key Findings column
    dwg.add(
        dwg.text(
            "Key Findings",
            insert=(50, y_offset),
            font_size="18px",
            font_family="Arial, sans-serif",
            font_weight="bold",
            fill=colors["primary"],
        )
    )

    findings = briefing.get("key_findings", [])
    for i, finding in enumerate(findings[:6]):
        bullet_y = y_offset + 30 + i * 35
        # Bullet point
        dwg.add(
            dwg.circle(
                center=(60, bullet_y - 4),
                r=4,
                fill=colors["secondary"],
            )
        )
        lines = wrap_text(truncate_text(finding, 80), 40)
        for j, line in enumerate(lines[:2]):
            dwg.add(
                dwg.text(
                    line,
                    insert=(75, bullet_y + j * 16),
                    font_size="12px",
                    font_family="Arial, sans-serif",
                    fill=colors["text"],
                )
            )

    # Recommendations column
    dwg.add(
        dwg.text(
            "Recommendations",
            insert=(50 + col_width, y_offset),
            font_size="18px",
            font_family="Arial, sans-serif",
            font_weight="bold",
            fill=colors["accent"],
        )
    )

    recommendations = briefing.get("recommendations", [])
    for i, rec in enumerate(recommendations[:6]):
        bullet_y = y_offset + 30 + i * 35
        # Numbered bullet
        dwg.add(
            dwg.circle(
                center=(60 + col_width, bullet_y - 4),
                r=10,
                fill=colors["accent"],
            )
        )
        dwg.add(
            dwg.text(
                str(i + 1),
                insert=(60 + col_width, bullet_y),
                text_anchor="middle",
                font_size="11px",
                font_family="Arial, sans-serif",
                font_weight="bold",
                fill=colors["background"],
            )
        )
        lines = wrap_text(truncate_text(rec, 80), 40)
        for j, line in enumerate(lines[:2]):
            dwg.add(
                dwg.text(
                    line,
                    insert=(80 + col_width, bullet_y + j * 16),
                    font_size="12px",
                    font_family="Arial, sans-serif",
                    fill=colors["text"],
                )
            )

    return dwg.tostring()


# ===== Template: Timeline =====


def generate_timeline_svg(
    events: list[dict[str, Any]],
    config: InfographicConfig,
) -> str:
    """Generate a timeline infographic as SVG.

    Args:
        events: List of TimelineEvent dicts with date, title, description
        config: Infographic configuration

    Returns:
        SVG content as string
    """
    if not SVGWRITE_AVAILABLE:
        raise ImportError("svgwrite package is not installed. Install with: pip install svgwrite")

    colors = get_theme_colors(config.theme)
    dwg = svgwrite.Drawing(size=(config.width, config.height))

    # Background
    dwg.add(dwg.rect(insert=(0, 0), size=(config.width, config.height), fill=colors["background"]))

    # Title
    title = config.title or "Timeline"
    dwg.add(
        dwg.text(
            title,
            insert=(config.width / 2, 45),
            text_anchor="middle",
            font_size="26px",
            font_family="Arial, sans-serif",
            font_weight="bold",
            fill=colors["text"],
        )
    )

    if not events:
        dwg.add(
            dwg.text(
                "No events to display",
                insert=(config.width / 2, config.height / 2),
                text_anchor="middle",
                font_size="18px",
                font_family="Arial, sans-serif",
                fill=colors["text_secondary"],
            )
        )
        return dwg.tostring()

    # Horizontal timeline
    timeline_y = config.height / 2
    timeline_start = 80
    timeline_end = config.width - 80
    timeline_length = timeline_end - timeline_start

    # Main timeline line
    dwg.add(
        dwg.line(
            start=(timeline_start, timeline_y),
            end=(timeline_end, timeline_y),
            stroke=colors["border"],
            stroke_width=4,
        )
    )

    # Plot events
    num_events = min(len(events), 8)  # Limit to 8 events
    spacing = timeline_length / (num_events + 1)

    for i, event in enumerate(events[:num_events]):
        x = timeline_start + spacing * (i + 1)
        above = i % 2 == 0  # Alternate above/below

        # Vertical connector
        connector_start = timeline_y - 10 if above else timeline_y + 10
        connector_end = timeline_y - 80 if above else timeline_y + 80

        dwg.add(
            dwg.line(
                start=(x, connector_start),
                end=(x, connector_end),
                stroke=colors["secondary"],
                stroke_width=2,
            )
        )

        # Event dot
        dwg.add(
            dwg.circle(
                center=(x, timeline_y),
                r=8,
                fill=colors["primary"],
                stroke=colors["background"],
                stroke_width=2,
            )
        )

        # Event card
        card_y = connector_end - 60 if above else connector_end + 10
        card_width = 140
        card_height = 70

        dwg.add(
            dwg.rect(
                insert=(x - card_width / 2, card_y),
                size=(card_width, card_height),
                rx=6,
                ry=6,
                fill=colors["card"],
                stroke=colors["border"],
                stroke_width=1,
            )
        )

        # Date
        date = event.get("date", "")[:10]  # Take first 10 chars (YYYY-MM-DD)
        dwg.add(
            dwg.text(
                date,
                insert=(x, card_y + 18),
                text_anchor="middle",
                font_size="11px",
                font_family="Arial, sans-serif",
                font_weight="bold",
                fill=colors["secondary"],
            )
        )

        # Title
        event_title = truncate_text(event.get("title", ""), 18)
        dwg.add(
            dwg.text(
                event_title,
                insert=(x, card_y + 38),
                text_anchor="middle",
                font_size="12px",
                font_family="Arial, sans-serif",
                font_weight="bold",
                fill=colors["text"],
            )
        )

        # Description (truncated)
        desc = truncate_text(event.get("description", ""), 25)
        dwg.add(
            dwg.text(
                desc,
                insert=(x, card_y + 55),
                text_anchor="middle",
                font_size="10px",
                font_family="Arial, sans-serif",
                fill=colors["text_secondary"],
            )
        )

    return dwg.tostring()


# ===== Template: Concept Map =====


def generate_concept_map_svg(
    nodes: list[dict[str, Any]],
    links: list[dict[str, Any]],
    config: InfographicConfig,
) -> str:
    """Generate a concept map infographic as SVG.

    Args:
        nodes: List of ConceptNode dicts with id, label, node_type, description
        links: List of ConceptLink dicts with source, target, relationship
        config: Infographic configuration

    Returns:
        SVG content as string
    """
    if not SVGWRITE_AVAILABLE:
        raise ImportError("svgwrite package is not installed. Install with: pip install svgwrite")

    colors = get_theme_colors(config.theme)
    dwg = svgwrite.Drawing(size=(config.width, config.height))

    # Background
    dwg.add(dwg.rect(insert=(0, 0), size=(config.width, config.height), fill=colors["background"]))

    # Title
    title = config.title or "Concept Map"
    dwg.add(
        dwg.text(
            title,
            insert=(config.width / 2, 40),
            text_anchor="middle",
            font_size="24px",
            font_family="Arial, sans-serif",
            font_weight="bold",
            fill=colors["text"],
        )
    )

    if not nodes:
        dwg.add(
            dwg.text(
                "No concepts to display",
                insert=(config.width / 2, config.height / 2),
                text_anchor="middle",
                font_size="18px",
                font_family="Arial, sans-serif",
                fill=colors["text_secondary"],
            )
        )
        return dwg.tostring()

    # Position nodes in a circular layout
    num_nodes = min(len(nodes), 15)  # Limit nodes
    center_x = config.width / 2
    center_y = (config.height + 60) / 2
    radius = min(config.width, config.height - 100) / 2.5

    # Calculate positions
    node_positions: dict[str, tuple[float, float]] = {}
    for i, node in enumerate(nodes[:num_nodes]):
        angle = (2 * math.pi * i / num_nodes) - math.pi / 2
        x = center_x + radius * math.cos(angle)
        y = center_y + radius * math.sin(angle)
        node_positions[node.get("id", str(i))] = (x, y)

    # Draw links first (below nodes)
    for link in links:
        source_id = link.get("source", "")
        target_id = link.get("target", "")

        if source_id in node_positions and target_id in node_positions:
            start_pos = node_positions[source_id]
            end_pos = node_positions[target_id]

            # Draw line
            dwg.add(
                dwg.line(
                    start=start_pos,
                    end=end_pos,
                    stroke=colors["border"],
                    stroke_width=2,
                    stroke_opacity=0.6,
                )
            )

            # Relationship label at midpoint
            mid_x = (start_pos[0] + end_pos[0]) / 2
            mid_y = (start_pos[1] + end_pos[1]) / 2
            relationship = truncate_text(link.get("relationship", ""), 15)

            if relationship:
                # Background for label
                dwg.add(
                    dwg.rect(
                        insert=(mid_x - 35, mid_y - 8),
                        size=(70, 16),
                        rx=3,
                        ry=3,
                        fill=colors["background"],
                        fill_opacity=0.9,
                    )
                )
                dwg.add(
                    dwg.text(
                        relationship,
                        insert=(mid_x, mid_y + 4),
                        text_anchor="middle",
                        font_size="10px",
                        font_family="Arial, sans-serif",
                        fill=colors["text_secondary"],
                    )
                )

    # Draw nodes
    node_type_colors = {
        "concept": colors["primary"],
        "example": colors["highlight"],
        "definition": colors["secondary"],
    }

    for node in nodes[:num_nodes]:
        node_id = node.get("id", "")
        if node_id not in node_positions:
            continue

        x, y = node_positions[node_id]
        node_type = node.get("node_type", "concept")
        fill_color = node_type_colors.get(node_type, colors["primary"])

        # Node circle
        dwg.add(
            dwg.circle(
                center=(x, y),
                r=35,
                fill=fill_color,
                stroke=colors["background"],
                stroke_width=3,
            )
        )

        # Node label
        label = truncate_text(node.get("label", ""), 12)
        dwg.add(
            dwg.text(
                label,
                insert=(x, y + 5),
                text_anchor="middle",
                font_size="11px",
                font_family="Arial, sans-serif",
                font_weight="bold",
                fill="#ffffff",
            )
        )

    # Legend
    legend_y = config.height - 40
    legend_items = [
        ("Concept", colors["primary"]),
        ("Example", colors["highlight"]),
        ("Definition", colors["secondary"]),
    ]

    for i, (label, color) in enumerate(legend_items):
        x = 100 + i * 120
        dwg.add(dwg.circle(center=(x, legend_y), r=8, fill=color))
        dwg.add(
            dwg.text(
                label,
                insert=(x + 15, legend_y + 4),
                font_size="12px",
                font_family="Arial, sans-serif",
                fill=colors["text"],
            )
        )

    return dwg.tostring()


# ===== PNG Export =====


def export_svg_to_png(svg_content: str, output_path: str) -> str:
    """Convert SVG content to PNG file.

    Args:
        svg_content: SVG string content
        output_path: Path to save PNG file

    Returns:
        Path to the saved PNG file
    """
    if not CAIROSVG_AVAILABLE:
        raise ImportError(
            "cairosvg package is not installed. Install with: pip install cairosvg"
        )

    cairosvg.svg2png(bytestring=svg_content.encode("utf-8"), write_to=output_path)
    return output_path


# ===== Main Entry Points =====


def generate_infographic(
    template: str,
    data: dict[str, Any],
    output_dir: str,
    config: dict[str, Any] | None = None,
    export_png: bool = True,
) -> dict[str, Any]:
    """Generate an infographic from data.

    Args:
        template: Template type (key_concepts, executive_summary, timeline, concept_map)
        data: Data dict containing the relevant fields for the template
        output_dir: Directory to save output files
        config: Optional configuration dict (width, height, theme, title)
        export_png: Whether to export PNG in addition to SVG

    Returns:
        InfographicResult as a dict
    """
    start_time = time.time()

    config = config or {}
    infographic_config = InfographicConfig(
        template=InfographicTemplate(template),
        width=config.get("width", 1200),
        height=config.get("height", 800),
        theme=InfographicTheme(config.get("theme", "light")),
        title=config.get("title"),
    )

    # Generate SVG based on template
    template_type = InfographicTemplate(template)

    if template_type == InfographicTemplate.KEY_CONCEPTS:
        key_concepts = data.get("key_concepts", [])
        svg_content = generate_key_concepts_svg(key_concepts, infographic_config)

    elif template_type == InfographicTemplate.EXECUTIVE_SUMMARY:
        svg_content = generate_executive_summary_svg(data, infographic_config)

    elif template_type == InfographicTemplate.TIMELINE:
        events = data.get("events", [])
        svg_content = generate_timeline_svg(events, infographic_config)

    elif template_type == InfographicTemplate.CONCEPT_MAP:
        nodes = data.get("nodes", [])
        links = data.get("links", [])
        svg_content = generate_concept_map_svg(nodes, links, infographic_config)

    else:
        raise ValueError(f"Unknown template: {template}")

    # Ensure output directory exists
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # Save SVG
    timestamp = int(time.time())
    svg_filename = f"infographic_{template}_{timestamp}.svg"
    svg_path = os.path.join(output_dir, svg_filename)
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(svg_content)

    # Export PNG if requested
    png_path = None
    if export_png and CAIROSVG_AVAILABLE:
        png_filename = f"infographic_{template}_{timestamp}.png"
        png_path = os.path.join(output_dir, png_filename)
        export_svg_to_png(svg_content, png_path)

    generation_time = time.time() - start_time

    result = InfographicResult(
        svg_content=svg_content,
        png_path=png_path,
        width=infographic_config.width,
        height=infographic_config.height,
        generation_time_seconds=round(generation_time, 2),
    )

    return result.model_dump()


def generate_infographic_sync(
    template: str,
    data: dict[str, Any],
    output_dir: str,
    config: dict[str, Any] | None = None,
    export_png: bool = True,
) -> dict[str, Any]:
    """Synchronous wrapper for generate_infographic."""
    return generate_infographic(template, data, output_dir, config, export_png)


# ===== Availability Check =====


def check_infographic_availability() -> dict[str, bool]:
    """Check which infographic features are available."""
    return {
        "svg_generation": SVGWRITE_AVAILABLE,
        "png_export": CAIROSVG_AVAILABLE,
    }
