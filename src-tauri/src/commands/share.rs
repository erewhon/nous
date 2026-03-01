use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::share::credentials;
use crate::share::html_gen::{generate_share_site, render_share_html};
use crate::share::storage::{
    build_multi_share_record, build_share_record, ShareExpiry, ShareRecord, ShareType,
};
use crate::share::upload::{self, ShareUploadConfig};
use crate::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePageRequest {
    pub notebook_id: String,
    pub page_id: String,
    pub theme: String,
    pub expiry: String,
    #[serde(default)]
    pub upload_external: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePageResponse {
    pub share: ShareRecord,
    pub local_url: String,
}

#[tauri::command]
pub async fn share_page(
    state: State<'_, AppState>,
    request: SharePageRequest,
) -> Result<SharePageResponse, String> {
    let nb_id =
        Uuid::parse_str(&request.notebook_id).map_err(|e| format!("Invalid notebook ID: {}", e))?;
    let pg_id =
        Uuid::parse_str(&request.page_id).map_err(|e| format!("Invalid page ID: {}", e))?;
    let expiry = ShareExpiry::from_str(&request.expiry)?;
    let upload_external = request.upload_external;

    let storage = state.storage.clone();
    let share_storage = state.share_storage.clone();
    let library_storage = state.library_storage.clone();
    let theme = request.theme.clone();

    // Extract upload config synchronously before any .await
    let upload_info = if upload_external {
        let lib_storage = library_storage.lock().map_err(|e| e.to_string())?;
        let library = lib_storage
            .get_current_library()
            .map_err(|e| format!("Failed to get library: {}", e))?;
        library.share_upload_config.clone().map(|config| {
            let creds = credentials::get_s3_credentials(&library.path, library.id).ok();
            (config, creds)
        })
    } else {
        None
    };

    let (html, record) = tokio::task::spawn_blocking(move || {
        let storage = storage.lock().map_err(|e| e.to_string())?;

        let page = storage
            .get_page(nb_id, pg_id)
            .map_err(|e| format!("Failed to get page: {}", e))?;
        let all_pages = storage
            .list_pages(nb_id)
            .map_err(|e| format!("Failed to list pages: {}", e))?;

        let html = render_share_html(&storage, nb_id, &page, &all_pages, &theme)?;
        let record = build_share_record(pg_id, nb_id, &page.title, &theme, expiry);

        Ok::<_, String>((html, record))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    // Attempt external upload if requested
    let mut record = record;
    if let Some((config, Some(creds))) = &upload_info {
        match upload::upload_share_html(config, creds, &record.id, &html).await {
            Ok(url) => {
                record.external_url = Some(url);
            }
            Err(e) => {
                log::warn!("External upload failed (continuing with local): {}", e);
            }
        }
    }

    let local_url = format!("http://localhost:7667/share/{}", record.id);

    // Persist locally
    let share_storage_clone = share_storage.clone();
    let record_clone = record.clone();
    let html_clone = html.clone();
    tokio::task::spawn_blocking(move || {
        let mut share_store = share_storage_clone.lock().map_err(|e| e.to_string())?;
        share_store.create_share(record_clone, &html_clone)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    Ok(SharePageResponse {
        share: record,
        local_url,
    })
}

#[tauri::command]
pub async fn list_shares(state: State<'_, AppState>) -> Result<Vec<ShareRecord>, String> {
    let share_storage = state.share_storage.clone();

    tokio::task::spawn_blocking(move || {
        let store = share_storage.lock().map_err(|e| e.to_string())?;
        store.list_shares()
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn delete_share(state: State<'_, AppState>, share_id: String) -> Result<(), String> {
    let share_storage = state.share_storage.clone();
    let library_storage = state.library_storage.clone();

    // Extract upload config + creds synchronously before any .await
    let remote_info = {
        let lib_storage = library_storage.lock().map_err(|e| e.to_string())?;
        if let Ok(library) = lib_storage.get_current_library() {
            library.share_upload_config.clone().and_then(|config| {
                credentials::get_s3_credentials(&library.path, library.id)
                    .ok()
                    .map(|creds| (config, creds))
            })
        } else {
            None
        }
    };

    // Best-effort remote delete
    if let Some((config, creds)) = &remote_info {
        let _ = upload::delete_share_remote(config, creds, &share_id).await;
    }

    tokio::task::spawn_blocking(move || {
        let store = share_storage.lock().map_err(|e| e.to_string())?;
        store.delete_share(&share_id)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

// ===== Folder / Section Sharing =====

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareFolderRequest {
    pub notebook_id: String,
    pub folder_id: String,
    pub theme: String,
    pub expiry: String,
    pub site_title: Option<String>,
    #[serde(default)]
    pub upload_external: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareSectionRequest {
    pub notebook_id: String,
    pub section_id: String,
    pub theme: String,
    pub expiry: String,
    pub site_title: Option<String>,
    #[serde(default)]
    pub upload_external: bool,
}

#[tauri::command]
pub async fn share_folder(
    state: State<'_, AppState>,
    request: ShareFolderRequest,
) -> Result<SharePageResponse, String> {
    let nb_id =
        Uuid::parse_str(&request.notebook_id).map_err(|e| format!("Invalid notebook ID: {}", e))?;
    let folder_id =
        Uuid::parse_str(&request.folder_id).map_err(|e| format!("Invalid folder ID: {}", e))?;
    let expiry = ShareExpiry::from_str(&request.expiry)?;
    let upload_external = request.upload_external;

    let storage = state.storage.clone();
    let share_storage = state.share_storage.clone();
    let library_storage = state.library_storage.clone();
    let theme = request.theme.clone();
    let site_title_opt = request.site_title.clone();

    // Extract upload config synchronously
    let upload_info = if upload_external {
        let lib_storage = library_storage.lock().map_err(|e| e.to_string())?;
        let library = lib_storage.get_current_library().map_err(|e| format!("{}", e))?;
        library.share_upload_config.clone().map(|config| {
            let creds = credentials::get_s3_credentials(&library.path, library.id).ok();
            (config, creds)
        })
    } else {
        None
    };

    // Generate site in a blocking task
    let (site_dir, record) = tokio::task::spawn_blocking(move || {
        let storage = storage.lock().map_err(|e| e.to_string())?;

        let all_pages = storage.list_pages(nb_id).map_err(|e| format!("{}", e))?;
        let all_folders = storage.list_folders(nb_id).map_err(|e| format!("{}", e))?;

        // Find the target folder
        let folder = all_folders
            .iter()
            .find(|f| f.id == folder_id)
            .ok_or_else(|| "Folder not found".to_string())?;

        let folder_name = folder.name.clone();
        let site_title = site_title_opt.unwrap_or(folder_name.clone());

        // Collect folder and all child folder IDs
        let folder_ids = collect_folder_subtree(folder_id, &all_folders);

        // Filter pages: belong to any folder in the subtree and not deleted
        let pages: Vec<_> = all_pages
            .into_iter()
            .filter(|p| {
                p.deleted_at.is_none()
                    && p.folder_id.map_or(false, |fid| folder_ids.contains(&fid))
            })
            .collect();

        // Filter folders to the subtree
        let folders: Vec<_> = all_folders
            .into_iter()
            .filter(|f| folder_ids.contains(&f.id))
            .collect();

        let page_count = pages.len();
        let site_dir = generate_share_site(&storage, nb_id, &pages, &folders, &site_title, &theme)?;

        let record = build_multi_share_record(
            ShareType::Folder { folder_id },
            nb_id,
            &folder_name,
            &theme,
            expiry,
            page_count,
        );

        Ok::<_, String>((site_dir, record))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    // Attempt external upload
    let mut record = record;
    if let Some((config, Some(creds))) = &upload_info {
        match upload::upload_share_site(config, creds, &record.id, &site_dir).await {
            Ok(url) => {
                record.external_url = Some(url);
            }
            Err(e) => {
                log::warn!("External upload failed (continuing with local): {}", e);
            }
        }
    }

    let local_url = format!("http://localhost:7667/share/{}", record.id);

    // Persist locally (copy site_dir into shares)
    let share_storage_clone = share_storage.clone();
    let record_clone = record.clone();
    let site_dir_clone = site_dir.clone();
    tokio::task::spawn_blocking(move || {
        let share_store = share_storage_clone.lock().map_err(|e| e.to_string())?;
        share_store.create_multi_share(record_clone, &site_dir_clone)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    // Clean up temp dir
    let _ = std::fs::remove_dir_all(&site_dir);

    Ok(SharePageResponse {
        share: record,
        local_url,
    })
}

#[tauri::command]
pub async fn share_section(
    state: State<'_, AppState>,
    request: ShareSectionRequest,
) -> Result<SharePageResponse, String> {
    let nb_id =
        Uuid::parse_str(&request.notebook_id).map_err(|e| format!("Invalid notebook ID: {}", e))?;
    let section_id =
        Uuid::parse_str(&request.section_id).map_err(|e| format!("Invalid section ID: {}", e))?;
    let expiry = ShareExpiry::from_str(&request.expiry)?;
    let upload_external = request.upload_external;

    let storage = state.storage.clone();
    let share_storage = state.share_storage.clone();
    let library_storage = state.library_storage.clone();
    let theme = request.theme.clone();
    let site_title_opt = request.site_title.clone();

    // Extract upload config synchronously
    let upload_info = if upload_external {
        let lib_storage = library_storage.lock().map_err(|e| e.to_string())?;
        let library = lib_storage.get_current_library().map_err(|e| format!("{}", e))?;
        library.share_upload_config.clone().map(|config| {
            let creds = credentials::get_s3_credentials(&library.path, library.id).ok();
            (config, creds)
        })
    } else {
        None
    };

    // Generate site in a blocking task
    let (site_dir, record) = tokio::task::spawn_blocking(move || {
        let storage = storage.lock().map_err(|e| e.to_string())?;

        let all_pages = storage.list_pages(nb_id).map_err(|e| format!("{}", e))?;
        let all_folders = storage.list_folders(nb_id).map_err(|e| format!("{}", e))?;

        // Get section name
        let sections = storage.list_sections(nb_id).map_err(|e| format!("{}", e))?;
        let section = sections
            .iter()
            .find(|s| s.id == section_id)
            .ok_or_else(|| "Section not found".to_string())?;
        let section_name = section.name.clone();
        let site_title = site_title_opt.unwrap_or(section_name.clone());

        // Filter pages in section, not deleted
        let pages: Vec<_> = all_pages
            .into_iter()
            .filter(|p| p.deleted_at.is_none() && p.section_id == Some(section_id))
            .collect();

        // Filter folders in section
        let folders: Vec<_> = all_folders
            .into_iter()
            .filter(|f| f.section_id == Some(section_id))
            .collect();

        let page_count = pages.len();
        let site_dir = generate_share_site(&storage, nb_id, &pages, &folders, &site_title, &theme)?;

        let record = build_multi_share_record(
            ShareType::Section { section_id },
            nb_id,
            &section_name,
            &theme,
            expiry,
            page_count,
        );

        Ok::<_, String>((site_dir, record))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    // Attempt external upload
    let mut record = record;
    if let Some((config, Some(creds))) = &upload_info {
        match upload::upload_share_site(config, creds, &record.id, &site_dir).await {
            Ok(url) => {
                record.external_url = Some(url);
            }
            Err(e) => {
                log::warn!("External upload failed (continuing with local): {}", e);
            }
        }
    }

    let local_url = format!("http://localhost:7667/share/{}", record.id);

    // Persist locally (copy site_dir into shares)
    let share_storage_clone = share_storage.clone();
    let record_clone = record.clone();
    let site_dir_clone = site_dir.clone();
    tokio::task::spawn_blocking(move || {
        let share_store = share_storage_clone.lock().map_err(|e| e.to_string())?;
        share_store.create_multi_share(record_clone, &site_dir_clone)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    // Clean up temp dir
    let _ = std::fs::remove_dir_all(&site_dir);

    Ok(SharePageResponse {
        share: record,
        local_url,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareNotebookRequest {
    pub notebook_id: String,
    pub theme: String,
    pub expiry: String,
    pub site_title: Option<String>,
    #[serde(default)]
    pub upload_external: bool,
}

#[tauri::command]
pub async fn share_notebook(
    state: State<'_, AppState>,
    request: ShareNotebookRequest,
) -> Result<SharePageResponse, String> {
    let nb_id =
        Uuid::parse_str(&request.notebook_id).map_err(|e| format!("Invalid notebook ID: {}", e))?;
    let expiry = ShareExpiry::from_str(&request.expiry)?;
    let upload_external = request.upload_external;

    let storage = state.storage.clone();
    let share_storage = state.share_storage.clone();
    let library_storage = state.library_storage.clone();
    let theme = request.theme.clone();
    let site_title_opt = request.site_title.clone();

    // Extract upload config synchronously
    let upload_info = if upload_external {
        let lib_storage = library_storage.lock().map_err(|e| e.to_string())?;
        let library = lib_storage.get_current_library().map_err(|e| format!("{}", e))?;
        library.share_upload_config.clone().map(|config| {
            let creds = credentials::get_s3_credentials(&library.path, library.id).ok();
            (config, creds)
        })
    } else {
        None
    };

    // Generate site in a blocking task
    let (site_dir, record) = tokio::task::spawn_blocking(move || {
        let storage = storage.lock().map_err(|e| e.to_string())?;

        let notebook = storage
            .get_notebook(nb_id)
            .map_err(|e| format!("Failed to get notebook: {}", e))?;
        let notebook_name = notebook.name.clone();
        let site_title = site_title_opt.unwrap_or(notebook_name.clone());

        let all_pages = storage.list_pages(nb_id).map_err(|e| format!("{}", e))?;
        let all_folders = storage.list_folders(nb_id).map_err(|e| format!("{}", e))?;

        // Include all non-deleted pages
        let pages: Vec<_> = all_pages
            .into_iter()
            .filter(|p| p.deleted_at.is_none())
            .collect();

        let page_count = pages.len();
        let site_dir =
            generate_share_site(&storage, nb_id, &pages, &all_folders, &site_title, &theme)?;

        let record = build_multi_share_record(
            ShareType::Notebook { notebook_id: nb_id },
            nb_id,
            &notebook_name,
            &theme,
            expiry,
            page_count,
        );

        Ok::<_, String>((site_dir, record))
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    // Attempt external upload
    let mut record = record;
    if let Some((config, Some(creds))) = &upload_info {
        match upload::upload_share_site(config, creds, &record.id, &site_dir).await {
            Ok(url) => {
                record.external_url = Some(url);
            }
            Err(e) => {
                log::warn!("External upload failed (continuing with local): {}", e);
            }
        }
    }

    let local_url = format!("http://localhost:7667/share/{}", record.id);

    // Persist locally (copy site_dir into shares)
    let share_storage_clone = share_storage.clone();
    let record_clone = record.clone();
    let site_dir_clone = site_dir.clone();
    tokio::task::spawn_blocking(move || {
        let share_store = share_storage_clone.lock().map_err(|e| e.to_string())?;
        share_store.create_multi_share(record_clone, &site_dir_clone)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    // Clean up temp dir
    let _ = std::fs::remove_dir_all(&site_dir);

    Ok(SharePageResponse {
        share: record,
        local_url,
    })
}

/// Collect a folder and all its descendant folder IDs.
fn collect_folder_subtree(
    root_id: Uuid,
    all_folders: &[crate::storage::Folder],
) -> std::collections::HashSet<Uuid> {
    let mut result = std::collections::HashSet::new();
    result.insert(root_id);

    let mut queue = vec![root_id];
    while let Some(parent_id) = queue.pop() {
        for folder in all_folders {
            if folder.parent_id == Some(parent_id) && !result.contains(&folder.id) {
                result.insert(folder.id);
                queue.push(folder.id);
            }
        }
    }

    result
}

// ===== S3 Upload Configuration Commands =====

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareUploadConfigInput {
    pub endpoint_url: String,
    pub bucket: String,
    pub region: String,
    pub path_prefix: String,
    pub public_url_base: String,
    pub access_key_id: String,
    pub secret_access_key: String,
}

#[tauri::command]
pub async fn configure_share_upload(
    state: State<'_, AppState>,
    config_input: ShareUploadConfigInput,
) -> Result<(), String> {
    let library_storage = state.library_storage.clone();
    let lib_storage = library_storage.lock().map_err(|e| e.to_string())?;
    let library = lib_storage
        .get_current_library()
        .map_err(|e| format!("Failed to get library: {}", e))?;

    let upload_config = ShareUploadConfig {
        endpoint_url: config_input.endpoint_url,
        bucket: config_input.bucket,
        region: config_input.region,
        path_prefix: config_input.path_prefix,
        public_url_base: config_input.public_url_base,
    };

    // Store credentials
    credentials::store_s3_credentials(
        &library.path,
        library.id,
        &config_input.access_key_id,
        &config_input.secret_access_key,
    )?;

    // Store config on library
    lib_storage
        .update_library_share_upload_config(library.id, Some(upload_config))
        .map_err(|e| format!("Failed to save config: {}", e))?;

    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareUploadConfigResponse {
    pub endpoint_url: String,
    pub bucket: String,
    pub region: String,
    pub path_prefix: String,
    pub public_url_base: String,
    pub has_credentials: bool,
}

#[tauri::command]
pub async fn get_share_upload_config(
    state: State<'_, AppState>,
) -> Result<Option<ShareUploadConfigResponse>, String> {
    let library_storage = state.library_storage.clone();
    let lib_storage = library_storage.lock().map_err(|e| e.to_string())?;
    let library = lib_storage
        .get_current_library()
        .map_err(|e| format!("Failed to get library: {}", e))?;

    match &library.share_upload_config {
        Some(config) => {
            let has_creds = credentials::get_s3_credentials(&library.path, library.id).is_ok();
            Ok(Some(ShareUploadConfigResponse {
                endpoint_url: config.endpoint_url.clone(),
                bucket: config.bucket.clone(),
                region: config.region.clone(),
                path_prefix: config.path_prefix.clone(),
                public_url_base: config.public_url_base.clone(),
                has_credentials: has_creds,
            }))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn test_share_upload(
    _state: State<'_, AppState>,
    config_input: ShareUploadConfigInput,
) -> Result<(), String> {
    let config = ShareUploadConfig {
        endpoint_url: config_input.endpoint_url,
        bucket: config_input.bucket,
        region: config_input.region,
        path_prefix: config_input.path_prefix,
        public_url_base: config_input.public_url_base,
    };

    let creds = credentials::S3Credentials {
        access_key_id: config_input.access_key_id,
        secret_access_key: config_input.secret_access_key,
    };

    upload::test_upload(&config, &creds).await
}

#[tauri::command]
pub async fn remove_share_upload_config(state: State<'_, AppState>) -> Result<(), String> {
    let library_storage = state.library_storage.clone();
    let lib_storage = library_storage.lock().map_err(|e| e.to_string())?;
    let library = lib_storage
        .get_current_library()
        .map_err(|e| format!("Failed to get library: {}", e))?;

    // Remove credentials
    credentials::delete_s3_credentials(&library.path, library.id)?;

    // Remove config from library
    lib_storage
        .update_library_share_upload_config(library.id, None)
        .map_err(|e| format!("Failed to remove config: {}", e))?;

    Ok(())
}
