use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::git;
use crate::storage::{FileStorage, Page};
use crate::AppState;

use super::notebook::CommandError;

type CommandResult<T> = Result<T, CommandError>;

// ===== Standalone core functions (no Tauri dependency) =====

/// Find a daily note for a date in a notebook (standalone).
pub fn find_daily_note(
    storage: &FileStorage,
    notebook_id: Uuid,
    date: &str,
) -> Result<Option<Page>, CommandError> {
    let pages = storage.list_pages(notebook_id)?;
    let daily_note = pages
        .into_iter()
        .find(|p| {
            p.is_daily_note
                && p.daily_note_date.as_deref() == Some(date)
                && p.deleted_at.is_none()
        });
    Ok(daily_note)
}

/// Create a daily note for a date (standalone, no sync/search/git side-effects).
/// Returns the existing note if one already exists for that date.
pub fn create_daily_note_core(
    storage: &FileStorage,
    notebook_id: Uuid,
    date: &str,
    template_id: Option<String>,
) -> Result<Page, CommandError> {
    // Check if a daily note already exists for this date
    if let Some(existing) = find_daily_note(storage, notebook_id, date)? {
        return Ok(existing);
    }

    // Get notebook config for daily notes folder
    let notebook = storage.get_notebook(notebook_id)?;
    let folder_id = notebook
        .daily_notes_config
        .as_ref()
        .and_then(|c| c.folder_id);

    // Format the title nicely (e.g., "January 15, 2024")
    let title = format_daily_note_title(date);

    // Create the page
    let mut page = storage.create_page(notebook_id, title)?;

    // Set daily note metadata
    page.is_daily_note = true;
    page.daily_note_date = Some(date.to_string());
    page.template_id = template_id;

    // Set folder if configured
    if let Some(fld_id) = folder_id {
        page.folder_id = Some(fld_id);
    }

    // Set section if configured
    let section_id = notebook.daily_notes_config.as_ref().and_then(|c| c.section_id);
    if let Some(sec_id) = section_id {
        page.section_id = Some(sec_id);
    }

    // Save the page
    storage.update_page(&page)?;

    Ok(page)
}

/// List daily notes (standalone).
pub fn list_daily_notes_core(
    storage: &FileStorage,
    notebook_id: Uuid,
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<Vec<Page>, CommandError> {
    let pages = storage.list_pages(notebook_id)?;
    let mut daily_notes: Vec<Page> = pages
        .into_iter()
        .filter(|p| {
            if !p.is_daily_note || p.deleted_at.is_some() {
                return false;
            }
            let date = match &p.daily_note_date {
                Some(d) => d.as_str(),
                None => return false,
            };
            if let Some(start) = start_date {
                if date < start {
                    return false;
                }
            }
            if let Some(end) = end_date {
                if date > end {
                    return false;
                }
            }
            true
        })
        .collect();

    // Sort by date descending (most recent first)
    daily_notes.sort_by(|a, b| {
        b.daily_note_date
            .as_ref()
            .cmp(&a.daily_note_date.as_ref())
    });

    Ok(daily_notes)
}

// ===== Tauri command wrappers =====

/// Get the daily note for a specific date in a notebook
#[tauri::command(rename_all = "camelCase")]
pub fn get_daily_note(
    state: State<AppState>,
    notebook_id: String,
    date: String, // "YYYY-MM-DD" format
) -> CommandResult<Option<Page>> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    find_daily_note(&storage, nb_id, &date)
}

/// Create a daily note for a specific date
#[tauri::command(rename_all = "camelCase")]
pub fn create_daily_note(
    state: State<AppState>,
    notebook_id: String,
    date: String, // "YYYY-MM-DD" format
    template_id: Option<String>,
) -> CommandResult<Page> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let page = create_daily_note_core(&storage, nb_id, &date, template_id)?;

    // Notify sync manager
    state.sync_manager.queue_page_update(nb_id, page.id);

    // Index the new page
    if let Ok(mut search_index) = state.search_index.lock() {
        let _ = search_index.index_page(&page);
    }

    // Auto-commit if git is enabled
    let notebook_path = storage.get_notebook_path(nb_id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = format!("Create daily note: {}", page.title);
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit daily note creation: {}", e);
        }
    }

    Ok(page)
}

/// List all daily notes in a notebook, optionally filtered by date range
#[tauri::command(rename_all = "camelCase")]
pub fn list_daily_notes(
    state: State<AppState>,
    notebook_id: String,
    start_date: Option<String>, // "YYYY-MM-DD" format
    end_date: Option<String>,   // "YYYY-MM-DD" format
) -> CommandResult<Vec<Page>> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    list_daily_notes_core(
        &storage,
        nb_id,
        start_date.as_deref(),
        end_date.as_deref(),
    )
}

/// Get or create today's daily note
#[tauri::command(rename_all = "camelCase")]
pub fn get_or_create_today_daily_note(
    state: State<AppState>,
    notebook_id: String,
    template_id: Option<String>,
) -> CommandResult<Page> {
    let today = Utc::now().format("%Y-%m-%d").to_string();

    // First try to get existing
    let existing = get_daily_note(state.clone(), notebook_id.clone(), today.clone())?;
    if let Some(page) = existing {
        return Ok(page);
    }

    // Create new with optional template
    create_daily_note(state, notebook_id, today, template_id)
}

/// Mark an existing page as a daily note
#[tauri::command(rename_all = "camelCase")]
pub fn mark_as_daily_note(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    date: String, // "YYYY-MM-DD" format
) -> CommandResult<Page> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    // Check if another daily note already exists for this date
    let pages = storage.list_pages(nb_id)?;
    if let Some(existing) = pages.iter().find(|p| {
        p.id != pg_id
            && p.is_daily_note
            && p.daily_note_date.as_ref() == Some(&date)
            && p.deleted_at.is_none()
    }) {
        return Err(CommandError {
            message: format!(
                "A daily note already exists for {}: \"{}\"",
                date, existing.title
            ),
        });
    }

    let mut page = storage.get_page(nb_id, pg_id)?;
    page.is_daily_note = true;
    page.daily_note_date = Some(date.clone());
    page.updated_at = Utc::now();
    storage.update_page(&page)?;

    // Notify sync manager
    state.sync_manager.queue_page_update(nb_id, pg_id);

    // Update search index
    if let Ok(mut search_index) = state.search_index.lock() {
        let _ = search_index.index_page(&page);
    }

    log::info!("Marked page {} as daily note for {}", page.title, date);
    Ok(page)
}

/// Unmark a page as a daily note
#[tauri::command(rename_all = "camelCase")]
pub fn unmark_daily_note(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<Page> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let mut page = storage.get_page(nb_id, pg_id)?;
    page.is_daily_note = false;
    page.daily_note_date = None;
    page.updated_at = Utc::now();
    storage.update_page(&page)?;

    // Notify sync manager
    state.sync_manager.queue_page_update(nb_id, pg_id);

    // Update search index
    if let Ok(mut search_index) = state.search_index.lock() {
        let _ = search_index.index_page(&page);
    }

    log::info!("Unmarked page {} as daily note", page.title);
    Ok(page)
}

/// Format a date string into a nice title
pub fn format_daily_note_title(date: &str) -> String {
    // Parse YYYY-MM-DD
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3 {
        return date.to_string();
    }

    let year = parts[0];
    let month: u32 = parts[1].parse().unwrap_or(0);
    let day: u32 = parts[2].parse().unwrap_or(0);

    let month_name = match month {
        1 => "January",
        2 => "February",
        3 => "March",
        4 => "April",
        5 => "May",
        6 => "June",
        7 => "July",
        8 => "August",
        9 => "September",
        10 => "October",
        11 => "November",
        12 => "December",
        _ => return date.to_string(),
    };

    format!("{} {}, {}", month_name, day, year)
}
