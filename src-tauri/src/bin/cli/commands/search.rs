use anyhow::Result;

use crate::app::App;
use crate::OutputFormat;

/// Search has moved to the daemon HTTP API. The CLI's read-only search path
/// was removed when the daemon took ownership of the Tantivy writer lock.
/// This command stays registered for argv compatibility but now prints a
/// migration notice.
pub fn run(
    _app: &App,
    query: &str,
    _notebook_name: Option<&str>,
    _limit: usize,
    _format: &OutputFormat,
    _use_color: bool,
) -> Result<()> {
    eprintln!(
        "Search has moved to the daemon HTTP API.\n\
         Try: curl 'http://127.0.0.1:7667/api/search?q={}'\n\
         (Start the daemon first: systemctl --user start nous-daemon)",
        urlencoding_minimal(query)
    );
    std::process::exit(1);
}

/// Tiny URL-encoder for the migration hint above. Avoids pulling in a
/// dependency for what is currently dead-end output.
fn urlencoding_minimal(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => out.push(ch),
            ' ' => out.push('+'),
            _ => {
                for byte in ch.to_string().bytes() {
                    out.push_str(&format!("%{:02X}", byte));
                }
            }
        }
    }
    out
}
