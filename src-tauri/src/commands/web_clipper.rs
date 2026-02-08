//! Web clipper Tauri command — fetches a URL and extracts article content.

use std::io::Cursor;

use serde::Serialize;

use super::notebook::CommandError;
use super::web_research::{extract_favicon, extract_meta_content, extract_title};

/// Content extracted from a web page for clipping
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClippedContent {
    pub title: String,
    pub content: String,
    pub text: String,
    pub url: String,
    pub site_name: Option<String>,
    pub favicon: Option<String>,
}

/// Clip a web page: fetch HTML, extract article with readability, return clean content
#[tauri::command]
pub async fn clip_web_page(url: String) -> Result<ClippedContent, CommandError> {
    // Validate URL
    let parsed_url = reqwest::Url::parse(&url).map_err(|e| CommandError {
        message: format!("Invalid URL: {}", e),
    })?;

    // Fetch the page
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (compatible; Nous/1.0)")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| CommandError {
            message: format!("Failed to create HTTP client: {}", e),
        })?;

    let response = client.get(parsed_url.as_str()).send().await.map_err(|e| CommandError {
        message: format!("Failed to fetch URL: {}", e),
    })?;

    // Check content type
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !content_type.contains("text/html") && !content_type.contains("application/xhtml") {
        return Err(CommandError {
            message: "URL does not return HTML content".to_string(),
        });
    }

    // Track final URL after redirects
    let final_url = response.url().to_string();
    let final_parsed = response.url().clone();

    // Read body
    let body_bytes = response.bytes().await.map_err(|e| CommandError {
        message: format!("Failed to read response body: {}", e),
    })?;

    let body_str = String::from_utf8_lossy(&body_bytes).to_string();

    // Extract metadata from head section (first 50KB)
    let html_head = if body_str.len() > 50_000 {
        &body_str[..50_000]
    } else {
        &body_str
    };

    let site_name = extract_meta_content(html_head, "og:site_name");
    let favicon = extract_favicon(html_head, &final_url);

    // Use readability to extract article content
    let mut cursor = Cursor::new(body_bytes.as_ref());
    let product = readability::extractor::extract(&mut cursor, &final_parsed).map_err(|e| {
        CommandError {
            message: format!("Failed to extract article content: {}", e),
        }
    })?;

    // Use readability title, fall back to meta/HTML title
    let title = if product.title.is_empty() {
        extract_meta_content(html_head, "og:title")
            .or_else(|| extract_title(html_head))
            .unwrap_or_else(|| "Untitled".to_string())
    } else {
        product.title
    };

    Ok(ClippedContent {
        title,
        content: product.content,
        text: product.text,
        url: final_url,
        site_name,
        favicon,
    })
}
