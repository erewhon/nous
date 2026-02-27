use std::time::Duration;

use tokio::sync::mpsc;
use uuid::Uuid;

use super::scheduler::SyncSchedulerMessage;

/// Handle for a running notify_push listener
pub struct NotifyPushListener {
    shutdown_tx: mpsc::Sender<()>,
}

impl NotifyPushListener {
    /// Signal the listener to shut down
    pub fn shutdown(&self) {
        let _ = self.shutdown_tx.try_send(());
    }
}

/// Start a Nextcloud notify_push SSE listener for a specific library.
///
/// Connects to the Nextcloud notify_push endpoint and sends
/// `SyncSchedulerMessage::RemoteChanged` to the scheduler whenever a
/// file-change event is received.
///
/// Automatically reconnects with exponential backoff on connection failures.
pub fn start_notify_push_listener(
    library_id: Uuid,
    nextcloud_url: String,
    username: String,
    password: String,
    scheduler_tx: mpsc::Sender<SyncSchedulerMessage>,
) -> NotifyPushListener {
    let (shutdown_tx, shutdown_rx) = mpsc::channel(1);

    tauri::async_runtime::spawn(async move {
        notify_push_loop(
            library_id,
            nextcloud_url,
            username,
            password,
            scheduler_tx,
            shutdown_rx,
        )
        .await;
    });

    NotifyPushListener { shutdown_tx }
}

/// Initial backoff delay on connection failure
const INITIAL_BACKOFF: Duration = Duration::from_secs(1);
/// Maximum backoff delay
const MAX_BACKOFF: Duration = Duration::from_secs(300);
/// Debounce window: ignore duplicate file events within this period
const DEBOUNCE_WINDOW: Duration = Duration::from_secs(5);

async fn notify_push_loop(
    library_id: Uuid,
    nextcloud_url: String,
    username: String,
    password: String,
    scheduler_tx: mpsc::Sender<SyncSchedulerMessage>,
    mut shutdown_rx: mpsc::Receiver<()>,
) {
    use reqwest_eventsource::{Event, EventSource};
    use futures_util::StreamExt;

    let sse_url = format!(
        "{}/apps/notify_push/api/v1/sse",
        nextcloud_url.trim_end_matches('/')
    );

    let mut backoff = INITIAL_BACKOFF;
    let mut last_notify = std::time::Instant::now().checked_sub(DEBOUNCE_WINDOW).unwrap_or_else(std::time::Instant::now);

    log::info!(
        "notify_push: starting listener for library {} at {}",
        library_id,
        sse_url,
    );

    loop {
        // Check for shutdown before (re)connecting
        match shutdown_rx.try_recv() {
            Ok(()) => {
                log::info!("notify_push: shutdown requested for library {}", library_id);
                return;
            }
            Err(mpsc::error::TryRecvError::Disconnected) => {
                log::info!("notify_push: channel closed for library {}", library_id);
                return;
            }
            Err(mpsc::error::TryRecvError::Empty) => {}
        }

        log::info!(
            "notify_push: connecting to {} for library {}",
            sse_url,
            library_id,
        );

        let client = reqwest::Client::new();
        let request = client
            .get(&sse_url)
            .basic_auth(&username, Some(&password));

        let mut es = match EventSource::new(request) {
            Ok(es) => es,
            Err(e) => {
                log::error!(
                    "notify_push: failed to create EventSource for library {}: {}",
                    library_id,
                    e,
                );
                // Wait with backoff before retrying
                tokio::select! {
                    _ = tokio::time::sleep(backoff) => {}
                    _ = shutdown_rx.recv() => {
                        log::info!("notify_push: shutdown during backoff for library {}", library_id);
                        return;
                    }
                }
                backoff = (backoff * 2).min(MAX_BACKOFF);
                continue;
            }
        };

        // Connected — reset backoff
        let mut connection_opened = false;

        loop {
            tokio::select! {
                event = es.next() => {
                    match event {
                        Some(Ok(Event::Open)) => {
                            log::info!(
                                "notify_push: SSE connection opened for library {}",
                                library_id,
                            );
                            connection_opened = true;
                            backoff = INITIAL_BACKOFF; // Reset on successful connection
                        }
                        Some(Ok(Event::Message(msg))) => {
                            log::debug!(
                                "notify_push: event for library {}: type={}, data={}",
                                library_id,
                                msg.event,
                                msg.data,
                            );

                            if msg.event == "notify_file" {
                                let now = std::time::Instant::now();
                                if now.duration_since(last_notify) >= DEBOUNCE_WINDOW {
                                    last_notify = now;
                                    log::info!(
                                        "notify_push: file change detected for library {}, triggering sync",
                                        library_id,
                                    );
                                    let _ = scheduler_tx
                                        .try_send(SyncSchedulerMessage::RemoteChanged { library_id });
                                } else {
                                    log::debug!(
                                        "notify_push: debouncing file event for library {}",
                                        library_id,
                                    );
                                }
                            }
                        }
                        Some(Err(e)) => {
                            log::warn!(
                                "notify_push: SSE error for library {}: {} — will reconnect",
                                library_id,
                                e,
                            );
                            es.close();
                            break; // Break inner loop to reconnect
                        }
                        None => {
                            log::info!(
                                "notify_push: SSE stream ended for library {} — will reconnect",
                                library_id,
                            );
                            break; // Break inner loop to reconnect
                        }
                    }
                }
                _ = shutdown_rx.recv() => {
                    log::info!("notify_push: shutdown requested for library {}", library_id);
                    es.close();
                    return;
                }
            }
        }

        // Backoff before reconnecting (shorter if we had a successful connection)
        let reconnect_delay = if connection_opened {
            INITIAL_BACKOFF
        } else {
            backoff = (backoff * 2).min(MAX_BACKOFF);
            backoff
        };

        log::info!(
            "notify_push: reconnecting in {:?} for library {}",
            reconnect_delay,
            library_id,
        );

        tokio::select! {
            _ = tokio::time::sleep(reconnect_delay) => {}
            _ = shutdown_rx.recv() => {
                log::info!("notify_push: shutdown during reconnect delay for library {}", library_id);
                return;
            }
        }
    }
}
