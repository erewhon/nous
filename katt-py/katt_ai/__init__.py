"""Katt AI - AI operations for the Katt notebook application."""

from katt_ai.chat import chat, chat_with_context
from katt_ai.providers import get_provider, list_providers
from katt_ai.models import (
    ChatMessage,
    ChatResponse,
    ProviderConfig,
    SearchResult,
    SearchResponse,
    ScrapedContent,
    ResearchSummary,
)
from katt_ai.web_research import web_search, scrape_url, summarize_research
from katt_ai.inbox import classify_inbox_item, classify_inbox_item_sync
from katt_ai.document_convert import (
    convert_document,
    convert_document_sync,
    convert_documents_batch,
    convert_documents_batch_sync,
    get_supported_extensions,
    get_supported_extensions_sync,
    is_supported_file,
    is_supported_file_sync,
    ConversionResult,
)

__all__ = [
    "chat",
    "chat_with_context",
    "get_provider",
    "list_providers",
    "ChatMessage",
    "ChatResponse",
    "ProviderConfig",
    # Web research
    "web_search",
    "scrape_url",
    "summarize_research",
    "SearchResult",
    "SearchResponse",
    "ScrapedContent",
    "ResearchSummary",
    # Inbox classification
    "classify_inbox_item",
    "classify_inbox_item_sync",
    # Document conversion
    "convert_document",
    "convert_document_sync",
    "convert_documents_batch",
    "convert_documents_batch_sync",
    "get_supported_extensions",
    "get_supported_extensions_sync",
    "is_supported_file",
    "is_supported_file_sync",
    "ConversionResult",
]
