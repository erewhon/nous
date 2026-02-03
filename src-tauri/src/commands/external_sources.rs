use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::external_sources::{
    CreateExternalSourceRequest, ExternalFileFormat, ExternalSource, ResolvedFileInfo,
    UpdateExternalSourceRequest,
};
use crate::AppState;

/// Error type for external sources commands
#[derive(Debug, Serialize)]
pub struct ExternalSourcesCommandError {
    message: String,
}

impl ExternalSourcesCommandError {
    pub fn new(message: &str) -> Self {
        Self {
            message: message.to_string(),
        }
    }
}

type CommandResult<T> = Result<T, ExternalSourcesCommandError>;

/// List all external sources
#[tauri::command]
pub fn list_external_sources(state: State<AppState>) -> CommandResult<Vec<ExternalSource>> {
    let storage = state.external_sources_storage.lock().map_err(|e| {
        ExternalSourcesCommandError::new(&format!("Failed to lock external sources storage: {}", e))
    })?;

    Ok(storage.list_sources())
}

/// Get a specific external source by ID
#[tauri::command]
pub fn get_external_source(
    state: State<AppState>,
    source_id: String,
) -> CommandResult<ExternalSource> {
    let storage = state.external_sources_storage.lock().map_err(|e| {
        ExternalSourcesCommandError::new(&format!("Failed to lock external sources storage: {}", e))
    })?;

    let uuid = Uuid::parse_str(&source_id)
        .map_err(|_| ExternalSourcesCommandError::new(&format!("Invalid source ID: {}", source_id)))?;

    storage
        .get_source(uuid)
        .map_err(|e| ExternalSourcesCommandError::new(&format!("Failed to get source: {}", e)))
}

/// Create a new external source
#[tauri::command]
pub fn create_external_source(
    state: State<AppState>,
    name: String,
    path_pattern: String,
    file_formats: Option<Vec<ExternalFileFormat>>,
    enabled: Option<bool>,
) -> CommandResult<ExternalSource> {
    let mut storage = state.external_sources_storage.lock().map_err(|e| {
        ExternalSourcesCommandError::new(&format!("Failed to lock external sources storage: {}", e))
    })?;

    let request = CreateExternalSourceRequest {
        name,
        path_pattern,
        file_formats: file_formats.unwrap_or_default(),
        enabled: enabled.unwrap_or(true),
    };

    storage
        .create_source(request)
        .map_err(|e| ExternalSourcesCommandError::new(&format!("Failed to create source: {}", e)))
}

/// Update an external source
#[tauri::command]
pub fn update_external_source(
    state: State<AppState>,
    source_id: String,
    name: Option<String>,
    path_pattern: Option<String>,
    file_formats: Option<Vec<ExternalFileFormat>>,
    enabled: Option<bool>,
) -> CommandResult<ExternalSource> {
    let mut storage = state.external_sources_storage.lock().map_err(|e| {
        ExternalSourcesCommandError::new(&format!("Failed to lock external sources storage: {}", e))
    })?;

    let uuid = Uuid::parse_str(&source_id)
        .map_err(|_| ExternalSourcesCommandError::new(&format!("Invalid source ID: {}", source_id)))?;

    let request = UpdateExternalSourceRequest {
        name,
        path_pattern,
        file_formats,
        enabled,
    };

    storage
        .update_source(uuid, request)
        .map_err(|e| ExternalSourcesCommandError::new(&format!("Failed to update source: {}", e)))
}

/// Delete an external source
#[tauri::command]
pub fn delete_external_source(state: State<AppState>, source_id: String) -> CommandResult<()> {
    let mut storage = state.external_sources_storage.lock().map_err(|e| {
        ExternalSourcesCommandError::new(&format!("Failed to lock external sources storage: {}", e))
    })?;

    let uuid = Uuid::parse_str(&source_id)
        .map_err(|_| ExternalSourcesCommandError::new(&format!("Invalid source ID: {}", source_id)))?;

    storage
        .delete_source(uuid)
        .map_err(|e| ExternalSourcesCommandError::new(&format!("Failed to delete source: {}", e)))
}

/// Preview files that would be matched by an external source
#[tauri::command]
pub fn preview_external_source_files(
    state: State<AppState>,
    source_id: String,
) -> CommandResult<Vec<ResolvedFileInfo>> {
    let storage = state.external_sources_storage.lock().map_err(|e| {
        ExternalSourcesCommandError::new(&format!("Failed to lock external sources storage: {}", e))
    })?;

    let uuid = Uuid::parse_str(&source_id)
        .map_err(|_| ExternalSourcesCommandError::new(&format!("Invalid source ID: {}", source_id)))?;

    storage
        .preview_source_files(uuid)
        .map_err(|e| ExternalSourcesCommandError::new(&format!("Failed to preview files: {}", e)))
}

/// Preview files that would be matched by a path pattern (without saving a source)
#[tauri::command]
pub fn preview_path_pattern_files(
    state: State<AppState>,
    path_pattern: String,
    file_formats: Option<Vec<ExternalFileFormat>>,
) -> CommandResult<Vec<ResolvedFileInfo>> {
    let storage = state.external_sources_storage.lock().map_err(|e| {
        ExternalSourcesCommandError::new(&format!("Failed to lock external sources storage: {}", e))
    })?;

    let formats = file_formats.unwrap_or_default();

    storage
        .resolve_files(&path_pattern, &formats)
        .map_err(|e| ExternalSourcesCommandError::new(&format!("Failed to resolve files: {}", e)))
}
