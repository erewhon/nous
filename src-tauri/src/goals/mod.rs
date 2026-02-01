//! Goals and streak tracking module

pub mod detector;
pub mod models;
pub mod storage;

pub use detector::GoalDetector;
pub use models::*;
pub use storage::GoalsStorage;
