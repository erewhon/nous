use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::git;
use crate::storage::Page;
use crate::AppState;

use super::notebook::CommandError;

type CommandResult<T> = Result<T, CommandError>;

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

    // List all pages and find the daily note for this date
    let pages = storage.list_pages(nb_id)?;
    let daily_note = pages
        .into_iter()
        .find(|p| {
            p.is_daily_note
                && p.daily_note_date.as_ref() == Some(&date)
                && p.deleted_at.is_none()
        });

    Ok(daily_note)
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

    // Check if a daily note already exists for this date
    let pages = storage.list_pages(nb_id)?;
    if let Some(existing) = pages.iter().find(|p| {
        p.is_daily_note
            && p.daily_note_date.as_ref() == Some(&date)
            && p.deleted_at.is_none()
    }) {
        return Ok(existing.clone());
    }

    // Get notebook config for daily notes folder
    let notebook = storage.get_notebook(nb_id)?;
    let folder_id = notebook
        .daily_notes_config
        .as_ref()
        .and_then(|c| c.folder_id);

    // Format the title nicely (e.g., "January 15, 2024")
    let title = format_daily_note_title(&date);

    // Create the page
    let mut page = storage.create_page(nb_id, title)?;

    // Set daily note metadata
    page.is_daily_note = true;
    page.daily_note_date = Some(date.clone());
    page.template_id = template_id;

    // Set folder if configured
    if let Some(fld_id) = folder_id {
        page.folder_id = Some(fld_id);
    }

    // Save the page
    storage.update_page(&page)?;

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

    let pages = storage.list_pages(nb_id)?;
    let mut daily_notes: Vec<Page> = pages
        .into_iter()
        .filter(|p| {
            if !p.is_daily_note || p.deleted_at.is_some() {
                return false;
            }
            let date = match &p.daily_note_date {
                Some(d) => d,
                None => return false,
            };
            // Filter by date range if specified
            if let Some(ref start) = start_date {
                if date < start {
                    return false;
                }
            }
            if let Some(ref end) = end_date {
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
pub(crate) fn format_daily_note_title(date: &str) -> String {
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
