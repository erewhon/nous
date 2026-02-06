use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::publish::presentation::{self, PresentationOptions};
use crate::publish::print::{self, PrintOptions};
use crate::publish::site::{self, PublishOptions, PublishResult};
use crate::AppState;

#[derive(Clone, Serialize)]
struct PublishProgress {
    current: usize,
    total: usize,
    message: String,
}

/// Publish an entire notebook as a static HTML site.
#[tauri::command]
pub async fn publish_notebook(
    state: State<'_, AppState>,
    app: AppHandle,
    notebook_id: String,
    output_dir: String,
    theme: String,
    options: PublishOptions,
) -> Result<PublishResult, String> {
    let nb_id =
        Uuid::parse_str(&notebook_id).map_err(|e| format!("Invalid notebook ID: {}", e))?;
    let storage = state.storage.clone();
    let out = std::path::PathBuf::from(&output_dir);

    tokio::task::spawn_blocking(move || {
        let storage = storage.lock().map_err(|e| e.to_string())?;

        let progress_fn: site::ProgressFn = Box::new(move |current, total, msg| {
            let _ = app.emit(
                "publish:progress",
                PublishProgress {
                    current,
                    total,
                    message: msg.to_string(),
                },
            );
        });

        site::publish_notebook(&storage, nb_id, &out, &theme, &options, Some(&progress_fn))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Publish selected pages as a static HTML site.
#[tauri::command]
pub async fn publish_selected_pages(
    state: State<'_, AppState>,
    app: AppHandle,
    notebook_id: String,
    page_ids: Vec<String>,
    output_dir: String,
    theme: String,
    options: PublishOptions,
) -> Result<PublishResult, String> {
    let nb_id =
        Uuid::parse_str(&notebook_id).map_err(|e| format!("Invalid notebook ID: {}", e))?;
    let parsed_ids: Vec<Uuid> = page_ids
        .iter()
        .map(|id| Uuid::parse_str(id).map_err(|e| format!("Invalid page ID {}: {}", id, e)))
        .collect::<Result<Vec<_>, _>>()?;
    let storage = state.storage.clone();
    let out = std::path::PathBuf::from(&output_dir);

    tokio::task::spawn_blocking(move || {
        let storage = storage.lock().map_err(|e| e.to_string())?;

        let progress_fn: site::ProgressFn = Box::new(move |current, total, msg| {
            let _ = app.emit(
                "publish:progress",
                PublishProgress {
                    current,
                    total,
                    message: msg.to_string(),
                },
            );
        });

        site::publish_selected_pages(
            &storage,
            nb_id,
            &parsed_ids,
            &out,
            &theme,
            &options,
            Some(&progress_fn),
        )
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Preview a single page rendered in the chosen theme. Returns a complete HTML string.
#[tauri::command]
pub fn preview_publish_page(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    theme: String,
) -> Result<String, String> {
    let nb_id =
        Uuid::parse_str(&notebook_id).map_err(|e| format!("Invalid notebook ID: {}", e))?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| format!("Invalid page ID: {}", e))?;
    let storage = state.storage.lock().map_err(|e| e.to_string())?;

    site::preview_page(&storage, nb_id, pg_id, &theme)
}

/// Generate a Reveal.js presentation HTML string for a page.
#[tauri::command]
pub fn generate_presentation(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    options: PresentationOptions,
) -> Result<String, String> {
    let nb_id =
        Uuid::parse_str(&notebook_id).map_err(|e| format!("Invalid notebook ID: {}", e))?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| format!("Invalid page ID: {}", e))?;
    let storage = state.storage.lock().map_err(|e| e.to_string())?;

    let page = storage
        .get_page(nb_id, pg_id)
        .map_err(|e| format!("Failed to get page: {}", e))?;
    let all_pages = storage
        .list_pages(nb_id)
        .map_err(|e| format!("Failed to list pages: {}", e))?;

    Ok(presentation::render_presentation_html(&page, &all_pages, &options))
}

/// Generate print-friendly HTML for a page.
#[tauri::command]
pub fn generate_print_html(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    options: PrintOptions,
) -> Result<String, String> {
    let nb_id =
        Uuid::parse_str(&notebook_id).map_err(|e| format!("Invalid notebook ID: {}", e))?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| format!("Invalid page ID: {}", e))?;
    let storage = state.storage.lock().map_err(|e| e.to_string())?;

    let page = storage
        .get_page(nb_id, pg_id)
        .map_err(|e| format!("Failed to get page: {}", e))?;
    let all_pages = storage
        .list_pages(nb_id)
        .map_err(|e| format!("Failed to list pages: {}", e))?;

    Ok(print::render_print_html(&page, &all_pages, &options))
}
