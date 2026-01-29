"""
Inbox classification module for AI-powered note filing.
"""

import asyncio
import json
from typing import Any

from .chat import get_provider


async def classify_inbox_item(
    title: str,
    content: str,
    tags: list[str],
    notebooks: list[dict[str, str]],
    pages: list[dict[str, str]],
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """
    Classify an inbox item to determine where it should be filed.

    Args:
        title: Title of the inbox item
        content: Content of the inbox item
        tags: Tags associated with the item
        notebooks: List of available notebooks with id and name
        pages: List of available pages with notebook_id, notebook_name, page_id, title
        provider_type: AI provider (openai, anthropic, ollama)
        api_key: API key for the provider
        model: Model to use

    Returns:
        Classification result with action type and details
    """
    provider = get_provider(provider_type, api_key=api_key, model=model)

    # Build context about available notebooks and pages
    notebooks_context = "\n".join([
        f"- {nb.get('name', 'Unknown')} (ID: {nb.get('id', '')})"
        for nb in notebooks
    ])

    pages_context = "\n".join([
        f"- \"{p.get('title', 'Untitled')}\" in {p.get('notebook_name', 'Unknown')} (Page ID: {p.get('page_id', '')}, Notebook ID: {p.get('notebook_id', '')})"
        for p in pages[:20]  # Limit to 20 pages for context
    ])

    tags_str = ", ".join(tags) if tags else "none"

    system_prompt = """You are an intelligent note filing assistant. Your job is to analyze incoming notes and determine the best place to file them.

You must respond with a JSON object containing your classification decision. Choose ONE of these actions:

1. create_page: Create a new page in an existing notebook
2. append_to_page: Add content to an existing page
3. create_notebook: Create a new notebook for this content (only if no existing notebook fits)
4. keep_in_inbox: Keep in inbox if unclear where it should go

Response format:
{
    "action_type": "create_page" | "append_to_page" | "create_notebook" | "keep_in_inbox",
    "confidence": 0.0-1.0,
    "reasoning": "Brief explanation of why this destination was chosen",

    // For create_page:
    "notebook_id": "uuid of target notebook",
    "notebook_name": "name of target notebook",
    "suggested_title": "suggested title for new page",
    "suggested_tags": ["tag1", "tag2"],

    // For append_to_page:
    "notebook_id": "uuid of notebook",
    "notebook_name": "name of notebook",
    "page_id": "uuid of page",
    "page_title": "title of page",

    // For create_notebook:
    "suggested_name": "name for new notebook",
    "suggested_icon": "emoji icon",

    // For keep_in_inbox:
    "reason": "why it should stay in inbox"
}

Consider:
- Topic and subject matter of the note
- Existing notebook themes and purposes
- Whether content relates to an existing page
- Tags that might indicate a destination
"""

    user_message = f"""Please classify this inbox item:

TITLE: {title}

CONTENT:
{content}

TAGS: {tags_str}

AVAILABLE NOTEBOOKS:
{notebooks_context if notebooks_context else "No notebooks available"}

RECENT PAGES:
{pages_context if pages_context else "No pages available"}

Analyze this note and determine the best action. Respond with JSON only."""

    try:
        response = await provider.chat(user_message, system_prompt=system_prompt)

        # Parse JSON response
        response_text = response.get("content", "{}")

        # Try to extract JSON from the response
        try:
            # Handle markdown code blocks
            if "```json" in response_text:
                json_start = response_text.find("```json") + 7
                json_end = response_text.find("```", json_start)
                response_text = response_text[json_start:json_end].strip()
            elif "```" in response_text:
                json_start = response_text.find("```") + 3
                json_end = response_text.find("```", json_start)
                response_text = response_text[json_start:json_end].strip()

            result = json.loads(response_text)
        except json.JSONDecodeError:
            # If parsing fails, return keep_in_inbox
            result = {
                "action_type": "keep_in_inbox",
                "confidence": 0.3,
                "reasoning": "Could not parse AI response",
                "reason": "Classification failed - please review manually"
            }

        return result

    except Exception as e:
        return {
            "action_type": "keep_in_inbox",
            "confidence": 0.0,
            "reasoning": f"Error during classification: {str(e)}",
            "reason": f"Classification error: {str(e)}"
        }


def classify_inbox_item_sync(
    title: str,
    content: str,
    tags: list[str],
    notebooks: list[dict[str, str]],
    pages: list[dict[str, str]],
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """Synchronous wrapper for classify_inbox_item."""
    return asyncio.run(classify_inbox_item(
        title=title,
        content=content,
        tags=tags,
        notebooks=notebooks,
        pages=pages,
        provider_type=provider_type,
        api_key=api_key,
        model=model,
    ))
