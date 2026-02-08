use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tantivy::collector::TopDocs;
use tantivy::query::{FuzzyTermQuery, QueryParser};
use tantivy::schema::{Field, Schema, Value, STORED, TEXT};
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term};
use thiserror::Error;
use uuid::Uuid;

use crate::storage::{EditorBlock, Page, PageType};

/// Convert PageType to string for indexing
fn page_type_to_str(page_type: &PageType) -> &'static str {
    match page_type {
        PageType::Standard => "standard",
        PageType::Markdown => "markdown",
        PageType::Pdf => "pdf",
        PageType::Jupyter => "jupyter",
        PageType::Epub => "epub",
        PageType::Calendar => "calendar",
        PageType::Chat => "chat",
        PageType::Canvas => "canvas",
        PageType::Database => "database",
    }
}

#[derive(Error, Debug)]
pub enum SearchError {
    #[error("Tantivy error: {0}")]
    Tantivy(#[from] tantivy::TantivyError),

    #[error("Query parse error: {0}")]
    QueryParse(#[from] tantivy::query::QueryParserError),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, SearchError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub page_id: String,
    pub notebook_id: String,
    pub title: String,
    pub snippet: String,
    pub score: f32,
    pub page_type: String,
}

/// Fields in the search index schema
struct SearchFields {
    page_id: Field,
    notebook_id: Field,
    title: Field,
    content: Field,
    tags: Field,
    page_type: Field,
}

pub struct SearchIndex {
    index: Index,
    reader: IndexReader,
    writer: IndexWriter,
    fields: SearchFields,
    #[allow(dead_code)]
    schema: Schema,
}

impl SearchIndex {
    /// Create a new search index at the given path
    pub fn new(index_path: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&index_path)?;

        // Build schema
        let mut schema_builder = Schema::builder();

        let page_id = schema_builder.add_text_field("page_id", STORED);
        let notebook_id = schema_builder.add_text_field("notebook_id", STORED);
        let title = schema_builder.add_text_field("title", TEXT | STORED);
        let content = schema_builder.add_text_field("content", TEXT);
        let tags = schema_builder.add_text_field("tags", TEXT | STORED);
        let page_type = schema_builder.add_text_field("page_type", STORED);

        let schema = schema_builder.build();

        // Create or open index
        let index = Index::create_in_dir(&index_path, schema.clone())
            .or_else(|_| Index::open_in_dir(&index_path))?;

        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()?;

        // Use a smaller heap for the writer (50MB)
        let writer = index.writer(50_000_000)?;

        let fields = SearchFields {
            page_id,
            notebook_id,
            title,
            content,
            tags,
            page_type,
        };

        Ok(Self {
            index,
            reader,
            writer,
            fields,
            schema,
        })
    }

    /// Extract plain text from Editor.js blocks
    fn extract_text_from_blocks(blocks: &[EditorBlock]) -> String {
        let mut text_parts: Vec<String> = Vec::new();

        for block in blocks {
            match block.block_type.as_str() {
                "paragraph" | "header" => {
                    if let Some(text) = block.data.get("text").and_then(|v| v.as_str()) {
                        // Strip HTML tags for plain text search
                        let plain_text = Self::strip_html_tags(text);
                        if !plain_text.is_empty() {
                            text_parts.push(plain_text);
                        }
                    }
                }
                "list" | "checklist" => {
                    if let Some(items) = block.data.get("items").and_then(|v| v.as_array()) {
                        for item in items {
                            // Handle both simple strings and objects with "text" field
                            let text = if let Some(s) = item.as_str() {
                                s.to_string()
                            } else if let Some(obj) = item.as_object() {
                                obj.get("text")
                                    .or(obj.get("content"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string()
                            } else {
                                continue;
                            };

                            let plain_text = Self::strip_html_tags(&text);
                            if !plain_text.is_empty() {
                                text_parts.push(plain_text);
                            }
                        }
                    }
                }
                "code" => {
                    if let Some(code) = block.data.get("code").and_then(|v| v.as_str()) {
                        text_parts.push(code.to_string());
                    }
                }
                "quote" => {
                    if let Some(text) = block.data.get("text").and_then(|v| v.as_str()) {
                        let plain_text = Self::strip_html_tags(text);
                        if !plain_text.is_empty() {
                            text_parts.push(plain_text);
                        }
                    }
                }
                "warning" | "delimiter" | "image" | "embed" => {
                    // Skip these block types or extract caption if available
                    if let Some(caption) = block.data.get("caption").and_then(|v| v.as_str()) {
                        let plain_text = Self::strip_html_tags(caption);
                        if !plain_text.is_empty() {
                            text_parts.push(plain_text);
                        }
                    }
                }
                _ => {
                    // For unknown block types, try to extract common text fields
                    if let Some(text) = block.data.get("text").and_then(|v| v.as_str()) {
                        let plain_text = Self::strip_html_tags(text);
                        if !plain_text.is_empty() {
                            text_parts.push(plain_text);
                        }
                    }
                }
            }
        }

        text_parts.join("\n")
    }

    /// Simple HTML tag stripping (for wiki-links and basic formatting)
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
            .trim()
            .to_string()
    }

    /// Extract plain text from Jupyter notebook JSON content
    fn extract_text_from_jupyter(json_content: &str) -> String {
        let mut text_parts: Vec<String> = Vec::new();

        // Parse the notebook JSON
        let notebook: JsonValue = match serde_json::from_str(json_content) {
            Ok(v) => v,
            Err(_) => return String::new(),
        };

        // Get cells array
        if let Some(cells) = notebook.get("cells").and_then(|c| c.as_array()) {
            for cell in cells {
                let cell_type = cell.get("cell_type").and_then(|t| t.as_str()).unwrap_or("");

                // Only index code and markdown cells
                if cell_type != "code" && cell_type != "markdown" {
                    continue;
                }

                // Extract source (can be string or array of strings)
                if let Some(source) = cell.get("source") {
                    let source_text = if let Some(s) = source.as_str() {
                        s.to_string()
                    } else if let Some(arr) = source.as_array() {
                        arr.iter()
                            .filter_map(|v| v.as_str())
                            .collect::<Vec<_>>()
                            .join("")
                    } else {
                        continue;
                    };

                    if !source_text.trim().is_empty() {
                        text_parts.push(source_text);
                    }
                }

                // For code cells, also extract text outputs
                if cell_type == "code" {
                    if let Some(outputs) = cell.get("outputs").and_then(|o| o.as_array()) {
                        for output in outputs {
                            // Handle stream output (stdout/stderr)
                            if let Some(text) = output.get("text") {
                                let text_str = if let Some(s) = text.as_str() {
                                    s.to_string()
                                } else if let Some(arr) = text.as_array() {
                                    arr.iter()
                                        .filter_map(|v| v.as_str())
                                        .collect::<Vec<_>>()
                                        .join("")
                                } else {
                                    continue;
                                };
                                if !text_str.trim().is_empty() {
                                    text_parts.push(text_str);
                                }
                            }

                            // Handle execute_result and display_data with text/plain
                            if let Some(data) = output.get("data") {
                                if let Some(text_plain) = data.get("text/plain") {
                                    let text_str = if let Some(s) = text_plain.as_str() {
                                        s.to_string()
                                    } else if let Some(arr) = text_plain.as_array() {
                                        arr.iter()
                                            .filter_map(|v| v.as_str())
                                            .collect::<Vec<_>>()
                                            .join("")
                                    } else {
                                        continue;
                                    };
                                    if !text_str.trim().is_empty() {
                                        text_parts.push(text_str);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        text_parts.join("\n")
    }

    /// Index a page (for standard Editor.js pages)
    pub fn index_page(&mut self, page: &Page) -> Result<()> {
        // First, remove any existing document with this page_id
        self.remove_page(page.id)?;

        let content = Self::extract_text_from_blocks(&page.content.blocks);
        let tags = page.tags.join(" ");
        let page_type_str = page_type_to_str(&page.page_type);

        self.writer.add_document(doc!(
            self.fields.page_id => page.id.to_string(),
            self.fields.notebook_id => page.notebook_id.to_string(),
            self.fields.title => page.title.clone(),
            self.fields.content => content,
            self.fields.tags => tags,
            self.fields.page_type => page_type_str
        ))?;

        self.writer.commit()?;

        Ok(())
    }

    /// Index a page with file content (for Jupyter, Markdown, etc.)
    pub fn index_page_with_content(&mut self, page: &Page, file_content: &str) -> Result<()> {
        // First, remove any existing document with this page_id
        self.remove_page(page.id)?;

        let content = match page.page_type {
            PageType::Jupyter => Self::extract_text_from_jupyter(file_content),
            PageType::Markdown => file_content.to_string(),
            PageType::Calendar => Self::extract_text_from_calendar(file_content),
            PageType::Pdf | PageType::Epub => Self::extract_text_from_markdown(file_content),
            PageType::Database => Self::extract_text_from_database(file_content),
            _ => String::new(),
        };

        let tags = page.tags.join(" ");
        let page_type_str = page_type_to_str(&page.page_type);

        self.writer.add_document(doc!(
            self.fields.page_id => page.id.to_string(),
            self.fields.notebook_id => page.notebook_id.to_string(),
            self.fields.title => page.title.clone(),
            self.fields.content => content,
            self.fields.tags => tags,
            self.fields.page_type => page_type_str
        ))?;

        self.writer.commit()?;

        Ok(())
    }

    /// Extract plain text from markdown content (strips formatting)
    fn extract_text_from_markdown(markdown: &str) -> String {
        // Simple markdown stripping - remove common formatting
        let mut text = markdown.to_string();

        // Remove code blocks (```...```)
        let code_block_re = regex::Regex::new(r"```[\s\S]*?```").unwrap();
        text = code_block_re.replace_all(&text, " ").to_string();

        // Remove inline code (`...`)
        let inline_code_re = regex::Regex::new(r"`[^`]+`").unwrap();
        text = inline_code_re.replace_all(&text, " ").to_string();

        // Remove headers (keep the text)
        let header_re = regex::Regex::new(r"^#{1,6}\s+").unwrap();
        text = header_re.replace_all(&text, "").to_string();

        // Remove bold/italic markers
        text = text.replace("**", "").replace("__", "").replace("*", "").replace("_", "");

        // Remove links but keep text: [text](url) -> text
        let link_re = regex::Regex::new(r"\[([^\]]+)\]\([^)]+\)").unwrap();
        text = link_re.replace_all(&text, "$1").to_string();

        // Remove images: ![alt](url) -> alt
        let img_re = regex::Regex::new(r"!\[([^\]]*)\]\([^)]+\)").unwrap();
        text = img_re.replace_all(&text, "$1").to_string();

        // Remove blockquotes marker
        let quote_re = regex::Regex::new(r"^>\s*").unwrap();
        text = quote_re.replace_all(&text, "").to_string();

        // Remove horizontal rules
        let hr_re = regex::Regex::new(r"^---+$|^___+$|^\*\*\*+$").unwrap();
        text = hr_re.replace_all(&text, "").to_string();

        // Collapse multiple spaces/newlines
        let space_re = regex::Regex::new(r"\s+").unwrap();
        text = space_re.replace_all(&text, " ").to_string();

        text.trim().to_string()
    }

    /// Extract text from calendar (ICS) content
    fn extract_text_from_calendar(ics_content: &str) -> String {
        let mut text_parts: Vec<String> = Vec::new();

        // Simple extraction of SUMMARY and DESCRIPTION from ICS
        for line in ics_content.lines() {
            let line = line.trim();
            if line.starts_with("SUMMARY:") {
                text_parts.push(line[8..].to_string());
            } else if line.starts_with("DESCRIPTION:") {
                // Handle escaped characters in ICS
                let desc = line[12..]
                    .replace("\\n", " ")
                    .replace("\\,", ",")
                    .replace("\\;", ";");
                text_parts.push(desc);
            } else if line.starts_with("LOCATION:") {
                text_parts.push(line[9..].to_string());
            }
        }

        text_parts.join(" ")
    }

    /// Extract searchable text from database JSON content
    fn extract_text_from_database(json_content: &str) -> String {
        // Parse JSON and extract all text/url cell values
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_content) {
            let mut text_parts: Vec<String> = Vec::new();

            // Extract property names
            if let Some(properties) = parsed.get("properties").and_then(|p| p.as_array()) {
                for prop in properties {
                    if let Some(name) = prop.get("name").and_then(|n| n.as_str()) {
                        text_parts.push(name.to_string());
                    }
                }
            }

            // Extract cell values from rows
            if let Some(rows) = parsed.get("rows").and_then(|r| r.as_array()) {
                for row in rows {
                    if let Some(cells) = row.get("cells").and_then(|c| c.as_object()) {
                        for value in cells.values() {
                            match value {
                                serde_json::Value::String(s) => {
                                    if !s.is_empty() {
                                        text_parts.push(s.clone());
                                    }
                                }
                                serde_json::Value::Number(n) => {
                                    text_parts.push(n.to_string());
                                }
                                serde_json::Value::Array(arr) => {
                                    // multiSelect values
                                    for item in arr {
                                        if let Some(s) = item.as_str() {
                                            text_parts.push(s.to_string());
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }

            text_parts.join(" ")
        } else {
            String::new()
        }
    }

    /// Remove a page from the index
    pub fn remove_page(&mut self, page_id: Uuid) -> Result<()> {
        let term = Term::from_field_text(self.fields.page_id, &page_id.to_string());
        self.writer.delete_term(term);
        self.writer.commit()?;
        Ok(())
    }

    /// Search pages with a query string
    pub fn search(&self, query_str: &str, limit: usize) -> Result<Vec<SearchResult>> {
        if query_str.trim().is_empty() {
            return Ok(Vec::new());
        }

        let searcher = self.reader.searcher();

        // Parse query across title, content, and tags fields
        let query_parser = QueryParser::for_index(
            &self.index,
            vec![self.fields.title, self.fields.content, self.fields.tags],
        );

        let query = query_parser.parse_query(query_str)?;
        let top_docs = searcher.search(&query, &TopDocs::with_limit(limit))?;

        let mut results = Vec::new();

        for (score, doc_address) in top_docs {
            let retrieved_doc: TantivyDocument = searcher.doc(doc_address)?;

            let page_id = retrieved_doc
                .get_first(self.fields.page_id)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let notebook_id = retrieved_doc
                .get_first(self.fields.notebook_id)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let title = retrieved_doc
                .get_first(self.fields.title)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let tags = retrieved_doc
                .get_first(self.fields.tags)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let page_type = retrieved_doc
                .get_first(self.fields.page_type)
                .and_then(|v| v.as_str())
                .unwrap_or("standard")
                .to_string();

            results.push(SearchResult {
                page_id,
                notebook_id,
                title,
                snippet: tags, // Use tags as snippet for now
                score,
                page_type,
            });
        }

        Ok(results)
    }

    /// Fuzzy search for autocomplete-style matching
    pub fn fuzzy_search(&self, query_str: &str, limit: usize) -> Result<Vec<SearchResult>> {
        if query_str.trim().is_empty() {
            return Ok(Vec::new());
        }

        let searcher = self.reader.searcher();
        let query_lower = query_str.to_lowercase();

        // Create fuzzy term query for title field
        let term = Term::from_field_text(self.fields.title, &query_lower);
        let fuzzy_query = FuzzyTermQuery::new(term, 2, true);

        let top_docs = searcher.search(&fuzzy_query, &TopDocs::with_limit(limit))?;

        let mut results = Vec::new();

        for (score, doc_address) in top_docs {
            let retrieved_doc: TantivyDocument = searcher.doc(doc_address)?;

            let page_id = retrieved_doc
                .get_first(self.fields.page_id)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let notebook_id = retrieved_doc
                .get_first(self.fields.notebook_id)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let title = retrieved_doc
                .get_first(self.fields.title)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let tags = retrieved_doc
                .get_first(self.fields.tags)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let page_type = retrieved_doc
                .get_first(self.fields.page_type)
                .and_then(|v| v.as_str())
                .unwrap_or("standard")
                .to_string();

            results.push(SearchResult {
                page_id,
                notebook_id,
                title,
                snippet: tags,
                score,
                page_type,
            });
        }

        Ok(results)
    }

    /// Rebuild the entire index from pages
    pub fn rebuild_index(&mut self, pages: &[Page]) -> Result<()> {
        // Clear the index
        self.writer.delete_all_documents()?;
        self.writer.commit()?;

        // Re-index all pages
        for page in pages {
            let content = Self::extract_text_from_blocks(&page.content.blocks);
            let tags = page.tags.join(" ");
            let page_type_str = page_type_to_str(&page.page_type);

            self.writer.add_document(doc!(
                self.fields.page_id => page.id.to_string(),
                self.fields.notebook_id => page.notebook_id.to_string(),
                self.fields.title => page.title.clone(),
                self.fields.content => content,
                self.fields.tags => tags,
                self.fields.page_type => page_type_str
            ))?;
        }

        self.writer.commit()?;

        Ok(())
    }
}
