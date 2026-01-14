//! Action Scheduler
//!
//! Manages scheduled action execution using tokio timers.
//! Actions are scheduled in-app and only run when the app is running.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Datelike, Local, NaiveTime, TimeZone, Utc};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::actions::executor::ActionExecutor;
use crate::actions::models::Schedule;
use crate::actions::storage::ActionStorage;

/// Message types for scheduler communication
#[derive(Debug)]
pub enum SchedulerMessage {
    /// Reload scheduled actions from storage
    Reload,
    /// Shutdown the scheduler
    Shutdown,
    /// Execute a specific action now
    ExecuteNow(Uuid),
}

/// Action scheduler that runs in the background
pub struct ActionScheduler {
    action_storage: Arc<Mutex<ActionStorage>>,
    executor: Arc<Mutex<ActionExecutor>>,
    sender: Option<mpsc::Sender<SchedulerMessage>>,
}

impl ActionScheduler {
    pub fn new(
        action_storage: Arc<Mutex<ActionStorage>>,
        executor: Arc<Mutex<ActionExecutor>>,
    ) -> Self {
        Self {
            action_storage,
            executor,
            sender: None,
        }
    }

    /// Start the scheduler in a background task
    pub fn start(&mut self) {
        let (tx, rx) = mpsc::channel(32);
        self.sender = Some(tx.clone());

        let action_storage = Arc::clone(&self.action_storage);
        let executor = Arc::clone(&self.executor);

        // Spawn scheduler task using Tauri's async runtime
        tauri::async_runtime::spawn(async move {
            scheduler_loop(action_storage, executor, rx).await;
        });

        // Trigger initial load using try_send (non-blocking)
        let _ = tx.try_send(SchedulerMessage::Reload);
    }

    /// Request scheduler to reload actions
    pub fn reload(&self) {
        if let Some(sender) = &self.sender {
            let _ = sender.try_send(SchedulerMessage::Reload);
        }
    }

    /// Request scheduler to execute an action immediately
    pub fn execute_now(&self, action_id: Uuid) {
        if let Some(sender) = &self.sender {
            let _ = sender.try_send(SchedulerMessage::ExecuteNow(action_id));
        }
    }

    /// Shutdown the scheduler
    pub fn shutdown(&self) {
        if let Some(sender) = &self.sender {
            let _ = sender.try_send(SchedulerMessage::Shutdown);
        }
    }
}

/// Main scheduler loop
async fn scheduler_loop(
    action_storage: Arc<Mutex<ActionStorage>>,
    executor: Arc<Mutex<ActionExecutor>>,
    mut receiver: mpsc::Receiver<SchedulerMessage>,
) {
    let mut scheduled_actions: Vec<ScheduledAction> = Vec::new();
    let mut next_check: Option<DateTime<Utc>> = None;

    loop {
        // Calculate how long to wait
        let wait_duration = if let Some(next) = next_check {
            let now = Utc::now();
            if next <= now {
                Duration::from_secs(0)
            } else {
                (next - now).to_std().unwrap_or(Duration::from_secs(60))
            }
        } else {
            Duration::from_secs(60) // Default check interval
        };

        tokio::select! {
            // Wait for next scheduled time or message
            _ = tokio::time::sleep(wait_duration) => {
                // Check for actions to execute
                let now = Utc::now();
                for action in &mut scheduled_actions {
                    if let Some(next_run) = action.next_run {
                        if next_run <= now {
                            // Execute action
                            log::info!("Executing scheduled action: {} ({})", action.name, action.id);

                            if let Ok(exec) = executor.lock() {
                                match exec.execute_action(action.id, None, None) {
                                    Ok(result) => {
                                        log::info!(
                                            "Action '{}' completed: {} steps, {} errors",
                                            action.name,
                                            result.steps_completed,
                                            result.errors.len()
                                        );
                                    }
                                    Err(e) => {
                                        log::error!("Action '{}' failed: {}", action.name, e);
                                    }
                                }
                            }

                            // Calculate next run time
                            action.next_run = calculate_next_run(&action.schedule);

                            // Update in storage
                            if let Some(next) = action.next_run {
                                if let Ok(storage) = action_storage.lock() {
                                    let _ = storage.update_next_run(action.id, next);
                                }
                            }
                        }
                    }
                }

                // Recalculate next check time
                next_check = scheduled_actions
                    .iter()
                    .filter_map(|a| a.next_run)
                    .min();
            }

            // Handle messages
            msg = receiver.recv() => {
                match msg {
                    Some(SchedulerMessage::Reload) => {
                        log::info!("Scheduler: Reloading scheduled actions");
                        scheduled_actions = load_scheduled_actions(&action_storage);
                        next_check = scheduled_actions
                            .iter()
                            .filter_map(|a| a.next_run)
                            .min();
                        log::info!("Scheduler: Loaded {} scheduled actions", scheduled_actions.len());
                    }
                    Some(SchedulerMessage::ExecuteNow(action_id)) => {
                        log::info!("Scheduler: Executing action {} now", action_id);
                        if let Ok(exec) = executor.lock() {
                            match exec.execute_action(action_id, None, None) {
                                Ok(result) => {
                                    log::info!(
                                        "Action completed: {} steps, {} errors",
                                        result.steps_completed,
                                        result.errors.len()
                                    );
                                }
                                Err(e) => {
                                    log::error!("Action execution failed: {}", e);
                                }
                            }
                        }
                    }
                    Some(SchedulerMessage::Shutdown) | None => {
                        log::info!("Scheduler: Shutting down");
                        break;
                    }
                }
            }
        }
    }
}

/// Scheduled action info
struct ScheduledAction {
    id: Uuid,
    name: String,
    schedule: Schedule,
    next_run: Option<DateTime<Utc>>,
}

/// Load scheduled actions from storage
fn load_scheduled_actions(action_storage: &Arc<Mutex<ActionStorage>>) -> Vec<ScheduledAction> {
    let Ok(storage) = action_storage.lock() else {
        return Vec::new();
    };

    let Ok(actions) = storage.get_scheduled_actions() else {
        return Vec::new();
    };

    actions
        .into_iter()
        .filter_map(|action| {
            // Get the first schedule (actions can have multiple triggers)
            let schedule = action.get_schedules().first().cloned()?;

            // Calculate next run time
            let next_run = action.next_run.or_else(|| calculate_next_run(&schedule));

            Some(ScheduledAction {
                id: action.id,
                name: action.name.clone(),
                schedule: schedule.clone(),
                next_run,
            })
        })
        .collect()
}

/// Parse a time string in "HH:MM" format
fn parse_time(time_str: &str) -> Option<NaiveTime> {
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let hour: u32 = parts[0].parse().ok()?;
    let minute: u32 = parts[1].parse().ok()?;
    NaiveTime::from_hms_opt(hour, minute, 0)
}

/// Calculate the next run time for a schedule
fn calculate_next_run(schedule: &Schedule) -> Option<DateTime<Utc>> {
    let now = Local::now();

    match schedule {
        Schedule::Daily { time, skip_weekends } => {
            let scheduled_time = parse_time(time)?;
            let mut date = now.date_naive();

            // If today's time has passed, move to tomorrow
            if now.time() >= scheduled_time {
                date = date.succ_opt()?;
            }

            // Skip weekends if needed
            if *skip_weekends {
                while date.weekday().num_days_from_monday() >= 5 {
                    date = date.succ_opt()?;
                }
            }

            let datetime = date.and_time(scheduled_time);
            Some(Local.from_local_datetime(&datetime).single()?.with_timezone(&Utc))
        }

        Schedule::Weekly { days, time } => {
            let scheduled_time = parse_time(time)?;
            let mut date = now.date_naive();

            // If today's time has passed, start from tomorrow
            if now.time() >= scheduled_time {
                date = date.succ_opt()?;
            }

            // Find the next matching day
            for _ in 0..7 {
                let day_name = date.format("%A").to_string().to_lowercase();
                if days.iter().any(|d| d.to_lowercase() == day_name) {
                    let datetime = date.and_time(scheduled_time);
                    return Some(Local.from_local_datetime(&datetime).single()?.with_timezone(&Utc));
                }
                date = date.succ_opt()?;
            }

            None
        }

        Schedule::Monthly { day_of_month, time } => {
            let scheduled_time = parse_time(time)?;
            let mut year = now.year();
            let mut month = now.month();
            let target_day = *day_of_month as u32;

            // Check this month first
            if let Some(date) = chrono::NaiveDate::from_ymd_opt(year, month, target_day) {
                let datetime = date.and_time(scheduled_time);
                if let Some(local_dt) = Local.from_local_datetime(&datetime).single() {
                    if local_dt > now {
                        return Some(local_dt.with_timezone(&Utc));
                    }
                }
            }

            // Try next month
            month += 1;
            if month > 12 {
                month = 1;
                year += 1;
            }

            if let Some(date) = chrono::NaiveDate::from_ymd_opt(year, month, target_day) {
                let datetime = date.and_time(scheduled_time);
                return Some(Local.from_local_datetime(&datetime).single()?.with_timezone(&Utc));
            }

            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_time() {
        let time = parse_time("08:30");
        assert!(time.is_some());
        let time = time.unwrap();
        assert_eq!(time.hour(), 8);
        assert_eq!(time.minute(), 30);
    }

    #[test]
    fn test_daily_schedule_next_run() {
        let schedule = Schedule::Daily {
            time: "08:00".to_string(),
            skip_weekends: false,
        };

        let next = calculate_next_run(&schedule);
        assert!(next.is_some());

        let next = next.unwrap();
        let local = next.with_timezone(&Local);
        assert_eq!(local.hour(), 8);
        assert_eq!(local.minute(), 0);
    }

    #[test]
    fn test_weekly_schedule_next_run() {
        let schedule = Schedule::Weekly {
            days: vec!["monday".to_string(), "wednesday".to_string(), "friday".to_string()],
            time: "09:00".to_string(),
        };

        let next = calculate_next_run(&schedule);
        assert!(next.is_some());
    }

    #[test]
    fn test_monthly_schedule_next_run() {
        let schedule = Schedule::Monthly {
            day_of_month: 15,
            time: "10:00".to_string(),
        };

        let next = calculate_next_run(&schedule);
        assert!(next.is_some());

        let next = next.unwrap();
        let local = next.with_timezone(&Local);
        assert_eq!(local.day(), 15);
    }
}
