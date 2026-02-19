//! Study tools Tauri commands for generating educational content.

use tauri::State;

use crate::python_bridge::{
    AIConfig, BriefingDocument, CitedResponse, ConceptGraph, FAQ, FlashcardGenerationResult,
    RAGChunk, StudyGuide, StudyGuideOptions, StudyPageContent, Timeline,
};
use crate::AppState;

use super::notebook::CommandError;

/// Generate a study guide from selected pages
#[tauri::command]
pub async fn generate_study_guide(
    state: State<'_, AppState>,
    pages: Vec<StudyPageContent>,
    provider_type: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
    depth: Option<String>,
    focus_areas: Option<Vec<String>>,
    num_practice_questions: Option<i32>,
) -> Result<StudyGuide, CommandError> {
    let python_ai = state.python_ai.clone();

    let config = AIConfig {
        provider_type: provider_type.unwrap_or_else(|| "openai".to_string()),
        api_key,
        model,
        temperature: temperature.or(Some(0.7)),
        max_tokens: max_tokens.or(Some(4096)),
        ..Default::default()
    };

    let options = if depth.is_some() || focus_areas.is_some() || num_practice_questions.is_some() {
        Some(StudyGuideOptions {
            depth: depth.unwrap_or_else(|| "standard".to_string()),
            focus_areas: focus_areas.unwrap_or_default(),
            num_practice_questions: num_practice_questions.unwrap_or(5),
        })
    } else {
        None
    };

    tauri::async_runtime::spawn_blocking(move || {
        let python_ai = python_ai.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire Python AI lock: {}", e),
        })?;

        python_ai
            .generate_study_guide(pages, config, options)
            .map_err(|e| CommandError {
                message: format!("Study guide generation error: {}", e),
            })
    })
    .await
    .map_err(|e| CommandError {
        message: format!("Task join error: {}", e),
    })?
}

/// Generate FAQ from selected pages
#[tauri::command]
pub async fn generate_faq(
    state: State<'_, AppState>,
    pages: Vec<StudyPageContent>,
    num_questions: Option<i32>,
    provider_type: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
) -> Result<FAQ, CommandError> {
    let python_ai = state.python_ai.clone();

    let config = AIConfig {
        provider_type: provider_type.unwrap_or_else(|| "openai".to_string()),
        api_key,
        model,
        temperature: temperature.or(Some(0.7)),
        max_tokens: max_tokens.or(Some(4096)),
        ..Default::default()
    };

    tauri::async_runtime::spawn_blocking(move || {
        let python_ai = python_ai.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire Python AI lock: {}", e),
        })?;

        python_ai
            .generate_faq(pages, config, num_questions)
            .map_err(|e| CommandError {
                message: format!("FAQ generation error: {}", e),
            })
    })
    .await
    .map_err(|e| CommandError {
        message: format!("Task join error: {}", e),
    })?
}

/// Generate flashcards from selected pages
#[tauri::command]
pub async fn ai_generate_flashcards(
    state: State<'_, AppState>,
    pages: Vec<StudyPageContent>,
    num_cards: Option<i32>,
    card_types: Option<Vec<String>>,
    provider_type: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
) -> Result<FlashcardGenerationResult, CommandError> {
    let python_ai = state.python_ai.clone();

    let config = AIConfig {
        provider_type: provider_type.unwrap_or_else(|| "openai".to_string()),
        api_key,
        model,
        temperature: temperature.or(Some(0.7)),
        max_tokens: max_tokens.or(Some(4096)),
        ..Default::default()
    };

    tauri::async_runtime::spawn_blocking(move || {
        let python_ai = python_ai.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire Python AI lock: {}", e),
        })?;

        python_ai
            .generate_flashcards(pages, config, num_cards, card_types)
            .map_err(|e| CommandError {
                message: format!("Flashcard generation error: {}", e),
            })
    })
    .await
    .map_err(|e| CommandError {
        message: format!("Task join error: {}", e),
    })?
}

/// Generate briefing document from selected pages
#[tauri::command]
pub async fn generate_briefing(
    state: State<'_, AppState>,
    pages: Vec<StudyPageContent>,
    include_action_items: Option<bool>,
    provider_type: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
) -> Result<BriefingDocument, CommandError> {
    let python_ai = state.python_ai.clone();

    let config = AIConfig {
        provider_type: provider_type.unwrap_or_else(|| "openai".to_string()),
        api_key,
        model,
        temperature: temperature.or(Some(0.7)),
        max_tokens: max_tokens.or(Some(4096)),
        ..Default::default()
    };

    tauri::async_runtime::spawn_blocking(move || {
        let python_ai = python_ai.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire Python AI lock: {}", e),
        })?;

        python_ai
            .generate_briefing(pages, config, include_action_items)
            .map_err(|e| CommandError {
                message: format!("Briefing generation error: {}", e),
            })
    })
    .await
    .map_err(|e| CommandError {
        message: format!("Task join error: {}", e),
    })?
}

/// Extract timeline from selected pages
#[tauri::command]
pub async fn extract_timeline(
    state: State<'_, AppState>,
    pages: Vec<StudyPageContent>,
    provider_type: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
) -> Result<Timeline, CommandError> {
    let python_ai = state.python_ai.clone();

    let config = AIConfig {
        provider_type: provider_type.unwrap_or_else(|| "openai".to_string()),
        api_key,
        model,
        temperature: temperature.or(Some(0.7)),
        max_tokens: max_tokens.or(Some(4096)),
        ..Default::default()
    };

    tauri::async_runtime::spawn_blocking(move || {
        let python_ai = python_ai.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire Python AI lock: {}", e),
        })?;

        python_ai
            .extract_timeline(pages, config)
            .map_err(|e| CommandError {
                message: format!("Timeline extraction error: {}", e),
            })
    })
    .await
    .map_err(|e| CommandError {
        message: format!("Task join error: {}", e),
    })?
}

/// Extract concept graph from selected pages
#[tauri::command]
pub async fn extract_concepts(
    state: State<'_, AppState>,
    pages: Vec<StudyPageContent>,
    max_nodes: Option<i32>,
    provider_type: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
) -> Result<ConceptGraph, CommandError> {
    let python_ai = state.python_ai.clone();

    let config = AIConfig {
        provider_type: provider_type.unwrap_or_else(|| "openai".to_string()),
        api_key,
        model,
        temperature: temperature.or(Some(0.7)),
        max_tokens: max_tokens.or(Some(4096)),
        ..Default::default()
    };

    tauri::async_runtime::spawn_blocking(move || {
        let python_ai = python_ai.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire Python AI lock: {}", e),
        })?;

        python_ai
            .extract_concepts(pages, config, max_nodes)
            .map_err(|e| CommandError {
                message: format!("Concept extraction error: {}", e),
            })
    })
    .await
    .map_err(|e| CommandError {
        message: format!("Task join error: {}", e),
    })?
}

/// Chat with RAG context and return response with source citations
#[tauri::command]
pub async fn chat_with_citations(
    state: State<'_, AppState>,
    query: String,
    context_chunks: Vec<RAGChunk>,
    max_citations: Option<i32>,
    provider_type: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
) -> Result<CitedResponse, CommandError> {
    let python_ai = state.python_ai.clone();

    let config = AIConfig {
        provider_type: provider_type.unwrap_or_else(|| "openai".to_string()),
        api_key,
        model,
        temperature: temperature.or(Some(0.7)),
        max_tokens: max_tokens.or(Some(4096)),
        ..Default::default()
    };

    tauri::async_runtime::spawn_blocking(move || {
        let python_ai = python_ai.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire Python AI lock: {}", e),
        })?;

        python_ai
            .chat_with_citations(query, context_chunks, config, max_citations)
            .map_err(|e| CommandError {
                message: format!("Citation chat error: {}", e),
            })
    })
    .await
    .map_err(|e| CommandError {
        message: format!("Task join error: {}", e),
    })?
}
