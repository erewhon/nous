//! Nous daemon — headless background service.
//!
//! Provides:
//! - Action scheduler (daily note creation, etc.)
//! - WebDAV sync on schedule
//! - HTTP API for external processes (MCP server, scripts)

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use tokio::signal;

use nous_lib::actions::{ActionExecutor, ActionScheduler, ActionStorage};
use nous_lib::contacts::ContactsStorage;
use nous_lib::energy::EnergyStorage;
use nous_lib::goals::GoalsStorage;
use nous_lib::inbox::InboxStorage;
use nous_lib::library::LibraryStorage;
use nous_lib::python_bridge::PythonAI;
use nous_lib::storage::FileStorage;
use nous_lib::sync::{LogEmitter, SyncManager};

use super::api;

/// Re-export AppEvent as DaemonEvent for backward compatibility
pub type DaemonEvent = nous_lib::events::AppEvent;

/// Shared state for the daemon (passed to HTTP handlers and schedulers)
pub struct DaemonState {
    pub storage: Arc<Mutex<FileStorage>>,
    pub library_storage: Arc<Mutex<LibraryStorage>>,
    pub inbox_storage: Arc<Mutex<InboxStorage>>,
    pub goals_storage: Arc<Mutex<GoalsStorage>>,
    pub energy_storage: Arc<Mutex<EnergyStorage>>,
    pub contacts_storage: Arc<Mutex<ContactsStorage>>,
    pub sync_manager: Arc<SyncManager>,
    pub action_scheduler: Mutex<ActionScheduler>,
    pub library_path: PathBuf,
    pub event_tx: nous_lib::events::EventSender,
}

/// Default daemon port
const DEFAULT_PORT: u16 = 7667;

/// Run the daemon (foreground, blocking).
pub async fn run(library_name: Option<&str>, port: Option<u16>, bind: Option<&str>) -> Result<()> {
    let port = port.unwrap_or(DEFAULT_PORT);

    // Get base data directory
    let data_dir = FileStorage::default_data_dir()
        .context("Failed to get data directory")?;

    // Check PID file
    let pid_path = data_dir.join(".nous-daemon.pid");
    if pid_path.exists() {
        if let Ok(pid_str) = std::fs::read_to_string(&pid_path) {
            if let Ok(pid) = pid_str.trim().parse::<u32>() {
                // Check if process is still running
                if is_process_running(pid) {
                    anyhow::bail!(
                        "Daemon already running (PID {}). Stop it first or remove {}",
                        pid,
                        pid_path.display()
                    );
                }
            }
        }
        // Stale PID file — remove it
        let _ = std::fs::remove_file(&pid_path);
    }

    // Write PID file
    std::fs::write(&pid_path, std::process::id().to_string())
        .context("Failed to write PID file")?;

    log::info!("Nous daemon starting (PID {})", std::process::id());

    // Initialize library storage
    let library_storage = LibraryStorage::new(data_dir.clone());
    let current_library = if let Some(name) = library_name {
        let libs = library_storage.list_libraries()
            .context("Failed to list libraries")?;
        libs.into_iter()
            .find(|lib| lib.name.to_lowercase() == name.to_lowercase())
            .context(format!("Library '{}' not found", name))?
    } else {
        library_storage.init()
            .context("Failed to initialize library storage")?
    };

    let library_path = current_library.path.clone();
    log::info!("Using library: {} at {}", current_library.name, library_path.display());

    // Initialize file storage
    let storage = FileStorage::new(library_path.clone());
    storage.init().context("Failed to initialize storage")?;

    // Initialize storages
    let inbox_storage = InboxStorage::new(library_path.clone())
        .context("Failed to initialize inbox storage")?;
    let goals_storage = GoalsStorage::new(library_path.clone())
        .context("Failed to initialize goals storage")?;
    let energy_storage = EnergyStorage::new(data_dir.clone())
        .context("Failed to initialize energy storage")?;
    let contacts_storage = ContactsStorage::new(data_dir.clone())
        .context("Failed to initialize contacts storage")?;
    let action_storage = ActionStorage::new(library_path.clone())
        .context("Failed to initialize action storage")?;

    // Initialize Python AI bridge (needed by ActionExecutor)
    let nous_py_path = find_nous_py_path();
    log::info!("Python AI bridge path: {:?}", nous_py_path);
    let python_ai = PythonAI::new(nous_py_path);

    // Wrap in Arc<Mutex<>>
    let storage_arc = Arc::new(Mutex::new(storage));
    let library_storage_arc = Arc::new(Mutex::new(library_storage));
    let inbox_storage_arc = Arc::new(Mutex::new(inbox_storage));
    let goals_storage_arc = Arc::new(Mutex::new(goals_storage));
    let energy_storage_arc = Arc::new(Mutex::new(energy_storage));
    let contacts_storage_arc = Arc::new(Mutex::new(contacts_storage));
    let action_storage_arc = Arc::new(Mutex::new(action_storage));
    let python_ai_arc = Arc::new(Mutex::new(python_ai));

    // Create event broadcast channel (capacity 256 — events are small)
    let (event_tx, _) = tokio::sync::broadcast::channel::<nous_lib::events::AppEvent>(256);

    // Initialize action executor
    let mut action_executor = ActionExecutor::new(
        Arc::clone(&storage_arc),
        Arc::clone(&action_storage_arc),
        Arc::clone(&python_ai_arc),
    );
    action_executor.set_goals_storage(Arc::clone(&goals_storage_arc));
    action_executor.set_energy_storage(Arc::clone(&energy_storage_arc));
    action_executor.set_inbox_storage(Arc::clone(&inbox_storage_arc));
    action_executor.set_event_tx(event_tx.clone());
    let action_executor_arc = Arc::new(Mutex::new(action_executor));

    // Initialize action scheduler and start it
    let mut action_scheduler = ActionScheduler::new(
        Arc::clone(&action_storage_arc),
        Arc::clone(&action_executor_arc),
    );
    action_scheduler.start();
    log::info!("Action scheduler started");

    // Initialize sync manager with LogEmitter (no GUI)
    let sync_manager = SyncManager::new(data_dir.clone());
    let sync_manager_arc = Arc::new(sync_manager);
    sync_manager_arc.set_emitter(Arc::new(LogEmitter));

    // Start sync scheduler
    let sync_scheduler = nous_lib::sync::scheduler::start_sync_scheduler(
        Arc::clone(&sync_manager_arc),
        Arc::clone(&storage_arc),
        Arc::clone(&library_storage_arc),
        Arc::clone(&goals_storage_arc),
        Arc::clone(&inbox_storage_arc),
        Arc::clone(&contacts_storage_arc),
        Arc::clone(&energy_storage_arc),
    );
    log::info!("Sync scheduler started");

    // Build shared daemon state
    let state = Arc::new(DaemonState {
        storage: storage_arc,
        library_storage: library_storage_arc,
        inbox_storage: inbox_storage_arc,
        goals_storage: goals_storage_arc,
        energy_storage: energy_storage_arc,
        contacts_storage: contacts_storage_arc,
        sync_manager: sync_manager_arc,
        action_scheduler: Mutex::new(action_scheduler),
        library_path: library_path.clone(),
        event_tx,
    });

    // Start HTTP API
    let router = api::build_router(Arc::clone(&state));
    let bind_addr: std::net::IpAddr = bind
        .unwrap_or("127.0.0.1")
        .parse()
        .context("Invalid bind address")?;
    let addr = std::net::SocketAddr::from((bind_addr, port));

    log::info!("HTTP API listening on http://{}", addr);
    println!("Nous daemon listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .context("Failed to bind HTTP listener")?;

    // Run server until signal
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("HTTP server error")?;

    // Cleanup
    log::info!("Shutting down...");
    sync_scheduler.shutdown();
    if let Ok(sched) = state.action_scheduler.lock() {
        sched.shutdown();
    }
    let _ = std::fs::remove_file(&pid_path);
    log::info!("Daemon stopped");

    Ok(())
}

/// Get the status of a running daemon
pub fn status() -> Result<()> {
    let data_dir = FileStorage::default_data_dir()
        .context("Failed to get data directory")?;
    let pid_path = data_dir.join(".nous-daemon.pid");

    if !pid_path.exists() {
        println!("Daemon is not running (no PID file)");
        return Ok(());
    }

    let pid_str = std::fs::read_to_string(&pid_path)
        .context("Failed to read PID file")?;
    let pid: u32 = pid_str.trim().parse()
        .context("Invalid PID in file")?;

    if is_process_running(pid) {
        println!("Daemon is running (PID {})", pid);
    } else {
        println!("Daemon is not running (stale PID file for PID {})", pid);
        let _ = std::fs::remove_file(&pid_path);
    }

    Ok(())
}

/// Install systemd/launchd service
pub fn install() -> Result<()> {
    let exe_path = std::env::current_exe()
        .context("Failed to get executable path")?;

    #[cfg(target_os = "linux")]
    {
        install_systemd(&exe_path)?;
    }

    #[cfg(target_os = "macos")]
    {
        install_launchd(&exe_path)?;
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        anyhow::bail!("Service installation not supported on this platform");
    }

    Ok(())
}

/// Uninstall systemd/launchd service
pub fn uninstall() -> Result<()> {
    #[cfg(target_os = "linux")]
    {
        uninstall_systemd()?;
    }

    #[cfg(target_os = "macos")]
    {
        uninstall_launchd()?;
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        anyhow::bail!("Service uninstallation not supported on this platform");
    }

    Ok(())
}

// ===== Helpers =====

fn find_nous_py_path() -> PathBuf {
    // Check bundled Python first
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let bundled = exe_dir.join("python-bundle/nous-py");
            if bundled.exists() {
                return bundled;
            }
            let bundled_resources = exe_dir.join("../Resources/python-bundle/nous-py");
            if bundled_resources.exists() {
                return bundled_resources;
            }
        }
    }

    // Dev mode
    if let Ok(cwd) = std::env::current_dir() {
        let direct = cwd.join("nous-py");
        if direct.exists() {
            return direct;
        }
        if let Some(parent) = cwd.parent() {
            let parent_path = parent.join("nous-py");
            if parent_path.exists() {
                return parent_path;
            }
        }
    }

    PathBuf::from("nous-py")
}

fn is_process_running(pid: u32) -> bool {
    // Check /proc on Linux, kill -0 on macOS
    #[cfg(target_os = "linux")]
    {
        std::path::Path::new(&format!("/proc/{}", pid)).exists()
    }

    #[cfg(target_os = "macos")]
    {
        unsafe { libc_kill(pid as i32, 0) == 0 }
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = pid;
        false
    }
}

#[cfg(target_os = "macos")]
extern "C" {
    #[link_name = "kill"]
    fn libc_kill(pid: i32, sig: i32) -> i32;
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("Failed to install CTRL+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => { log::info!("Received CTRL+C"); }
        _ = terminate => { log::info!("Received SIGTERM"); }
    }
}

// ===== Service installation =====

#[cfg(target_os = "linux")]
fn install_systemd(exe_path: &std::path::Path) -> Result<()> {
    let service_dir = dirs::config_dir()
        .context("Failed to get config directory")?
        .join("systemd/user");
    std::fs::create_dir_all(&service_dir)?;

    let service_path = service_dir.join("nous-daemon.service");

    // Discover Python paths for PyO3
    let home = dirs::home_dir().unwrap_or_default();
    let uv_python_dir = home.join(".local/share/uv/python");
    let mut python_lib_path = String::new();
    let mut pythonpath = String::new();

    // Find the uv-managed Python lib directory
    if uv_python_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&uv_python_dir) {
            for entry in entries.flatten() {
                let lib_dir = entry.path().join("lib");
                if lib_dir.exists() {
                    python_lib_path = lib_dir.to_string_lossy().to_string();
                    break;
                }
            }
        }
    }

    // Find nous-py path (sibling of the exe or in the project)
    if let Some(exe_dir) = exe_path.parent() {
        // Check standard locations
        let candidates = [
            exe_dir.join("nous-py"),
            exe_dir.join("../../nous-py"),
            home.join("Projects/erewhon/nous/nous-py"),
        ];
        for candidate in &candidates {
            if candidate.exists() {
                pythonpath = candidate.canonicalize()
                    .unwrap_or(candidate.clone())
                    .to_string_lossy()
                    .to_string();
                break;
            }
        }
    }

    let mut env_lines = vec!["Environment=RUST_LOG=info".to_string()];
    if !python_lib_path.is_empty() {
        env_lines.push(format!("Environment=LD_LIBRARY_PATH={python_lib_path}"));
    }
    if !pythonpath.is_empty() {
        env_lines.push(format!("Environment=PYTHONPATH={pythonpath}"));
    }

    let content = format!(
        r#"[Unit]
Description=Nous Daemon - Headless notebook service
After=network.target

[Service]
Type=simple
ExecStart={exe} daemon start
Restart=on-failure
RestartSec=5
{env}

[Install]
WantedBy=default.target
"#,
        exe = exe_path.display(),
        env = env_lines.join("\n"),
    );

    std::fs::write(&service_path, content)?;
    println!("Installed systemd user service: {}", service_path.display());
    println!("Enable and start with:");
    println!("  systemctl --user daemon-reload");
    println!("  systemctl --user enable --now nous-daemon");

    Ok(())
}

#[cfg(target_os = "linux")]
fn uninstall_systemd() -> Result<()> {
    let service_path = dirs::config_dir()
        .context("Failed to get config directory")?
        .join("systemd/user/nous-daemon.service");

    if service_path.exists() {
        std::fs::remove_file(&service_path)?;
        println!("Removed systemd service: {}", service_path.display());
        println!("Run: systemctl --user daemon-reload");
    } else {
        println!("No systemd service found at {}", service_path.display());
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn install_launchd(exe_path: &std::path::Path) -> Result<()> {
    let launch_agents = dirs::home_dir()
        .context("Failed to get home directory")?
        .join("Library/LaunchAgents");
    std::fs::create_dir_all(&launch_agents)?;

    let plist_path = launch_agents.join("com.nous.daemon.plist");
    let content = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nous.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>{exe}</string>
        <string>daemon</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/nous-daemon.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/nous-daemon.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>RUST_LOG</key>
        <string>info</string>
    </dict>
</dict>
</plist>
"#,
        exe = exe_path.display()
    );

    std::fs::write(&plist_path, content)?;
    println!("Installed launchd agent: {}", plist_path.display());
    println!("Load with: launchctl load {}", plist_path.display());

    Ok(())
}

#[cfg(target_os = "macos")]
fn uninstall_launchd() -> Result<()> {
    let plist_path = dirs::home_dir()
        .context("Failed to get home directory")?
        .join("Library/LaunchAgents/com.nous.daemon.plist");

    if plist_path.exists() {
        // Try to unload first
        let _ = std::process::Command::new("launchctl")
            .args(["unload", &plist_path.to_string_lossy()])
            .output();
        std::fs::remove_file(&plist_path)?;
        println!("Removed launchd agent: {}", plist_path.display());
    } else {
        println!("No launchd agent found at {}", plist_path.display());
    }

    Ok(())
}
