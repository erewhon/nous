//! AI-related Tauri commands.

use tauri::State;

use crate::python_bridge::{AIConfig, ChatMessage, ChatResponse, PageContext};
use crate::AppState;

use super::notebook::CommandError;

/// Send a chat message to the AI
#[tauri::command]
pub fn ai_chat(
    state: State<AppState>,
    messages: Vec<ChatMessage>,
    provider_type: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
) -> Result<ChatResponse, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    let config = AIConfig {
        provider_type: provider_type.unwrap_or_else(|| "openai".to_string()),
        api_key,
        model,
        temperature,
        max_tokens,
    };

    python_ai.chat(messages, config).map_err(|e| CommandError {
        message: format!("AI chat error: {}", e),
    })
}

/// Chat with page context
#[tauri::command]
pub fn ai_chat_with_context(
    state: State<AppState>,
    user_message: String,
    page_context: Option<PageContext>,
    conversation_history: Option<Vec<ChatMessage>>,
    provider_type: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
) -> Result<ChatResponse, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    let config = AIConfig {
        provider_type: provider_type.unwrap_or_else(|| "openai".to_string()),
        api_key,
        model,
        temperature,
        max_tokens,
    };

    python_ai
        .chat_with_context(user_message, page_context, conversation_history, config)
        .map_err(|e| CommandError {
            message: format!("AI chat error: {}", e),
        })
}

/// Summarize page content
#[tauri::command]
pub fn ai_summarize_page(
    state: State<AppState>,
    content: String,
    title: Option<String>,
    max_length: Option<i64>,
    provider_type: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
) -> Result<String, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    let config = AIConfig {
        provider_type: provider_type.unwrap_or_else(|| "openai".to_string()),
        api_key,
        model,
        temperature: Some(0.5),
        max_tokens: Some(1000),
    };

    python_ai
        .summarize_page(content, title, max_length, config)
        .map_err(|e| CommandError {
            message: format!("AI summarization error: {}", e),
        })
}

/// Suggest tags for page content
#[tauri::command]
pub fn ai_suggest_tags(
    state: State<AppState>,
    content: String,
    existing_tags: Option<Vec<String>>,
    provider_type: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
) -> Result<Vec<String>, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    let config = AIConfig {
        provider_type: provider_type.unwrap_or_else(|| "openai".to_string()),
        api_key,
        model,
        temperature: Some(0.3),
        max_tokens: Some(100),
    };

    python_ai
        .suggest_tags(content, existing_tags, config)
        .map_err(|e| CommandError {
            message: format!("AI tag suggestion error: {}", e),
        })
}
