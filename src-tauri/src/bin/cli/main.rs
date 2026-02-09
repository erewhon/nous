mod app;
mod commands;
mod render;
#[cfg(feature = "tui")]
mod tui;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "nous-cli", about = "Nous notebook CLI and TUI", version)]
struct Cli {
    /// Use a specific library (default: current)
    #[arg(long, global = true)]
    library: Option<String>,

    /// Output format
    #[arg(long, global = true, default_value = "plain")]
    format: OutputFormat,

    /// Disable ANSI colors
    #[arg(long, global = true)]
    no_color: bool,

    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Clone, Debug, clap::ValueEnum)]
pub enum OutputFormat {
    Plain,
    Json,
}

#[derive(Subcommand)]
enum Command {
    /// List all libraries and their notebooks
    List,

    /// List pages in a notebook
    Ls {
        /// Notebook name (case-insensitive prefix match)
        notebook: String,
        /// Filter by folder name
        #[arg(long)]
        folder: Option<String>,
    },

    /// Show page content
    Show {
        /// Notebook name
        notebook: String,
        /// Page title (case-insensitive prefix match)
        page: String,
    },

    /// Show folder tree of a notebook
    Tree {
        /// Notebook name
        notebook: String,
    },

    /// Create a new page in a notebook
    New {
        /// Notebook name (case-insensitive prefix match)
        notebook: String,
        /// Page title (defaults to "Quick Note YYYY-MM-DD HH:MM")
        title: Option<String>,
        /// Place in a named folder
        #[arg(long)]
        folder: Option<String>,
        /// Comma-separated tags
        #[arg(long)]
        tags: Option<String>,
        /// Initial paragraph text (use "-" to read from stdin)
        #[arg(long)]
        content: Option<String>,
    },

    /// Inbox capture and listing
    #[command(subcommand)]
    Inbox(InboxCommand),

    /// Full-text search across pages
    Search {
        /// Search query
        query: String,
        /// Filter by notebook name
        #[arg(long)]
        notebook: Option<String>,
        /// Maximum results
        #[arg(long, default_value = "20")]
        limit: usize,
    },

    /// List tags with counts
    Tags {
        /// Filter by notebook name
        #[arg(long)]
        notebook: Option<String>,
    },

    /// Launch interactive TUI
    #[cfg(feature = "tui")]
    Tui,
}

#[derive(Subcommand)]
enum InboxCommand {
    /// Capture a new inbox item
    Capture {
        /// Title of the inbox item
        title: String,
        /// Content text (use "-" to read from stdin)
        #[arg(long)]
        content: Option<String>,
        /// Comma-separated tags
        #[arg(long)]
        tags: Option<String>,
    },

    /// List inbox items
    List {
        /// Show only unprocessed items
        #[arg(long)]
        unprocessed: bool,
    },
}

/// Read content from stdin if piped, or resolve "-" as stdin
fn resolve_content(content: Option<String>) -> Option<String> {
    match content.as_deref() {
        Some("-") => {
            // Explicit stdin read
            let mut buf = String::new();
            std::io::Read::read_to_string(&mut std::io::stdin(), &mut buf).ok();
            Some(buf)
        }
        Some(_) => content,
        None => {
            // Auto-detect piped stdin
            if !stdin_is_tty() {
                let mut buf = String::new();
                std::io::Read::read_to_string(&mut std::io::stdin(), &mut buf).ok();
                if buf.is_empty() { None } else { Some(buf) }
            } else {
                None
            }
        }
    }
}

/// Check if stdin is a terminal (not piped)
fn stdin_is_tty() -> bool {
    unsafe { libc_isatty(0) != 0 }
}

fn main() -> anyhow::Result<()> {
    env_logger::init();

    let cli = Cli::parse();
    let use_color = !cli.no_color && atty_check();

    match cli.command {
        None => {
            // No subcommand → launch TUI
            #[cfg(feature = "tui")]
            {
                tui::run(cli.library.as_deref())?;
            }
            #[cfg(not(feature = "tui"))]
            {
                eprintln!("TUI not available (built without 'tui' feature). Use a subcommand.");
                eprintln!("Run with --help for usage.");
                std::process::exit(1);
            }
        }
        Some(Command::List) => {
            let app = app::App::new(cli.library.as_deref())?;
            commands::list::run(&app, &cli.format, use_color)?;
        }
        Some(Command::Ls { notebook, folder }) => {
            let app = app::App::new(cli.library.as_deref())?;
            commands::ls::run(&app, &notebook, folder.as_deref(), &cli.format, use_color)?;
        }
        Some(Command::Show { notebook, page }) => {
            let app = app::App::new(cli.library.as_deref())?;
            commands::show::run(&app, &notebook, &page, use_color)?;
        }
        Some(Command::Tree { notebook }) => {
            let app = app::App::new(cli.library.as_deref())?;
            commands::tree::run(&app, &notebook, use_color)?;
        }
        Some(Command::New { notebook, title, folder, tags, content }) => {
            let app = app::App::new(cli.library.as_deref())?;
            let content = resolve_content(content);
            commands::new::run(
                &app,
                &notebook,
                title.as_deref(),
                folder.as_deref(),
                tags.as_deref(),
                content,
                &cli.format,
                use_color,
            )?;
        }
        Some(Command::Inbox(subcmd)) => {
            let app = app::App::new(cli.library.as_deref())?;
            match subcmd {
                InboxCommand::Capture { title, content, tags } => {
                    let content = resolve_content(content);
                    commands::inbox::run_capture(
                        &app,
                        &title,
                        content,
                        tags.as_deref(),
                        &cli.format,
                        use_color,
                    )?;
                }
                InboxCommand::List { unprocessed } => {
                    commands::inbox::run_list(&app, unprocessed, &cli.format, use_color)?;
                }
            }
        }
        Some(Command::Search { query, notebook, limit }) => {
            let app = app::App::new(cli.library.as_deref())?;
            commands::search::run(&app, &query, notebook.as_deref(), limit, &cli.format, use_color)?;
        }
        Some(Command::Tags { notebook }) => {
            let app = app::App::new(cli.library.as_deref())?;
            commands::tags::run(&app, notebook.as_deref(), &cli.format, use_color)?;
        }
        #[cfg(feature = "tui")]
        Some(Command::Tui) => {
            tui::run(cli.library.as_deref())?;
        }
    }

    Ok(())
}

/// Check if stdout is a terminal (for color support)
fn atty_check() -> bool {
    unsafe { libc_isatty(1) != 0 }
}

extern "C" {
    #[link_name = "isatty"]
    fn libc_isatty(fd: i32) -> i32;
}
