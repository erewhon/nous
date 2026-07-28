//! ICS subscription fetching with an on-disk cache.
//!
//! Calendar pages can subscribe to hosted .ics feeds. Fetches are cached
//! (keyed by URL hash) so page loads don't hammer remote servers and offline
//! opens still show the last-known events. Shared by the Tauri command and
//! the daemon HTTP route.

use std::fs;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_REDIRECTS: usize = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IcsSubscriptionResult {
    pub content: String,
    /// RFC 3339 timestamp of when the content was fetched from the network.
    pub fetched_at: String,
    pub from_cache: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct CacheEntry {
    url: String,
    fetched_at: String,
    content: String,
}

/// True when the host must not be fetched (SSRF guard, same policy as the
/// plugin host's http_request): loopback, private, link-local, unspecified.
fn host_is_blocked(host: &str) -> bool {
    match host {
        "localhost" | "0.0.0.0" => true,
        h => {
            // IPv6 literals arrive from host_str() bracketed ("[::1]").
            let h = h
                .strip_prefix('[')
                .and_then(|inner| inner.strip_suffix(']'))
                .unwrap_or(h);
            if let Ok(ip) = h.parse::<IpAddr>() {
                match ip {
                    IpAddr::V4(v4) => {
                        v4.is_loopback()
                            || v4.is_private()
                            || v4.is_link_local()
                            || v4.is_unspecified()
                    }
                    IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
                }
            } else {
                false
            }
        }
    }
}

/// Validate a subscription URL: https only, public host.
pub fn validate_subscription_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed: reqwest::Url = url.parse().map_err(|e| format!("invalid URL: {e}"))?;
    if parsed.scheme() != "https" {
        return Err(format!(
            "subscription URLs must use https (got {})",
            parsed.scheme()
        ));
    }
    match parsed.host_str() {
        None => Err("URL has no host".to_string()),
        Some(host) if host_is_blocked(host) => Err(format!(
            "blocked request to private/loopback address: {host}"
        )),
        Some(_) => Ok(parsed),
    }
}

fn cache_path(cache_dir: &Path, url: &str) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    let hash = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    cache_dir.join(format!("{hash}.json"))
}

fn read_cache(path: &Path) -> Option<CacheEntry> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_cache(cache_dir: &Path, path: &Path, entry: &CacheEntry) {
    let write = || -> std::io::Result<()> {
        fs::create_dir_all(cache_dir)?;
        let json = serde_json::to_string(entry)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        // Atomic-ish: temp + rename, matching the storage layer's convention.
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, json)?;
        fs::rename(&tmp, path)?;
        Ok(())
    };
    if let Err(e) = write() {
        log::warn!("Failed to write ICS subscription cache: {e}");
    }
}

fn cache_age_secs(entry: &CacheEntry) -> Option<u64> {
    let fetched = chrono::DateTime::parse_from_rfc3339(&entry.fetched_at).ok()?;
    let age = chrono::Utc::now().signed_duration_since(fetched.with_timezone(&chrono::Utc));
    u64::try_from(age.num_seconds()).ok()
}

fn fetch_remote(url: &str) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > MAX_REDIRECTS {
                return attempt.error("too many redirects");
            }
            if attempt.url().scheme() != "https" {
                return attempt.error("redirected to a non-https URL");
            }
            match attempt.url().host_str() {
                Some(host) if !host_is_blocked(host) => attempt.follow(),
                _ => attempt.error("redirected to a blocked address"),
            }
        }))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("fetch failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("fetch failed: HTTP {}", response.status()));
    }
    let bytes = response
        .bytes()
        .map_err(|e| format!("failed to read response: {e}"))?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(format!(
            "response too large: {} bytes (max {MAX_RESPONSE_BYTES})",
            bytes.len()
        ));
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Fetch a subscription feed, serving from the on-disk cache when it is
/// younger than `max_age_secs` (0 forces a refresh). A network failure with
/// a cache present returns the stale cache (`from_cache: true`) instead of
/// erroring, so offline opens keep working.
///
/// Blocking — call via spawn_blocking from async contexts.
pub fn fetch_ics_subscription(
    cache_dir: &Path,
    url: &str,
    max_age_secs: u64,
) -> Result<IcsSubscriptionResult, String> {
    validate_subscription_url(url)?;

    let path = cache_path(cache_dir, url);
    let cached = read_cache(&path);

    if max_age_secs > 0 {
        if let Some(entry) = &cached {
            if cache_age_secs(entry).is_some_and(|age| age < max_age_secs) {
                return Ok(IcsSubscriptionResult {
                    content: entry.content.clone(),
                    fetched_at: entry.fetched_at.clone(),
                    from_cache: true,
                });
            }
        }
    }

    match fetch_remote(url) {
        Ok(content) => {
            let fetched_at = chrono::Utc::now().to_rfc3339();
            write_cache(
                cache_dir,
                &path,
                &CacheEntry {
                    url: url.to_string(),
                    fetched_at: fetched_at.clone(),
                    content: content.clone(),
                },
            );
            Ok(IcsSubscriptionResult {
                content,
                fetched_at,
                from_cache: false,
            })
        }
        Err(err) => {
            if let Some(entry) = cached {
                log::warn!(
                    "ICS subscription fetch failed for {url}: {err}; serving stale cache"
                );
                Ok(IcsSubscriptionResult {
                    content: entry.content,
                    fetched_at: entry.fetched_at,
                    from_cache: true,
                })
            } else {
                Err(err)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // RFC 2606 reserved TLD — DNS resolution always fails, no real network.
    const UNREACHABLE: &str = "https://feed.invalid/calendar.ics";

    fn seed_cache(cache_dir: &Path, url: &str, content: &str, age_secs: i64) {
        let fetched_at = (chrono::Utc::now() - chrono::Duration::seconds(age_secs)).to_rfc3339();
        let path = cache_path(cache_dir, url);
        write_cache(
            cache_dir,
            &path,
            &CacheEntry {
                url: url.to_string(),
                fetched_at,
                content: content.to_string(),
            },
        );
    }

    #[test]
    fn test_url_validation() {
        assert!(validate_subscription_url("https://example.com/cal.ics").is_ok());
        assert!(validate_subscription_url("http://example.com/cal.ics").is_err());
        assert!(validate_subscription_url("ftp://example.com/cal.ics").is_err());
        assert!(validate_subscription_url("not a url").is_err());
        assert!(validate_subscription_url("https://localhost/cal.ics").is_err());
        assert!(validate_subscription_url("https://127.0.0.1/cal.ics").is_err());
        assert!(validate_subscription_url("https://10.1.2.3/cal.ics").is_err());
        assert!(validate_subscription_url("https://192.168.1.1/cal.ics").is_err());
        assert!(validate_subscription_url("https://169.254.0.1/cal.ics").is_err());
        assert!(validate_subscription_url("https://[::1]/cal.ics").is_err());
        assert!(validate_subscription_url("https://8.8.8.8/cal.ics").is_ok());
    }

    #[test]
    fn test_fresh_cache_serves_without_network() {
        let dir = TempDir::new().unwrap();
        seed_cache(dir.path(), UNREACHABLE, "CACHED", 10);

        // Would fail if it hit the network; a fresh cache short-circuits.
        let result = fetch_ics_subscription(dir.path(), UNREACHABLE, 3600).unwrap();
        assert_eq!(result.content, "CACHED");
        assert!(result.from_cache);
    }

    #[test]
    fn test_stale_cache_served_on_fetch_failure() {
        let dir = TempDir::new().unwrap();
        seed_cache(dir.path(), UNREACHABLE, "STALE", 7200);

        // Cache is older than max_age, so a fetch is attempted and fails
        // (unresolvable host) — the stale copy is returned instead of an error.
        let result = fetch_ics_subscription(dir.path(), UNREACHABLE, 3600).unwrap();
        assert_eq!(result.content, "STALE");
        assert!(result.from_cache);
    }

    #[test]
    fn test_zero_max_age_forces_refresh_attempt() {
        let dir = TempDir::new().unwrap();
        seed_cache(dir.path(), UNREACHABLE, "CACHED", 1);

        // Even a 1-second-old cache is bypassed with max_age 0; the failed
        // fetch then falls back to the cache.
        let result = fetch_ics_subscription(dir.path(), UNREACHABLE, 0).unwrap();
        assert_eq!(result.content, "CACHED");
        assert!(result.from_cache);
    }

    #[test]
    fn test_fetch_failure_without_cache_errors() {
        let dir = TempDir::new().unwrap();
        let result = fetch_ics_subscription(dir.path(), UNREACHABLE, 3600);
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_url_rejected_before_cache_or_network() {
        let dir = TempDir::new().unwrap();
        seed_cache(dir.path(), "http://example.com/cal.ics", "NOPE", 10);
        let result = fetch_ics_subscription(dir.path(), "http://example.com/cal.ics", 3600);
        assert!(result.is_err());
    }

    #[test]
    fn test_cache_key_is_per_url() {
        let dir = TempDir::new().unwrap();
        let a = cache_path(dir.path(), "https://a.example.com/cal.ics");
        let b = cache_path(dir.path(), "https://b.example.com/cal.ics");
        assert_ne!(a, b);
    }
}
