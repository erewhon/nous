use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Open a library in a new window
///
/// If a window for this library is already open, focus it instead of creating a duplicate.
#[tauri::command]
pub async fn open_library_window(app: AppHandle, library_id: String) -> Result<String, String> {
    let label = format!("library-{}", library_id);

    // Focus existing window if already open
    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(label);
    }

    // Create new window with library context via URL query parameter
    let url = format!("/?library={}", library_id);

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title("Nous")
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;

    Ok(label)
}

/// Close a library window by its ID
#[tauri::command]
pub async fn close_library_window(app: AppHandle, library_id: String) -> Result<(), String> {
    let label = format!("library-{}", library_id);

    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Check if a library window is open
#[tauri::command]
pub fn is_library_window_open(app: AppHandle, library_id: String) -> bool {
    let label = format!("library-{}", library_id);
    app.get_webview_window(&label).is_some()
}
