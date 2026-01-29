"""Katt AI - AI operations for the Katt notebook application."""

from nous_ai.chat import chat, chat_with_context
from nous_ai.providers import get_provider, list_providers
from nous_ai.models import (
    ChatMessage,
    ChatResponse,
    ProviderConfig,
    SearchResult,
    SearchResponse,
    ScrapedContent,
    ResearchSummary,
)
from nous_ai.web_research import web_search, scrape_url, summarize_research
from nous_ai.inbox import classify_inbox_item, classify_inbox_item_sync
from nous_ai.document_convert import (
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
from nous_ai.embeddings import (
    generate_embedding,
    generate_embedding_sync,
    generate_embeddings_batch,
    generate_embeddings_batch_sync,
    get_embedding_models,
    get_default_dimensions,
    discover_models,
    discover_models_sync,
    EMBEDDING_MODELS,
    EmbeddingConfig,
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
    # Embeddings
    "generate_embedding",
    "generate_embedding_sync",
    "generate_embeddings_batch",
    "generate_embeddings_batch_sync",
    "get_embedding_models",
    "get_default_dimensions",
    "discover_models",
    "discover_models_sync",
    "EMBEDDING_MODELS",
    "EmbeddingConfig",
]
