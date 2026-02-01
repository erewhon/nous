"""
Smart Organize module — AI-powered page organization suggestions.
"""

import asyncio
import json
from typing import Any

from .chat import get_provider


async def suggest_organization(
    pages: list[dict[str, Any]],
    destinations: list[dict[str, Any]],
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
) -> list[dict[str, Any]]:
    """
    Analyze pages and suggest which destination notebook each should be moved to.

    Args:
        pages: List of pages to organize, each with id, title, content_summary, tags.
        destinations: List of destination notebooks, each with id, name, sample_page_titles.
        provider_type: AI provider (openai, anthropic, ollama).
        api_key: API key for the provider.
        model: Model to use.

    Returns:
        List of suggestions, one per page.
    """
    provider = get_provider(provider_type, api_key=api_key, model=model)

    system_prompt = """You are a note organization assistant. You analyze pages and suggest which notebook they best belong to, based on content topic, tags, and the themes of destination notebooks.

Respond with a JSON array. For each page, suggest the best destination notebook or null if it should stay where it is.

Response format:
[
  {
    "page_id": "uuid",
    "suggested_notebook_id": "uuid or null",
    "confidence": 0.0-1.0,
    "reasoning": "Brief explanation"
  }
]

Guidelines:
- Only suggest moving a page if you are reasonably confident it fits better in a destination notebook.
- If a page's topic does not clearly match any destination, set suggested_notebook_id to null.
- Consider page titles, content summaries, and tags when making decisions.
- Consider the theme of each destination notebook based on its name and sample page titles.
- Confidence should reflect how well the page matches the suggested destination.
- Keep reasoning brief (one sentence)."""

    # Build destination context
    dest_lines: list[str] = []
    for dest in destinations:
        name = dest.get("name", "Unknown")
        dest_id = dest.get("id", "")
        sample_titles = dest.get("sample_page_titles", [])
        samples_str = ", ".join(f'"{t}"' for t in sample_titles[:5])
        if samples_str:
            dest_lines.append(f"- {name} (ID: {dest_id}) — sample pages: {samples_str}")
        else:
            dest_lines.append(f"- {name} (ID: {dest_id})")

    destinations_context = "\n".join(dest_lines)

    # Process in batches of 20
    batch_size = 20
    all_results: list[dict[str, Any]] = []

    for i in range(0, len(pages), batch_size):
        batch = pages[i : i + batch_size]

        # Build pages context for this batch
        page_lines: list[str] = []
        for page in batch:
            page_id = page.get("id", "")
            title = page.get("title", "Untitled")
            content_summary = page.get("content_summary", "")
            tags = page.get("tags", [])
            tags_str = ", ".join(tags) if tags else "none"
            page_lines.append(
                f"- ID: {page_id}\n  Title: {title}\n  Tags: {tags_str}\n  Content: {content_summary}"
            )

        pages_context = "\n\n".join(page_lines)

        user_message = f"""Analyze these pages and suggest which destination notebook each should be moved to.

DESTINATION NOTEBOOKS:
{destinations_context}

PAGES TO ORGANIZE:
{pages_context}

Respond with a JSON array only."""

        try:
            response = await provider.chat(user_message, system_prompt=system_prompt)
            response_text = response.get("content", "[]")

            # Parse JSON response, handling markdown code blocks
            try:
                if "```json" in response_text:
                    json_start = response_text.find("```json") + 7
                    json_end = response_text.find("```", json_start)
                    response_text = response_text[json_start:json_end].strip()
                elif "```" in response_text:
                    json_start = response_text.find("```") + 3
                    json_end = response_text.find("```", json_start)
                    response_text = response_text[json_start:json_end].strip()

                batch_results = json.loads(response_text)
                if isinstance(batch_results, list):
                    all_results.extend(batch_results)
                else:
                    # If the AI returned something unexpected, generate empty results
                    for page in batch:
                        all_results.append({
                            "page_id": page.get("id", ""),
                            "suggested_notebook_id": None,
                            "confidence": 0.0,
                            "reasoning": "Could not parse AI response",
                        })
            except json.JSONDecodeError:
                for page in batch:
                    all_results.append({
                        "page_id": page.get("id", ""),
                        "suggested_notebook_id": None,
                        "confidence": 0.0,
                        "reasoning": "Could not parse AI response",
                    })

        except Exception as e:
            for page in batch:
                all_results.append({
                    "page_id": page.get("id", ""),
                    "suggested_notebook_id": None,
                    "confidence": 0.0,
                    "reasoning": f"Error during analysis: {str(e)}",
                })

    return all_results


def suggest_organization_sync(
    pages: list[dict[str, Any]],
    destinations: list[dict[str, Any]],
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
) -> list[dict[str, Any]]:
    """Synchronous wrapper for suggest_organization."""
    return asyncio.run(
        suggest_organization(
            pages=pages,
            destinations=destinations,
            provider_type=provider_type,
            api_key=api_key,
            model=model,
        )
    )
