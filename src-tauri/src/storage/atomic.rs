//! Crash-atomic, durable file writes shared across the storage layer.
//!
//! Every content write goes through [`write`] / [`write_str`]: data is written
//! to a uniquely-named sibling temp file, fsync'd, atomically renamed over the
//! target, and then the parent directory is fsync'd so the rename itself is
//! durable. A crash (or power loss, or `ENOSPC`) at any point leaves either the
//! old file or the new file fully intact — never a truncated, empty, or
//! interleaved file.
//!
//! Two writers (e.g. the desktop app and the daemon) never collide on the temp
//! file because each temp name carries the writer's PID and a process-monotonic
//! sequence number.

use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

/// Process-monotonic counter so concurrent writers never share a temp filename.
static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Suffix marking our temp files. Recovery deletes any orphan with this suffix.
const TEMP_SUFFIX: &str = ".nous-tmp";

/// Atomically and durably write `bytes` to `path`.
///
/// On success the target either did not change or now contains exactly `bytes`.
/// The temp file is always cleaned up (consumed by the rename on success, or
/// removed on failure).
pub fn write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("atomic write target has no parent directory: {:?}", path),
        )
    })?;
    if !parent.exists() {
        fs::create_dir_all(parent)?;
    }

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("nous-file");
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp_path = parent.join(format!(
        "{}.{}.{}{}",
        file_name,
        std::process::id(),
        seq,
        TEMP_SUFFIX
    ));

    // Write + flush + fsync the temp file so its bytes are durable before rename.
    {
        let mut f = File::create(&tmp_path)?;
        f.write_all(bytes)?;
        f.flush()?;
        f.sync_all()?;
    }

    // Atomic replace. On failure, don't leak the temp file.
    if let Err(e) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(e);
    }

    // fsync the directory so the rename itself survives a crash. Best-effort:
    // some platforms / filesystems don't support directory fsync.
    if let Ok(dir) = File::open(parent) {
        let _ = dir.sync_all();
    }

    Ok(())
}

/// Convenience wrapper for string content.
pub fn write_str(path: &Path, content: &str) -> std::io::Result<()> {
    write(path, content.as_bytes())
}

/// Delete orphan temp files left in `dir` by a crash mid-write.
///
/// A leftover temp is ALWAYS an incomplete / uncommitted write: `rename` is
/// atomic, so a committed target is never torn, and an orphan temp can never be
/// safely promoted (we cannot distinguish a fully-written-but-unrenamed temp
/// from one truncated mid-write). The committed target, if any, is
/// authoritative, so we delete orphans rather than resurrect them. This also
/// fixes the old recovery path, which could promote a stale/partial temp over a
/// missing target and restore corrupt content. Best-effort.
pub fn cleanup_temp_files(dir: &Path) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        // New unique temps (".nous-tmp") and legacy fixed-name temps (".tmp").
        if name.ends_with(TEMP_SUFFIX) || name.ends_with(".tmp") {
            let _ = fs::remove_file(&path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use uuid::Uuid;

    fn tmp_dir() -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("nous_atomic_{}", Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn writes_content_and_leaves_no_temp() {
        let dir = tmp_dir();
        let path = dir.join("page.json");
        write_str(&path, "{\"v\":1}").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "{\"v\":1}");
        // No temp file left behind.
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                n.ends_with(".tmp") || n.ends_with(TEMP_SUFFIX)
            })
            .collect();
        assert!(leftovers.is_empty(), "temp file leaked: {:?}", leftovers);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn overwrites_existing_atomically() {
        let dir = tmp_dir();
        let path = dir.join("page.json");
        write_str(&path, "old").unwrap();
        write_str(&path, "new").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn creates_missing_parent_dirs() {
        let dir = tmp_dir();
        let path = dir.join("nested").join("deep").join("file.json");
        write_str(&path, "x").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "x");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cleanup_removes_orphan_temps_but_keeps_real_files() {
        let dir = tmp_dir();
        // A committed file and two orphan temps (new + legacy naming).
        write_str(&dir.join("real.json"), "keep").unwrap();
        fs::write(dir.join("real.json.1234.0.nous-tmp"), "partial").unwrap();
        fs::write(dir.join("legacy.json.tmp"), "partial").unwrap();

        cleanup_temp_files(&dir);

        assert!(dir.join("real.json").exists());
        assert_eq!(fs::read_to_string(dir.join("real.json")).unwrap(), "keep");
        assert!(!dir.join("real.json.1234.0.nous-tmp").exists());
        assert!(!dir.join("legacy.json.tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn concurrent_writers_to_distinct_paths_do_not_collide() {
        let dir = Arc::new(tmp_dir());
        let mut handles = vec![];
        for i in 0..8 {
            let dir = Arc::clone(&dir);
            handles.push(std::thread::spawn(move || {
                let path = dir.join(format!("f{}.json", i));
                for n in 0..20 {
                    write_str(&path, &format!("{}-{}", i, n)).unwrap();
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        for i in 0..8 {
            assert_eq!(
                fs::read_to_string(dir.join(format!("f{}.json", i))).unwrap(),
                format!("{}-19", i)
            );
        }
        // No temp leftovers from any thread.
        let leftovers = fs::read_dir(&*dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(TEMP_SUFFIX))
            .count();
        assert_eq!(leftovers, 0);
        let _ = fs::remove_dir_all(&*dir);
    }
}
