use serde::{Deserialize, Serialize};
use std::fs;
use tauri::State;
use uuid::Uuid;

use crate::AppState;

use super::notebook::CommandError;

type CommandResult<T> = Result<T, CommandError>;

/// Page annotation data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageAnnotation {
    pub id: String,
    pub page_id: String,
    pub notebook_id: String,
    pub canvas_data: serde_json::Value,
    pub viewport_width: f64,
    pub viewport_height: f64,
    pub created_at: String,
    pub updated_at: String,
}

/// Get the annotations directory path for a notebook
fn get_annotations_dir(state: &State<AppState>, notebook_id: Uuid) -> CommandResult<std::path::PathBuf> {
    let storage = state.storage.lock().unwrap();
    let assets_path = storage.notebook_assets_dir(notebook_id);
    let annotations_path = assets_path.join("annotations");

    // Ensure directory exists
    fs::create_dir_all(&annotations_path).map_err(|e| CommandError {
        message: format!("Failed to create annotations directory: {}", e),
    })?;

    Ok(annotations_path)
}

/// Get page annotation
#[tauri::command]
pub fn get_page_annotation(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<Option<PageAnnotation>> {
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let annotations_dir = get_annotations_dir(&state, nb_id)?;
    let annotation_path = annotations_dir.join(format!("{}.json", page_id));

    if !annotation_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&annotation_path).map_err(|e| CommandError {
        message: format!("Failed to read annotation: {}", e),
    })?;

    let annotation: PageAnnotation = serde_json::from_str(&content).map_err(|e| CommandError {
        message: format!("Failed to parse annotation: {}", e),
    })?;

    Ok(Some(annotation))
}

/// Save page annotation
#[tauri::command]
pub fn save_page_annotation(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    annotation: PageAnnotation,
) -> CommandResult<()> {
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let annotations_dir = get_annotations_dir(&state, nb_id)?;
    let annotation_path = annotations_dir.join(format!("{}.json", page_id));

    let content = serde_json::to_string_pretty(&annotation).map_err(|e| CommandError {
        message: format!("Failed to serialize annotation: {}", e),
    })?;

    fs::write(&annotation_path, content).map_err(|e| CommandError {
        message: format!("Failed to save annotation: {}", e),
    })?;

    Ok(())
}

/// Delete page annotation
#[tauri::command]
pub fn delete_page_annotation(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<()> {
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let annotations_dir = get_annotations_dir(&state, nb_id)?;
    let annotation_path = annotations_dir.join(format!("{}.json", page_id));

    if annotation_path.exists() {
        fs::remove_file(&annotation_path).map_err(|e| CommandError {
            message: format!("Failed to delete annotation: {}", e),
        })?;
    }

    Ok(())
}
