//! External Sources Module
//!
//! This module provides functionality to register and process external files
//! (JSON, Markdown, plain text) as sources for creating pages with AI summaries.
//!
//! # Features
//!
//! - **Registration**: Register file paths or glob patterns as external sources
//! - **Glob support**: Use patterns like `~/research/*.json` or `**/*.md`
//! - **Format detection**: Automatically detect JSON, Markdown, and plain text
//! - **Incremental processing**: Skip already-processed files when enabled
//! - **AI summarization**: Generate summaries via the ProcessExternalSource action step
//!
//! # Example
//!
//! ```ignore
//! // Register a source
//! let request = CreateExternalSourceRequest {
//!     name: "Research Notes".to_string(),
//!     path_pattern: "~/research/*.json".to_string(),
//!     file_formats: vec![ExternalFileFormat::Json],
//!     enabled: true,
//! };
//! let source = storage.create_source(request)?;
//!
//! // Preview matched files
//! let files = storage.preview_source_files(source.id)?;
//! ```

pub mod models;
pub mod storage;

// Re-export commonly used types
pub use models::*;
pub use storage::{read_file_content, ExternalSourcesError, ExternalSourcesStorage};
