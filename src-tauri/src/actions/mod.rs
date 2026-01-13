//! Custom Actions & Automations Module
//!
//! This module provides a system for defining and executing custom actions
//! that can be triggered manually, via AI chat, or on a schedule.
//!
//! # Features
//!
//! - **Manual triggers**: Run actions via UI button or command palette
//! - **AI chat triggers**: Run actions by asking AI (e.g., "create my daily goals")
//! - **Scheduled triggers**: Run actions at specific times (daily, weekly, monthly)
//!
//! # Step Types
//!
//! Actions consist of one or more steps:
//! - CreatePageFromTemplate: Create a page using a template
//! - CreateNotebook: Create a new notebook
//! - CreateFolder: Create a folder in a notebook
//! - MovePages: Move pages matching criteria
//! - ArchivePages: Archive pages matching criteria
//! - ManageTags: Add/remove tags from pages
//! - AiSummarize: Generate AI summaries
//! - CarryForwardItems: Copy incomplete checklist items
//! - Delay: Wait between steps
//! - Conditional: Execute steps based on conditions
//!
//! # Variable Substitution
//!
//! Action titles and content can include variables:
//! - `{{date}}`: Current date (YYYY-MM-DD)
//! - `{{dayOfWeek}}`: Day name (Monday, Tuesday, etc.)
//! - `{{weekNumber}}`: Week number (1-52)
//! - `{{monthName}}`: Month name (January, February, etc.)
//! - `{{year}}`: Current year

pub mod builtin;
pub mod executor;
pub mod models;
pub mod scheduler;
pub mod storage;
pub mod variables;

// Re-export commonly used types
pub use builtin::get_builtin_actions;
pub use executor::ActionExecutor;
pub use models::*;
pub use scheduler::ActionScheduler;
pub use storage::ActionStorage;
