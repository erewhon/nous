//! One-time migration of globally-scoped data into library-scoped directories.
//!
//! Goals, actions, and inbox were previously stored under the global data_dir.
//! They are now stored per-library. This module copies the old global data into
//! the current library's directory on first run.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const MARKER_FILE: &str = ".nous/.v2_lib_scoped";
const DIRS_TO_MIGRATE: &[&str] = &["goals", "inbox", "actions"];

/// Migrate global goals/inbox/actions into the library directory (one-time).
///
/// - If the marker file already exists in the library, this is a no-op.
/// - If `data_dir == library_path` (default library), data is already in place;
///   just writes the marker.
/// - Otherwise, copies each directory that exists in data_dir but not in library_path.
/// - Old directories are NOT deleted (serve as backup).
pub fn migrate_global_to_library(data_dir: &Path, library_path: &Path) -> io::Result<()> {
    let marker = library_path.join(MARKER_FILE);

    // Already migrated — nothing to do
    if marker.exists() {
        return Ok(());
    }

    // Ensure .nous directory exists for the marker
    let nous_dir = library_path.join(".nous");
    fs::create_dir_all(&nous_dir)?;

    // If data_dir and library_path are the same (default library), data is already
    // in the right place. Just write the marker.
    if paths_are_same(data_dir, library_path) {
        fs::write(&marker, "migrated")?;
        log::info!(
            "Migration: default library at {:?}, data already in place. Marker written.",
            library_path
        );
        return Ok(());
    }

    // Copy each directory from data_dir to library_path
    for dir_name in DIRS_TO_MIGRATE {
        let src = data_dir.join(dir_name);
        let dst = library_path.join(dir_name);

        if src.exists() && !dst.exists() {
            log::info!("Migration: copying {:?} → {:?}", src, dst);
            copy_dir_recursive(&src, &dst)?;
        } else if src.exists() && dst.exists() {
            log::info!(
                "Migration: skipping {} (destination already exists)",
                dir_name
            );
        }
    }

    // Write marker so we don't run again
    fs::write(&marker, "migrated")?;
    log::info!("Migration: complete for library at {:?}", library_path);

    Ok(())
}

/// Check if two paths refer to the same location (canonicalizing to handle symlinks).
fn paths_are_same(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => a == b,
    }
}

/// Recursively copy a directory tree.
fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

const TMP_VIDEOS_DIR: &str = "/tmp/nous-videos";

/// Migrate videos from `/tmp/nous-videos` back to notebook assets directories.
///
/// Previously, uploaded videos were moved from `{library}/notebooks/{nb_id}/assets/`
/// to `/tmp/nous-videos/{nb_id}/` because the Tauri asset protocol couldn't serve
/// files from hidden directories. Now that all video playback goes through the
/// embedded HTTP video server, this workaround is unnecessary.
///
/// This migration:
/// 1. Moves video files back to `{library_path}/notebooks/{nb_id}/assets/`
/// 2. Rewrites `/tmp/nous-videos/...` paths in page JSON files
/// 3. Cleans up `/tmp/nous-videos` if empty
pub fn migrate_tmp_videos(library_path: &Path) -> io::Result<()> {
    let tmp_dir = PathBuf::from(TMP_VIDEOS_DIR);
    if !tmp_dir.exists() {
        return Ok(());
    }

    log::info!("migrate_tmp_videos: scanning {:?}", tmp_dir);

    let notebooks_dir = library_path.join("notebooks");

    // Phase 1: Move video files back to notebook assets
    let entries = match fs::read_dir(&tmp_dir) {
        Ok(e) => e,
        Err(_) => return Ok(()), // Can't read, skip
    };

    for entry in entries.flatten() {
        if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
            continue;
        }
        let nb_id_str = entry.file_name();
        let nb_id = nb_id_str.to_string_lossy();
        let tmp_nb_dir = entry.path();
        let assets_dir = notebooks_dir.join(nb_id.as_ref()).join("assets");

        // Only migrate if the notebook directory exists in the library
        if !notebooks_dir.join(nb_id.as_ref()).exists() {
            log::info!(
                "migrate_tmp_videos: skipping {} (notebook not in library)",
                nb_id
            );
            continue;
        }

        fs::create_dir_all(&assets_dir)?;

        // Move each video file
        if let Ok(files) = fs::read_dir(&tmp_nb_dir) {
            for file_entry in files.flatten() {
                if !file_entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                    continue;
                }
                let filename = file_entry.file_name();
                let dest = assets_dir.join(&filename);

                if dest.exists() {
                    log::info!(
                        "migrate_tmp_videos: skipping {} (already exists in assets)",
                        filename.to_string_lossy()
                    );
                    continue;
                }

                let src = file_entry.path();
                log::info!(
                    "migrate_tmp_videos: moving {:?} -> {:?}",
                    src,
                    dest
                );

                // Try rename first, fall back to copy+delete for cross-device
                if fs::rename(&src, &dest).is_err() {
                    fs::copy(&src, &dest)?;
                    let _ = fs::remove_file(&src);
                }
            }
        }

        // Remove the now-empty notebook directory under /tmp
        let _ = fs::remove_dir(&tmp_nb_dir);
    }

    // Phase 2: Rewrite /tmp/nous-videos/ paths in page JSON files
    rewrite_tmp_video_paths(&notebooks_dir)?;

    // Phase 3: Clean up /tmp/nous-videos if empty
    if is_dir_empty(&tmp_dir) {
        log::info!("migrate_tmp_videos: removing empty {:?}", tmp_dir);
        let _ = fs::remove_dir(&tmp_dir);
    }

    log::info!("migrate_tmp_videos: complete");
    Ok(())
}

/// Scan all page JSON files and rewrite `/tmp/nous-videos/{nb_id}/filename`
/// to the new assets path.
fn rewrite_tmp_video_paths(notebooks_dir: &Path) -> io::Result<()> {
    let entries = match fs::read_dir(notebooks_dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };

    for nb_entry in entries.flatten() {
        if !nb_entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
            continue;
        }
        let nb_id = nb_entry.file_name();
        let nb_dir = nb_entry.path();
        let pages_dir = nb_dir.join("pages");

        if !pages_dir.exists() {
            continue;
        }

        let page_files = match fs::read_dir(&pages_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for page_entry in page_files.flatten() {
            let page_path = page_entry.path();
            if page_path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }

            let content = match fs::read_to_string(&page_path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            // Quick check: does this file reference /tmp/nous-videos?
            if !content.contains(TMP_VIDEOS_DIR) {
                continue;
            }

            // Rewrite: /tmp/nous-videos/{nb_id}/filename → {notebooks_dir}/{nb_id}/assets/filename
            let nb_id_str = nb_id.to_string_lossy();
            let old_prefix = format!("{}/{}/", TMP_VIDEOS_DIR, nb_id_str);
            let new_prefix = format!(
                "{}/{}/assets/",
                notebooks_dir.to_string_lossy(),
                nb_id_str
            );

            let updated = content.replace(&old_prefix, &new_prefix);

            if updated != content {
                log::info!(
                    "migrate_tmp_videos: rewriting paths in {:?}",
                    page_path
                );
                fs::write(&page_path, &updated)?;
            }
        }
    }

    Ok(())
}

/// Check if a directory is empty.
fn is_dir_empty(path: &Path) -> bool {
    fs::read_dir(path)
        .map(|mut entries| entries.next().is_none())
        .unwrap_or(true)
}
