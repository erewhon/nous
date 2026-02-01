use std::collections::HashMap;
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::actions::{
    Action, ActionCategory, ActionExecutionResult, ActionStep, ActionTrigger, ActionUpdate,
    ScheduledActionInfo,
};
use crate::storage::StorageError;
use crate::AppState;

/// Error type for action commands
#[derive(Debug, Serialize)]
pub struct ActionCommandError {
    message: String,
}

impl ActionCommandError {
    pub fn new(message: &str) -> Self {
        Self {
            message: message.to_string(),
        }
    }
}

impl From<StorageError> for ActionCommandError {
    fn from(e: StorageError) -> Self {
        Self {
            message: e.to_string(),
        }
    }
}

type CommandResult<T> = Result<T, ActionCommandError>;

/// List all actions (custom and built-in)
#[tauri::command]
pub fn list_actions(state: State<AppState>) -> CommandResult<Vec<Action>> {
    let action_storage = state
        .action_storage
        .lock()
        .map_err(|e| ActionCommandError::new(&format!("Failed to lock action storage: {}", e)))?;

    let actions = action_storage.list_actions()?;
    Ok(actions)
}

/// Get a specific action by ID
#[tauri::command]
pub fn get_action(state: State<AppState>, action_id: String) -> CommandResult<Action> {
    let action_storage = state
        .action_storage
        .lock()
        .map_err(|e| ActionCommandError::new(&format!("Failed to lock action storage: {}", e)))?;

    let uuid = Uuid::parse_str(&action_id)
        .map_err(|_| ActionCommandError::new(&format!("Invalid action ID: {}", action_id)))?;

    let action = action_storage.get_action(uuid)?;
    Ok(action)
}

/// Create a new action
#[tauri::command]
pub fn create_action(
    state: State<AppState>,
    name: String,
    description: String,
    category: Option<ActionCategory>,
    triggers: Option<Vec<ActionTrigger>>,
    steps: Option<Vec<ActionStep>>,
) -> CommandResult<Action> {
    let action_storage = state
        .action_storage
        .lock()
        .map_err(|e| ActionCommandError::new(&format!("Failed to lock action storage: {}", e)))?;

    let mut action = Action::new(name, description);

    if let Some(cat) = category {
        action.category = cat;
    }
    if let Some(trigs) = triggers {
        action.triggers = trigs;
    }
    if let Some(stps) = steps {
        action.steps = stps;
    }

    let created = action_storage.create_action(action)?;
    Ok(created)
}

/// Update an existing action
#[tauri::command]
pub fn update_action(
    state: State<AppState>,
    action_id: String,
    updates: ActionUpdate,
) -> CommandResult<Action> {
    let action_storage = state
        .action_storage
        .lock()
        .map_err(|e| ActionCommandError::new(&format!("Failed to lock action storage: {}", e)))?;

    let uuid = Uuid::parse_str(&action_id)
        .map_err(|_| ActionCommandError::new(&format!("Invalid action ID: {}", action_id)))?;

    let updated = action_storage.update_action(uuid, updates)?;
    Ok(updated)
}

/// Delete an action
#[tauri::command]
pub fn delete_action(state: State<AppState>, action_id: String) -> CommandResult<()> {
    let action_storage = state
        .action_storage
        .lock()
        .map_err(|e| ActionCommandError::new(&format!("Failed to lock action storage: {}", e)))?;

    let uuid = Uuid::parse_str(&action_id)
        .map_err(|_| ActionCommandError::new(&format!("Invalid action ID: {}", action_id)))?;

    action_storage.delete_action(uuid)?;
    Ok(())
}

/// Run an action
#[tauri::command]
pub fn run_action(
    state: State<AppState>,
    action_id: String,
    variables: Option<HashMap<String, String>>,
    current_notebook_id: Option<String>,
) -> CommandResult<ActionExecutionResult> {
    let uuid = Uuid::parse_str(&action_id)
        .map_err(|_| ActionCommandError::new(&format!("Invalid action ID: {}", action_id)))?;

    let notebook_uuid = current_notebook_id
        .map(|id| Uuid::parse_str(&id))
        .transpose()
        .map_err(|_| ActionCommandError::new("Invalid notebook ID"))?;

    let executor = state
        .action_executor
        .lock()
        .map_err(|e| ActionCommandError::new(&format!("Failed to lock executor: {}", e)))?;

    let result = executor
        .execute_action(uuid, variables, notebook_uuid)
        .map_err(|e| ActionCommandError::new(&format!("Action execution failed: {}", e)))?;

    Ok(result)
}

/// Run an action by name (for AI chat integration)
#[tauri::command]
pub fn run_action_by_name(
    state: State<AppState>,
    action_name: String,
    variables: Option<HashMap<String, String>>,
    current_notebook_id: Option<String>,
) -> CommandResult<ActionExecutionResult> {
    let action_storage = state
        .action_storage
        .lock()
        .map_err(|e| ActionCommandError::new(&format!("Failed to lock action storage: {}", e)))?;

    let action = action_storage
        .find_action_by_name(&action_name)?
        .ok_or_else(|| ActionCommandError::new(&format!("Action not found: {}", action_name)))?;

    drop(action_storage); // Release lock before executing

    let notebook_uuid = current_notebook_id
        .map(|id| Uuid::parse_str(&id))
        .transpose()
        .map_err(|_| ActionCommandError::new("Invalid notebook ID"))?;

    let executor = state
        .action_executor
        .lock()
        .map_err(|e| ActionCommandError::new(&format!("Failed to lock executor: {}", e)))?;

    let result = executor
        .execute_action(action.id, variables, notebook_uuid)
        .map_err(|e| ActionCommandError::new(&format!("Action execution failed: {}", e)))?;

    Ok(result)
}

/// Find actions by AI keywords
#[tauri::command]
pub fn find_actions_by_keywords(
    state: State<AppState>,
    input: String,
) -> CommandResult<Vec<Action>> {
    let action_storage = state
        .action_storage
        .lock()
        .map_err(|e| ActionCommandError::new(&format!("Failed to lock action storage: {}", e)))?;

    let actions = action_storage.find_actions_by_keywords(&input)?;
    Ok(actions)
}

/// Get actions by category
#[tauri::command]
pub fn get_actions_by_category(
    state: State<AppState>,
    category: ActionCategory,
) -> CommandResult<Vec<Action>> {
    let action_storage = state
        .action_storage
        .lock()
        .map_err(|e| ActionCommandError::new(&format!("Failed to lock action storage: {}", e)))?;

    let all_actions = action_storage.list_actions()?;
    let filtered: Vec<Action> = all_actions
        .into_iter()
        .filter(|a| a.category == category)
        .collect();

    Ok(filtered)
}

/// Get scheduled actions
#[tauri::command]
pub fn get_scheduled_actions(state: State<AppState>) -> CommandResult<Vec<ScheduledActionInfo>> {
    let action_storage = state
        .action_storage
        .lock()
        .map_err(|e| ActionCommandError::new(&format!("Failed to lock action storage: {}", e)))?;

    let scheduled = action_storage.get_scheduled_actions()?;

    let infos: Vec<ScheduledActionInfo> = scheduled
        .into_iter()
        .filter_map(|action| {
            action.get_schedules().first().map(|schedule| ScheduledActionInfo {
                action_id: action.id,
                action_name: action.name.clone(),
                next_run: action.next_run.unwrap_or_else(chrono::Utc::now),
                schedule: (*schedule).clone(),
                enabled: action.enabled,
            })
        })
        .collect();

    Ok(infos)
}

/// Enable or disable an action
#[tauri::command]
pub fn set_action_enabled(
    state: State<AppState>,
    action_id: String,
    enabled: bool,
) -> CommandResult<Action> {
    let action_storage = state
        .action_storage
        .lock()
        .map_err(|e| ActionCommandError::new(&format!("Failed to lock action storage: {}", e)))?;

    let uuid = Uuid::parse_str(&action_id)
        .map_err(|_| ActionCommandError::new(&format!("Invalid action ID: {}", action_id)))?;

    let update = ActionUpdate {
        enabled: Some(enabled),
        ..Default::default()
    };

    let updated = action_storage.update_action(uuid, update)?;
    Ok(updated)
}
