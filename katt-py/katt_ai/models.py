"""Pydantic models for Katt AI operations."""

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class ProviderType(str, Enum):
    """Supported AI provider types."""

    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    OLLAMA = "ollama"


class ChatMessage(BaseModel):
    """A single chat message."""

    role: Literal["system", "user", "assistant"]
    content: str


class ChatResponse(BaseModel):
    """Response from a chat completion."""

    content: str
    model: str
    provider: ProviderType
    tokens_used: int | None = None
    finish_reason: str | None = None


class ProviderConfig(BaseModel):
    """Configuration for an AI provider."""

    provider_type: ProviderType
    api_key: str | None = None
    base_url: str | None = None
    model: str = Field(default="")
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=4096, ge=1)

    def model_post_init(self, __context) -> None:
        """Set default model based on provider if not specified."""
        if not self.model:
            defaults = {
                ProviderType.OPENAI: "gpt-4o",
                ProviderType.ANTHROPIC: "claude-sonnet-4-20250514",
                ProviderType.OLLAMA: "llama3.2",
            }
            self.model = defaults.get(self.provider_type, "gpt-4o")


class SummarizeRequest(BaseModel):
    """Request to summarize content."""

    content: str
    max_length: int = Field(default=500, ge=50, le=2000)
    style: Literal["brief", "detailed", "bullet_points"] = "brief"


class SummarizeResponse(BaseModel):
    """Response from summarization."""

    summary: str
    original_length: int
    summary_length: int


class PageContext(BaseModel):
    """Context from a notebook page for AI operations."""

    page_id: str
    title: str
    content: str  # Plain text extracted from Editor.js blocks
    tags: list[str] = Field(default_factory=list)
    notebook_name: str | None = None


# ===== Web Research Models =====


class SearchResult(BaseModel):
    """A single search result from Tavily."""

    title: str
    url: str
    content: str  # Snippet from search
    score: float
    published_date: str | None = None


class SearchResponse(BaseModel):
    """Response from Tavily search API."""

    query: str
    results: list[SearchResult]
    answer: str | None = None
    follow_up_questions: list[str] = Field(default_factory=list)


class ScrapedContent(BaseModel):
    """Content scraped from a URL."""

    url: str
    title: str
    content: str
    author: str | None = None
    published_date: str | None = None
    word_count: int


class SourceRef(BaseModel):
    """Reference to a source in research summary."""

    title: str
    url: str


class ResearchSummary(BaseModel):
    """AI-generated summary of research results."""

    summary: str
    key_points: list[str] = Field(default_factory=list)
    sources: list[SourceRef] = Field(default_factory=list)
    suggested_tags: list[str] = Field(default_factory=list)
