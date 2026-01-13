use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::{Local, Utc};
use uuid::Uuid;

use crate::actions::models::*;
use crate::actions::storage::ActionStorage;
use crate::actions::variables::VariableResolver;
use crate::storage::{FileStorage, NotebookType, StorageError};

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
    variable_resolver: VariableResolver,
}

impl ActionExecutor {
    pub fn new(
        storage: Arc<Mutex<FileStorage>>,
        action_storage: Arc<Mutex<ActionStorage>>,
    ) -> Self {
        Self {
            storage,
            action_storage,
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
            } => {
                self.execute_carry_forward(
                    source_selector,
                    destination,
                    title_template,
                    template_id.as_ref(),
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
                // AI summarization would need Python bridge
                // For now, just a placeholder
                log::info!("AiSummarize: selector={:?}, output={:?}", selector, output_target);
                Ok(())
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
        _template_id: Option<&String>,
        context: &mut ExecutionContext,
    ) -> Result<(), ExecutionError> {
        // Find source pages
        let source_pages = self.find_pages(source_selector, context)?;
        if source_pages.is_empty() {
            return Ok(()); // Nothing to carry forward
        }

        // Extract incomplete checklist items from source pages
        let mut incomplete_items: Vec<String> = Vec::new();
        for page in &source_pages {
            for block in &page.content.blocks {
                if block.block_type == "checklist" {
                    if let Some(items) = block.data.get("items") {
                        if let Some(items_array) = items.as_array() {
                            for item in items_array {
                                if let Some(checked) = item.get("checked") {
                                    if !checked.as_bool().unwrap_or(true) {
                                        if let Some(text) = item.get("text") {
                                            if let Some(text_str) = text.as_str() {
                                                incomplete_items.push(text_str.to_string());
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

        if incomplete_items.is_empty() {
            return Ok(()); // No incomplete items
        }

        // Create destination page
        let notebook_id = self.resolve_notebook_target(destination, context)?;
        let storage = self.storage.lock().map_err(|e| {
            ExecutionError::StepFailed(format!(
                "Failed to lock storage: {}",
                e
            ))
        })?;

        let title = self.variable_resolver.substitute(title_template, &context.variables);
        let page = storage.create_page(notebook_id, title)?;
        context.created_pages.push(page.id.to_string());

        // Note: The actual content with incomplete items would be set by frontend
        // since EditorJS content format is complex. We just create the page here.

        Ok(())
    }

    /// Find pages matching a selector
    fn find_pages(
        &self,
        selector: &PageSelector,
        context: &ExecutionContext,
    ) -> Result<Vec<crate::storage::Page>, ExecutionError> {
        let storage = self.storage.lock().map_err(|e| {
            ExecutionError::StepFailed(format!(
                "Failed to lock storage: {}",
                e
            ))
        })?;

        // Determine notebook to search
        let notebook_id = if let Some(target) = &selector.notebook {
            Some(self.resolve_notebook_target(target, context)?)
        } else {
            context.current_notebook_id
        };

        let notebook_id = notebook_id.ok_or_else(|| {
            ExecutionError::InvalidConfig("No notebook specified for page selector".to_string())
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

                // Date filters
                if let Some(days) = selector.created_within_days {
                    let cutoff = now - chrono::Duration::days(days as i64);
                    if p.created_at < cutoff.with_timezone(&Utc) {
                        return false;
                    }
                }
                if let Some(days) = selector.updated_within_days {
                    let cutoff = now - chrono::Duration::days(days as i64);
                    if p.updated_at < cutoff.with_timezone(&Utc) {
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
