//! Web research Tauri commands.

use regex::Regex;
use serde::Serialize;
use tauri::State;

use crate::python_bridge::{AIConfig, ResearchSummary, ScrapedContent, SearchResponse};
use crate::AppState;

use super::notebook::CommandError;

/// Metadata extracted from a web page for link previews
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub site_name: Option<String>,
    pub favicon: Option<String>,
}

/// Extract content of a meta tag from HTML
fn extract_meta_content(html: &str, property: &str) -> Option<String> {
    // Try OpenGraph property
    let og_pattern = format!(
        r#"<meta[^>]+property=["']{}["'][^>]+content=["']([^"']+)["']"#,
        regex::escape(property)
    );
    if let Ok(re) = Regex::new(&og_pattern) {
        if let Some(caps) = re.captures(html) {
            return caps.get(1).map(|m| html_escape::decode_html_entities(m.as_str()).to_string());
        }
    }

    // Try reverse order (content before property)
    let og_pattern_rev = format!(
        r#"<meta[^>]+content=["']([^"']+)["'][^>]+property=["']{}["']"#,
        regex::escape(property)
    );
    if let Ok(re) = Regex::new(&og_pattern_rev) {
        if let Some(caps) = re.captures(html) {
            return caps.get(1).map(|m| html_escape::decode_html_entities(m.as_str()).to_string());
        }
    }

    // Try name attribute (for twitter cards and standard meta tags)
    let name_pattern = format!(
        r#"<meta[^>]+name=["']{}["'][^>]+content=["']([^"']+)["']"#,
        regex::escape(property)
    );
    if let Ok(re) = Regex::new(&name_pattern) {
        if let Some(caps) = re.captures(html) {
            return caps.get(1).map(|m| html_escape::decode_html_entities(m.as_str()).to_string());
        }
    }

    // Try reverse order for name attribute
    let name_pattern_rev = format!(
        r#"<meta[^>]+content=["']([^"']+)["'][^>]+name=["']{}["']"#,
        regex::escape(property)
    );
    if let Ok(re) = Regex::new(&name_pattern_rev) {
        if let Some(caps) = re.captures(html) {
            return caps.get(1).map(|m| html_escape::decode_html_entities(m.as_str()).to_string());
        }
    }

    None
}

/// Extract the title from HTML
fn extract_title(html: &str) -> Option<String> {
    let title_pattern = r#"<title[^>]*>([^<]+)</title>"#;
    if let Ok(re) = Regex::new(title_pattern) {
        if let Some(caps) = re.captures(html) {
            return caps.get(1).map(|m| {
                html_escape::decode_html_entities(m.as_str().trim()).to_string()
            });
        }
    }
    None
}

/// Extract favicon URL from HTML
fn extract_favicon(html: &str, base_url: &str) -> Option<String> {
    // Try to find apple-touch-icon first (usually higher quality)
    let apple_icon_pattern = r#"<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)["']"#;
    if let Ok(re) = Regex::new(apple_icon_pattern) {
        if let Some(caps) = re.captures(html) {
            return Some(resolve_url(caps.get(1)?.as_str(), base_url));
        }
    }

    // Try shortcut icon
    let shortcut_pattern = r#"<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']"#;
    if let Ok(re) = Regex::new(shortcut_pattern) {
        if let Some(caps) = re.captures(html) {
            return Some(resolve_url(caps.get(1)?.as_str(), base_url));
        }
    }

    // Fall back to /favicon.ico
    if let Ok(url) = reqwest::Url::parse(base_url) {
        return Some(format!("{}://{}/favicon.ico", url.scheme(), url.host_str()?));
    }

    None
}

/// Resolve a potentially relative URL against a base URL
fn resolve_url(href: &str, base_url: &str) -> String {
    if href.starts_with("http://") || href.starts_with("https://") {
        return href.to_string();
    }

    if let Ok(base) = reqwest::Url::parse(base_url) {
        if href.starts_with("//") {
            return format!("{}:{}", base.scheme(), href);
        }
        if href.starts_with('/') {
            return format!("{}://{}{}", base.scheme(), base.host_str().unwrap_or(""), href);
        }
        // Relative path
        if let Ok(resolved) = base.join(href) {
            return resolved.to_string();
        }
    }

    href.to_string()
}

/// Fetch metadata from a URL for link previews
#[tauri::command]
pub async fn fetch_link_metadata(url: String) -> Result<Option<LinkMetadata>, CommandError> {
    // Create a client with timeout
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (compatible; Nous/1.0)")
        .build()
        .map_err(|e| CommandError {
            message: format!("Failed to create HTTP client: {}", e),
        })?;

    // Fetch the page
    let response = client.get(&url).send().await.map_err(|e| CommandError {
        message: format!("Failed to fetch URL: {}", e),
    })?;

    // Check content type - only process HTML
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !content_type.contains("text/html") {
        return Ok(None);
    }

    // Get the final URL (after redirects)
    let final_url = response.url().to_string();

    // Read body (limit to 1MB to avoid memory issues)
    let body = response
        .text()
        .await
        .map_err(|e| CommandError {
            message: format!("Failed to read response: {}", e),
        })?;

    // Only process first 50KB for meta tags (they're usually in the head)
    let html = if body.len() > 50_000 {
        &body[..50_000]
    } else {
        &body
    };

    // Extract metadata
    let title = extract_meta_content(html, "og:title")
        .or_else(|| extract_meta_content(html, "twitter:title"))
        .or_else(|| extract_title(html));

    let description = extract_meta_content(html, "og:description")
        .or_else(|| extract_meta_content(html, "twitter:description"))
        .or_else(|| extract_meta_content(html, "description"));

    let image = extract_meta_content(html, "og:image")
        .or_else(|| extract_meta_content(html, "twitter:image"))
        .map(|img| resolve_url(&img, &final_url));

    let site_name = extract_meta_content(html, "og:site_name");

    let favicon = extract_favicon(html, &final_url);

    Ok(Some(LinkMetadata {
        title,
        description,
        image,
        site_name,
        favicon,
    }))
}

/// Search the web using Tavily API
#[tauri::command]
pub fn web_search(
    state: State<AppState>,
    query: String,
    api_key: String,
    max_results: Option<i64>,
    search_depth: Option<String>,
    include_answer: Option<bool>,
) -> Result<SearchResponse, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai
        .web_search(
            query,
            api_key,
            max_results.unwrap_or(10),
            search_depth.unwrap_or_else(|| "basic".to_string()),
            include_answer.unwrap_or(true),
        )
        .map_err(|e| CommandError {
            message: format!("Web search error: {}", e),
        })
}

/// Scrape content from a URL
#[tauri::command]
pub fn scrape_url(state: State<AppState>, url: String) -> Result<ScrapedContent, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai.scrape_url(url).map_err(|e| CommandError {
        message: format!("URL scraping error: {}", e),
    })
}

/// Summarize research results using AI
#[tauri::command]
pub fn summarize_research(
    state: State<AppState>,
    contents: Vec<ScrapedContent>,
    query: String,
    provider_type: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
) -> Result<ResearchSummary, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    let config = AIConfig {
        provider_type: provider_type.unwrap_or_else(|| "openai".to_string()),
        api_key,
        model,
        temperature: Some(0.5),
        max_tokens: Some(2000),
    };

    python_ai
        .summarize_research(contents, query, config)
        .map_err(|e| CommandError {
            message: format!("Research summarization error: {}", e),
        })
}

/// URL content for embedding
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlContent {
    pub title: String,
    pub description: String,
    pub content: String,
    pub url: String,
    pub site_name: Option<String>,
    pub favicon: Option<String>,
}

/// Extract main text content from HTML
fn extract_text_content(html: &str) -> String {
    // Remove script and style tags
    let script_re = Regex::new(r"(?is)<script[^>]*>.*?</script>").unwrap();
    let style_re = Regex::new(r"(?is)<style[^>]*>.*?</style>").unwrap();
    let nav_re = Regex::new(r"(?is)<nav[^>]*>.*?</nav>").unwrap();
    let header_re = Regex::new(r"(?is)<header[^>]*>.*?</header>").unwrap();
    let footer_re = Regex::new(r"(?is)<footer[^>]*>.*?</footer>").unwrap();

    let mut text = html.to_string();
    text = script_re.replace_all(&text, "").to_string();
    text = style_re.replace_all(&text, "").to_string();
    text = nav_re.replace_all(&text, "").to_string();
    text = header_re.replace_all(&text, "").to_string();
    text = footer_re.replace_all(&text, "").to_string();

    // Remove all HTML tags
    let tag_re = Regex::new(r"<[^>]+>").unwrap();
    text = tag_re.replace_all(&text, " ").to_string();

    // Decode HTML entities
    text = html_escape::decode_html_entities(&text).to_string();

    // Normalize whitespace
    let whitespace_re = Regex::new(r"\s+").unwrap();
    text = whitespace_re.replace_all(&text, " ").to_string();

    text.trim().to_string()
}

/// Fetch full content from a URL for embedding
#[tauri::command]
pub async fn fetch_url_content(url: String) -> Result<UrlContent, CommandError> {
    // Create a client with timeout
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (compatible; Nous/1.0)")
        .build()
        .map_err(|e| CommandError {
            message: format!("Failed to create HTTP client: {}", e),
        })?;

    // Fetch the page
    let response = client.get(&url).send().await.map_err(|e| CommandError {
        message: format!("Failed to fetch URL: {}", e),
    })?;

    // Check content type
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !content_type.contains("text/html") {
        return Err(CommandError {
            message: "URL does not return HTML content".to_string(),
        });
    }

    // Get the final URL (after redirects)
    let final_url = response.url().to_string();

    // Read body
    let body = response
        .text()
        .await
        .map_err(|e| CommandError {
            message: format!("Failed to read response: {}", e),
        })?;

    // Extract metadata from head (first 50KB)
    let html_head = if body.len() > 50_000 {
        &body[..50_000]
    } else {
        &body
    };

    let title = extract_meta_content(html_head, "og:title")
        .or_else(|| extract_meta_content(html_head, "twitter:title"))
        .or_else(|| extract_title(html_head))
        .unwrap_or_else(|| "Untitled".to_string());

    let description = extract_meta_content(html_head, "og:description")
        .or_else(|| extract_meta_content(html_head, "twitter:description"))
        .or_else(|| extract_meta_content(html_head, "description"))
        .unwrap_or_default();

    let site_name = extract_meta_content(html_head, "og:site_name");
    let favicon = extract_favicon(html_head, &final_url);

    // Extract main text content (limit to reasonable size)
    let content = extract_text_content(&body);
    let content = if content.len() > 10_000 {
        content[..10_000].to_string() + "..."
    } else {
        content
    };

    Ok(UrlContent {
        title,
        description,
        content,
        url: final_url,
        site_name,
        favicon,
    })
}
