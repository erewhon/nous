//! App monitoring module
//!
//! Monitors desktop applications via AI Vision (screenshot + multimodal analysis)
//! and AT-SPI2 accessibility scraping.

pub mod capture;
pub mod models;
pub mod scheduler;
pub mod storage;

pub use models::*;
pub use storage::MonitorStorage;
