//! One-time migration of globally-scoped data into library-scoped directories.
//!
//! Goals, actions, and inbox were previously stored under the global data_dir.
//! They are now stored per-library. This module copies the old global data into
//! the current library's directory on first run.

use std::fs;
use std::io;
use std::path::Path;

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
