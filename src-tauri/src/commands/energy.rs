//! Tauri commands for energy and focus tracking

use chrono::NaiveDate;
use tauri::State;

use crate::energy::{
    CreateCheckInRequest, EnergyCheckIn, EnergyPattern, UpdateCheckInRequest,
};
use crate::AppState;

type CommandResult<T> = Result<T, String>;

/// Log an energy check-in (upsert: creates or updates for the given date)
#[tauri::command]
pub fn log_energy_checkin(
    state: State<AppState>,
    request: CreateCheckInRequest,
) -> CommandResult<EnergyCheckIn> {
    let storage = state.energy_storage.lock().map_err(|e| e.to_string())?;
    storage.upsert_checkin(request).map_err(|e| e.to_string())
}

/// Get an energy check-in for a specific date
#[tauri::command]
pub fn get_energy_checkin(
    state: State<AppState>,
    date: String,
) -> CommandResult<Option<EnergyCheckIn>> {
    let date = NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid date: {}", e))?;
    let storage = state.energy_storage.lock().map_err(|e| e.to_string())?;
    storage.get_checkin(date).map_err(|e| e.to_string())
}

/// Get energy check-ins within a date range
#[tauri::command]
pub fn get_energy_checkins_range(
    state: State<AppState>,
    start_date: String,
    end_date: String,
) -> CommandResult<Vec<EnergyCheckIn>> {
    let start = NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid start date: {}", e))?;
    let end = NaiveDate::parse_from_str(&end_date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid end date: {}", e))?;
    let storage = state.energy_storage.lock().map_err(|e| e.to_string())?;
    storage.get_checkins_range(start, end).map_err(|e| e.to_string())
}

/// Update an existing energy check-in
#[tauri::command]
pub fn update_energy_checkin(
    state: State<AppState>,
    date: String,
    updates: UpdateCheckInRequest,
) -> CommandResult<EnergyCheckIn> {
    let date = NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid date: {}", e))?;
    let storage = state.energy_storage.lock().map_err(|e| e.to_string())?;
    storage.update_checkin(date, updates).map_err(|e| e.to_string())
}

/// Delete an energy check-in
#[tauri::command]
pub fn delete_energy_checkin(
    state: State<AppState>,
    date: String,
) -> CommandResult<()> {
    let date = NaiveDate::parse_from_str(&date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid date: {}", e))?;
    let storage = state.energy_storage.lock().map_err(|e| e.to_string())?;
    storage.delete_checkin(date).map_err(|e| e.to_string())
}

/// Get energy patterns for a date range
#[tauri::command]
pub fn get_energy_patterns(
    state: State<AppState>,
    start_date: String,
    end_date: String,
) -> CommandResult<EnergyPattern> {
    let start = NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid start date: {}", e))?;
    let end = NaiveDate::parse_from_str(&end_date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid end date: {}", e))?;
    let storage = state.energy_storage.lock().map_err(|e| e.to_string())?;
    storage.calculate_patterns(start, end).map_err(|e| e.to_string())
}

/// Get the full energy log (all check-ins)
#[tauri::command]
pub fn get_energy_log(state: State<AppState>) -> CommandResult<Vec<EnergyCheckIn>> {
    let storage = state.energy_storage.lock().map_err(|e| e.to_string())?;
    storage.list_checkins().map_err(|e| e.to_string())
}
