//! HTML text extraction utilities for website mirror imports.

use regex::Regex;

/// Extract searchable plain text from HTML content.
///
/// Strips `<script>`, `<style>`, `<nav>`, all remaining tags,
/// decodes HTML entities, and normalizes whitespace.
pub fn html_to_searchable_text(html: &str) -> String {
    let mut text = html.to_string();

    // Remove script tags and content
    let script_re = Regex::new(r"(?is)<script[^>]*>.*?</script>").unwrap();
    text = script_re.replace_all(&text, "").to_string();

    // Remove style tags and content
    let style_re = Regex::new(r"(?is)<style[^>]*>.*?</style>").unwrap();
    text = style_re.replace_all(&text, "").to_string();

    // Remove nav tags and content
    let nav_re = Regex::new(r"(?is)<nav[^>]*>.*?</nav>").unwrap();
    text = nav_re.replace_all(&text, "").to_string();

    // Remove HTML comments
    let comment_re = Regex::new(r"(?s)<!--.*?-->").unwrap();
    text = comment_re.replace_all(&text, "").to_string();

    // Convert block elements to newlines for readable text
    let block_re = Regex::new(r"(?i)</?(div|p|br|h[1-6]|li|tr|blockquote|section|article|header|footer|main|aside|figure|figcaption|details|summary)[^>]*>").unwrap();
    text = block_re.replace_all(&text, "\n").to_string();

    // Remove all remaining HTML tags
    let tag_re = Regex::new(r"<[^>]+>").unwrap();
    text = tag_re.replace_all(&text, "").to_string();

    // Decode common HTML entities
    text = text
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&#x27;", "'")
        .replace("&mdash;", "\u{2014}")
        .replace("&ndash;", "\u{2013}")
        .replace("&hellip;", "\u{2026}")
        .replace("&laquo;", "\u{00ab}")
        .replace("&raquo;", "\u{00bb}");

    // Decode numeric HTML entities (&#NNN;)
    let numeric_entity_re = Regex::new(r"&#(\d+);").unwrap();
    text = numeric_entity_re
        .replace_all(&text, |caps: &regex::Captures| {
            caps[1]
                .parse::<u32>()
                .ok()
                .and_then(char::from_u32)
                .map(|c| c.to_string())
                .unwrap_or_default()
        })
        .to_string();

    // Decode hex HTML entities (&#xHHH;)
    let hex_entity_re = Regex::new(r"&#x([0-9a-fA-F]+);").unwrap();
    text = hex_entity_re
        .replace_all(&text, |caps: &regex::Captures| {
            u32::from_str_radix(&caps[1], 16)
                .ok()
                .and_then(char::from_u32)
                .map(|c| c.to_string())
                .unwrap_or_default()
        })
        .to_string();

    // Normalize whitespace: collapse multiple spaces/tabs to single space
    let space_re = Regex::new(r"[ \t]+").unwrap();
    text = space_re.replace_all(&text, " ").to_string();

    // Collapse multiple newlines to double newline
    let newline_re = Regex::new(r"\n\s*\n+").unwrap();
    text = newline_re.replace_all(&text, "\n\n").to_string();

    text.trim().to_string()
}

/// Extract the `<title>` content from an HTML document.
pub fn extract_html_title(html: &str) -> Option<String> {
    let title_re = Regex::new(r"(?is)<title[^>]*>(.*?)</title>").ok()?;
    title_re.captures(html).map(|caps| {
        let raw = caps[1].trim().to_string();
        // Strip any nested tags inside <title>
        let tag_re = Regex::new(r"<[^>]+>").unwrap();
        let clean = tag_re.replace_all(&raw, "").to_string();
        // Decode entities
        clean
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .trim()
            .to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_html_to_searchable_text_basic() {
        let html = "<html><body><h1>Hello World</h1><p>This is a test.</p></body></html>";
        let text = html_to_searchable_text(html);
        assert!(text.contains("Hello World"));
        assert!(text.contains("This is a test."));
        assert!(!text.contains("<"));
    }

    #[test]
    fn test_html_to_searchable_text_strips_scripts() {
        let html = "<p>Before</p><script>alert('hi');</script><p>After</p>";
        let text = html_to_searchable_text(html);
        assert!(text.contains("Before"));
        assert!(text.contains("After"));
        assert!(!text.contains("alert"));
    }

    #[test]
    fn test_html_to_searchable_text_strips_styles() {
        let html = "<p>Content</p><style>body { color: red; }</style>";
        let text = html_to_searchable_text(html);
        assert!(text.contains("Content"));
        assert!(!text.contains("color"));
    }

    #[test]
    fn test_html_to_searchable_text_decodes_entities() {
        let html = "<p>Tom &amp; Jerry &lt;3</p>";
        let text = html_to_searchable_text(html);
        assert!(text.contains("Tom & Jerry <3"));
    }

    #[test]
    fn test_extract_html_title() {
        let html = "<html><head><title>My Page Title</title></head><body></body></html>";
        assert_eq!(extract_html_title(html), Some("My Page Title".to_string()));
    }

    #[test]
    fn test_extract_html_title_none() {
        let html = "<html><body>No title here</body></html>";
        assert_eq!(extract_html_title(html), None);
    }

    #[test]
    fn test_extract_html_title_with_entities() {
        let html = "<title>Foo &amp; Bar</title>";
        assert_eq!(extract_html_title(html), Some("Foo & Bar".to_string()));
    }
}
