use tauri::State;

use crate::ics_subscriptions::IcsSubscriptionResult;
use crate::AppState;

type CommandResult<T> = Result<T, String>;

/// Fetch an ICS subscription feed with on-disk caching. `max_age_secs = 0`
/// forces a network refresh; failures with a cache present return the stale
/// copy (`from_cache: true`).
#[tauri::command]
pub async fn fetch_ics_subscription(
    state: State<'_, AppState>,
    url: String,
    max_age_secs: u64,
) -> CommandResult<IcsSubscriptionResult> {
    let cache_dir = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        storage.cache_dir().join("ics-subscriptions")
    };
    // Blocking reqwest + file IO — keep it off the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        crate::ics_subscriptions::fetch_ics_subscription(&cache_dir, &url, max_age_secs)
    })
    .await
    .map_err(|e| e.to_string())?
}
