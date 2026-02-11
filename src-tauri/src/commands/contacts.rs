//! Tauri commands for contacts and activity tracking

use tauri::State;
use uuid::Uuid;

use crate::contacts::{
    Contact, ContactActivity, ContactHarvester, HarvestResult, HarvestState,
    UpdateContactRequest,
};
use crate::AppState;

type CommandResult<T> = Result<T, String>;

/// List all contacts
#[tauri::command]
pub fn list_contacts(state: State<AppState>) -> CommandResult<Vec<Contact>> {
    let storage = state.contacts_storage.lock().map_err(|e| e.to_string())?;
    storage.list_contacts().map_err(|e| e.to_string())
}

/// Get a contact by ID
#[tauri::command]
pub fn get_contact(state: State<AppState>, id: String) -> CommandResult<Contact> {
    let contact_id =
        Uuid::parse_str(&id).map_err(|e| format!("Invalid contact ID: {}", e))?;
    let storage = state.contacts_storage.lock().map_err(|e| e.to_string())?;
    storage.get_contact(contact_id).map_err(|e| e.to_string())
}

/// Update an existing contact
#[tauri::command]
pub fn update_contact(
    state: State<AppState>,
    id: String,
    updates: UpdateContactRequest,
) -> CommandResult<Contact> {
    let contact_id =
        Uuid::parse_str(&id).map_err(|e| format!("Invalid contact ID: {}", e))?;
    let storage = state.contacts_storage.lock().map_err(|e| e.to_string())?;
    storage
        .update_contact(contact_id, updates)
        .map_err(|e| e.to_string())
}

/// Delete a contact
#[tauri::command]
pub fn delete_contact(state: State<AppState>, id: String) -> CommandResult<()> {
    let contact_id =
        Uuid::parse_str(&id).map_err(|e| format!("Invalid contact ID: {}", e))?;
    let storage = state.contacts_storage.lock().map_err(|e| e.to_string())?;
    storage.delete_contact(contact_id).map_err(|e| e.to_string())
}

/// List activities for a specific contact
#[tauri::command]
pub fn list_contact_activities(
    state: State<AppState>,
    contact_id: String,
) -> CommandResult<Vec<ContactActivity>> {
    let contact_id =
        Uuid::parse_str(&contact_id).map_err(|e| format!("Invalid contact ID: {}", e))?;
    let storage = state.contacts_storage.lock().map_err(|e| e.to_string())?;
    storage
        .list_activities_for_contact(contact_id)
        .map_err(|e| e.to_string())
}

/// List all activities
#[tauri::command]
pub fn list_all_activities(state: State<AppState>) -> CommandResult<Vec<ContactActivity>> {
    let storage = state.contacts_storage.lock().map_err(|e| e.to_string())?;
    storage.list_activities().map_err(|e| e.to_string())
}

/// Run the contact harvester (macOS only)
#[tauri::command]
pub fn harvest_contacts(state: State<AppState>) -> CommandResult<HarvestResult> {
    let harvester = ContactHarvester::new(state.contacts_storage.clone());
    harvester.harvest()
}

/// Check if the harvester is available
#[tauri::command]
pub fn is_harvester_available(state: State<AppState>) -> CommandResult<bool> {
    let harvester = ContactHarvester::new(state.contacts_storage.clone());
    Ok(harvester.is_available())
}

/// Get the current harvest state
#[tauri::command]
pub fn get_harvest_state(state: State<AppState>) -> CommandResult<HarvestState> {
    let storage = state.contacts_storage.lock().map_err(|e| e.to_string())?;
    storage.get_harvest_state().map_err(|e| e.to_string())
}
