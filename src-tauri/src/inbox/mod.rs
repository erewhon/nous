//! Inbox module for quick capture and AI classification
//!
//! Provides:
//! - Quick capture of notes to inbox
//! - AI-powered classification to suggest target notebook/page
//! - Batch processing of inbox items

mod models;
mod storage;

pub use models::*;
pub use storage::*;
