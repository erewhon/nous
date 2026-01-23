//! AI-related Tauri commands.

use tauri::{AppHandle, Emitter, State};

use crate::python_bridge::{
    AIConfig, BrowserTaskResult, ChatMessage, ChatResponse, ChatResponseWithActions,
    NotebookInfo, PageContext, PageInfo, PageSummaryInput, PagesSummaryResult,
    RelatedPageSuggestion, StreamEvent,
};
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

/// Suggest related pages to link based on content analysis
#[tauri::command]
pub fn ai_suggest_related_pages(
    state: State<AppState>,
    content: String,
    title: String,
    available_pages: Vec<PageInfo>,
    existing_links: Option<Vec<String>>,
    max_suggestions: Option<i64>,
    provider_type: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
) -> Result<Vec<RelatedPageSuggestion>, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    let config = AIConfig {
        provider_type: provider_type.unwrap_or_else(|| "openai".to_string()),
        api_key,
        model,
        temperature: Some(0.3),
        max_tokens: Some(1000),
    };

    python_ai
        .suggest_related_pages(content, title, available_pages, existing_links, max_suggestions, config)
        .map_err(|e| CommandError {
            message: format!("AI related pages suggestion error: {}", e),
        })
}

/// Chat with AI using tools for notebook/page creation
#[tauri::command]
pub async fn ai_chat_with_tools(
    state: State<'_, AppState>,
    user_message: String,
    page_context: Option<PageContext>,
    conversation_history: Option<Vec<ChatMessage>>,
    available_notebooks: Option<Vec<NotebookInfo>>,
    current_notebook_id: Option<String>,
    provider_type: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
) -> Result<ChatResponseWithActions, CommandError> {
    let python_ai = state.python_ai.clone();

    let config = AIConfig {
        provider_type: provider_type.unwrap_or_else(|| "openai".to_string()),
        api_key,
        model,
        temperature,
        max_tokens,
    };

    // Run the blocking Python call on a separate thread
    tauri::async_runtime::spawn_blocking(move || {
        let python_ai = python_ai.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire Python AI lock: {}", e),
        })?;

        python_ai
            .chat_with_tools(
                user_message,
                page_context,
                conversation_history,
                available_notebooks,
                current_notebook_id,
                config,
            )
            .map_err(|e| CommandError {
                message: format!("AI chat with tools error: {}", e),
            })
    })
    .await
    .map_err(|e| CommandError {
        message: format!("Task join error: {}", e),
    })?
}

/// Chat with AI using tools, streaming the response via events
/// Emits "ai-stream" events with StreamEvent payloads
#[tauri::command]
pub async fn ai_chat_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    user_message: String,
    page_context: Option<PageContext>,
    conversation_history: Option<Vec<ChatMessage>>,
    available_notebooks: Option<Vec<NotebookInfo>>,
    current_notebook_id: Option<String>,
    provider_type: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
    system_prompt: Option<String>,
) -> Result<(), CommandError> {
    let python_ai = state.python_ai.clone();

    let config = AIConfig {
        provider_type: provider_type.unwrap_or_else(|| "openai".to_string()),
        api_key,
        model,
        temperature,
        max_tokens,
    };

    // Get current library path for MCP server access
    let library_path = {
        let library_storage = state.library_storage.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire library storage lock: {}", e),
        })?;
        library_storage
            .get_current()
            .ok()
            .map(|lib| lib.path.to_string_lossy().to_string())
    };

    // Get the event receiver from the Python bridge
    let rx = {
        let python_ai = python_ai.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire Python AI lock: {}", e),
        })?;

        python_ai
            .chat_with_tools_stream(
                user_message,
                page_context,
                conversation_history,
                available_notebooks,
                current_notebook_id,
                config,
                system_prompt,
                library_path,
            )
            .map_err(|e| CommandError {
                message: format!("AI streaming error: {}", e),
            })?
    };

    // Read from channel and emit events in a blocking task
    // This ensures events are emitted as they arrive
    tauri::async_runtime::spawn_blocking(move || {
        log::info!("AI stream: waiting for events from Python bridge");
        let mut event_count = 0;

        while let Ok(event) = rx.recv() {
            event_count += 1;
            let is_done = matches!(event, StreamEvent::Done { .. });
            let is_error = matches!(event, StreamEvent::Error { .. });

            if is_error {
                if let StreamEvent::Error { ref message } = event {
                    log::error!("AI stream error: {}", message);
                }
            }

            // Emit the event to the frontend
            if let Err(e) = app.emit("ai-stream", &event) {
                log::error!("Failed to emit AI stream event: {}", e);
            }

            // Stop if we're done or got an error
            if is_done || is_error {
                log::info!("AI stream: completed after {} events (done={}, error={})", event_count, is_done, is_error);
                break;
            }
        }

        if event_count == 0 {
            log::warn!("AI stream: channel closed without receiving any events");
        }
    })
    .await
    .map_err(|e| CommandError {
        message: format!("Stream task error: {}", e),
    })?;

    Ok(())
}

/// Summarize multiple pages into a single summary
#[tauri::command]
pub async fn ai_summarize_pages(
    state: State<'_, AppState>,
    pages: Vec<PageSummaryInput>,
    custom_prompt: Option<String>,
    summary_style: Option<String>,
    provider_type: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
) -> Result<PagesSummaryResult, CommandError> {
    let python_ai = state.python_ai.clone();

    let config = AIConfig {
        provider_type: provider_type.unwrap_or_else(|| "openai".to_string()),
        api_key,
        model,
        temperature: Some(0.5),
        max_tokens: Some(4096),
    };

    tauri::async_runtime::spawn_blocking(move || {
        let python_ai = python_ai.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire Python AI lock: {}", e),
        })?;

        python_ai
            .summarize_pages(pages, custom_prompt, summary_style, config)
            .map_err(|e| CommandError {
                message: format!("AI summarization error: {}", e),
            })
    })
    .await
    .map_err(|e| CommandError {
        message: format!("Task join error: {}", e),
    })?
}

/// Run a browser automation task using AI
#[tauri::command]
pub async fn browser_run_task(
    state: State<'_, AppState>,
    task: String,
    provider_type: String,
    api_key: String,
    model: String,
    capture_screenshot: Option<bool>,
) -> Result<BrowserTaskResult, CommandError> {
    let python_ai = state.python_ai.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let python_ai = python_ai.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire Python AI lock: {}", e),
        })?;

        python_ai
            .run_browser_task(
                &task,
                &provider_type,
                &api_key,
                &model,
                capture_screenshot.unwrap_or(false),
            )
            .map_err(|e| CommandError {
                message: format!("Browser automation error: {}", e),
            })
    })
    .await
    .map_err(|e| CommandError {
        message: format!("Task join error: {}", e),
    })?
}
