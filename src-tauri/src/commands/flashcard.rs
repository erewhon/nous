//! Tauri commands for flashcard operations

use tauri::State;
use uuid::Uuid;

use crate::flashcards::{
    CardState, CardType, CardWithState, Deck, Flashcard, FlashcardStorageError, ReviewStats,
};
use crate::AppState;

use super::notebook::CommandError;

impl From<FlashcardStorageError> for CommandError {
    fn from(err: FlashcardStorageError) -> Self {
        Self {
            message: err.to_string(),
        }
    }
}

type CommandResult<T> = Result<T, CommandError>;

// ==================== Deck Commands ====================

/// List all decks in a notebook
#[tauri::command]
pub fn list_decks(state: State<AppState>, notebook_id: String) -> CommandResult<Vec<Deck>> {
    let flashcard_storage = state.flashcard_storage.lock().unwrap();
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    flashcard_storage.list_decks(id).map_err(Into::into)
}

/// Get a specific deck
#[tauri::command]
pub fn get_deck(
    state: State<AppState>,
    notebook_id: String,
    deck_id: String,
) -> CommandResult<Deck> {
    let flashcard_storage = state.flashcard_storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let dk_id = Uuid::parse_str(&deck_id).map_err(|e| CommandError {
        message: format!("Invalid deck ID: {}", e),
    })?;
    flashcard_storage.get_deck(nb_id, dk_id).map_err(Into::into)
}

/// Create a new deck in a notebook
#[tauri::command]
pub fn create_deck(
    state: State<AppState>,
    notebook_id: String,
    name: String,
    description: Option<String>,
    color: Option<String>,
) -> CommandResult<Deck> {
    let flashcard_storage = state.flashcard_storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    flashcard_storage
        .create_deck(nb_id, name, description, color)
        .map_err(Into::into)
}

/// Update a deck's properties
#[tauri::command]
pub fn update_deck(
    state: State<AppState>,
    notebook_id: String,
    deck_id: String,
    name: Option<String>,
    description: Option<Option<String>>,
    color: Option<Option<String>>,
    new_cards_per_day: Option<i32>,
    reviews_per_day: Option<i32>,
) -> CommandResult<Deck> {
    let flashcard_storage = state.flashcard_storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let dk_id = Uuid::parse_str(&deck_id).map_err(|e| CommandError {
        message: format!("Invalid deck ID: {}", e),
    })?;

    let mut deck = flashcard_storage.get_deck(nb_id, dk_id)?;

    if let Some(new_name) = name {
        deck.name = new_name;
    }
    if let Some(new_desc) = description {
        deck.description = new_desc;
    }
    if let Some(new_color) = color {
        deck.color = new_color;
    }
    if let Some(new_cards) = new_cards_per_day {
        deck.new_cards_per_day = new_cards;
    }
    if let Some(reviews) = reviews_per_day {
        deck.reviews_per_day = reviews;
    }

    deck.updated_at = chrono::Utc::now();
    flashcard_storage.update_deck(nb_id, &deck)?;

    Ok(deck)
}

/// Delete a deck and all its cards
#[tauri::command]
pub fn delete_deck(
    state: State<AppState>,
    notebook_id: String,
    deck_id: String,
) -> CommandResult<()> {
    let flashcard_storage = state.flashcard_storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let dk_id = Uuid::parse_str(&deck_id).map_err(|e| CommandError {
        message: format!("Invalid deck ID: {}", e),
    })?;
    flashcard_storage
        .delete_deck(nb_id, dk_id)
        .map_err(Into::into)
}

// ==================== Card Commands ====================

/// List all cards in a deck
#[tauri::command]
pub fn list_cards(
    state: State<AppState>,
    notebook_id: String,
    deck_id: String,
) -> CommandResult<Vec<Flashcard>> {
    let flashcard_storage = state.flashcard_storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let dk_id = Uuid::parse_str(&deck_id).map_err(|e| CommandError {
        message: format!("Invalid deck ID: {}", e),
    })?;
    flashcard_storage.list_cards(nb_id, dk_id).map_err(Into::into)
}

/// Get a specific card
#[tauri::command]
pub fn get_card(
    state: State<AppState>,
    notebook_id: String,
    card_id: String,
) -> CommandResult<Flashcard> {
    let flashcard_storage = state.flashcard_storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let cd_id = Uuid::parse_str(&card_id).map_err(|e| CommandError {
        message: format!("Invalid card ID: {}", e),
    })?;
    flashcard_storage.get_card(nb_id, cd_id).map_err(Into::into)
}

/// Create a new card in a deck
#[tauri::command]
pub fn create_card(
    state: State<AppState>,
    notebook_id: String,
    deck_id: String,
    front: String,
    back: String,
    card_type: Option<String>,
    tags: Option<Vec<String>>,
) -> CommandResult<Flashcard> {
    let flashcard_storage = state.flashcard_storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let dk_id = Uuid::parse_str(&deck_id).map_err(|e| CommandError {
        message: format!("Invalid deck ID: {}", e),
    })?;

    let ct = card_type.map(|t| match t.as_str() {
        "cloze" => CardType::Cloze,
        "reversible" => CardType::Reversible,
        _ => CardType::Basic,
    });

    flashcard_storage
        .create_card(nb_id, dk_id, front, back, ct, tags)
        .map_err(Into::into)
}

/// Create a card from an editor block
#[tauri::command]
pub fn create_card_from_block(
    state: State<AppState>,
    notebook_id: String,
    deck_id: String,
    page_id: String,
    block_id: String,
    front: String,
    back: String,
) -> CommandResult<Flashcard> {
    let flashcard_storage = state.flashcard_storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let dk_id = Uuid::parse_str(&deck_id).map_err(|e| CommandError {
        message: format!("Invalid deck ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    flashcard_storage
        .create_card_from_block(nb_id, dk_id, pg_id, block_id, front, back)
        .map_err(Into::into)
}

/// Update a card
#[tauri::command]
pub fn update_card(
    state: State<AppState>,
    notebook_id: String,
    card_id: String,
    front: Option<String>,
    back: Option<String>,
    card_type: Option<String>,
    tags: Option<Vec<String>>,
) -> CommandResult<Flashcard> {
    let flashcard_storage = state.flashcard_storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let cd_id = Uuid::parse_str(&card_id).map_err(|e| CommandError {
        message: format!("Invalid card ID: {}", e),
    })?;

    let mut card = flashcard_storage.get_card(nb_id, cd_id)?;

    if let Some(new_front) = front {
        card.front = new_front;
    }
    if let Some(new_back) = back {
        card.back = new_back;
    }
    if let Some(ct) = card_type {
        card.card_type = match ct.as_str() {
            "cloze" => CardType::Cloze,
            "reversible" => CardType::Reversible,
            _ => CardType::Basic,
        };
    }
    if let Some(new_tags) = tags {
        card.tags = new_tags;
    }

    card.updated_at = chrono::Utc::now();
    flashcard_storage.update_card(nb_id, &card)?;

    Ok(card)
}

/// Delete a card
#[tauri::command]
pub fn delete_card(
    state: State<AppState>,
    notebook_id: String,
    card_id: String,
) -> CommandResult<()> {
    let flashcard_storage = state.flashcard_storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let cd_id = Uuid::parse_str(&card_id).map_err(|e| CommandError {
        message: format!("Invalid card ID: {}", e),
    })?;
    flashcard_storage
        .delete_card(nb_id, cd_id)
        .map_err(Into::into)
}

// ==================== Review Commands ====================

/// Get all due cards for review
#[tauri::command]
pub fn get_due_cards(
    state: State<AppState>,
    notebook_id: String,
    deck_id: Option<String>,
) -> CommandResult<Vec<CardWithState>> {
    let flashcard_storage = state.flashcard_storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let dk_id = deck_id
        .map(|id| {
            Uuid::parse_str(&id).map_err(|e| CommandError {
                message: format!("Invalid deck ID: {}", e),
            })
        })
        .transpose()?;

    flashcard_storage
        .get_due_cards(nb_id, dk_id)
        .map_err(Into::into)
}

/// Submit a review for a card
#[tauri::command]
pub fn submit_review(
    state: State<AppState>,
    notebook_id: String,
    card_id: String,
    rating: i32,
) -> CommandResult<CardState> {
    let flashcard_storage = state.flashcard_storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let cd_id = Uuid::parse_str(&card_id).map_err(|e| CommandError {
        message: format!("Invalid card ID: {}", e),
    })?;

    flashcard_storage
        .submit_review(nb_id, cd_id, rating)
        .map_err(Into::into)
}

/// Get review statistics
#[tauri::command]
pub fn get_review_stats(
    state: State<AppState>,
    notebook_id: String,
    deck_id: Option<String>,
) -> CommandResult<ReviewStats> {
    let flashcard_storage = state.flashcard_storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let dk_id = deck_id
        .map(|id| {
            Uuid::parse_str(&id).map_err(|e| CommandError {
                message: format!("Invalid deck ID: {}", e),
            })
        })
        .transpose()?;

    flashcard_storage
        .get_review_stats(nb_id, dk_id)
        .map_err(Into::into)
}

/// Get the state for a specific card
#[tauri::command]
pub fn get_card_state(
    state: State<AppState>,
    notebook_id: String,
    card_id: String,
) -> CommandResult<CardState> {
    let flashcard_storage = state.flashcard_storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let cd_id = Uuid::parse_str(&card_id).map_err(|e| CommandError {
        message: format!("Invalid card ID: {}", e),
    })?;

    flashcard_storage
        .get_card_state(nb_id, cd_id)
        .map_err(Into::into)
}

/// Get preview intervals for each rating option
#[tauri::command]
pub fn preview_review_intervals(
    state: State<AppState>,
    notebook_id: String,
    card_id: String,
) -> CommandResult<[i32; 4]> {
    use crate::flashcards::algorithm::preview_intervals;

    let flashcard_storage = state.flashcard_storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let cd_id = Uuid::parse_str(&card_id).map_err(|e| CommandError {
        message: format!("Invalid card ID: {}", e),
    })?;

    let card_state = flashcard_storage.get_card_state(nb_id, cd_id)?;
    Ok(preview_intervals(&card_state))
}
