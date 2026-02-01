"""Web research functionality for Katt AI."""

import asyncio
import json
from typing import Any

import httpx
import trafilatura
from tavily import AsyncTavilyClient

from nous_ai.models import (
    ProviderConfig,
    ProviderType,
    ScrapedContent,
    SearchResponse,
    SearchResult,
    ResearchSummary,
    SourceRef,
)
from nous_ai.providers import get_provider


async def web_search(
    query: str,
    api_key: str,
    max_results: int = 10,
    search_depth: str = "basic",
    include_answer: bool = True,
) -> dict[str, Any]:
    """Search the web using Tavily API.

    Args:
        query: Search query string.
        api_key: Tavily API key.
        max_results: Maximum number of results to return (1-20).
        search_depth: "basic" for quick search, "advanced" for deeper search.
        include_answer: Whether to include AI-generated answer.

    Returns:
        Dict with search results and optional AI answer.
    """
    client = AsyncTavilyClient(api_key=api_key)

    response = await client.search(
        query=query,
        max_results=max_results,
        search_depth=search_depth,
        include_answer=include_answer,
    )

    results = [
        SearchResult(
            title=r.get("title", ""),
            url=r.get("url", ""),
            content=r.get("content", ""),
            score=r.get("score", 0.0),
            published_date=r.get("published_date"),
        )
        for r in response.get("results", [])
    ]

    search_response = SearchResponse(
        query=query,
        results=results,
        answer=response.get("answer"),
        follow_up_questions=response.get("follow_up_questions", []),
    )

    return search_response.model_dump()


async def scrape_url(url: str) -> dict[str, Any]:
    """Scrape and extract content from a URL.

    Args:
        url: URL to scrape.

    Returns:
        Dict with extracted content.
    """
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        response = await client.get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; KattBot/1.0; +https://katt.app)"
            },
        )
        response.raise_for_status()
        html = response.text

    # Extract main content using trafilatura
    extracted = trafilatura.extract(
        html,
        include_comments=False,
        include_tables=True,
        output_format="txt",
    )

    # Get metadata
    metadata = trafilatura.extract_metadata(html)

    content = extracted or ""
    scraped = ScrapedContent(
        url=url,
        title=metadata.title if metadata and metadata.title else "",
        content=content,
        author=metadata.author if metadata else None,
        published_date=str(metadata.date) if metadata and metadata.date else None,
        word_count=len(content.split()),
    )

    return scraped.model_dump()


async def summarize_research(
    contents: list[dict[str, Any]],
    query: str,
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """Summarize research results using AI.

    Args:
        contents: List of scraped content dicts with url, title, content.
        query: Original research query for context.
        provider_type: AI provider to use.
        api_key: API key for the provider.
        model: Model to use.

    Returns:
        Dict with summary, key points, and sources.
    """
    config = ProviderConfig(
        provider_type=ProviderType(provider_type),
        api_key=api_key,
        model=model or "",
        temperature=0.5,
        max_tokens=2000,
    )

    provider = get_provider(config)

    # Build context from all scraped content
    context_parts = []
    sources = []
    for c in contents:
        # Truncate content to avoid token limits
        truncated_content = c.get("content", "")[:3000]
        title = c.get("title", "Untitled")
        url = c.get("url", "")
        context_parts.append(f"=== Source: {title} ({url}) ===\n{truncated_content}")
        sources.append(SourceRef(title=title, url=url))

    context = "\n\n".join(context_parts)

    system_prompt = """You are a research assistant. Analyze the provided web content and create a comprehensive summary.

Your response must be valid JSON with this exact structure:
{
    "summary": "A comprehensive paragraph summarizing the key findings relevant to the research query...",
    "key_points": ["Key point 1", "Key point 2", "Key point 3"],
    "suggested_tags": ["tag1", "tag2", "tag3"]
}

Guidelines:
- Focus on answering the user's research query
- Be factual and synthesize information from all sources
- Extract 3-7 key points as bullet points
- Suggest 3-5 relevant tags for categorization
- Keep the summary between 100-300 words"""

    prompt = f"""Research query: {query}

Web content to analyze:
{context}

Please provide a JSON summary following the specified format."""

    # Get AI response
    from nous_ai.models import ChatMessage

    messages = [
        ChatMessage(role="system", content=system_prompt),
        ChatMessage(role="user", content=prompt),
    ]
    response = await provider.chat(messages)

    # Parse JSON response
    try:
        # Try to extract JSON from response
        content = response.content.strip()
        # Handle markdown code blocks
        if content.startswith("```"):
            lines = content.split("\n")
            content = "\n".join(lines[1:-1])
        result = json.loads(content)
    except json.JSONDecodeError:
        # Fallback if JSON parsing fails
        result = {
            "summary": response.content,
            "key_points": [],
            "suggested_tags": [],
        }

    summary = ResearchSummary(
        summary=result.get("summary", ""),
        key_points=result.get("key_points", []),
        sources=sources,
        suggested_tags=result.get("suggested_tags", []),
    )

    return summary.model_dump()


# ===== Synchronous wrappers for PyO3 (called from Rust) =====


def web_search_sync(
    query: str,
    api_key: str,
    max_results: int = 10,
    search_depth: str = "basic",
    include_answer: bool = True,
) -> dict[str, Any]:
    """Synchronous wrapper for web_search."""
    return asyncio.run(
        web_search(query, api_key, max_results, search_depth, include_answer)
    )


def scrape_url_sync(url: str) -> dict[str, Any]:
    """Synchronous wrapper for scrape_url."""
    return asyncio.run(scrape_url(url))


def summarize_research_sync(
    contents: list[dict[str, Any]],
    query: str,
    provider_type: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """Synchronous wrapper for summarize_research."""
    return asyncio.run(
        summarize_research(contents, query, provider_type, api_key, model)
    )
