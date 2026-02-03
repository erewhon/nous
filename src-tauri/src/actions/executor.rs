use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::{Local, Utc};
use uuid::Uuid;

use crate::actions::models::*;
use crate::actions::storage::ActionStorage;
use crate::actions::variables::VariableResolver;
use crate::python_bridge::{AIConfig, PageSummaryInput, PythonAI};
use crate::storage::{EditorBlock, EditorData, FileStorage, NotebookType, StorageError};

/// Represents a checklist item that was carried forward with source tracking
#[derive(Debug, Clone)]
struct CarriedItem {
    text: String,
    source_page_id: Uuid,
    block_index: usize,
    item_index: usize,
}

/// Error type for action execution
#[derive(Debug, thiserror::Error)]
pub enum ExecutionError {
    #[error("Storage error: {0}")]
    Storage(#[from] StorageError),

    #[error("Action not found: {0}")]
    ActionNotFound(String),

    #[error("Template not found: {0}")]
    TemplateNotFound(String),

    #[error("Notebook not found: {0}")]
    NotebookNotFound(String),

    #[error("Page not found: {0}")]
    PageNotFound(String),

    #[error("Step execution failed: {0}")]
    StepFailed(String),

    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),

    #[error("Action is disabled")]
    ActionDisabled,
}

/// Context for action execution
pub struct ExecutionContext {
    /// Variable values for substitution
    pub variables: HashMap<String, String>,
    /// Current notebook ID (if applicable)
    pub current_notebook_id: Option<Uuid>,
    /// Created pages during execution
    pub created_pages: Vec<String>,
    /// Created notebooks during execution
    pub created_notebooks: Vec<String>,
    /// Modified pages during execution
    pub modified_pages: Vec<String>,
    /// Errors encountered
    pub errors: Vec<String>,
    /// AI configuration for AI-powered steps
    pub ai_config: Option<AIConfig>,
}

impl ExecutionContext {
    pub fn new() -> Self {
        Self {
            variables: HashMap::new(),
            current_notebook_id: None,
            created_pages: Vec::new(),
            created_notebooks: Vec::new(),
            modified_pages: Vec::new(),
            errors: Vec::new(),
            ai_config: None,
        }
    }

    pub fn with_notebook(mut self, notebook_id: Uuid) -> Self {
        self.current_notebook_id = Some(notebook_id);
        self
    }

    pub fn with_variables(mut self, variables: HashMap<String, String>) -> Self {
        self.variables = variables;
        self
    }

    pub fn with_ai_config(mut self, config: AIConfig) -> Self {
        self.ai_config = Some(config);
        self
    }
}

impl Default for ExecutionContext {
    fn default() -> Self {
        Self::new()
    }
}

/// Action executor
pub struct ActionExecutor {
    storage: Arc<Mutex<FileStorage>>,
    action_storage: Arc<Mutex<ActionStorage>>,
    python_ai: Arc<Mutex<PythonAI>>,
    variable_resolver: VariableResolver,
}

impl ActionExecutor {
    pub fn new(
        storage: Arc<Mutex<FileStorage>>,
        action_storage: Arc<Mutex<ActionStorage>>,
        python_ai: Arc<Mutex<PythonAI>>,
    ) -> Self {
        Self {
            storage,
            action_storage,
            python_ai,
            variable_resolver: VariableResolver::new(),
        }
    }

    /// Execute an action by ID
    pub fn execute_action(
        &self,
        action_id: Uuid,
        variable_overrides: Option<HashMap<String, String>>,
        current_notebook_id: Option<Uuid>,
    ) -> Result<ActionExecutionResult, ExecutionError> {
        // Load action
        let action = {
            let action_storage = self.action_storage.lock().map_err(|e| {
                ExecutionError::StepFailed(format!(
                    "Failed to lock action storage: {}",
                    e
                ))
            })?;
            action_storage.get_action(action_id)?
        };

        // Check if enabled
        if !action.enabled {
            return Err(ExecutionError::ActionDisabled);
        }

        // Build execution context
        let mut context = ExecutionContext::new();
        if let Some(notebook_id) = current_notebook_id {
            context = context.with_notebook(notebook_id);
        }

        // Build variable context
        let mut variables = self.variable_resolver.build_context(&action.variables);
        if let Some(overrides) = variable_overrides {
            for (k, v) in overrides {
                variables.insert(k, v);
            }
        }
        context = context.with_variables(variables);

        // Create result
        let mut result = ActionExecutionResult::new(action.id, action.name.clone(), action.steps.len());

        // Execute steps
        for step in &action.steps {
            match self.execute_step(step, &mut context) {
                Ok(_) => {
                    result.steps_completed += 1;
                }
                Err(e) => {
                    let error_msg = format!("Step {} failed: {}", result.steps_completed + 1, e);
                    context.errors.push(error_msg.clone());
                    result.errors.push(error_msg);
                    // Continue to next step on error (could be configurable)
                }
            }
        }

        // Complete result
        result.created_pages = context.created_pages;
        result.created_notebooks = context.created_notebooks;
        result.modified_pages = context.modified_pages;
        result.errors = context.errors;
        result.complete(result.errors.is_empty());

        log::info!(
            "Action '{}' completed: {}/{} steps, {} modified, {} created, {} errors: {:?}",
            action.name,
            result.steps_completed,
            result.steps_total,
            result.modified_pages.len(),
            result.created_pages.len(),
            result.errors.len(),
            result.errors,
        );

        // Update last run time
        if let Ok(mut action_storage) = self.action_storage.lock() {
            let _ = action_storage.update_last_run(action_id);
        }

        Ok(result)
    }

    /// Execute a single step
    fn execute_step(
        &self,
        step: &ActionStep,
        context: &mut ExecutionContext,
    ) -> Result<(), ExecutionError> {
        match step {
            ActionStep::CreatePageFromTemplate {
                template_id,
                notebook_target,
                title_template,
                folder_name,
                tags,
            } => {
                self.execute_create_page_from_template(
                    template_id,
                    notebook_target,
                    title_template,
                    folder_name.as_ref(),
                    tags,
                    context,
                )
            }

            ActionStep::CreateNotebook { name, notebook_type } => {
                self.execute_create_notebook(name, notebook_type.as_ref(), context)
            }

            ActionStep::CreateFolder {
                notebook_target,
                name,
                parent_folder_name,
            } => {
                self.execute_create_folder(notebook_target, name, parent_folder_name.as_ref(), context)
            }

            ActionStep::MovePages { source, destination } => {
                self.execute_move_pages(source, destination, context)
            }

            ActionStep::ArchivePages { selector } => {
                self.execute_archive_pages(selector, context)
            }

            ActionStep::ManageTags {
                selector,
                add_tags,
                remove_tags,
            } => {
                self.execute_manage_tags(selector, add_tags, remove_tags, context)
            }

            ActionStep::CarryForwardItems {
                source_selector,
                destination,
                title_template,
                template_id,
                find_existing,
                insert_after_section,
            } => {
                self.execute_carry_forward(
                    source_selector,
                    destination,
                    title_template,
                    template_id.as_ref(),
                    find_existing.as_ref(),
                    insert_after_section.as_ref(),
                    context,
                )
            }

            ActionStep::Delay { seconds } => {
                std::thread::sleep(std::time::Duration::from_secs(*seconds));
                Ok(())
            }

            ActionStep::SetVariable { name, value } => {
                let resolved_value = self.variable_resolver.substitute(value, &context.variables);
                context.variables.insert(name.clone(), resolved_value);
                Ok(())
            }

            ActionStep::Conditional {
                condition,
                then_steps,
                else_steps,
            } => {
                let condition_met = self.evaluate_condition(condition, context)?;
                let steps_to_run = if condition_met { then_steps } else { else_steps };
                for step in steps_to_run {
                    self.execute_step(step, context)?;
                }
                Ok(())
            }

            ActionStep::SearchAndProcess { query, process_steps, limit } => {
                // This would search and apply steps to matching pages
                // For now, just a placeholder
                log::info!("SearchAndProcess: query={}, limit={:?}", query, limit);
                Ok(())
            }

            ActionStep::AiSummarize { selector, output_target, custom_prompt } => {
                self.execute_ai_summarize(selector, output_target, custom_prompt.as_ref(), context)
            }
        }
    }

    /// Resolve notebook target to notebook ID
    fn resolve_notebook_target(
        &self,
        target: &NotebookTarget,
        context: &ExecutionContext,
    ) -> Result<Uuid, ExecutionError> {
        let storage = self.storage.lock().map_err(|e| {
            ExecutionError::StepFailed(format!(
                "Failed to lock storage: {}",
                e
            ))
        })?;

        match target {
            NotebookTarget::Current => {
                context.current_notebook_id.ok_or_else(|| {
                    ExecutionError::InvalidConfig("No current notebook set".to_string())
                })
            }
            NotebookTarget::ById { id } => {
                let uuid = Uuid::parse_str(id).map_err(|_| {
                    ExecutionError::NotebookNotFound(format!("Invalid notebook ID: {}", id))
                })?;
                // Verify notebook exists
                storage.get_notebook(uuid)?;
                Ok(uuid)
            }
            NotebookTarget::ByName { name } => {
                // Try to find by name
                let notebooks = storage.list_notebooks()?;
                if let Some(nb) = notebooks.iter().find(|n| n.name.eq_ignore_ascii_case(name)) {
                    return Ok(nb.id);
                }
                // Create if not exists
                let notebook = storage.create_notebook(name.clone(), NotebookType::default())?;
                Ok(notebook.id)
            }
        }
    }

    /// Execute create page from template step
    fn execute_create_page_from_template(
        &self,
        _template_id: &str,
        notebook_target: &NotebookTarget,
        title_template: &str,
        _folder_name: Option<&String>,
        tags: &[String],
        context: &mut ExecutionContext,
    ) -> Result<(), ExecutionError> {
        let notebook_id = self.resolve_notebook_target(notebook_target, context)?;

        let storage = self.storage.lock().map_err(|e| {
            ExecutionError::StepFailed(format!(
                "Failed to lock storage: {}",
                e
            ))
        })?;

        // Resolve title
        let title = self.variable_resolver.substitute(title_template, &context.variables);

        // Create page
        let page = storage.create_page(notebook_id, title)?;
        context.created_pages.push(page.id.to_string());

        // Apply tags if any
        if !tags.is_empty() {
            let mut updated_page = page.clone();
            updated_page.tags = tags.to_vec();
            storage.update_page(&updated_page)?;
        }

        // Note: Template content application would be handled by frontend
        // since templates are stored in the frontend templateStore.
        // The backend creates the page and the frontend will fill in content.

        Ok(())
    }

    /// Execute create notebook step
    fn execute_create_notebook(
        &self,
        name: &str,
        _notebook_type: Option<&String>,
        context: &mut ExecutionContext,
    ) -> Result<(), ExecutionError> {
        let storage = self.storage.lock().map_err(|e| {
            ExecutionError::StepFailed(format!(
                "Failed to lock storage: {}",
                e
            ))
        })?;

        let resolved_name = self.variable_resolver.substitute(name, &context.variables);
        let notebook = storage.create_notebook(resolved_name, NotebookType::default())?;
        context.created_notebooks.push(notebook.id.to_string());

        Ok(())
    }

    /// Execute create folder step
    fn execute_create_folder(
        &self,
        notebook_target: &NotebookTarget,
        name: &str,
        _parent_folder_name: Option<&String>,
        context: &mut ExecutionContext,
    ) -> Result<(), ExecutionError> {
        let notebook_id = self.resolve_notebook_target(notebook_target, context)?;

        let storage = self.storage.lock().map_err(|e| {
            ExecutionError::StepFailed(format!(
                "Failed to lock storage: {}",
                e
            ))
        })?;

        let resolved_name = self.variable_resolver.substitute(name, &context.variables);
        storage.create_folder(notebook_id, resolved_name, None)?;

        Ok(())
    }

    /// Execute move pages step
    fn execute_move_pages(
        &self,
        selector: &PageSelector,
        destination: &PageDestination,
        context: &mut ExecutionContext,
    ) -> Result<(), ExecutionError> {
        let pages = self.find_pages(selector, context)?;
        let dest_notebook_id = self.resolve_notebook_target(&destination.notebook, context)?;

        let storage = self.storage.lock().map_err(|e| {
            ExecutionError::StepFailed(format!(
                "Failed to lock storage: {}",
                e
            ))
        })?;

        // Find destination folder if specified
        let folder_id = if let Some(folder_name) = &destination.folder_name {
            let folders = storage.list_folders(dest_notebook_id)?;
            folders.iter().find(|f| f.name == *folder_name).map(|f| f.id)
        } else {
            None
        };

        for page in pages {
            storage.move_page_to_folder(dest_notebook_id, page.id, folder_id, None)?;
            context.modified_pages.push(page.id.to_string());
        }

        Ok(())
    }

    /// Execute archive pages step
    fn execute_archive_pages(
        &self,
        selector: &PageSelector,
        context: &mut ExecutionContext,
    ) -> Result<(), ExecutionError> {
        let pages = self.find_pages(selector, context)?;

        for page in pages {
            let storage = self.storage.lock().map_err(|e| {
                ExecutionError::StepFailed(format!(
                    "Failed to lock storage: {}",
                    e
                ))
            })?;

            storage.archive_page(page.notebook_id, page.id)?;
            context.modified_pages.push(page.id.to_string());
        }

        Ok(())
    }

    /// Execute manage tags step
    fn execute_manage_tags(
        &self,
        selector: &PageSelector,
        add_tags: &[String],
        remove_tags: &[String],
        context: &mut ExecutionContext,
    ) -> Result<(), ExecutionError> {
        let pages = self.find_pages(selector, context)?;

        let storage = self.storage.lock().map_err(|e| {
            ExecutionError::StepFailed(format!(
                "Failed to lock storage: {}",
                e
            ))
        })?;

        for mut page in pages {
            // Remove tags
            page.tags.retain(|t| !remove_tags.contains(t));

            // Add tags
            for tag in add_tags {
                if !page.tags.contains(tag) {
                    page.tags.push(tag.clone());
                }
            }

            storage.update_page(&page)?;
            context.modified_pages.push(page.id.to_string());
        }

        Ok(())
    }

    /// Execute carry forward items step
    fn execute_carry_forward(
        &self,
        source_selector: &PageSelector,
        destination: &NotebookTarget,
        title_template: &str,
        template_id: Option<&String>,
        find_existing: Option<&PageSelector>,
        insert_after_section: Option<&String>,
        context: &mut ExecutionContext,
    ) -> Result<(), ExecutionError> {
        log::info!("CarryForward: Starting execution");

        // Find the destination page first (if it exists) so we can exclude it from sources
        let dest_page_id = if let Some(existing_selector) = find_existing {
            let mut pages = self.find_pages(existing_selector, context)?;
            log::info!(
                "CarryForward: find_existing matched {} pages: {:?}",
                pages.len(),
                pages.iter().map(|p| &p.title).collect::<Vec<_>>()
            );
            pages.sort_by(|a, b| b.created_at.cmp(&a.created_at));
            pages.first().map(|p| p.id)
        } else {
            log::info!("CarryForward: No find_existing selector provided");
            None
        };

        // Find source pages, excluding the destination page to avoid self-duplication
        let all_source_pages = self.find_pages(source_selector, context)?;
        log::info!(
            "CarryForward: source_selector matched {} pages: {:?}",
            all_source_pages.len(),
            all_source_pages.iter().map(|p| &p.title).collect::<Vec<_>>()
        );
        let source_pages: Vec<_> = all_source_pages
            .into_iter()
            .filter(|p| Some(p.id) != dest_page_id)
            .collect();
        log::info!(
            "CarryForward: After excluding destination, {} source pages remain",
            source_pages.len()
        );
        if source_pages.is_empty() {
            log::info!("CarryForward: No source pages found (excluding destination)");
            return Ok(()); // Nothing to carry forward
        }

        // Extract incomplete checklist items from source pages with source tracking
        let mut items_with_source: Vec<CarriedItem> = Vec::new();
        for page in &source_pages {
            // Also specifically extract unchecked items from under a "Carried Forward"
            // heading, so tasks that were already carried forward but still incomplete
            // are re-carried. We walk all blocks; items under a "Carried Forward"
            // heading are picked up alongside items from other sections.
            let mut in_carried_forward_section = false;
            for (block_idx, block) in page.content.blocks.iter().enumerate() {
                // Track whether we're inside a "Carried Forward" section
                if block.block_type == "header" {
                    if let Some(text) = block.data.get("text").and_then(|t| t.as_str()) {
                        in_carried_forward_section =
                            text.to_lowercase().contains("carried forward");
                    } else {
                        in_carried_forward_section = false;
                    }
                }

                if block.block_type == "checklist" {
                    if let Some(items) = block.data.get("items") {
                        if let Some(items_array) = items.as_array() {
                            for (item_idx, item) in items_array.iter().enumerate() {
                                if let Some(checked) = item.get("checked") {
                                    if !checked.as_bool().unwrap_or(true) {
                                        if let Some(text) = item.get("text") {
                                            if let Some(text_str) = text.as_str() {
                                                if !text_str.trim().is_empty() {
                                                    items_with_source.push(CarriedItem {
                                                        text: text_str.to_string(),
                                                        source_page_id: page.id,
                                                        block_index: block_idx,
                                                        item_index: item_idx,
                                                    });
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if in_carried_forward_section {
                log::debug!(
                    "CarryForward: Found 'Carried Forward' section on source page '{}'",
                    page.title
                );
            }
        }

        // Extract just the text for the incomplete_items list (for deduplication and building blocks)
        let mut incomplete_items: Vec<String> = items_with_source.iter().map(|i| i.text.clone()).collect();
        log::info!(
            "CarryForward: Extracted {} incomplete items from source pages",
            incomplete_items.len()
        );

        let notebook_id = self.resolve_notebook_target(destination, context)?;

        // Reuse the destination page we already found (or None if find_existing wasn't set)
        let existing_page = if let Some(page_id) = dest_page_id {
            let storage = self.storage.lock().map_err(|e| {
                ExecutionError::StepFailed(format!("Failed to lock storage: {}", e))
            })?;
            storage.get_page(notebook_id, page_id).ok()
        } else {
            None
        };

        // If the destination page already has a "Carried Forward" section with
        // still-unchecked items, merge those into the list so they aren't lost.
        // This handles re-runs on the same day and ensures previously-carried
        // items that remain incomplete continue to appear.
        if let Some(ref dest) = existing_page {
            let existing_cf_items = extract_carried_forward_items(&dest.content.blocks);
            if !existing_cf_items.is_empty() {
                log::info!(
                    "CarryForward: Found {} existing unchecked items in destination page '{}'",
                    existing_cf_items.len(),
                    dest.title
                );
                for item in existing_cf_items {
                    if !incomplete_items.contains(&item) {
                        incomplete_items.push(item);
                    }
                }
            }
        }

        if incomplete_items.is_empty() {
            return Ok(()); // No incomplete items
        }

        // Deduplicate while preserving order
        let mut seen = std::collections::HashSet::new();
        incomplete_items.retain(|item| seen.insert(item.clone()));

        let carry_forward_blocks = build_carry_forward_blocks(&incomplete_items);

        if let Some(mut existing) = existing_page {
            // Remove any pre-existing "Carried Forward" section to avoid duplicates
            existing.content.blocks = remove_carried_forward_section(existing.content.blocks);

            // Insert at the right position
            let insert_pos = if let Some(section_name) = insert_after_section {
                find_section_end(&existing.content.blocks, section_name)
            } else {
                existing.content.blocks.len()
            };

            let mut new_blocks = existing.content.blocks.clone();
            for (i, block) in carry_forward_blocks.into_iter().enumerate() {
                new_blocks.insert(insert_pos + i, block);
            }
            existing.content.blocks = new_blocks;
            existing.content.time = Some(chrono::Utc::now().timestamp_millis());

            let storage = self.storage.lock().map_err(|e| {
                ExecutionError::StepFailed(format!("Failed to lock storage: {}", e))
            })?;
            storage.update_page(&existing)?;
            context.modified_pages.push(existing.id.to_string());

            log::info!(
                "CarryForward: Inserted {} items into existing page '{}'",
                incomplete_items.len(),
                existing.title
            );
        } else {
            // Create new destination page
            let storage = self.storage.lock().map_err(|e| {
                ExecutionError::StepFailed(format!("Failed to lock storage: {}", e))
            })?;

            let title = self
                .variable_resolver
                .substitute(title_template, &context.variables);
            let mut page = storage.create_page(notebook_id, title)?;

            // Set template_id if provided
            if let Some(tpl_id) = template_id {
                page.template_id = Some(tpl_id.clone());
            }

            // Set content with carried forward blocks
            page.content.blocks = carry_forward_blocks;
            page.content.time = Some(chrono::Utc::now().timestamp_millis());
            storage.update_page(&page)?;

            context.created_pages.push(page.id.to_string());

            log::info!(
                "CarryForward: Created new page '{}' with {} items",
                page.title,
                incomplete_items.len()
            );
        }

        // Now update source pages to mark carried items as done with "(carried forward)" suffix
        // Group items by source page for efficient updates
        let mut items_by_page: HashMap<Uuid, Vec<&CarriedItem>> = HashMap::new();
        for item in &items_with_source {
            items_by_page
                .entry(item.source_page_id)
                .or_default()
                .push(item);
        }

        for source_page in &source_pages {
            if let Some(items_to_mark) = items_by_page.get(&source_page.id) {
                if items_to_mark.is_empty() {
                    continue;
                }

                let storage = self.storage.lock().map_err(|e| {
                    ExecutionError::StepFailed(format!("Failed to lock storage: {}", e))
                })?;

                let mut updated_page = source_page.clone();
                let mut marked_count = 0;

                for item in items_to_mark {
                    // Validate indices are still valid (content may have shifted)
                    if item.block_index >= updated_page.content.blocks.len() {
                        continue;
                    }

                    let block = &mut updated_page.content.blocks[item.block_index];
                    if block.block_type != "checklist" {
                        continue;
                    }

                    if let Some(items_val) = block.data.get_mut("items") {
                        if let Some(items_array) = items_val.as_array_mut() {
                            if item.item_index >= items_array.len() {
                                continue;
                            }

                            let checklist_item = &mut items_array[item.item_index];

                            // Verify the text still matches (defensive against content changes)
                            let current_text = checklist_item
                                .get("text")
                                .and_then(|t| t.as_str())
                                .unwrap_or("");
                            if current_text != item.text {
                                continue;
                            }

                            // Skip if already marked as carried forward
                            if current_text.ends_with("(carried forward)") {
                                continue;
                            }

                            // Mark as checked and append suffix
                            if let Some(obj) = checklist_item.as_object_mut() {
                                obj.insert("checked".to_string(), serde_json::Value::Bool(true));
                                let new_text = format!("{} (carried forward)", item.text);
                                obj.insert("text".to_string(), serde_json::Value::String(new_text));
                                marked_count += 1;
                            }
                        }
                    }
                }

                if marked_count > 0 {
                    updated_page.content.time = Some(chrono::Utc::now().timestamp_millis());
                    storage.update_page(&updated_page)?;
                    context.modified_pages.push(updated_page.id.to_string());

                    log::info!(
                        "CarryForward: Marked {} items as carried forward on source page '{}'",
                        marked_count,
                        updated_page.title
                    );
                }
            }
        }

        Ok(())
    }

    /// Execute AI summarization step
    fn execute_ai_summarize(
        &self,
        selector: &PageSelector,
        output_target: &SummaryOutput,
        custom_prompt: Option<&String>,
        context: &mut ExecutionContext,
    ) -> Result<(), ExecutionError> {
        // Find pages to summarize
        let pages = self.find_pages(selector, context)?;
        if pages.is_empty() {
            log::info!("AiSummarize: No pages found matching selector");
            return Ok(());
        }

        // Get AI config from context or use default
        let ai_config = context.ai_config.clone().unwrap_or_default();

        // Convert pages to PageSummaryInput
        let page_inputs: Vec<PageSummaryInput> = pages
            .iter()
            .map(|p| {
                // Extract text content from EditorJS blocks
                let content = p.content.blocks.iter()
                    .filter_map(|block| {
                        match block.block_type.as_str() {
                            "paragraph" | "header" | "quote" => {
                                block.data.get("text").and_then(|t| t.as_str()).map(String::from)
                            }
                            "list" | "checklist" => {
                                block.data.get("items").and_then(|items| {
                                    items.as_array().map(|arr| {
                                        arr.iter()
                                            .filter_map(|item| {
                                                if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                                    Some(format!("- {}", text))
                                                } else if let Some(text) = item.as_str() {
                                                    Some(format!("- {}", text))
                                                } else {
                                                    None
                                                }
                                            })
                                            .collect::<Vec<_>>()
                                            .join("\n")
                                    })
                                })
                            }
                            _ => None,
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n\n");

                PageSummaryInput {
                    title: p.title.clone(),
                    content,
                    tags: p.tags.clone(),
                }
            })
            .collect();

        // Call Python AI for summarization
        let python_ai = self.python_ai.lock().map_err(|e| {
            ExecutionError::StepFailed(format!("Failed to lock Python AI: {}", e))
        })?;

        let summary_result = python_ai
            .summarize_pages(
                page_inputs,
                custom_prompt.cloned(),
                Some("concise".to_string()),
                ai_config,
            )
            .map_err(|e| ExecutionError::StepFailed(format!("AI summarization failed: {}", e)))?;

        // Handle output based on target
        match output_target {
            SummaryOutput::NewPage { notebook_target, title_template } => {
                let notebook_id = self.resolve_notebook_target(notebook_target, context)?;
                let storage = self.storage.lock().map_err(|e| {
                    ExecutionError::StepFailed(format!("Failed to lock storage: {}", e))
                })?;

                // Resolve title template
                let title = self.variable_resolver.substitute(title_template, &context.variables);

                // Create page with summary content
                let page = storage.create_page(notebook_id, title)?;
                context.created_pages.push(page.id.to_string());

                // Build EditorJS content with summary
                let mut blocks = vec![
                    serde_json::json!({
                        "type": "paragraph",
                        "data": { "text": summary_result.summary }
                    }),
                ];

                // Add key points as a list
                if !summary_result.key_points.is_empty() {
                    blocks.push(serde_json::json!({
                        "type": "header",
                        "data": { "text": "Key Points", "level": 2 }
                    }));
                    blocks.push(serde_json::json!({
                        "type": "list",
                        "data": {
                            "style": "unordered",
                            "items": summary_result.key_points
                        }
                    }));
                }

                // Add action items as a checklist
                if !summary_result.action_items.is_empty() {
                    blocks.push(serde_json::json!({
                        "type": "header",
                        "data": { "text": "Action Items", "level": 2 }
                    }));
                    let checklist_items: Vec<_> = summary_result.action_items
                        .iter()
                        .map(|item| serde_json::json!({ "text": item, "checked": false }))
                        .collect();
                    blocks.push(serde_json::json!({
                        "type": "checklist",
                        "data": { "items": checklist_items }
                    }));
                }

                // Add themes as tags info
                if !summary_result.themes.is_empty() {
                    blocks.push(serde_json::json!({
                        "type": "header",
                        "data": { "text": "Themes", "level": 2 }
                    }));
                    blocks.push(serde_json::json!({
                        "type": "paragraph",
                        "data": { "text": summary_result.themes.join(", ") }
                    }));
                }

                // Update page with content
                let mut updated_page = page.clone();
                updated_page.content = EditorData {
                    time: Some(chrono::Utc::now().timestamp_millis()),
                    blocks: blocks.iter().map(|b| {
                        serde_json::from_value(b.clone()).unwrap_or_else(|_| {
                            EditorBlock {
                                id: uuid::Uuid::new_v4().to_string(),
                                block_type: "paragraph".to_string(),
                                data: serde_json::json!({}),
                            }
                        })
                    }).collect(),
                    version: Some("2.30.0".to_string()),
                };
                updated_page.tags = summary_result.themes.clone();
                storage.update_page(&updated_page)?;

                log::info!(
                    "AiSummarize: Created summary page '{}' from {} pages",
                    updated_page.title,
                    summary_result.pages_count
                );
            }

            SummaryOutput::PrependToPage { page_selector } => {
                // Find target page and prepend summary
                let target_pages = self.find_pages(page_selector, context)?;
                if let Some(target_page) = target_pages.first() {
                    let storage = self.storage.lock().map_err(|e| {
                        ExecutionError::StepFailed(format!("Failed to lock storage: {}", e))
                    })?;

                    let mut updated_page = target_page.clone();

                    // Create summary block
                    let summary_block = EditorBlock {
                        id: uuid::Uuid::new_v4().to_string(),
                        block_type: "paragraph".to_string(),
                        data: serde_json::json!({ "text": format!("**Summary:** {}", summary_result.summary) }),
                    };

                    // Prepend to existing blocks
                    let mut new_blocks = vec![summary_block];
                    new_blocks.extend(updated_page.content.blocks.clone());
                    updated_page.content.blocks = new_blocks;

                    storage.update_page(&updated_page)?;
                    context.modified_pages.push(updated_page.id.to_string());

                    log::info!("AiSummarize: Prepended summary to page '{}'", updated_page.title);
                }
            }

            SummaryOutput::Result => {
                // Store result in context variable for chaining
                context.variables.insert("_summary".to_string(), summary_result.summary.clone());
                context.variables.insert(
                    "_key_points".to_string(),
                    summary_result.key_points.join("\n"),
                );
                context.variables.insert(
                    "_action_items".to_string(),
                    summary_result.action_items.join("\n"),
                );
                context.variables.insert(
                    "_themes".to_string(),
                    summary_result.themes.join(", "),
                );

                log::info!("AiSummarize: Stored summary result in context variables");
            }
        }

        Ok(())
    }

    /// Find pages matching a selector
    fn find_pages(
        &self,
        selector: &PageSelector,
        context: &ExecutionContext,
    ) -> Result<Vec<crate::storage::Page>, ExecutionError> {
        // Resolve notebook target BEFORE acquiring storage lock to avoid deadlock
        // (resolve_notebook_target also acquires the storage lock)
        let notebook_id = if let Some(target) = &selector.notebook {
            Some(self.resolve_notebook_target(target, context)?)
        } else {
            context.current_notebook_id
        };

        let notebook_id = notebook_id.ok_or_else(|| {
            ExecutionError::InvalidConfig("No notebook specified for page selector".to_string())
        })?;

        let storage = self.storage.lock().map_err(|e| {
            ExecutionError::StepFailed(format!(
                "Failed to lock storage: {}",
                e
            ))
        })?;

        // Get pages
        let pages = storage.list_pages(notebook_id)?;

        // Apply filters
        let now = Local::now();
        let filtered: Vec<_> = pages
            .into_iter()
            .filter(|p| {
                // Title pattern
                if let Some(pattern) = &selector.title_pattern {
                    let pattern_lower = pattern.to_lowercase();
                    if pattern.contains('*') {
                        // Simple wildcard matching
                        let parts: Vec<&str> = pattern_lower.split('*').collect();
                        let title_lower = p.title.to_lowercase();
                        let mut pos = 0;
                        for part in parts {
                            if part.is_empty() {
                                continue;
                            }
                            if let Some(found) = title_lower[pos..].find(part) {
                                pos += found + part.len();
                            } else {
                                return false;
                            }
                        }
                    } else if !p.title.to_lowercase().contains(&pattern_lower) {
                        return false;
                    }
                }

                // Tags filter
                if !selector.with_tags.is_empty() {
                    if !selector.with_tags.iter().all(|t| p.tags.contains(t)) {
                        return false;
                    }
                }
                if !selector.without_tags.is_empty() {
                    if selector.without_tags.iter().any(|t| p.tags.contains(t)) {
                        return false;
                    }
                }

                // Date filters (use start-of-day so 0 = today, 1 = since yesterday, etc.)
                if let Some(days) = selector.created_within_days {
                    let cutoff = (now - chrono::Duration::days(days as i64))
                        .date_naive()
                        .and_hms_opt(0, 0, 0)
                        .unwrap()
                        .and_utc();
                    if p.created_at < cutoff {
                        return false;
                    }
                }
                if let Some(days) = selector.updated_within_days {
                    let cutoff = (now - chrono::Duration::days(days as i64))
                        .date_naive()
                        .and_hms_opt(0, 0, 0)
                        .unwrap()
                        .and_utc();
                    if p.updated_at < cutoff {
                        return false;
                    }
                }

                // Template filter
                if let Some(template) = &selector.from_template {
                    if p.template_id.as_deref() != Some(template.as_str()) {
                        return false;
                    }
                }

                // Folder filter
                if let Some(folder_name) = &selector.in_folder {
                    if let Some(folder_id) = p.folder_id {
                        // Would need to look up folder name
                        // For now, skip this filter
                        let _ = folder_name;
                        let _ = folder_id;
                    } else {
                        return false;
                    }
                }

                true
            })
            .collect();

        Ok(filtered)
    }

    /// Evaluate a step condition
    fn evaluate_condition(
        &self,
        condition: &StepCondition,
        context: &ExecutionContext,
    ) -> Result<bool, ExecutionError> {
        match condition {
            StepCondition::PagesExist { selector } => {
                let pages = self.find_pages(selector, context)?;
                Ok(!pages.is_empty())
            }
            StepCondition::DayOfWeek { days } => {
                let today = Local::now().format("%A").to_string().to_lowercase();
                Ok(days.iter().any(|d| d.to_lowercase() == today))
            }
            StepCondition::VariableEquals { name, value } => {
                let actual = context.variables.get(name).cloned().unwrap_or_default();
                Ok(actual == *value)
            }
            StepCondition::VariableNotEmpty { name } => {
                let value = context.variables.get(name).cloned().unwrap_or_default();
                Ok(!value.is_empty())
            }
        }
    }
}

/// Build EditorJS blocks for carried-forward items
fn build_carry_forward_blocks(items: &[String]) -> Vec<EditorBlock> {
    let header = EditorBlock {
        id: Uuid::new_v4().to_string(),
        block_type: "header".to_string(),
        data: serde_json::json!({
            "text": "Carried Forward",
            "level": 2
        }),
    };

    let checklist_items: Vec<serde_json::Value> = items
        .iter()
        .map(|text| {
            serde_json::json!({
                "text": text,
                "checked": false
            })
        })
        .collect();

    let checklist = EditorBlock {
        id: Uuid::new_v4().to_string(),
        block_type: "checklist".to_string(),
        data: serde_json::json!({
            "items": checklist_items
        }),
    };

    vec![header, checklist]
}

/// Find the insertion position after a named section.
///
/// Searches for a header block whose text contains `section_name` (case-insensitive).
/// Returns the index just before the next same-or-higher-level header, or end of blocks.
fn find_section_end(blocks: &[EditorBlock], section_name: &str) -> usize {
    let section_lower = section_name.to_lowercase();

    // Find the header matching the section name
    let mut header_idx = None;
    let mut header_level = 0u64;
    for (i, block) in blocks.iter().enumerate() {
        if block.block_type == "header" {
            if let Some(text) = block.data.get("text").and_then(|t| t.as_str()) {
                if text.to_lowercase().contains(&section_lower) {
                    header_idx = Some(i);
                    header_level = block
                        .data
                        .get("level")
                        .and_then(|l| l.as_u64())
                        .unwrap_or(2);
                    break;
                }
            }
        }
    }

    let Some(start) = header_idx else {
        // Section not found — fall back to end
        return blocks.len();
    };

    // Walk forward to find the next header at the same or higher level
    for i in (start + 1)..blocks.len() {
        if blocks[i].block_type == "header" {
            let level = blocks[i]
                .data
                .get("level")
                .and_then(|l| l.as_u64())
                .unwrap_or(2);
            if level <= header_level {
                return i;
            }
        }
    }

    blocks.len()
}

/// Extract unchecked checklist items from under a "Carried Forward" heading.
///
/// Walks blocks, detects a header containing "Carried Forward" (case-insensitive),
/// and collects unchecked items from checklist blocks that follow it until the
/// next same-or-higher-level header.
fn extract_carried_forward_items(blocks: &[EditorBlock]) -> Vec<String> {
    let mut items = Vec::new();
    let mut in_section = false;
    let mut section_level = 0u64;

    for block in blocks {
        if block.block_type == "header" {
            let level = block
                .data
                .get("level")
                .and_then(|l| l.as_u64())
                .unwrap_or(2);
            if let Some(text) = block.data.get("text").and_then(|t| t.as_str()) {
                if text.to_lowercase().contains("carried forward") {
                    in_section = true;
                    section_level = level;
                    continue;
                }
            }
            // Another header at same or higher level ends the section
            if in_section && level <= section_level {
                break;
            }
        }

        if in_section && block.block_type == "checklist" {
            if let Some(items_val) = block.data.get("items").and_then(|v| v.as_array()) {
                for item in items_val {
                    let checked = item
                        .get("checked")
                        .and_then(|c| c.as_bool())
                        .unwrap_or(true);
                    if !checked {
                        if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                            if !text.trim().is_empty() {
                                items.push(text.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    items
}

/// Remove the "Carried Forward" section (header + following content blocks up to
/// the next same-or-higher-level header) from a list of blocks.
fn remove_carried_forward_section(blocks: Vec<EditorBlock>) -> Vec<EditorBlock> {
    let mut result = Vec::new();
    let mut skip = false;
    let mut section_level = 0u64;

    for block in blocks {
        if block.block_type == "header" {
            let level = block
                .data
                .get("level")
                .and_then(|l| l.as_u64())
                .unwrap_or(2);
            if let Some(text) = block.data.get("text").and_then(|t| t.as_str()) {
                if text.to_lowercase().contains("carried forward") {
                    skip = true;
                    section_level = level;
                    continue;
                }
            }
            // Another header at same or higher level ends the skip
            if skip && level <= section_level {
                skip = false;
            }
        }

        if !skip {
            result.push(block);
        }
    }

    result
}
