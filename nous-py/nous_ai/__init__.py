"""Katt AI - AI operations for the Katt notebook application."""

from nous_ai.audio_generate import (
    generate_page_audio,
    generate_page_audio_sync,
    get_tts_providers_sync,
    list_tts_voices,
    list_tts_voices_sync,
)
from nous_ai.chat import chat, chat_with_context
from nous_ai.document_convert import (
    ConversionResult,
    convert_document,
    convert_document_sync,
    convert_documents_batch,
    convert_documents_batch_sync,
    get_supported_extensions,
    get_supported_extensions_sync,
    is_supported_file,
    is_supported_file_sync,
)
from nous_ai.embeddings import (
    EMBEDDING_MODELS,
    EmbeddingConfig,
    discover_models,
    discover_models_sync,
    generate_embedding,
    generate_embedding_sync,
    generate_embeddings_batch,
    generate_embeddings_batch_sync,
    get_default_dimensions,
    get_embedding_models,
)
from nous_ai.inbox import classify_inbox_item, classify_inbox_item_sync
from nous_ai.organize import suggest_organization, suggest_organization_sync
from nous_ai.models import (
    ChatMessage,
    ChatResponse,
    ProviderConfig,
    ResearchSummary,
    ScrapedContent,
    SearchResponse,
    SearchResult,
)
from nous_ai.providers import get_provider, list_providers
from nous_ai.web_research import scrape_url, summarize_research, web_search

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
    # Smart organize
    "suggest_organization",
    "suggest_organization_sync",
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
    # Audio generation
    "generate_page_audio",
    "generate_page_audio_sync",
    "list_tts_voices",
    "list_tts_voices_sync",
    "get_tts_providers_sync",
]
