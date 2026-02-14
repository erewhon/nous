use std::fs;
use std::path::Path;

use chrono::Utc;
use onenote_parser::contents::{
    Content, EmbeddedFile as OneNoteEmbeddedFile, Image as OneNoteImage, List as OneNoteList,
    NoteTag, Outline, OutlineElement, OutlineItem, RichText, Table as OneNoteTable,
};
use onenote_parser::page::{Page as OneNotePage, PageContent};
use onenote_parser::section::Section as OneNoteSection;
use onenote_parser::section::SectionEntry;
use onenote_parser::Parser;
use serde::Serialize;
use uuid::Uuid;

use crate::storage::{
    EditorBlock, EditorData, Folder, Notebook, NotebookType, Page, StorageError,
};

type Result<T> = std::result::Result<T, StorageError>;

/// Preview metadata for a OneNote import
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OneNoteImportPreview {
    pub section_count: usize,
    pub page_count: usize,
    pub image_count: usize,
    pub sections: Vec<OneNoteSectionPreview>,
    pub suggested_name: String,
    pub warnings: Vec<String>,
}

/// Preview info for a single section
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OneNoteSectionPreview {
    pub name: String,
    pub page_count: usize,
}

/// Generate a block ID similar to Editor.js
fn generate_block_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{:x}", timestamp % 0xFFFFFFFFFF)
}

/// Determine the image extension from onenote_parser's extension hint
fn image_extension(ext: Option<&str>) -> &str {
    match ext {
        Some(e) => e,
        None => "png",
    }
}

/// Determine if a list is ordered based on the list format specifier.
/// Ordered lists typically have format chars containing digit placeholders.
fn is_ordered_list(list: &OneNoteList) -> bool {
    let fmt = list.list_format();
    // Ordered lists use format like ['0', '.'] or similar numeric patterns
    fmt.iter().any(|c| c.is_ascii_digit())
}

/// Check if a NoteTag represents a checkbox/task item
fn is_checkbox_tag(tag: &NoteTag) -> bool {
    tag.item_status().task_tag()
}

/// Check if a NoteTag checkbox is completed
fn is_checkbox_completed(tag: &NoteTag) -> bool {
    tag.item_status().completed()
}

/// Known file format GUIDs from MS-ONESTORE specification.
/// The first 16 bytes of a .one file contain a GUID identifying the packaging format.
const GUID_PACKAGE_STORE: [u8; 16] = [
    // {638DE92F-A6D4-4BC1-9A36-B3FC2511A5B7} — legacy package store (OneNote desktop/local)
    0x2F, 0xE9, 0x8D, 0x63, 0xD4, 0xA6, 0xC1, 0x4B, 0x9A, 0x36, 0xB3, 0xFC, 0x25, 0x11, 0xA5,
    0xB7,
];
const GUID_REVISION_STORE: [u8; 16] = [
    // {109ADD3F-911B-49F5-A5D0-1791EDC8AED8} — revision store (OneDrive/FSSHTTP)
    0x3F, 0xDD, 0x9A, 0x10, 0x1B, 0x91, 0xF5, 0x49, 0xA5, 0xD0, 0x17, 0x91, 0xED, 0xC8, 0xAE,
    0xD8,
];

/// Detect the file format from the first 16 bytes (the file format GUID).
/// Returns a human-readable description if the format is known but unsupported.
fn detect_one_file_format(path: &Path) -> Option<&'static str> {
    let data = fs::read(path).ok()?;
    if data.len() < 16 {
        return Some("File is too small to be a valid OneNote file");
    }
    let guid = &data[..16];
    if guid == GUID_PACKAGE_STORE {
        // Legacy package store format — used by OneNote desktop app and its backups.
        // The parser has partial support; backup files often fail.
        None // Let the parser try — it may work for some files
    } else if guid == GUID_REVISION_STORE {
        None // Fully supported
    } else {
        Some(
            "This file does not appear to be a valid OneNote section file \
             (unrecognized format header)",
        )
    }
}

/// Check if a filename looks like a OneNote automatic backup file.
/// Pattern: "SectionName.one (On M-DD-YY).one"
fn is_backup_filename(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    // Match pattern like ".one (On " in the filename
    name.contains(".one (On ")
}

/// Build a user-facing error message for a parse failure, adding context about
/// backup files and the format limitation.
fn format_parse_error(path: &Path, err: &onenote_parser::errors::Error) -> String {
    let err_str = err.to_string();
    let is_backup = is_backup_filename(path);
    let is_fsshttpb_error = err_str.contains("FSSHTTPB") || err_str.contains("object header");

    if is_fsshttpb_error && is_backup {
        format!(
            "Cannot parse OneNote backup file \"{}\". \
             OneNote's automatic backup files use an internal format that is not fully supported. \
             Workaround: open the original notebook in OneNote, then use File > Export to save \
             each section as a .one file, or sync to OneDrive and download from there.",
            path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default()
        )
    } else if is_fsshttpb_error {
        format!(
            "Cannot parse \"{}\": this .one file uses a local packaging format \
             that is not fully supported. The importer works with .one files synced via \
             OneDrive. Workaround: open the notebook in OneNote, then export each section, \
             or sync to OneDrive and download from there.",
            path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default()
        )
    } else {
        format!("Failed to parse OneNote section: {}", err_str)
    }
}

/// Collect all parsed sections from a path (file or directory)
fn collect_sections(path: &Path) -> Result<Vec<(String, OneNoteSection)>> {
    let parser = Parser::new();
    let mut sections = Vec::new();

    if path.is_file() {
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase());
        if ext.as_deref() == Some("one") {
            // Check for known-unsupported format before attempting parse
            if let Some(format_msg) = detect_one_file_format(path) {
                return Err(StorageError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format_msg,
                )));
            }

            let section = parser.parse_section(path).map_err(|e| {
                StorageError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format_parse_error(path, &e),
                ))
            })?;
            let name = path
                .file_stem()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Untitled Section".to_string());
            sections.push((name, section));
        } else {
            return Err(StorageError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Expected a .one file",
            )));
        }
    } else if path.is_dir() {
        // Check for .onetoc2 file for ordered notebook parsing
        let toc_file = find_onetoc2(path);

        if let Some(toc_path) = toc_file {
            // Parse as notebook using the table of contents
            let notebook = parser.parse_notebook(&toc_path).map_err(|e| {
                StorageError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("Failed to parse OneNote notebook: {}", e),
                ))
            })?;

            collect_sections_from_entries(&parser, path, notebook.entries(), &mut sections)?;
        } else {
            // No .onetoc2 — parse each .one file individually
            let mut one_files: Vec<_> = fs::read_dir(path)?
                .filter_map(|entry| entry.ok())
                .filter(|entry| {
                    entry
                        .path()
                        .extension()
                        .map(|e| e.to_string_lossy().to_lowercase() == "one")
                        .unwrap_or(false)
                })
                .collect();

            one_files.sort_by_key(|e| e.file_name());

            let mut parse_errors: Vec<String> = Vec::new();
            let mut all_are_backup_format = true;

            for entry in one_files {
                let file_path = entry.path();
                match parser.parse_section(&file_path) {
                    Ok(section) => {
                        all_are_backup_format = false;
                        let name = file_path
                            .file_stem()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_else(|| "Untitled Section".to_string());
                        sections.push((name, section));
                    }
                    Err(e) => {
                        let err_str = e.to_string();
                        let is_format_error = err_str.contains("FSSHTTPB")
                            || err_str.contains("object header");
                        if !is_format_error {
                            all_are_backup_format = false;
                        }
                        parse_errors.push(format_parse_error(&file_path, &e));
                        log::warn!("Skipping unparseable .one file {:?}: {}", file_path, e);
                    }
                }
            }

            // If all files failed with the same format error, return a single clear message
            if sections.is_empty() && !parse_errors.is_empty() {
                let has_backups = path
                    .to_string_lossy()
                    .to_lowercase()
                    .contains("backup");
                let message = if all_are_backup_format || has_backups {
                    "None of the .one files could be parsed. These appear to be OneNote \
                     desktop backup files, which use an internal format not fully supported \
                     by the importer.\n\n\
                     Workaround: open the notebooks in OneNote, then either:\n\
                     \u{2022} Export each section as a .one file (File > Export)\n\
                     \u{2022} Sync to OneDrive and download from there"
                        .to_string()
                } else {
                    format!(
                        "No valid .one section files found. {} file(s) could not be parsed.\n\
                         First error: {}",
                        parse_errors.len(),
                        parse_errors.first().unwrap_or(&String::new())
                    )
                };
                return Err(StorageError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    message,
                )));
            }
        }

        if sections.is_empty() {
            return Err(StorageError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "No valid .one section files found in directory",
            )));
        }
    } else {
        return Err(StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Path does not exist",
        )));
    }

    Ok(sections)
}

/// Recursively collect sections from notebook entries
fn collect_sections_from_entries(
    parser: &Parser,
    base_dir: &Path,
    entries: &[SectionEntry],
    sections: &mut Vec<(String, OneNoteSection)>,
) -> Result<()> {
    for entry in entries {
        match entry {
            SectionEntry::Section(section) => {
                sections.push((section.display_name().to_string(), section.clone()));
            }
            SectionEntry::SectionGroup(group) => {
                // Recurse into section groups
                collect_sections_from_entries(parser, base_dir, group.entries(), sections)?;
            }
        }
    }
    Ok(())
}

/// Find a .onetoc2 file in the given directory
fn find_onetoc2(dir: &Path) -> Option<std::path::PathBuf> {
    fs::read_dir(dir).ok()?.find_map(|entry| {
        let entry = entry.ok()?;
        let path = entry.path();
        if path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase() == "onetoc2")
            .unwrap_or(false)
        {
            Some(path)
        } else {
            None
        }
    })
}

/// Count pages across all page series in a section
fn count_pages(section: &OneNoteSection) -> usize {
    section
        .page_series()
        .iter()
        .map(|ps| ps.pages().len())
        .sum()
}

/// Count images in a page
fn count_page_images(page: &OneNotePage) -> usize {
    let mut count = 0;
    for content in page.contents() {
        match content {
            PageContent::Image(_) => count += 1,
            PageContent::Outline(outline) => {
                count += count_outline_images(outline);
            }
            _ => {}
        }
    }
    count
}

/// Count images within an outline recursively
fn count_outline_images(outline: &Outline) -> usize {
    let mut count = 0;
    for item in outline.items() {
        if let Some(element) = item.element() {
            for content in element.contents() {
                if matches!(content, Content::Image(_)) {
                    count += 1;
                }
            }
            count += count_outline_items_images(element.children());
        }
    }
    count
}

/// Count images in nested outline items
fn count_outline_items_images(items: &[OutlineItem]) -> usize {
    let mut count = 0;
    for item in items {
        if let Some(element) = item.element() {
            for content in element.contents() {
                if matches!(content, Content::Image(_)) {
                    count += 1;
                }
            }
            count += count_outline_items_images(element.children());
        }
    }
    count
}

/// Collect warnings from page content
fn collect_page_warnings(page: &OneNotePage, warnings: &mut Vec<String>) {
    for content in page.contents() {
        match content {
            PageContent::Ink(_) => {
                let msg = "Ink/handwriting content was skipped".to_string();
                if !warnings.contains(&msg) {
                    warnings.push(msg);
                }
            }
            PageContent::EmbeddedFile(_) => {
                let msg = "Embedded files were saved as attachments".to_string();
                if !warnings.contains(&msg) {
                    warnings.push(msg);
                }
            }
            PageContent::Outline(outline) => {
                collect_outline_warnings(outline, warnings);
            }
            _ => {}
        }
    }
}

/// Collect warnings from outline content recursively
fn collect_outline_warnings(outline: &Outline, warnings: &mut Vec<String>) {
    for item in outline.items() {
        if let Some(element) = item.element() {
            for content in element.contents() {
                match content {
                    Content::Ink(_) => {
                        let msg = "Ink/handwriting content was skipped".to_string();
                        if !warnings.contains(&msg) {
                            warnings.push(msg);
                        }
                    }
                    Content::EmbeddedFile(_) => {
                        let msg = "Embedded files were saved as attachments".to_string();
                        if !warnings.contains(&msg) {
                            warnings.push(msg);
                        }
                    }
                    _ => {}
                }
            }
            collect_outline_items_warnings(element.children(), warnings);
        }
    }
}

fn collect_outline_items_warnings(items: &[OutlineItem], warnings: &mut Vec<String>) {
    for item in items {
        if let Some(element) = item.element() {
            for content in element.contents() {
                match content {
                    Content::Ink(_) => {
                        let msg = "Ink/handwriting content was skipped".to_string();
                        if !warnings.contains(&msg) {
                            warnings.push(msg);
                        }
                    }
                    Content::EmbeddedFile(_) => {
                        let msg = "Embedded files were saved as attachments".to_string();
                        if !warnings.contains(&msg) {
                            warnings.push(msg);
                        }
                    }
                    _ => {}
                }
            }
            collect_outline_items_warnings(element.children(), warnings);
        }
    }
}

/// Preview a OneNote import without actually importing
pub fn preview_onenote(path: &Path) -> Result<OneNoteImportPreview> {
    let sections = collect_sections(path)?;

    let mut total_pages = 0;
    let mut total_images = 0;
    let mut section_previews = Vec::new();
    let mut warnings = Vec::new();

    for (name, section) in &sections {
        let page_count = count_pages(section);
        total_pages += page_count;

        for ps in section.page_series() {
            for page in ps.pages() {
                total_images += count_page_images(page);
                collect_page_warnings(page, &mut warnings);
            }
        }

        section_previews.push(OneNoteSectionPreview {
            name: name.clone(),
            page_count,
        });
    }

    let suggested_name = if path.is_file() {
        path.file_stem()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Imported from OneNote".to_string())
    } else {
        path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Imported from OneNote".to_string())
    };

    Ok(OneNoteImportPreview {
        section_count: sections.len(),
        page_count: total_pages,
        image_count: total_images,
        sections: section_previews,
        suggested_name,
        warnings,
    })
}

/// Import a OneNote file or directory as a new notebook
pub fn import_onenote(
    path: &Path,
    notebooks_dir: &Path,
    notebook_name: Option<String>,
) -> Result<(Notebook, Vec<Page>)> {
    let sections = collect_sections(path)?;

    // Determine notebook name
    let name = notebook_name.unwrap_or_else(|| {
        if path.is_file() {
            path.file_stem()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Imported from OneNote".to_string())
        } else {
            path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Imported from OneNote".to_string())
        }
    });

    let notebook_id = Uuid::new_v4();
    let now = Utc::now();

    let notebook = Notebook {
        id: notebook_id,
        name,
        notebook_type: NotebookType::Standard,
        icon: Some("\u{1f4d3}".to_string()), // Notebook emoji
        color: None,
        sections_enabled: false,
        archived: false,
        system_prompt: None,
        system_prompt_mode: crate::storage::SystemPromptMode::default(),
        ai_provider: None,
        ai_model: None,
        sync_config: None,
        encryption_config: None,
        is_pinned: false,
        position: 0,
        page_sort_by: None,
        daily_notes_config: None,
        created_at: now,
        updated_at: now,
    };

    // Create notebook directory structure
    let notebook_dir = notebooks_dir.join(notebook_id.to_string());
    fs::create_dir_all(&notebook_dir)?;
    fs::create_dir_all(notebook_dir.join("pages"))?;
    fs::create_dir_all(notebook_dir.join("assets"))?;
    fs::create_dir_all(notebook_dir.join("assets").join("images"))?;
    fs::create_dir_all(notebook_dir.join("assets").join("embedded"))?;

    // Write notebook.json
    let notebook_json = serde_json::to_string_pretty(&notebook)?;
    fs::write(notebook_dir.join("notebook.json"), notebook_json)?;

    let assets_dir = notebook_dir.join("assets");
    let use_folders = sections.len() > 1;
    let mut folders: Vec<Folder> = Vec::new();
    let mut pages = Vec::new();
    let mut position = 0;

    for (section_name, section) in &sections {
        // Create a folder for each section if there are multiple sections
        let folder_id = if use_folders {
            let folder = Folder::new(notebook_id, section_name.clone(), None);
            let fid = folder.id;
            folders.push(folder);
            Some(fid)
        } else {
            None
        };

        // Track the last level-0 page for subpage parenting
        let mut last_level0_page_id: Option<Uuid> = None;

        for ps in section.page_series() {
            for onenote_page in ps.pages() {
                let page_id = Uuid::new_v4();

                // Extract title
                let title = onenote_page
                    .title_text()
                    .map(|t| t.to_string())
                    .filter(|t| !t.trim().is_empty())
                    .unwrap_or_else(|| "Untitled Page".to_string());

                // Determine parent page for subpages
                let level = onenote_page.level();
                let parent_page_id = if level > 0 {
                    last_level0_page_id
                } else {
                    last_level0_page_id = Some(page_id);
                    None
                };

                // Convert page content to editor blocks
                let blocks =
                    convert_page_contents(onenote_page, notebook_id, &assets_dir);

                let page = Page {
                    id: page_id,
                    notebook_id,
                    title,
                    content: EditorData {
                        time: Some(Utc::now().timestamp_millis()),
                        blocks,
                        version: Some("2.28.0".to_string()),
                    },
                    tags: Vec::new(),
                    folder_id,
                    parent_page_id,
                    section_id: None,
                    is_archived: false,
                    is_cover: false,
                    position,
                    system_prompt: None,
                    system_prompt_mode: crate::storage::SystemPromptMode::default(),
                    ai_model: None,
                    page_type: crate::storage::PageType::default(),
                    source_file: None,
                    storage_mode: None,
                    file_extension: None,
                    last_file_sync: None,
                    template_id: None,
                    deleted_at: None,
                    is_favorite: false,
                    color: None,
                    is_daily_note: false,
                    daily_note_date: None,
                    created_at: now,
                    updated_at: now,
                };

                // Save page
                let page_path = notebook_dir
                    .join("pages")
                    .join(format!("{}.json", page_id));
                let page_json = serde_json::to_string_pretty(&page)?;
                fs::write(page_path, page_json)?;

                pages.push(page);
                position += 1;
            }
        }
    }

    // Write folders.json if we created any
    if !folders.is_empty() {
        let folders_json = serde_json::to_string_pretty(&folders)?;
        fs::write(notebook_dir.join("folders.json"), folders_json)?;
    }

    Ok((notebook, pages))
}

/// Convert a OneNote page's contents to EditorJS blocks
fn convert_page_contents(
    page: &OneNotePage,
    notebook_id: Uuid,
    assets_dir: &Path,
) -> Vec<EditorBlock> {
    let mut blocks = Vec::new();

    for content in page.contents() {
        match content {
            PageContent::Outline(outline) => {
                convert_outline(&mut blocks, outline, notebook_id, assets_dir);
            }
            PageContent::Image(image) => {
                if let Some(block) = convert_standalone_image(image, notebook_id, assets_dir) {
                    blocks.push(block);
                }
            }
            PageContent::EmbeddedFile(file) => {
                blocks.push(convert_embedded_file(file, notebook_id, assets_dir));
            }
            PageContent::Ink(_) => {
                // Skip ink content — warning was collected during preview
            }
            PageContent::Unknown => {}
        }
    }

    // Ensure at least one block
    if blocks.is_empty() {
        blocks.push(EditorBlock {
            id: generate_block_id(),
            block_type: "paragraph".to_string(),
            data: serde_json::json!({ "text": "" }),
        });
    }

    blocks
}

/// Convert an outline to editor blocks
fn convert_outline(
    blocks: &mut Vec<EditorBlock>,
    outline: &Outline,
    notebook_id: Uuid,
    assets_dir: &Path,
) {
    for item in outline.items() {
        convert_outline_item(blocks, item, notebook_id, assets_dir);
    }
}

/// Convert a single outline item
fn convert_outline_item(
    blocks: &mut Vec<EditorBlock>,
    item: &OutlineItem,
    notebook_id: Uuid,
    assets_dir: &Path,
) {
    if let Some(element) = item.element() {
        convert_outline_element(blocks, element, notebook_id, assets_dir);
    }
}

/// Convert an outline element to editor blocks
fn convert_outline_element(
    blocks: &mut Vec<EditorBlock>,
    element: &OutlineElement,
    notebook_id: Uuid,
    assets_dir: &Path,
) {
    let list_specs = element.list_contents();
    let has_list = !list_specs.is_empty();

    for content in element.contents() {
        match content {
            Content::RichText(rt) => {
                // Check for checkbox note tags
                let note_tags = rt.note_tags();
                let is_checkbox = note_tags.iter().any(|t| is_checkbox_tag(t));

                if is_checkbox {
                    let checked = note_tags.iter().any(|t| is_checkbox_completed(t));
                    let text = format_rich_text(rt);
                    blocks.push(EditorBlock {
                        id: generate_block_id(),
                        block_type: "checklist".to_string(),
                        data: serde_json::json!({
                            "items": [{
                                "text": text,
                                "checked": checked
                            }]
                        }),
                    });
                } else if has_list {
                    let text = format_rich_text(rt);
                    let ordered = list_specs.iter().any(|l| is_ordered_list(l));
                    blocks.push(EditorBlock {
                        id: generate_block_id(),
                        block_type: "list".to_string(),
                        data: serde_json::json!({
                            "style": if ordered { "ordered" } else { "unordered" },
                            "items": [text]
                        }),
                    });
                } else {
                    // Check if this should be a header based on font size
                    let style = rt.paragraph_style();
                    let font_size = style.font_size(); // half-point increments

                    if let Some(size) = font_size {
                        // Convert from half-points to points
                        let pt = size / 2;
                        if pt >= 16 {
                            let level = if pt >= 24 {
                                1
                            } else if pt >= 18 {
                                2
                            } else {
                                3
                            };
                            let text = format_rich_text(rt);
                            blocks.push(EditorBlock {
                                id: generate_block_id(),
                                block_type: "header".to_string(),
                                data: serde_json::json!({
                                    "text": text,
                                    "level": level
                                }),
                            });
                            continue;
                        }
                    }

                    // Regular paragraph
                    let text = format_rich_text(rt);
                    blocks.push(EditorBlock {
                        id: generate_block_id(),
                        block_type: "paragraph".to_string(),
                        data: serde_json::json!({ "text": text }),
                    });
                }
            }
            Content::Table(table) => {
                blocks.push(convert_table(table));
            }
            Content::Image(image) => {
                if let Some(block) = convert_standalone_image(image, notebook_id, assets_dir) {
                    blocks.push(block);
                }
            }
            Content::EmbeddedFile(file) => {
                blocks.push(convert_embedded_file(file, notebook_id, assets_dir));
            }
            Content::Ink(_) => {
                // Skip ink — warning collected during preview
            }
            Content::Unknown => {}
        }
    }

    // Process nested children
    for child in element.children() {
        convert_outline_item(blocks, child, notebook_id, assets_dir);
    }
}

/// Format rich text with HTML inline tags based on text run formatting
fn format_rich_text(rt: &RichText) -> String {
    let text = rt.text();
    if text.is_empty() {
        return String::new();
    }

    let indices = rt.text_run_indices();
    let formatting = rt.text_run_formatting();

    // If no formatting runs, return plain text (HTML-escaped)
    if formatting.is_empty() || indices.is_empty() {
        return html_escape_text(text);
    }

    let chars: Vec<char> = text.chars().collect();
    let mut result = String::new();

    // Build ranges from indices
    // indices are start positions; each run goes from indices[i] to indices[i+1] (or end)
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for (i, &start) in indices.iter().enumerate() {
        let start = start as usize;
        let end = if i + 1 < indices.len() {
            indices[i + 1] as usize
        } else {
            chars.len()
        };
        if start < chars.len() {
            ranges.push((start, end.min(chars.len())));
        }
    }

    // If we have more formatting entries than ranges, use the extra ones for the
    // remaining text not covered by indices
    // Typical pattern: formatting[0] is default, then formatting[1..] match indices[0..]
    let format_offset = if formatting.len() > indices.len() { 1 } else { 0 };

    for (i, &(start, end)) in ranges.iter().enumerate() {
        let substring: String = chars[start..end].iter().collect();
        let escaped = html_escape_text(&substring);

        let fmt_idx = i + format_offset;
        if fmt_idx < formatting.len() {
            let fmt = &formatting[fmt_idx];
            result.push_str(&wrap_with_formatting(&escaped, fmt));
        } else {
            result.push_str(&escaped);
        }
    }

    // Handle any text before the first index
    if !indices.is_empty() && indices[0] > 0 {
        let prefix: String = chars[..indices[0] as usize].iter().collect();
        let escaped = html_escape_text(&prefix);
        // Prepend with base paragraph formatting if available
        if format_offset > 0 {
            let fmt = &formatting[0];
            return format!("{}{}", wrap_with_formatting(&escaped, fmt), result);
        }
        return format!("{}{}", escaped, result);
    }

    result
}

/// Wrap text in HTML formatting tags based on ParagraphStyling
fn wrap_with_formatting(text: &str, fmt: &onenote_parser::contents::ParagraphStyling) -> String {
    let mut result = text.to_string();

    if fmt.bold() {
        result = format!("<b>{}</b>", result);
    }
    if fmt.italic() {
        result = format!("<i>{}</i>", result);
    }
    if fmt.underline() {
        result = format!("<u>{}</u>", result);
    }
    if fmt.strikethrough() {
        result = format!("<s>{}</s>", result);
    }
    if fmt.superscript() {
        result = format!("<sup>{}</sup>", result);
    }
    if fmt.subscript() {
        result = format!("<sub>{}</sub>", result);
    }

    result
}

/// Basic HTML escaping for text content
fn html_escape_text(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Convert a OneNote image to an editor image block
fn convert_standalone_image(
    image: &OneNoteImage,
    notebook_id: Uuid,
    assets_dir: &Path,
) -> Option<EditorBlock> {
    let data = image.data()?;
    if data.is_empty() {
        return None;
    }

    let ext = image_extension(image.extension());
    let filename = image
        .image_filename()
        .map(|n| n.to_string())
        .unwrap_or_else(|| format!("{}.{}", Uuid::new_v4(), ext));

    // Ensure unique filename
    let images_dir = assets_dir.join("images");
    let mut target_filename = filename.clone();
    let mut counter = 1;
    while images_dir.join(&target_filename).exists() {
        let stem = std::path::Path::new(&filename)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let file_ext = std::path::Path::new(&filename)
            .extension()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| ext.to_string());
        target_filename = format!("{}_{}.{}", stem, counter, file_ext);
        counter += 1;
    }

    // Write image file
    let target_path = images_dir.join(&target_filename);
    if let Err(e) = fs::write(&target_path, data) {
        log::warn!("Failed to write image asset: {}", e);
        return None;
    }

    let asset_url = format!("asset://{}/images/{}", notebook_id, target_filename);
    let caption = image.alt_text().unwrap_or("").to_string();

    Some(EditorBlock {
        id: generate_block_id(),
        block_type: "image".to_string(),
        data: serde_json::json!({
            "file": { "url": asset_url },
            "caption": caption,
            "withBorder": false,
            "stretched": false,
            "withBackground": false
        }),
    })
}

/// Convert an embedded file to a paragraph block with link
fn convert_embedded_file(
    file: &OneNoteEmbeddedFile,
    notebook_id: Uuid,
    assets_dir: &Path,
) -> EditorBlock {
    let filename = file.filename().to_string();
    let data = file.data();

    if !data.is_empty() {
        let embedded_dir = assets_dir.join("embedded");
        let _ = fs::create_dir_all(&embedded_dir);

        // Ensure unique filename
        let mut target_filename = filename.clone();
        let mut counter = 1;
        while embedded_dir.join(&target_filename).exists() {
            let stem = std::path::Path::new(&filename)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let ext = std::path::Path::new(&filename)
                .extension()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "bin".to_string());
            target_filename = format!("{}_{}.{}", stem, counter, ext);
            counter += 1;
        }

        let target_path = embedded_dir.join(&target_filename);
        if let Err(e) = fs::write(&target_path, data) {
            log::warn!("Failed to write embedded file: {}", e);
        }

        let asset_url = format!("asset://{}/embedded/{}", notebook_id, target_filename);
        EditorBlock {
            id: generate_block_id(),
            block_type: "paragraph".to_string(),
            data: serde_json::json!({
                "text": format!("[Attached file: <a href=\"{}\">{}</a>]", asset_url, html_escape_text(&filename))
            }),
        }
    } else {
        EditorBlock {
            id: generate_block_id(),
            block_type: "paragraph".to_string(),
            data: serde_json::json!({
                "text": format!("[Attached file: {}]", html_escape_text(&filename))
            }),
        }
    }
}

/// Convert a OneNote table to an editor table block
fn convert_table(table: &OneNoteTable) -> EditorBlock {
    let mut content: Vec<Vec<String>> = Vec::new();

    for row in table.contents() {
        let mut row_data: Vec<String> = Vec::new();
        for cell in row.contents() {
            // Extract text from cell's outline elements
            let mut cell_text = String::new();
            for element in cell.contents() {
                for c in element.contents() {
                    if let Content::RichText(rt) = c {
                        if !cell_text.is_empty() {
                            cell_text.push_str("<br>");
                        }
                        cell_text.push_str(&format_rich_text(rt));
                    }
                }
            }
            row_data.push(cell_text);
        }
        content.push(row_data);
    }

    EditorBlock {
        id: generate_block_id(),
        block_type: "table".to_string(),
        data: serde_json::json!({
            "withHeadings": false,
            "content": content
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_block_id() {
        let id = generate_block_id();
        assert!(!id.is_empty());
        assert!(id.len() <= 10);
    }

    #[test]
    fn test_html_escape_text() {
        assert_eq!(html_escape_text("<b>test</b>"), "&lt;b&gt;test&lt;/b&gt;");
        assert_eq!(html_escape_text("a & b"), "a &amp; b");
    }
}
