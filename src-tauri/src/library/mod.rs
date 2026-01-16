//! Library module
//!
//! Provides the concept of "Libraries" - collections of notebooks stored at different paths.

mod models;
mod storage;

pub use models::{Library, LibraryStats};
pub use storage::{LibraryError, LibraryStorage};
