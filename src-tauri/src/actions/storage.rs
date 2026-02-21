use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

use crate::actions::builtin::get_builtin_actions;
use crate::actions::models::{Action, ActionUpdate};
use crate::storage::StorageError;

/// Version for built-in actions — bump this to force regeneration
const BUILTIN_ACTIONS_VERSION: u32 = 7;

/// Storage for custom actions
/// Actions are stored in ~/.local/share/nous/actions/
pub struct ActionStorage {
    base_path: PathBuf,
}

impl ActionStorage {
    pub fn new(base_path: PathBuf) -> Result<Self, StorageError> {
        let actions_path = base_path.join("actions");
        if !actions_path.exists() {
            fs::create_dir_all(&actions_path)?;
        }

        let storage = Self {
            base_path: actions_path,
        };

        // Initialize built-in actions if they don't exist
        storage.ensure_builtin_actions()?;

        Ok(storage)
    }

    /// Ensure all built-in actions exist in storage (regenerates when version bumps)
    fn ensure_builtin_actions(&self) -> Result<(), StorageError> {
        let version_path = self.base_path.join("builtin_version.txt");
        let current = fs::read_to_string(&version_path)
            .ok()
            .and_then(|v| v.trim().parse::<u32>().ok())
            .unwrap_or(0);
        let needs_regen = current < BUILTIN_ACTIONS_VERSION;

        for mut action in get_builtin_actions() {
            let path = self.action_path(action.id);
            if needs_regen || !path.exists() {
                // Preserve the user's enabled setting from the existing file.
                // Triggers are NOT preserved — version bumps push new trigger
                // configurations (e.g. adding a schedule). User trigger edits via
                // update_action() will persist until the next version bump.
                if needs_regen {
                    if let Ok(existing) = self.load_action_from_path(&path) {
                        action.enabled = existing.enabled;
                    }
                }
                let content = serde_json::to_string_pretty(&action)?;
                fs::write(&path, content)?;
                log::info!("Created built-in action: {}", action.name);
            }
        }

        if needs_regen {
            fs::write(&version_path, BUILTIN_ACTIONS_VERSION.to_string())?;
            log::info!(
                "Updated built-in actions to version {}",
                BUILTIN_ACTIONS_VERSION
            );
        }

        Ok(())
    }

    /// Get path for an action file
    fn action_path(&self, action_id: Uuid) -> PathBuf {
        self.base_path.join(format!("{}.json", action_id))
    }

    /// List all custom actions
    pub fn list_actions(&self) -> Result<Vec<Action>, StorageError> {
        let mut actions = Vec::new();

        if !self.base_path.exists() {
            return Ok(actions);
        }

        for entry in fs::read_dir(&self.base_path)? {
            let entry = entry?;
            let path = entry.path();

            if path.extension().map_or(false, |ext| ext == "json") {
                match self.load_action_from_path(&path) {
                    Ok(action) => actions.push(action),
                    Err(e) => {
                        log::warn!("Failed to load action from {:?}: {}", path, e);
                    }
                }
            }
        }

        // Sort by name
        actions.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(actions)
    }

    /// Load an action from a file path
    fn load_action_from_path(&self, path: &PathBuf) -> Result<Action, StorageError> {
        let content = fs::read_to_string(path)?;
        let action: Action = serde_json::from_str(&content)?;
        Ok(action)
    }

    /// Get a specific action by ID
    pub fn get_action(&self, action_id: Uuid) -> Result<Action, StorageError> {
        let path = self.action_path(action_id);
        if !path.exists() {
            return Err(StorageError::NotFound(format!(
                "Action {} not found",
                action_id
            )));
        }
        self.load_action_from_path(&path)
    }

    /// Create a new action
    pub fn create_action(&self, action: Action) -> Result<Action, StorageError> {
        let path = self.action_path(action.id);
        let content = serde_json::to_string_pretty(&action)?;
        fs::write(&path, content)?;
        Ok(action)
    }

    /// Update an existing action
    pub fn update_action(
        &self,
        action_id: Uuid,
        updates: ActionUpdate,
    ) -> Result<Action, StorageError> {
        let mut action = self.get_action(action_id)?;

        // Built-in actions: only allow toggling enabled and editing triggers
        if action.is_built_in {
            let only_allowed = updates.name.is_none()
                && updates.description.is_none()
                && updates.icon.is_none()
                && updates.category.is_none()
                && updates.steps.is_none()
                && updates.variables.is_none();

            if !only_allowed || (updates.enabled.is_none() && updates.triggers.is_none()) {
                return Err(StorageError::InvalidOperation(
                    "Only enabled and triggers can be changed on built-in actions".to_string(),
                ));
            }

            if let Some(enabled) = updates.enabled {
                action.enabled = enabled;
            }
            if let Some(triggers) = updates.triggers {
                action.triggers = triggers;
            }
            action.updated_at = chrono::Utc::now();

            let path = self.action_path(action_id);
            let content = serde_json::to_string_pretty(&action)?;
            fs::write(&path, content)?;

            return Ok(action);
        }

        // Apply updates
        if let Some(name) = updates.name {
            action.name = name;
        }
        if let Some(description) = updates.description {
            action.description = description;
        }
        if let Some(icon) = updates.icon {
            action.icon = Some(icon);
        }
        if let Some(category) = updates.category {
            action.category = category;
        }
        if let Some(triggers) = updates.triggers {
            action.triggers = triggers;
        }
        if let Some(steps) = updates.steps {
            action.steps = steps;
        }
        if let Some(enabled) = updates.enabled {
            action.enabled = enabled;
        }
        if let Some(variables) = updates.variables {
            action.variables = variables;
        }

        action.updated_at = chrono::Utc::now();

        // Save
        let path = self.action_path(action_id);
        let content = serde_json::to_string_pretty(&action)?;
        fs::write(&path, content)?;

        Ok(action)
    }

    /// Delete an action
    pub fn delete_action(&self, action_id: Uuid) -> Result<(), StorageError> {
        let action = self.get_action(action_id)?;

        // Don't allow deleting built-in actions
        if action.is_built_in {
            return Err(StorageError::InvalidOperation(
                "Cannot delete built-in actions".to_string(),
            ));
        }

        let path = self.action_path(action_id);
        if path.exists() {
            fs::remove_file(&path)?;
        }
        Ok(())
    }

    /// Update last run time for an action
    pub fn update_last_run(&self, action_id: Uuid) -> Result<(), StorageError> {
        let mut action = self.get_action(action_id)?;
        action.last_run = Some(chrono::Utc::now());

        let path = self.action_path(action_id);
        let content = serde_json::to_string_pretty(&action)?;
        fs::write(&path, content)?;
        Ok(())
    }

    /// Update next run time for a scheduled action
    pub fn update_next_run(
        &self,
        action_id: Uuid,
        next_run: chrono::DateTime<chrono::Utc>,
    ) -> Result<(), StorageError> {
        let mut action = self.get_action(action_id)?;
        action.next_run = Some(next_run);

        let path = self.action_path(action_id);
        let content = serde_json::to_string_pretty(&action)?;
        fs::write(&path, content)?;
        Ok(())
    }

    /// Find action by name (case-insensitive partial match)
    pub fn find_action_by_name(&self, name: &str) -> Result<Option<Action>, StorageError> {
        let actions = self.list_actions()?;
        let name_lower = name.to_lowercase();

        // First try exact match
        if let Some(action) = actions.iter().find(|a| a.name.to_lowercase() == name_lower) {
            return Ok(Some(action.clone()));
        }

        // Then try partial match
        if let Some(action) = actions
            .iter()
            .find(|a| a.name.to_lowercase().contains(&name_lower))
        {
            return Ok(Some(action.clone()));
        }

        Ok(None)
    }

    /// Find actions matching AI keywords
    pub fn find_actions_by_keywords(&self, input: &str) -> Result<Vec<Action>, StorageError> {
        let actions = self.list_actions()?;
        let matching: Vec<Action> = actions
            .into_iter()
            .filter(|a| a.enabled && a.matches_keywords(input))
            .collect();
        Ok(matching)
    }

    /// Get all scheduled actions
    pub fn get_scheduled_actions(&self) -> Result<Vec<Action>, StorageError> {
        let actions = self.list_actions()?;
        let scheduled: Vec<Action> = actions
            .into_iter()
            .filter(|a| a.enabled && a.has_schedule())
            .collect();
        Ok(scheduled)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::actions::models::{ActionCategory, ActionStep, ActionTrigger, NotebookTarget};
    use tempfile::TempDir;

    fn create_test_storage() -> (ActionStorage, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let storage = ActionStorage::new(temp_dir.path().to_path_buf()).unwrap();
        (storage, temp_dir)
    }

    #[test]
    fn test_create_and_get_action() {
        let (storage, _temp) = create_test_storage();

        let mut action = Action::new("Test Action".to_string(), "A test action".to_string());
        action.category = ActionCategory::Custom;
        action.steps.push(ActionStep::CreateNotebook {
            name: "Test Notebook".to_string(),
            notebook_type: None,
        });

        let created = storage.create_action(action.clone()).unwrap();
        assert_eq!(created.name, "Test Action");

        let retrieved = storage.get_action(created.id).unwrap();
        assert_eq!(retrieved.name, "Test Action");
        assert_eq!(retrieved.steps.len(), 1);
    }

    #[test]
    fn test_list_actions() {
        let (storage, _temp) = create_test_storage();

        // Create a few actions
        for i in 0..3 {
            let action = Action::new(format!("Action {}", i), format!("Description {}", i));
            storage.create_action(action).unwrap();
        }

        let actions = storage.list_actions().unwrap();
        assert_eq!(actions.len(), 3);
    }

    #[test]
    fn test_update_action() {
        let (storage, _temp) = create_test_storage();

        let action = Action::new("Original Name".to_string(), "Original desc".to_string());
        let created = storage.create_action(action).unwrap();

        let update = ActionUpdate {
            name: Some("Updated Name".to_string()),
            description: Some("Updated desc".to_string()),
            ..Default::default()
        };

        let updated = storage.update_action(created.id, update).unwrap();
        assert_eq!(updated.name, "Updated Name");
        assert_eq!(updated.description, "Updated desc");
    }

    #[test]
    fn test_delete_action() {
        let (storage, _temp) = create_test_storage();

        let action = Action::new("To Delete".to_string(), "Will be deleted".to_string());
        let created = storage.create_action(action).unwrap();

        storage.delete_action(created.id).unwrap();

        let result = storage.get_action(created.id);
        assert!(result.is_err());
    }

    #[test]
    fn test_find_by_keywords() {
        let (storage, _temp) = create_test_storage();

        let mut action = Action::new("Daily Goals".to_string(), "Create daily goals".to_string());
        action.triggers = vec![ActionTrigger::AiChat {
            keywords: vec!["daily goals".to_string(), "today's goals".to_string()],
        }];
        storage.create_action(action).unwrap();

        let matches = storage.find_actions_by_keywords("create my daily goals").unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].name, "Daily Goals");

        let no_matches = storage.find_actions_by_keywords("weekly review").unwrap();
        assert_eq!(no_matches.len(), 0);
    }
}
