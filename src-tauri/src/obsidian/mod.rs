//! Obsidian import module
//!
//! Handles importing Obsidian vault folders into Katt notebooks.
//! Supports:
//! - Markdown pages with YAML frontmatter
//! - Wiki-links [[page]] preservation
//! - Folder structure preservation
//! - Attachments and assets

mod import;

pub use import::*;
