//! Data models for the flashcard system

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A deck is a collection of flashcards belonging to a notebook
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Deck {
    pub id: Uuid,
    pub notebook_id: Uuid,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub card_count: usize,
    #[serde(default = "default_new_cards_per_day")]
    pub new_cards_per_day: i32,
    #[serde(default = "default_reviews_per_day")]
    pub reviews_per_day: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn default_new_cards_per_day() -> i32 {
    20
}

fn default_reviews_per_day() -> i32 {
    100
}

impl Deck {
    pub fn new(notebook_id: Uuid, name: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            notebook_id,
            name,
            description: None,
            color: None,
            card_count: 0,
            new_cards_per_day: default_new_cards_per_day(),
            reviews_per_day: default_reviews_per_day(),
            created_at: now,
            updated_at: now,
        }
    }
}

/// Type of flashcard
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CardType {
    /// Simple question and answer
    Basic,
    /// Fill-in-the-blank style
    Cloze,
    /// Can be reviewed in both directions
    Reversible,
}

impl Default for CardType {
    fn default() -> Self {
        Self::Basic
    }
}

/// Source of a flashcard - standalone or from an editor block
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CardSource {
    /// Created directly in the deck
    Standalone,
    /// Created from an editor block
    BlockRef {
        page_id: Uuid,
        block_id: String,
    },
}

impl Default for CardSource {
    fn default() -> Self {
        Self::Standalone
    }
}

/// A flashcard with question (front) and answer (back)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Flashcard {
    pub id: Uuid,
    pub deck_id: Uuid,
    pub front: String,
    pub back: String,
    #[serde(default)]
    pub card_type: CardType,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub source: CardSource,
    #[serde(default)]
    pub position: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Flashcard {
    pub fn new(deck_id: Uuid, front: String, back: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            deck_id,
            front,
            back,
            card_type: CardType::default(),
            tags: Vec::new(),
            source: CardSource::default(),
            position: 0,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn from_block(deck_id: Uuid, page_id: Uuid, block_id: String, front: String, back: String) -> Self {
        let mut card = Self::new(deck_id, front, back);
        card.source = CardSource::BlockRef { page_id, block_id };
        card
    }
}

/// Status of a card in the spaced repetition system
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CardStatus {
    /// Never reviewed
    New,
    /// In initial learning phase
    Learning,
    /// Regular spaced review
    Review,
    /// Failed and re-learning
    Relearning,
}

impl Default for CardStatus {
    fn default() -> Self {
        Self::New
    }
}

/// Current spaced repetition state for a card
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardState {
    pub card_id: Uuid,
    /// Current interval in days
    #[serde(default = "default_interval")]
    pub interval: i32,
    /// SM-2 ease factor (default 2.5)
    #[serde(default = "default_ease_factor")]
    pub ease_factor: f32,
    /// When the card is due for review
    pub due_date: DateTime<Utc>,
    /// Total number of reviews
    #[serde(default)]
    pub review_count: i32,
    /// Number of correct responses
    #[serde(default)]
    pub correct_count: i32,
    /// Current status in the learning process
    #[serde(default)]
    pub status: CardStatus,
}

fn default_interval() -> i32 {
    0
}

fn default_ease_factor() -> f32 {
    2.5
}

impl CardState {
    pub fn new(card_id: Uuid) -> Self {
        Self {
            card_id,
            interval: 0,
            ease_factor: 2.5,
            due_date: Utc::now(),
            review_count: 0,
            correct_count: 0,
            status: CardStatus::New,
        }
    }

    /// Check if the card is due for review
    pub fn is_due(&self) -> bool {
        Utc::now() >= self.due_date
    }
}

/// A record of a single review attempt
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRecord {
    pub id: Uuid,
    pub card_id: Uuid,
    /// Quality rating (0-5, SM-2 scale)
    /// 0 = complete blackout
    /// 1 = incorrect, but recognized
    /// 2 = incorrect, but easy to recall
    /// 3 = correct with difficulty
    /// 4 = correct with hesitation
    /// 5 = perfect response
    pub quality: i32,
    /// Interval at time of review (days)
    pub interval: i32,
    /// Ease factor at time of review
    pub ease_factor: f32,
    /// When the review occurred
    pub reviewed_at: DateTime<Utc>,
}

impl ReviewRecord {
    #[allow(dead_code)]
    pub fn new(card_id: Uuid, quality: i32, interval: i32, ease_factor: f32) -> Self {
        Self {
            id: Uuid::new_v4(),
            card_id,
            quality,
            interval,
            ease_factor,
            reviewed_at: Utc::now(),
        }
    }
}

/// Statistics for a deck or all decks
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewStats {
    pub total_cards: usize,
    pub new_cards: usize,
    pub learning_cards: usize,
    pub review_cards: usize,
    pub due_cards: usize,
    pub reviews_today: usize,
    pub correct_today: usize,
    pub streak_days: i32,
}

impl Default for ReviewStats {
    fn default() -> Self {
        Self {
            total_cards: 0,
            new_cards: 0,
            learning_cards: 0,
            review_cards: 0,
            due_cards: 0,
            reviews_today: 0,
            correct_today: 0,
            streak_days: 0,
        }
    }
}

/// A card with its current state, used for review sessions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardWithState {
    pub card: Flashcard,
    pub state: CardState,
}
