//! Storage operations for flashcards
//!
//! Directory structure per notebook:
//! ```
//! notebooks/{notebook-id}/flashcards/
//! ├── decks.json           # Array of all decks
//! ├── cards/
//! │   └── {card-id}.json   # Individual card files
//! └── states/
//!     └── {card-id}.json   # Card spaced repetition state
//! ```

use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use thiserror::Error;
use uuid::Uuid;

use super::algorithm::{calculate_next_review, ui_rating_to_quality, ReviewResult};
use super::models::*;

#[derive(Error, Debug)]
pub enum FlashcardStorageError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Deck not found: {0}")]
    DeckNotFound(Uuid),

    #[error("Card not found: {0}")]
    CardNotFound(Uuid),

    #[error("Invalid notebook path")]
    InvalidNotebookPath,
}

pub type Result<T> = std::result::Result<T, FlashcardStorageError>;

/// Storage manager for flashcard operations
pub struct FlashcardStorage {
    /// Base path for notebooks (e.g., ~/.local/share/katt/notebooks)
    notebooks_path: PathBuf,
}

impl FlashcardStorage {
    pub fn new(notebooks_path: PathBuf) -> Self {
        Self { notebooks_path }
    }

    /// Get the flashcards directory for a notebook
    fn flashcards_dir(&self, notebook_id: Uuid) -> PathBuf {
        self.notebooks_path
            .join(notebook_id.to_string())
            .join("flashcards")
    }

    /// Get the cards directory for a notebook
    fn cards_dir(&self, notebook_id: Uuid) -> PathBuf {
        self.flashcards_dir(notebook_id).join("cards")
    }

    /// Get the states directory for a notebook
    fn states_dir(&self, notebook_id: Uuid) -> PathBuf {
        self.flashcards_dir(notebook_id).join("states")
    }

    /// Get the decks.json path for a notebook
    fn decks_path(&self, notebook_id: Uuid) -> PathBuf {
        self.flashcards_dir(notebook_id).join("decks.json")
    }

    /// Get the path for a specific card
    fn card_path(&self, notebook_id: Uuid, card_id: Uuid) -> PathBuf {
        self.cards_dir(notebook_id)
            .join(format!("{}.json", card_id))
    }

    /// Get the path for a card's state
    fn state_path(&self, notebook_id: Uuid, card_id: Uuid) -> PathBuf {
        self.states_dir(notebook_id)
            .join(format!("{}.json", card_id))
    }

    /// Initialize flashcard storage for a notebook
    pub fn init(&self, notebook_id: Uuid) -> Result<()> {
        let flashcards_dir = self.flashcards_dir(notebook_id);
        fs::create_dir_all(&flashcards_dir)?;
        fs::create_dir_all(self.cards_dir(notebook_id))?;
        fs::create_dir_all(self.states_dir(notebook_id))?;

        // Create empty decks.json if it doesn't exist
        let decks_path = self.decks_path(notebook_id);
        if !decks_path.exists() {
            let empty_decks: Vec<Deck> = Vec::new();
            fs::write(&decks_path, serde_json::to_string_pretty(&empty_decks)?)?;
        }

        Ok(())
    }

    // ==================== Deck Operations ====================

    /// List all decks in a notebook
    pub fn list_decks(&self, notebook_id: Uuid) -> Result<Vec<Deck>> {
        let decks_path = self.decks_path(notebook_id);
        if !decks_path.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(&decks_path)?;
        let decks: Vec<Deck> = serde_json::from_str(&content)?;
        Ok(decks)
    }

    /// Get a specific deck
    pub fn get_deck(&self, notebook_id: Uuid, deck_id: Uuid) -> Result<Deck> {
        let decks = self.list_decks(notebook_id)?;
        decks
            .into_iter()
            .find(|d| d.id == deck_id)
            .ok_or(FlashcardStorageError::DeckNotFound(deck_id))
    }

    /// Create a new deck
    pub fn create_deck(&self, notebook_id: Uuid, name: String, description: Option<String>, color: Option<String>) -> Result<Deck> {
        self.init(notebook_id)?;

        let mut deck = Deck::new(notebook_id, name);
        deck.description = description;
        deck.color = color;

        let mut decks = self.list_decks(notebook_id)?;
        decks.push(deck.clone());

        let decks_path = self.decks_path(notebook_id);
        fs::write(&decks_path, serde_json::to_string_pretty(&decks)?)?;

        Ok(deck)
    }

    /// Update a deck
    pub fn update_deck(&self, notebook_id: Uuid, deck: &Deck) -> Result<()> {
        let mut decks = self.list_decks(notebook_id)?;
        let pos = decks
            .iter()
            .position(|d| d.id == deck.id)
            .ok_or(FlashcardStorageError::DeckNotFound(deck.id))?;

        decks[pos] = deck.clone();

        let decks_path = self.decks_path(notebook_id);
        fs::write(&decks_path, serde_json::to_string_pretty(&decks)?)?;

        Ok(())
    }

    /// Delete a deck and all its cards
    pub fn delete_deck(&self, notebook_id: Uuid, deck_id: Uuid) -> Result<()> {
        // Delete all cards in the deck
        let cards = self.list_cards(notebook_id, deck_id)?;
        for card in cards {
            self.delete_card(notebook_id, card.id)?;
        }

        // Remove deck from list
        let mut decks = self.list_decks(notebook_id)?;
        decks.retain(|d| d.id != deck_id);

        let decks_path = self.decks_path(notebook_id);
        fs::write(&decks_path, serde_json::to_string_pretty(&decks)?)?;

        Ok(())
    }

    /// Update the card count for a deck
    fn update_deck_card_count(&self, notebook_id: Uuid, deck_id: Uuid) -> Result<()> {
        let cards = self.list_cards(notebook_id, deck_id)?;
        let mut deck = self.get_deck(notebook_id, deck_id)?;
        deck.card_count = cards.len();
        deck.updated_at = Utc::now();
        self.update_deck(notebook_id, &deck)?;
        Ok(())
    }

    // ==================== Card Operations ====================

    /// List all cards in a deck
    pub fn list_cards(&self, notebook_id: Uuid, deck_id: Uuid) -> Result<Vec<Flashcard>> {
        let cards_dir = self.cards_dir(notebook_id);
        if !cards_dir.exists() {
            return Ok(Vec::new());
        }

        let mut cards = Vec::new();
        for entry in fs::read_dir(&cards_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "json") {
                let content = fs::read_to_string(&path)?;
                let card: Flashcard = serde_json::from_str(&content)?;
                if card.deck_id == deck_id {
                    cards.push(card);
                }
            }
        }

        cards.sort_by(|a, b| a.position.cmp(&b.position));
        Ok(cards)
    }

    /// List all cards in a notebook (across all decks)
    pub fn list_all_cards(&self, notebook_id: Uuid) -> Result<Vec<Flashcard>> {
        let cards_dir = self.cards_dir(notebook_id);
        if !cards_dir.exists() {
            return Ok(Vec::new());
        }

        let mut cards = Vec::new();
        for entry in fs::read_dir(&cards_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "json") {
                let content = fs::read_to_string(&path)?;
                let card: Flashcard = serde_json::from_str(&content)?;
                cards.push(card);
            }
        }

        Ok(cards)
    }

    /// Get a specific card
    pub fn get_card(&self, notebook_id: Uuid, card_id: Uuid) -> Result<Flashcard> {
        let card_path = self.card_path(notebook_id, card_id);
        if !card_path.exists() {
            return Err(FlashcardStorageError::CardNotFound(card_id));
        }

        let content = fs::read_to_string(&card_path)?;
        let card: Flashcard = serde_json::from_str(&content)?;
        Ok(card)
    }

    /// Create a new card
    pub fn create_card(
        &self,
        notebook_id: Uuid,
        deck_id: Uuid,
        front: String,
        back: String,
        card_type: Option<CardType>,
        tags: Option<Vec<String>>,
    ) -> Result<Flashcard> {
        self.init(notebook_id)?;

        // Get position for new card
        let existing_cards = self.list_cards(notebook_id, deck_id)?;
        let position = existing_cards.len() as i32;

        let mut card = Flashcard::new(deck_id, front, back);
        card.position = position;
        if let Some(ct) = card_type {
            card.card_type = ct;
        }
        if let Some(t) = tags {
            card.tags = t;
        }

        let card_path = self.card_path(notebook_id, card.id);
        fs::write(&card_path, serde_json::to_string_pretty(&card)?)?;

        // Create initial state for the card
        let state = CardState::new(card.id);
        let state_path = self.state_path(notebook_id, card.id);
        fs::write(&state_path, serde_json::to_string_pretty(&state)?)?;

        // Update deck card count
        self.update_deck_card_count(notebook_id, deck_id)?;

        Ok(card)
    }

    /// Create a card from an editor block
    pub fn create_card_from_block(
        &self,
        notebook_id: Uuid,
        deck_id: Uuid,
        page_id: Uuid,
        block_id: String,
        front: String,
        back: String,
    ) -> Result<Flashcard> {
        self.init(notebook_id)?;

        let existing_cards = self.list_cards(notebook_id, deck_id)?;
        let position = existing_cards.len() as i32;

        let mut card = Flashcard::from_block(deck_id, page_id, block_id, front, back);
        card.position = position;

        let card_path = self.card_path(notebook_id, card.id);
        fs::write(&card_path, serde_json::to_string_pretty(&card)?)?;

        // Create initial state
        let state = CardState::new(card.id);
        let state_path = self.state_path(notebook_id, card.id);
        fs::write(&state_path, serde_json::to_string_pretty(&state)?)?;

        // Update deck card count
        self.update_deck_card_count(notebook_id, deck_id)?;

        Ok(card)
    }

    /// Update a card
    pub fn update_card(&self, notebook_id: Uuid, card: &Flashcard) -> Result<()> {
        let card_path = self.card_path(notebook_id, card.id);
        if !card_path.exists() {
            return Err(FlashcardStorageError::CardNotFound(card.id));
        }

        fs::write(&card_path, serde_json::to_string_pretty(card)?)?;
        Ok(())
    }

    /// Delete a card and its state
    pub fn delete_card(&self, notebook_id: Uuid, card_id: Uuid) -> Result<()> {
        let card = self.get_card(notebook_id, card_id)?;
        let deck_id = card.deck_id;

        let card_path = self.card_path(notebook_id, card_id);
        if card_path.exists() {
            fs::remove_file(&card_path)?;
        }

        let state_path = self.state_path(notebook_id, card_id);
        if state_path.exists() {
            fs::remove_file(&state_path)?;
        }

        // Update deck card count
        self.update_deck_card_count(notebook_id, deck_id)?;

        Ok(())
    }

    // ==================== State Operations ====================

    /// Get the state for a card
    pub fn get_card_state(&self, notebook_id: Uuid, card_id: Uuid) -> Result<CardState> {
        let state_path = self.state_path(notebook_id, card_id);
        if !state_path.exists() {
            // Return default state if not found
            return Ok(CardState::new(card_id));
        }

        let content = fs::read_to_string(&state_path)?;
        let state: CardState = serde_json::from_str(&content)?;
        Ok(state)
    }

    /// Update the state for a card
    pub fn update_card_state(&self, notebook_id: Uuid, state: &CardState) -> Result<()> {
        let state_path = self.state_path(notebook_id, state.card_id);
        fs::write(&state_path, serde_json::to_string_pretty(state)?)?;
        Ok(())
    }

    // ==================== Review Operations ====================

    /// Get all due cards for a notebook (optionally filtered by deck)
    pub fn get_due_cards(&self, notebook_id: Uuid, deck_id: Option<Uuid>) -> Result<Vec<CardWithState>> {
        let cards = match deck_id {
            Some(did) => self.list_cards(notebook_id, did)?,
            None => self.list_all_cards(notebook_id)?,
        };

        let mut due_cards = Vec::new();
        let now = Utc::now();

        for card in cards {
            let state = self.get_card_state(notebook_id, card.id)?;
            if state.due_date <= now {
                due_cards.push(CardWithState { card, state });
            }
        }

        // Sort by due date (oldest first)
        due_cards.sort_by(|a, b| a.state.due_date.cmp(&b.state.due_date));

        Ok(due_cards)
    }

    /// Submit a review for a card
    pub fn submit_review(&self, notebook_id: Uuid, card_id: Uuid, rating: i32) -> Result<CardState> {
        let mut state = self.get_card_state(notebook_id, card_id)?;

        // Convert UI rating (1-4) to SM-2 quality (0-5)
        let quality = ui_rating_to_quality(rating);

        // Calculate next review
        let ReviewResult {
            interval,
            ease_factor,
            due_date,
            status,
        } = calculate_next_review(&state, quality);

        // Update state
        state.interval = interval;
        state.ease_factor = ease_factor;
        state.due_date = due_date;
        state.status = status;
        state.review_count += 1;
        if quality >= 3 {
            state.correct_count += 1;
        }

        // Save state
        self.update_card_state(notebook_id, &state)?;

        Ok(state)
    }

    /// Get review statistics for a notebook (optionally filtered by deck)
    pub fn get_review_stats(&self, notebook_id: Uuid, deck_id: Option<Uuid>) -> Result<ReviewStats> {
        let cards = match deck_id {
            Some(did) => self.list_cards(notebook_id, did)?,
            None => self.list_all_cards(notebook_id)?,
        };

        let mut stats = ReviewStats::default();
        stats.total_cards = cards.len();

        let now = Utc::now();

        for card in &cards {
            let state = self.get_card_state(notebook_id, card.id)?;

            match state.status {
                CardStatus::New => stats.new_cards += 1,
                CardStatus::Learning => stats.learning_cards += 1,
                CardStatus::Review | CardStatus::Relearning => stats.review_cards += 1,
            }

            if state.is_due() {
                stats.due_cards += 1;
            }
        }

        Ok(stats)
    }
}
