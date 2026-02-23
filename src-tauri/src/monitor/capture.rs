//! Linux window capture utilities
//!
//! Uses subprocess calls to xdotool and ImageMagick's import command
//! for window discovery and screenshot capture.

use std::path::Path;
use std::process::Command;

use super::models::WindowInfo;

/// Find windows matching a name pattern using xdotool
pub fn find_windows(pattern: &str) -> Vec<WindowInfo> {
    let output = Command::new("xdotool")
        .args(["search", "--name", pattern])
        .output();

    let output = match output {
        Ok(o) => o,
        Err(e) => {
            log::warn!("xdotool not available: {}", e);
            return Vec::new();
        }
    };

    if !output.status.success() {
        return Vec::new();
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut windows = Vec::new();

    for line in stdout.lines() {
        let window_id = line.trim();
        if window_id.is_empty() {
            continue;
        }

        // Get window title
        let title = get_window_title(window_id).unwrap_or_default();
        let class_name = get_window_class(window_id);

        windows.push(WindowInfo {
            window_id: window_id.to_string(),
            title,
            class_name,
        });
    }

    windows
}

/// List all visible windows
pub fn list_all_windows() -> Vec<WindowInfo> {
    let output = Command::new("xdotool")
        .args(["search", "--onlyvisible", "--name", ""])
        .output();

    let output = match output {
        Ok(o) => o,
        Err(e) => {
            log::warn!("xdotool not available: {}", e);
            return Vec::new();
        }
    };

    if !output.status.success() {
        return Vec::new();
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut windows = Vec::new();
    let mut seen_titles = std::collections::HashSet::new();

    for line in stdout.lines() {
        let window_id = line.trim();
        if window_id.is_empty() {
            continue;
        }

        let title = get_window_title(window_id).unwrap_or_default();
        if title.is_empty() {
            continue;
        }

        // Deduplicate by title
        if seen_titles.contains(&title) {
            continue;
        }
        seen_titles.insert(title.clone());

        let class_name = get_window_class(window_id);

        windows.push(WindowInfo {
            window_id: window_id.to_string(),
            title,
            class_name,
        });
    }

    // Sort by title
    windows.sort_by(|a, b| a.title.cmp(&b.title));
    windows
}

/// Capture a screenshot of a specific window using ImageMagick's import
pub fn capture_window_screenshot(
    window_id: &str,
    output_path: &Path,
) -> std::result::Result<(), String> {
    let result = Command::new("import")
        .args(["-window", window_id, output_path.to_str().unwrap_or("")])
        .output();

    match result {
        Ok(output) => {
            if output.status.success() {
                Ok(())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("import failed: {}", stderr))
            }
        }
        Err(e) => Err(format!(
            "ImageMagick import not available: {}. Install with: sudo apt install imagemagick",
            e
        )),
    }
}

/// Get a window's title using xdotool
fn get_window_title(window_id: &str) -> Option<String> {
    let output = Command::new("xdotool")
        .args(["getwindowname", window_id])
        .output()
        .ok()?;

    if output.status.success() {
        let title = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if title.is_empty() {
            None
        } else {
            Some(title)
        }
    } else {
        None
    }
}

/// Get a window's WM_CLASS using xprop
fn get_window_class(window_id: &str) -> Option<String> {
    let output = Command::new("xprop")
        .args(["-id", window_id, "WM_CLASS"])
        .output()
        .ok()?;

    if output.status.success() {
        let line = String::from_utf8_lossy(&output.stdout);
        // Format: WM_CLASS(STRING) = "instance", "class"
        if let Some(pos) = line.find('=') {
            let value = line[pos + 1..].trim().trim_matches('"');
            // Get the second value (class name)
            if let Some(comma_pos) = value.find(',') {
                let class = value[comma_pos + 1..].trim().trim_matches('"').trim();
                return Some(class.to_string());
            }
            return Some(value.to_string());
        }
    }

    None
}
