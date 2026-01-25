use serde::{Deserialize, Serialize};
use std::fs;
use tauri::State;
use uuid::Uuid;

use crate::AppState;

use super::notebook::CommandError;

type CommandResult<T> = Result<T, CommandError>;

/// Bounding rectangle for highlight position
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PDFRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// PDF highlight annotation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PDFHighlight {
    pub id: String,
    pub page_number: i32,
    pub rects: Vec<PDFRect>,
    pub selected_text: String,
    pub note: Option<String>,
    pub color: String,
    pub created_at: String,
    pub updated_at: String,
}

/// PDF page annotations container
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PDFPageAnnotations {
    pub page_id: String,
    pub notebook_id: String,
    pub highlights: Vec<PDFHighlight>,
    pub updated_at: String,
}

/// Get the PDF annotations directory path for a notebook
fn get_pdf_annotations_dir(state: &State<AppState>, notebook_id: Uuid) -> CommandResult<std::path::PathBuf> {
    let storage = state.storage.lock().unwrap();
    let assets_path = storage.notebook_assets_dir(notebook_id);
    let pdf_annotations_path = assets_path.join("pdf_annotations");

    // Ensure directory exists
    fs::create_dir_all(&pdf_annotations_path).map_err(|e| CommandError {
        message: format!("Failed to create PDF annotations directory: {}", e),
    })?;

    Ok(pdf_annotations_path)
}

/// Get PDF annotations for a page
#[tauri::command]
pub fn get_pdf_annotations(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<PDFPageAnnotations> {
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let annotations_dir = get_pdf_annotations_dir(&state, nb_id)?;
    let annotation_path = annotations_dir.join(format!("{}.json", page_id));

    if !annotation_path.exists() {
        // Return empty annotations
        return Ok(PDFPageAnnotations {
            page_id: page_id.clone(),
            notebook_id: notebook_id.clone(),
            highlights: vec![],
            updated_at: chrono::Utc::now().to_rfc3339(),
        });
    }

    let content = fs::read_to_string(&annotation_path).map_err(|e| CommandError {
        message: format!("Failed to read PDF annotations: {}", e),
    })?;

    let annotations: PDFPageAnnotations = serde_json::from_str(&content).map_err(|e| CommandError {
        message: format!("Failed to parse PDF annotations: {}", e),
    })?;

    Ok(annotations)
}

/// Save all PDF annotations for a page
#[tauri::command]
pub fn save_pdf_annotations(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    highlights: Vec<PDFHighlight>,
) -> CommandResult<PDFPageAnnotations> {
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let annotations_dir = get_pdf_annotations_dir(&state, nb_id)?;
    let annotation_path = annotations_dir.join(format!("{}.json", page_id));

    let annotations = PDFPageAnnotations {
        page_id: page_id.clone(),
        notebook_id: notebook_id.clone(),
        highlights,
        updated_at: chrono::Utc::now().to_rfc3339(),
    };

    let content = serde_json::to_string_pretty(&annotations).map_err(|e| CommandError {
        message: format!("Failed to serialize PDF annotations: {}", e),
    })?;

    fs::write(&annotation_path, content).map_err(|e| CommandError {
        message: format!("Failed to save PDF annotations: {}", e),
    })?;

    Ok(annotations)
}

/// Add a highlight to a PDF page
#[tauri::command]
pub fn add_pdf_highlight(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    highlight: PDFHighlight,
) -> CommandResult<PDFPageAnnotations> {
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let annotations_dir = get_pdf_annotations_dir(&state, nb_id)?;
    let annotation_path = annotations_dir.join(format!("{}.json", page_id));

    // Load existing annotations or create new
    let mut annotations = if annotation_path.exists() {
        let content = fs::read_to_string(&annotation_path).map_err(|e| CommandError {
            message: format!("Failed to read PDF annotations: {}", e),
        })?;
        serde_json::from_str(&content).map_err(|e| CommandError {
            message: format!("Failed to parse PDF annotations: {}", e),
        })?
    } else {
        PDFPageAnnotations {
            page_id: page_id.clone(),
            notebook_id: notebook_id.clone(),
            highlights: vec![],
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
    };

    // Add highlight
    annotations.highlights.push(highlight);
    annotations.updated_at = chrono::Utc::now().to_rfc3339();

    // Save
    let content = serde_json::to_string_pretty(&annotations).map_err(|e| CommandError {
        message: format!("Failed to serialize PDF annotations: {}", e),
    })?;

    fs::write(&annotation_path, content).map_err(|e| CommandError {
        message: format!("Failed to save PDF annotations: {}", e),
    })?;

    Ok(annotations)
}

/// Update a highlight
#[tauri::command]
pub fn update_pdf_highlight(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    highlight_id: String,
    note: Option<String>,
    color: Option<String>,
) -> CommandResult<PDFPageAnnotations> {
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let annotations_dir = get_pdf_annotations_dir(&state, nb_id)?;
    let annotation_path = annotations_dir.join(format!("{}.json", page_id));

    if !annotation_path.exists() {
        return Err(CommandError {
            message: "No annotations found for this page".to_string(),
        });
    }

    let content = fs::read_to_string(&annotation_path).map_err(|e| CommandError {
        message: format!("Failed to read PDF annotations: {}", e),
    })?;

    let mut annotations: PDFPageAnnotations = serde_json::from_str(&content).map_err(|e| CommandError {
        message: format!("Failed to parse PDF annotations: {}", e),
    })?;

    // Find and update highlight
    let mut found = false;
    for h in &mut annotations.highlights {
        if h.id == highlight_id {
            if let Some(n) = note {
                h.note = if n.is_empty() { None } else { Some(n) };
            }
            if let Some(c) = color {
                h.color = c;
            }
            h.updated_at = chrono::Utc::now().to_rfc3339();
            found = true;
            break;
        }
    }

    if !found {
        return Err(CommandError {
            message: format!("Highlight not found: {}", highlight_id),
        });
    }

    annotations.updated_at = chrono::Utc::now().to_rfc3339();

    // Save
    let content = serde_json::to_string_pretty(&annotations).map_err(|e| CommandError {
        message: format!("Failed to serialize PDF annotations: {}", e),
    })?;

    fs::write(&annotation_path, content).map_err(|e| CommandError {
        message: format!("Failed to save PDF annotations: {}", e),
    })?;

    Ok(annotations)
}

/// Delete a highlight
#[tauri::command]
pub fn delete_pdf_highlight(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    highlight_id: String,
) -> CommandResult<PDFPageAnnotations> {
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let annotations_dir = get_pdf_annotations_dir(&state, nb_id)?;
    let annotation_path = annotations_dir.join(format!("{}.json", page_id));

    if !annotation_path.exists() {
        return Err(CommandError {
            message: "No annotations found for this page".to_string(),
        });
    }

    let content = fs::read_to_string(&annotation_path).map_err(|e| CommandError {
        message: format!("Failed to read PDF annotations: {}", e),
    })?;

    let mut annotations: PDFPageAnnotations = serde_json::from_str(&content).map_err(|e| CommandError {
        message: format!("Failed to parse PDF annotations: {}", e),
    })?;

    // Remove highlight
    let before_len = annotations.highlights.len();
    annotations.highlights.retain(|h| h.id != highlight_id);

    if annotations.highlights.len() == before_len {
        return Err(CommandError {
            message: format!("Highlight not found: {}", highlight_id),
        });
    }

    annotations.updated_at = chrono::Utc::now().to_rfc3339();

    // Save
    let content = serde_json::to_string_pretty(&annotations).map_err(|e| CommandError {
        message: format!("Failed to serialize PDF annotations: {}", e),
    })?;

    fs::write(&annotation_path, content).map_err(|e| CommandError {
        message: format!("Failed to save PDF annotations: {}", e),
    })?;

    Ok(annotations)
}

/// Delete all annotations for a page
#[tauri::command]
pub fn delete_pdf_annotations(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<()> {
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let annotations_dir = get_pdf_annotations_dir(&state, nb_id)?;
    let annotation_path = annotations_dir.join(format!("{}.json", page_id));

    if annotation_path.exists() {
        fs::remove_file(&annotation_path).map_err(|e| CommandError {
            message: format!("Failed to delete PDF annotations: {}", e),
        })?;
    }

    Ok(())
}
