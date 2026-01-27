//! Content chunking for RAG indexing.
//!
//! This module provides utilities for splitting page content into chunks
//! suitable for embedding and semantic search.

use uuid::Uuid;

use crate::storage::{EditorBlock, Page};

use super::models::{Chunk, ChunkMetadata};

/// Maximum number of tokens per chunk (approximate).
const MAX_CHUNK_TOKENS: usize = 512;

/// Number of tokens to overlap between chunks for context continuity.
const OVERLAP_TOKENS: usize = 50;

/// Approximate characters per token (rough estimate for English text).
const CHARS_PER_TOKEN: usize = 4;

/// Maximum characters per chunk.
const MAX_CHUNK_CHARS: usize = MAX_CHUNK_TOKENS * CHARS_PER_TOKEN;

/// Overlap characters between chunks.
const OVERLAP_CHARS: usize = OVERLAP_TOKENS * CHARS_PER_TOKEN;

/// Chunk a page into embedding-ready text chunks.
pub fn chunk_page(page: &Page) -> Vec<Chunk> {
    let text = extract_text_from_blocks(&page.content.blocks);
    chunk_text_with_ids(&text, page.id, page.notebook_id)
}

/// Chunk raw text into chunks with page/notebook IDs.
fn chunk_text_with_ids(text: &str, page_id: Uuid, notebook_id: Uuid) -> Vec<Chunk> {
    let text_chunks = sliding_window(text, MAX_CHUNK_CHARS, OVERLAP_CHARS);

    text_chunks
        .into_iter()
        .enumerate()
        .map(|(index, (content, start, end))| {
            Chunk::new(
                page_id,
                notebook_id,
                index as u32,
                content,
                Some(ChunkMetadata {
                    block_types: vec!["text".to_string()],
                    start_offset: start,
                    end_offset: end,
                }),
            )
        })
        .collect()
}

/// Chunk raw text into string chunks (for external use).
pub fn chunk_text(text: &str) -> Vec<String> {
    sliding_window(text, MAX_CHUNK_CHARS, OVERLAP_CHARS)
        .into_iter()
        .map(|(content, _, _)| content)
        .collect()
}

/// Extract plain text from Editor.js blocks.
fn extract_text_from_blocks(blocks: &[EditorBlock]) -> String {
    let mut text_parts: Vec<String> = Vec::new();

    for block in blocks {
        let text = extract_text_from_block(block);
        if !text.is_empty() {
            text_parts.push(text);
        }
    }

    text_parts.join("\n\n")
}

/// Extract text from a single Editor.js block.
fn extract_text_from_block(block: &EditorBlock) -> String {
    match block.block_type.as_str() {
        "paragraph" | "header" => block
            .data
            .get("text")
            .and_then(|v| v.as_str())
            .map(strip_html_tags)
            .unwrap_or_default(),

        "list" | "checklist" => {
            if let Some(items) = block.data.get("items").and_then(|v| v.as_array()) {
                items
                    .iter()
                    .filter_map(|item| {
                        if let Some(s) = item.as_str() {
                            Some(strip_html_tags(s))
                        } else if let Some(obj) = item.as_object() {
                            obj.get("text")
                                .or(obj.get("content"))
                                .and_then(|v| v.as_str())
                                .map(strip_html_tags)
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                String::new()
            }
        }

        "code" => block
            .data
            .get("code")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),

        "quote" => block
            .data
            .get("text")
            .and_then(|v| v.as_str())
            .map(strip_html_tags)
            .unwrap_or_default(),

        "table" => {
            if let Some(content) = block.data.get("content").and_then(|v| v.as_array()) {
                content
                    .iter()
                    .filter_map(|row| row.as_array())
                    .flat_map(|row| {
                        row.iter()
                            .filter_map(|cell| cell.as_str().map(strip_html_tags))
                    })
                    .collect::<Vec<_>>()
                    .join(" ")
            } else {
                String::new()
            }
        }

        _ => {
            // For unknown block types, try common text fields
            block
                .data
                .get("text")
                .or(block.data.get("caption"))
                .and_then(|v| v.as_str())
                .map(strip_html_tags)
                .unwrap_or_default()
        }
    }
}

/// Strip HTML tags from text.
fn strip_html_tags(html: &str) -> String {
    let mut result = String::with_capacity(html.len());
    let mut in_tag = false;

    for ch in html.chars() {
        if ch == '<' {
            in_tag = true;
        } else if ch == '>' {
            in_tag = false;
        } else if !in_tag {
            result.push(ch);
        }
    }

    // Decode common HTML entities
    result
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .trim()
        .to_string()
}

/// Split text into overlapping chunks using a sliding window approach.
/// Returns tuples of (chunk_text, start_offset, end_offset).
fn sliding_window(text: &str, max_chars: usize, overlap: usize) -> Vec<(String, usize, usize)> {
    let text = text.trim();
    if text.is_empty() {
        return Vec::new();
    }

    // If text is small enough, return as single chunk
    if text.len() <= max_chars {
        return vec![(text.to_string(), 0, text.len())];
    }

    let mut chunks = Vec::new();
    let mut start = 0;

    while start < text.len() {
        let end = (start + max_chars).min(text.len());

        // Try to find a good break point (sentence or paragraph boundary)
        let chunk_end = if end < text.len() {
            find_break_point(&text[start..end], max_chars)
                .map(|offset| start + offset)
                .unwrap_or(end)
        } else {
            end
        };

        let chunk_text = text[start..chunk_end].trim().to_string();
        if !chunk_text.is_empty() {
            chunks.push((chunk_text, start, chunk_end));
        }

        // Move start position, accounting for overlap
        let step = chunk_end - start;
        if step <= overlap {
            // Avoid infinite loop if chunk is too small
            start = chunk_end;
        } else {
            start = chunk_end - overlap;
        }
    }

    chunks
}

/// Find a good break point in text (prefer sentence/paragraph boundaries).
fn find_break_point(text: &str, max_len: usize) -> Option<usize> {
    let search_text = &text[..max_len.min(text.len())];

    // Look for paragraph boundary (double newline)
    if let Some(pos) = search_text.rfind("\n\n") {
        if pos > max_len / 3 {
            return Some(pos + 2);
        }
    }

    // Look for sentence boundary
    for pattern in &[". ", "! ", "? ", ".\n", "!\n", "?\n"] {
        if let Some(pos) = search_text.rfind(pattern) {
            if pos > max_len / 3 {
                return Some(pos + pattern.len());
            }
        }
    }

    // Look for any newline
    if let Some(pos) = search_text.rfind('\n') {
        if pos > max_len / 3 {
            return Some(pos + 1);
        }
    }

    // Look for comma or semicolon
    for pattern in &[", ", "; "] {
        if let Some(pos) = search_text.rfind(pattern) {
            if pos > max_len / 2 {
                return Some(pos + pattern.len());
            }
        }
    }

    // Fall back to word boundary
    if let Some(pos) = search_text.rfind(' ') {
        return Some(pos + 1);
    }

    None
}

/// Estimate the number of tokens in text.
#[allow(dead_code)]
pub fn estimate_tokens(text: &str) -> usize {
    text.len() / CHARS_PER_TOKEN
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_html_tags() {
        assert_eq!(strip_html_tags("<p>Hello</p>"), "Hello");
        assert_eq!(strip_html_tags("Hello &amp; World"), "Hello & World");
        assert_eq!(strip_html_tags("<a href='test'>Link</a>"), "Link");
    }

    #[test]
    fn test_sliding_window_small_text() {
        let chunks = sliding_window("Hello world", 1000, 100);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].0, "Hello world");
    }

    #[test]
    fn test_sliding_window_large_text() {
        let text = "This is a test. ".repeat(100);
        let chunks = sliding_window(&text, 200, 50);
        assert!(chunks.len() > 1);

        // Check that chunks have overlap
        for i in 1..chunks.len() {
            let prev_end = &chunks[i - 1].0;
            let curr_start = &chunks[i].0;
            // There should be some text from the end of prev in the start of curr
            let overlap_text = &prev_end[prev_end.len().saturating_sub(50)..];
            assert!(
                curr_start.starts_with(overlap_text.trim())
                    || curr_start.contains(&overlap_text[..overlap_text.len().min(20)])
            );
        }
    }

    #[test]
    fn test_chunk_text() {
        let text = "Short text";
        let chunks = chunk_text(text);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], "Short text");
    }
}
