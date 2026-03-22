"""Data models for the Nous SDK."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Notebook:
    id: str
    name: str
    icon: str | None = None
    sections_enabled: bool = False
    archived: bool = False
    page_count: int = 0

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Notebook:
        return cls(
            id=d["id"],
            name=d["name"],
            icon=d.get("icon"),
            sections_enabled=d.get("sectionsEnabled", False),
            archived=d.get("archived", False),
            page_count=d.get("pageCount", 0),
        )


@dataclass
class Page:
    id: str
    title: str
    notebook_id: str
    tags: list[str] = field(default_factory=list)
    folder_id: str | None = None
    section_id: str | None = None
    page_type: str = "standard"
    is_daily_note: bool = False
    daily_note_date: str | None = None
    created_at: str = ""
    updated_at: str = ""
    content: dict[str, Any] | None = None

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Page:
        return cls(
            id=d["id"],
            title=d.get("title", ""),
            notebook_id=d.get("notebookId", ""),
            tags=d.get("tags", []),
            folder_id=d.get("folderId"),
            section_id=d.get("sectionId"),
            page_type=d.get("pageType", "standard"),
            is_daily_note=d.get("isDailyNote", False),
            daily_note_date=d.get("dailyNoteDate"),
            created_at=d.get("createdAt", ""),
            updated_at=d.get("updatedAt", ""),
            content=d.get("content"),
        )

    @property
    def text(self) -> str:
        """Extract plain text from Editor.js content blocks."""
        if not self.content:
            return ""
        blocks = self.content.get("blocks", [])
        parts = []
        for block in blocks:
            data = block.get("data", {})
            text = data.get("text", "")
            if text:
                parts.append(text)
            # Handle list items
            items = data.get("items", [])
            for item in items:
                if isinstance(item, str):
                    parts.append(f"- {item}")
                elif isinstance(item, dict):
                    parts.append(f"- {item.get('content', item.get('text', ''))}")
        return "\n".join(parts)


@dataclass
class Folder:
    id: str
    name: str
    parent_id: str | None = None
    section_id: str | None = None
    position: int = 0

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Folder:
        return cls(
            id=d["id"],
            name=d["name"],
            parent_id=d.get("parentId"),
            section_id=d.get("sectionId"),
            position=d.get("position", 0),
        )


@dataclass
class Section:
    id: str
    name: str
    color: str | None = None
    position: int = 0

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Section:
        return cls(
            id=d["id"],
            name=d["name"],
            color=d.get("color"),
            position=d.get("position", 0),
        )


@dataclass
class InboxItem:
    id: str
    title: str
    content: str | None = None
    tags: list[str] = field(default_factory=list)
    created_at: str = ""

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> InboxItem:
        return cls(
            id=d["id"],
            title=d.get("title", ""),
            content=d.get("content"),
            tags=d.get("tags", []),
            created_at=d.get("createdAt", d.get("captured_at", "")),
        )


@dataclass
class Goal:
    id: str
    name: str
    description: str = ""
    target_type: str = "boolean"
    target_value: int | None = None
    frequency: str = "daily"

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Goal:
        return cls(
            id=d["id"],
            name=d.get("name", ""),
            description=d.get("description", ""),
            target_type=d.get("targetType", "boolean"),
            target_value=d.get("targetValue"),
            frequency=d.get("frequency", "daily"),
        )


@dataclass
class Database:
    id: str
    title: str
    tags: list[str] = field(default_factory=list)
    folder_id: str | None = None
    section_id: str | None = None
    property_count: int = 0
    row_count: int = 0

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Database:
        return cls(
            id=d["id"],
            title=d.get("title", ""),
            tags=d.get("tags", []),
            folder_id=d.get("folderId"),
            section_id=d.get("sectionId"),
            property_count=d.get("propertyCount", 0),
            row_count=d.get("rowCount", 0),
        )


@dataclass
class SearchResult:
    page_id: str
    notebook_id: str
    title: str
    snippet: str = ""
    score: float = 0.0

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> SearchResult:
        return cls(
            page_id=d.get("pageId", d.get("page_id", "")),
            notebook_id=d.get("notebookId", d.get("notebook_id", "")),
            title=d.get("title", ""),
            snippet=d.get("snippet", ""),
            score=d.get("score", 0.0),
        )
