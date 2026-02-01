//! Git Integration Module
//!
//! Provides Git-backed version control for notebooks.
//! Each notebook can optionally be a Git repository with:
//! - Auto-commit on save
//! - Page history via git log
//! - Remote push/pull support
//! - Branch management

mod repository;

pub use repository::*;
