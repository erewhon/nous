//! Flashcard and spaced repetition system for Nous
//!
//! This module provides:
//! - Deck management (per-notebook flashcard collections)
//! - Flashcard CRUD (standalone or linked to editor blocks)
//! - SM-2 spaced repetition algorithm
//! - Review state tracking

pub mod algorithm;
pub mod models;
pub mod storage;

pub use models::*;
pub use storage::{FlashcardStorage, FlashcardStorageError};
