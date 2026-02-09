use anyhow::Result;
use ratatui::prelude::Rect;
use uuid::Uuid;

use crate::app::App;
use crate::render::terminal as renderer;
use nous_lib::search::SearchResult;
use nous_lib::storage::Folder;

#[derive(Debug, Clone, PartialEq)]
pub enum Mode {
    Tree,
    Content,
    Search,
    CreateNote,
    InboxCapture,
}

#[derive(Debug, Clone)]
pub enum TreeItemKind {
    Notebook { id: Uuid },
    Section { id: Uuid, notebook_id: Uuid },
    Folder { id: Uuid, notebook_id: Uuid },
    Page { id: Uuid, notebook_id: Uuid },
}

#[derive(Debug, Clone)]
pub struct TreeItem {
    pub label: String,
    pub kind: TreeItemKind,
    pub depth: usize,
    pub expanded: bool,
    pub has_children: bool,
}

pub struct TuiState {
    pub app: App,
    pub mode: Mode,

    // Tree state
    pub tree_items: Vec<TreeItem>,
    pub tree_selected: usize,
    pub tree_scroll: usize,

    // Content state
    pub rendered_lines: Vec<String>,
    pub content_scroll: usize,
    pub content_title: String,

    // Search state
    pub search_input: String,
    pub search_results: Vec<SearchResult>,
    pub search_selected: usize,

    // Key state for multi-char sequences
    pub pending_key: Option<char>,

    // Panel areas for mouse hit-testing (updated each draw)
    pub tree_area: Option<Rect>,
    pub content_area: Option<Rect>,

    // Input mode state (for CreateNote / InboxCapture)
    pub input_text: String,
    pub flash_message: Option<String>,

    pub show_help: bool,
    pub quit: bool,
}

impl TuiState {
    pub fn new(app: App) -> Result<Self> {
        let mut state = Self {
            app,
            mode: Mode::Tree,
            tree_items: Vec::new(),
            tree_selected: 0,
            tree_scroll: 0,
            rendered_lines: Vec::new(),
            content_scroll: 0,
            content_title: String::new(),
            search_input: String::new(),
            search_results: Vec::new(),
            search_selected: 0,
            pending_key: None,
            tree_area: None,
            content_area: None,
            input_text: String::new(),
            flash_message: None,
            show_help: false,
            quit: false,
        };

        state.rebuild_tree()?;
        Ok(state)
    }

    pub fn rebuild_tree(&mut self) -> Result<()> {
        self.tree_items.clear();
        let notebooks = self.app.list_notebooks()?;

        for nb in &notebooks {
            if nb.archived {
                continue;
            }
            self.tree_items.push(TreeItem {
                label: nb.name.clone(),
                kind: TreeItemKind::Notebook { id: nb.id },
                depth: 0,
                expanded: false,
                has_children: true,
            });
        }

        Ok(())
    }

    pub fn toggle_expand(&mut self) {
        if self.tree_selected >= self.tree_items.len() {
            return;
        }

        let item = &self.tree_items[self.tree_selected];

        if item.expanded {
            // Collapse: remove children
            self.collapse_at(self.tree_selected);
        } else if item.has_children {
            // Expand: insert children
            self.expand_at(self.tree_selected);
        }
    }

    fn expand_at(&mut self, idx: usize) {
        let item = &self.tree_items[idx];
        let depth = item.depth;
        let kind = item.kind.clone();

        let mut children = Vec::new();

        match kind {
            TreeItemKind::Notebook { id } => {
                // Check if notebook has sections enabled
                let notebook = self.app.get_notebook(id).ok();
                let sections_enabled = notebook.as_ref().map(|n| n.sections_enabled).unwrap_or(false);

                if sections_enabled {
                    // Add sections first
                    if let Ok(mut sections) = self.app.list_sections(id) {
                        sections.sort_by_key(|s| s.position);
                        let folders = self.app.list_folders(id).unwrap_or_default();
                        let pages = self.app.list_pages(id).unwrap_or_default();

                        for section in &sections {
                            let has_section_folders = folders.iter()
                                .any(|f| f.section_id == Some(section.id) && f.parent_id.is_none());
                            let has_section_pages = pages.iter()
                                .any(|p| p.section_id == Some(section.id) && p.folder_id.is_none() && p.deleted_at.is_none());
                            children.push(TreeItem {
                                label: section.name.clone(),
                                kind: TreeItemKind::Section { id: section.id, notebook_id: id },
                                depth: depth + 1,
                                expanded: false,
                                has_children: has_section_folders || has_section_pages,
                            });
                        }

                        // Also add root-level folders/pages that have no section
                        self.add_folder_children(&mut children, id, &folders, &pages, None, None, depth + 1);
                    }
                } else {
                    // No sections — add folders then root pages directly
                    let folders = self.app.list_folders(id).unwrap_or_default();
                    let pages = self.app.list_pages(id).unwrap_or_default();
                    self.add_folder_children(&mut children, id, &folders, &pages, None, None, depth + 1);
                }
            }
            TreeItemKind::Section { id, notebook_id } => {
                // Expand section: show folders/pages belonging to this section
                let folders = self.app.list_folders(notebook_id).unwrap_or_default();
                let pages = self.app.list_pages(notebook_id).unwrap_or_default();
                self.add_folder_children(&mut children, notebook_id, &folders, &pages, None, Some(id), depth + 1);
            }
            TreeItemKind::Folder { id, notebook_id } => {
                let folders = self.app.list_folders(notebook_id).unwrap_or_default();
                let pages = self.app.list_pages(notebook_id).unwrap_or_default();

                // Child folders (parent_id matches this folder)
                for f in folders.iter().filter(|f| f.parent_id == Some(id)) {
                    let has_kids = folders.iter().any(|cf| cf.parent_id == Some(f.id))
                        || pages.iter().any(|p| p.folder_id == Some(f.id) && p.deleted_at.is_none());
                    children.push(TreeItem {
                        label: format!("{}/", f.name),
                        kind: TreeItemKind::Folder { id: f.id, notebook_id },
                        depth: depth + 1,
                        expanded: false,
                        has_children: has_kids,
                    });
                }
                // Child pages
                for p in pages.iter().filter(|p| p.folder_id == Some(id) && p.deleted_at.is_none()) {
                    children.push(TreeItem {
                        label: p.title.clone(),
                        kind: TreeItemKind::Page { id: p.id, notebook_id },
                        depth: depth + 1,
                        expanded: false,
                        has_children: false,
                    });
                }
            }
            TreeItemKind::Page { .. } => {
                return;
            }
        }

        self.tree_items[idx].expanded = true;

        // Insert children after current item
        let insert_pos = idx + 1;
        for (i, child) in children.into_iter().enumerate() {
            self.tree_items.insert(insert_pos + i, child);
        }
    }

    /// Add root-level folders and pages as children.
    /// If `parent_folder_id` is None, picks root folders (parent_id == None).
    /// If `section_id` is Some, filters folders/pages by section_id.
    /// If `section_id` is None (and notebook has sections), picks unsectioned items.
    fn add_folder_children(
        &self,
        children: &mut Vec<TreeItem>,
        notebook_id: Uuid,
        folders: &[Folder],
        pages: &[nous_lib::storage::Page],
        parent_folder_id: Option<Uuid>,
        section_id: Option<Uuid>,
        depth: usize,
    ) {
        // Root folders matching criteria
        let matching_folders: Vec<&Folder> = folders.iter()
            .filter(|f| f.parent_id == parent_folder_id)
            .filter(|f| match section_id {
                Some(sid) => f.section_id == Some(sid),
                None => f.section_id.is_none(),
            })
            .collect();

        for f in &matching_folders {
            let has_child_folders = folders.iter().any(|cf| cf.parent_id == Some(f.id));
            let has_child_pages = pages.iter()
                .any(|p| p.folder_id == Some(f.id) && p.deleted_at.is_none());
            children.push(TreeItem {
                label: format!("{}/", f.name),
                kind: TreeItemKind::Folder { id: f.id, notebook_id },
                depth,
                expanded: false,
                has_children: has_child_folders || has_child_pages,
            });
        }

        // Root pages matching criteria
        let matching_pages: Vec<&nous_lib::storage::Page> = pages.iter()
            .filter(|p| p.folder_id == parent_folder_id && p.deleted_at.is_none())
            .filter(|p| match section_id {
                Some(sid) => p.section_id == Some(sid),
                None => p.section_id.is_none(),
            })
            .collect();

        for p in &matching_pages {
            children.push(TreeItem {
                label: p.title.clone(),
                kind: TreeItemKind::Page { id: p.id, notebook_id },
                depth,
                expanded: false,
                has_children: false,
            });
        }
    }

    fn collapse_at(&mut self, idx: usize) {
        let depth = self.tree_items[idx].depth;
        self.tree_items[idx].expanded = false;

        // Remove all items with depth > current until we hit same or lower depth
        let mut remove_count = 0;
        for i in (idx + 1)..self.tree_items.len() {
            if self.tree_items[i].depth > depth {
                remove_count += 1;
            } else {
                break;
            }
        }

        if remove_count > 0 {
            self.tree_items.drain((idx + 1)..(idx + 1 + remove_count));
        }

        // Adjust selected if it was in the collapsed range
        if self.tree_selected > idx && self.tree_selected <= idx + remove_count {
            self.tree_selected = idx;
        }
    }

    pub fn open_selected_page(&mut self) {
        if self.tree_selected >= self.tree_items.len() {
            return;
        }

        let item = &self.tree_items[self.tree_selected];
        match &item.kind {
            TreeItemKind::Page { id, notebook_id } => {
                let page_id = *id;
                let nb_id = *notebook_id;
                if let Ok(pages) = self.app.list_pages(nb_id) {
                    if let Some(page) = pages.iter().find(|p| p.id == page_id) {
                        self.content_title = page.title.clone();
                        self.rendered_lines = renderer::render_blocks_plain(&page.content.blocks);
                        self.content_scroll = 0;
                        self.mode = Mode::Content;
                    }
                }
            }
            _ => {
                // Toggle expand for notebooks/folders
                self.toggle_expand();
            }
        }
    }

    pub fn perform_search(&mut self) {
        if self.search_input.is_empty() {
            self.search_results.clear();
            return;
        }

        if let Some(ref index) = self.app.search_index {
            if let Ok(results) = index.search(&self.search_input, 20) {
                self.search_results = results;
                self.search_selected = 0;
            }
        }
    }

    pub fn navigate_to_search_result(&mut self) {
        if self.search_selected >= self.search_results.len() {
            return;
        }

        let result = &self.search_results[self.search_selected].clone();
        let nb_id: Uuid = result.notebook_id.parse().unwrap_or_default();
        let page_id: Uuid = result.page_id.parse().unwrap_or_default();

        if let Ok(pages) = self.app.list_pages(nb_id) {
            if let Some(page) = pages.iter().find(|p| p.id == page_id) {
                self.content_title = page.title.clone();
                self.rendered_lines = renderer::render_blocks_plain(&page.content.blocks);
                self.content_scroll = 0;
                self.mode = Mode::Content;
                self.search_input.clear();
                self.search_results.clear();
            }
        }
    }

    pub fn tree_move_down(&mut self) {
        if !self.tree_items.is_empty() && self.tree_selected < self.tree_items.len() - 1 {
            self.tree_selected += 1;
        }
    }

    pub fn tree_move_up(&mut self) {
        if self.tree_selected > 0 {
            self.tree_selected -= 1;
        }
    }

    pub fn tree_go_top(&mut self) {
        self.tree_selected = 0;
        self.tree_scroll = 0;
    }

    pub fn tree_go_bottom(&mut self) {
        if !self.tree_items.is_empty() {
            self.tree_selected = self.tree_items.len() - 1;
        }
    }

    pub fn content_scroll_down(&mut self, amount: usize) {
        self.content_scroll = self.content_scroll.saturating_add(amount);
        let max = self.rendered_lines.len().saturating_sub(1);
        if self.content_scroll > max {
            self.content_scroll = max;
        }
    }

    pub fn content_scroll_up(&mut self, amount: usize) {
        self.content_scroll = self.content_scroll.saturating_sub(amount);
    }

    /// Walk up from tree_selected to find the enclosing notebook ID (and optional folder ID)
    pub fn selected_context(&self) -> Option<(Uuid, Option<Uuid>)> {
        if self.tree_selected >= self.tree_items.len() {
            return None;
        }

        let mut notebook_id = None;
        let mut folder_id = None;

        // Walk backwards from selected item to find context
        for i in (0..=self.tree_selected).rev() {
            let item = &self.tree_items[i];
            match &item.kind {
                TreeItemKind::Folder { id, notebook_id: nb_id } if folder_id.is_none() && item.depth <= self.tree_items[self.tree_selected].depth => {
                    folder_id = Some(*id);
                    notebook_id = Some(*nb_id);
                }
                TreeItemKind::Notebook { id } => {
                    notebook_id = Some(*id);
                    break;
                }
                TreeItemKind::Section { notebook_id: nb_id, .. } if notebook_id.is_none() => {
                    notebook_id = Some(*nb_id);
                    break;
                }
                TreeItemKind::Page { notebook_id: nb_id, .. } if notebook_id.is_none() => {
                    notebook_id = Some(*nb_id);
                }
                _ => {}
            }
        }

        notebook_id.map(|nb_id| (nb_id, folder_id))
    }

    /// Create a note from the input text, using selected tree context
    pub fn create_note_from_input(&mut self) {
        let title = self.input_text.trim().to_string();
        if title.is_empty() {
            return;
        }

        let context = self.selected_context();
        let (notebook_id, folder_id) = match context {
            Some(ctx) => ctx,
            None => {
                self.flash_message = Some("No notebook selected".to_string());
                return;
            }
        };

        match self.app.create_page(notebook_id, title.clone()) {
            Ok(mut page) => {
                if let Some(fid) = folder_id {
                    page.folder_id = Some(fid);
                    let _ = self.app.update_page(&page);
                }

                self.flash_message = Some(format!("Created \"{}\"", title));

                // Rebuild tree and try to select the new page
                let _ = self.rebuild_tree();
            }
            Err(e) => {
                self.flash_message = Some(format!("Error: {}", e));
            }
        }

        self.input_text.clear();
        self.mode = Mode::Tree;
    }

    /// Capture an inbox item from the input text
    pub fn capture_inbox_from_input(&mut self) {
        let title = self.input_text.trim().to_string();
        if title.is_empty() {
            return;
        }

        match self.app.capture_inbox(title.clone(), String::new(), None) {
            Ok(_) => {
                self.flash_message = Some(format!("Captured to inbox: \"{}\"", title));
            }
            Err(e) => {
                self.flash_message = Some(format!("Error: {}", e));
            }
        }

        self.input_text.clear();
        self.mode = Mode::Tree;
    }

    pub fn collapse_or_parent(&mut self) {
        if self.tree_selected >= self.tree_items.len() {
            return;
        }

        let item = &self.tree_items[self.tree_selected];
        if item.expanded {
            self.collapse_at(self.tree_selected);
        } else if item.depth > 0 {
            // Go to parent
            let target_depth = item.depth - 1;
            for i in (0..self.tree_selected).rev() {
                if self.tree_items[i].depth == target_depth {
                    self.tree_selected = i;
                    break;
                }
            }
        }
    }
}
