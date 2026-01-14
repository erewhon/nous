//! SM-2 Spaced Repetition Algorithm
//!
//! Implementation of the SuperMemo 2 algorithm for calculating
//! optimal review intervals based on user performance.
//!
//! Quality ratings (0-5):
//! - 0: Complete blackout, no recall
//! - 1: Incorrect, but upon seeing answer, remembered
//! - 2: Incorrect, but answer seemed easy to recall
//! - 3: Correct response with serious difficulty
//! - 4: Correct response after hesitation
//! - 5: Perfect response with no hesitation

use chrono::{DateTime, Duration, Utc};

use super::models::{CardState, CardStatus};

/// Minimum ease factor allowed
const MIN_EASE_FACTOR: f32 = 1.3;

/// Result of calculating the next review
#[derive(Debug, Clone)]
pub struct ReviewResult {
    pub interval: i32,
    pub ease_factor: f32,
    pub due_date: DateTime<Utc>,
    pub status: CardStatus,
}

/// Calculate the next review interval and ease factor using SM-2 algorithm
///
/// # Arguments
/// * `state` - Current card state
/// * `quality` - Quality rating (0-5)
///
/// # Returns
/// ReviewResult with new interval, ease factor, due date, and status
pub fn calculate_next_review(state: &CardState, quality: i32) -> ReviewResult {
    // Clamp quality to valid range
    let quality = quality.clamp(0, 5);

    let mut ease_factor = state.ease_factor;
    let mut interval = state.interval;
    let status;

    if quality >= 3 {
        // Correct response
        match state.review_count {
            0 => {
                // First review: 1 day
                interval = 1;
                status = CardStatus::Learning;
            }
            1 => {
                // Second review: 6 days
                interval = 6;
                status = CardStatus::Review;
            }
            _ => {
                // Subsequent reviews: multiply by ease factor
                interval = (interval as f32 * ease_factor).round() as i32;
                status = CardStatus::Review;
            }
        }

        // Update ease factor based on quality
        // EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02))
        ease_factor = ease_factor
            + (0.1 - (5 - quality) as f32 * (0.08 + (5 - quality) as f32 * 0.02));

        // Ensure minimum ease factor
        ease_factor = ease_factor.max(MIN_EASE_FACTOR);
    } else {
        // Incorrect response - reset to learning
        interval = 1;
        ease_factor = (ease_factor - 0.2).max(MIN_EASE_FACTOR);

        if state.status == CardStatus::Review {
            status = CardStatus::Relearning;
        } else {
            status = CardStatus::Learning;
        }
    }

    // Calculate due date
    let due_date = Utc::now() + Duration::days(interval as i64);

    ReviewResult {
        interval,
        ease_factor,
        due_date,
        status,
    }
}

/// Calculate the preview intervals for each quality rating
/// Used to show users what interval each rating would give
pub fn preview_intervals(state: &CardState) -> [i32; 4] {
    // Returns intervals for ratings: Again (1), Hard (2), Good (3), Easy (4)
    // Mapped from SM-2 quality ratings: 1, 3, 4, 5

    let again = calculate_next_review(state, 1).interval;
    let hard = calculate_next_review(state, 3).interval;
    let good = calculate_next_review(state, 4).interval;
    let easy = calculate_next_review(state, 5).interval;

    [again, hard, good, easy]
}

/// Map UI rating (1-4: Again, Hard, Good, Easy) to SM-2 quality (0-5)
pub fn ui_rating_to_quality(rating: i32) -> i32 {
    match rating {
        1 => 1, // Again -> quality 1 (incorrect but recognized)
        2 => 3, // Hard -> quality 3 (correct with difficulty)
        3 => 4, // Good -> quality 4 (correct with hesitation)
        4 => 5, // Easy -> quality 5 (perfect)
        _ => 3, // Default to Good
    }
}

/// Format an interval in days to a human-readable string
#[allow(dead_code)]
pub fn format_interval(days: i32) -> String {
    if days == 0 {
        "now".to_string()
    } else if days == 1 {
        "1d".to_string()
    } else if days < 7 {
        format!("{}d", days)
    } else if days < 30 {
        let weeks = days / 7;
        if weeks == 1 {
            "1w".to_string()
        } else {
            format!("{}w", weeks)
        }
    } else if days < 365 {
        let months = days / 30;
        if months == 1 {
            "1mo".to_string()
        } else {
            format!("{}mo", months)
        }
    } else {
        let years = days / 365;
        if years == 1 {
            "1y".to_string()
        } else {
            format!("{}y", years)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn new_card_state() -> CardState {
        CardState::new(Uuid::new_v4())
    }

    #[test]
    fn test_first_review_correct() {
        let state = new_card_state();
        let result = calculate_next_review(&state, 4);

        assert_eq!(result.interval, 1);
        assert_eq!(result.status, CardStatus::Learning);
    }

    #[test]
    fn test_second_review_correct() {
        let mut state = new_card_state();
        state.review_count = 1;
        state.interval = 1;

        let result = calculate_next_review(&state, 4);

        assert_eq!(result.interval, 6);
        assert_eq!(result.status, CardStatus::Review);
    }

    #[test]
    fn test_subsequent_review_correct() {
        let mut state = new_card_state();
        state.review_count = 5;
        state.interval = 10;
        state.ease_factor = 2.5;

        let result = calculate_next_review(&state, 4);

        // 10 * 2.5 = 25
        assert_eq!(result.interval, 25);
    }

    #[test]
    fn test_review_incorrect_resets() {
        let mut state = new_card_state();
        state.review_count = 5;
        state.interval = 30;
        state.status = CardStatus::Review;

        let result = calculate_next_review(&state, 1);

        assert_eq!(result.interval, 1);
        assert_eq!(result.status, CardStatus::Relearning);
    }

    #[test]
    fn test_ease_factor_minimum() {
        let mut state = new_card_state();
        state.ease_factor = 1.4;
        state.review_count = 5;
        state.interval = 10;

        // Multiple incorrect responses should not go below minimum
        let result = calculate_next_review(&state, 1);
        assert!(result.ease_factor >= MIN_EASE_FACTOR);

        let result2 = calculate_next_review(&CardState {
            ease_factor: result.ease_factor,
            ..state
        }, 1);
        assert!(result2.ease_factor >= MIN_EASE_FACTOR);
    }

    #[test]
    fn test_format_interval() {
        assert_eq!(format_interval(0), "now");
        assert_eq!(format_interval(1), "1d");
        assert_eq!(format_interval(5), "5d");
        assert_eq!(format_interval(7), "1w");
        assert_eq!(format_interval(14), "2w");
        assert_eq!(format_interval(30), "1mo");
        assert_eq!(format_interval(90), "3mo");
        assert_eq!(format_interval(365), "1y");
        assert_eq!(format_interval(730), "2y");
    }
}
