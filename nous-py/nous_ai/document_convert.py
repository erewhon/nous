"""Document conversion functionality using markitdown.

Converts various file formats (PDF, Word, Excel, PowerPoint, images, etc.)
to Markdown for import into Katt notebooks.
"""

from pathlib import Path
from typing import Any

from pydantic import BaseModel
from markitdown import MarkItDown


class ConversionResult(BaseModel):
    """Result of a document conversion."""

    content: str
    """The converted markdown content."""

    source_path: str
    """Original file path."""

    source_type: str
    """Detected file type (e.g., 'pdf', 'docx', 'xlsx')."""

    title: str | None = None
    """Extracted title if available."""

    word_count: int = 0
    """Word count of converted content."""


# Supported file extensions and their types
SUPPORTED_EXTENSIONS: dict[str, str] = {
    # Documents
    ".pdf": "pdf",
    ".docx": "docx",
    ".doc": "doc",
    ".pptx": "pptx",
    ".ppt": "ppt",
    ".xlsx": "xlsx",
    ".xls": "xls",
    # Web and data
    ".html": "html",
    ".htm": "html",
    ".csv": "csv",
    ".json": "json",
    ".xml": "xml",
    # Images
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".gif": "image",
    ".webp": "image",
    ".bmp": "image",
    # Audio
    ".mp3": "audio",
    ".wav": "audio",
    ".m4a": "audio",
    ".ogg": "audio",
    # Archives
    ".zip": "zip",
    # Ebooks
    ".epub": "epub",
}


def get_supported_extensions() -> list[str]:
    """Get list of supported file extensions.

    Returns:
        List of supported extensions (e.g., ['.pdf', '.docx', ...]).
    """
    return list(SUPPORTED_EXTENSIONS.keys())


def is_supported_file(file_path: str) -> bool:
    """Check if a file type is supported for conversion.

    Args:
        file_path: Path to the file.

    Returns:
        True if the file type is supported.
    """
    ext = Path(file_path).suffix.lower()
    return ext in SUPPORTED_EXTENSIONS


def detect_file_type(file_path: str) -> str | None:
    """Detect the file type from extension.

    Args:
        file_path: Path to the file.

    Returns:
        File type string or None if not supported.
    """
    ext = Path(file_path).suffix.lower()
    return SUPPORTED_EXTENSIONS.get(ext)


def convert_document(file_path: str) -> dict[str, Any]:
    """Convert a document to Markdown using markitdown.

    Args:
        file_path: Path to the document file.

    Returns:
        Dict with conversion result including content and metadata.

    Raises:
        FileNotFoundError: If the file doesn't exist.
        ValueError: If the file type is not supported.
    """
    path = Path(file_path)

    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    file_type = detect_file_type(file_path)
    if not file_type:
        raise ValueError(
            f"Unsupported file type: {path.suffix}. "
            f"Supported types: {', '.join(SUPPORTED_EXTENSIONS.keys())}"
        )

    # Convert using markitdown
    md = MarkItDown()
    result = md.convert(str(path))

    content = result.text_content or ""

    # Try to extract a title from the content
    title = None
    lines = content.strip().split("\n")
    for line in lines[:10]:  # Check first 10 lines
        line = line.strip()
        if line.startswith("# "):
            title = line[2:].strip()
            break
        elif line and not line.startswith("#"):
            # Use first non-empty, non-header line as fallback title
            if not title:
                title = line[:100]  # Truncate long first lines

    # If no title found, use filename
    if not title:
        title = path.stem

    conversion_result = ConversionResult(
        content=content,
        source_path=str(path.absolute()),
        source_type=file_type,
        title=title,
        word_count=len(content.split()),
    )

    return conversion_result.model_dump()


def convert_documents_batch(file_paths: list[str]) -> list[dict[str, Any]]:
    """Convert multiple documents to Markdown.

    Args:
        file_paths: List of paths to document files.

    Returns:
        List of conversion results. Failed conversions include an 'error' key.
    """
    results = []

    for file_path in file_paths:
        try:
            result = convert_document(file_path)
            results.append(result)
        except Exception as e:
            results.append({
                "source_path": file_path,
                "error": str(e),
                "content": "",
                "source_type": detect_file_type(file_path) or "unknown",
                "title": Path(file_path).stem,
                "word_count": 0,
            })

    return results


# ===== Synchronous wrappers for PyO3 (called from Rust) =====
# Note: markitdown operations are already synchronous, but we keep
# the naming convention consistent with other modules.


def convert_document_sync(file_path: str) -> dict[str, Any]:
    """Synchronous wrapper for convert_document."""
    return convert_document(file_path)


def convert_documents_batch_sync(file_paths: list[str]) -> list[dict[str, Any]]:
    """Synchronous wrapper for convert_documents_batch."""
    return convert_documents_batch(file_paths)


def get_supported_extensions_sync() -> list[str]:
    """Synchronous wrapper for get_supported_extensions."""
    return get_supported_extensions()


def is_supported_file_sync(file_path: str) -> bool:
    """Synchronous wrapper for is_supported_file."""
    return is_supported_file(file_path)
