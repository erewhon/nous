//! Document conversion Tauri commands using markitdown.

use tauri::State;

use crate::python_bridge::DocumentConversionResult;
use crate::AppState;

use super::notebook::CommandError;

/// Convert a document to Markdown using markitdown
#[tauri::command]
pub fn convert_document(
    state: State<AppState>,
    file_path: String,
) -> Result<DocumentConversionResult, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai.convert_document(file_path).map_err(|e| CommandError {
        message: format!("Document conversion error: {}", e),
    })
}

/// Convert multiple documents to Markdown
#[tauri::command]
pub fn convert_documents_batch(
    state: State<AppState>,
    file_paths: Vec<String>,
) -> Result<Vec<DocumentConversionResult>, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai
        .convert_documents_batch(file_paths)
        .map_err(|e| CommandError {
            message: format!("Batch document conversion error: {}", e),
        })
}

/// Get list of supported file extensions for document conversion
#[tauri::command]
pub fn get_supported_document_extensions(
    state: State<AppState>,
) -> Result<Vec<String>, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai
        .get_supported_extensions()
        .map_err(|e| CommandError {
            message: format!("Failed to get supported extensions: {}", e),
        })
}

/// Check if a file type is supported for conversion
#[tauri::command]
pub fn is_supported_document(
    state: State<AppState>,
    file_path: String,
) -> Result<bool, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai.is_supported_file(file_path).map_err(|e| CommandError {
        message: format!("Failed to check file support: {}", e),
    })
}
