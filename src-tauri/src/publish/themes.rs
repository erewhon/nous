use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Theme {
    pub name: &'static str,
    pub page_template: &'static str,
    pub index_template: &'static str,
    pub css: &'static str,
    pub js: Option<&'static str>,
}

pub fn get_theme(name: &str) -> Theme {
    match name {
        "documentation" => theme_documentation(),
        "blog" => theme_blog(),
        "academic" => theme_academic(),
        "docs" => theme_docs(),
        _ => theme_minimal(),
    }
}

pub fn available_themes() -> Vec<&'static str> {
    vec!["minimal", "documentation", "blog", "academic", "docs"]
}

// ---------------------------------------------------------------------------
// Minimal Theme
// ---------------------------------------------------------------------------
fn theme_minimal() -> Theme {
    Theme {
        name: "minimal",
        js: None,
        page_template: r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{page_title}} — {{site_title}}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <nav class="top-nav">
    <a href="index.html" class="site-name">{{site_title}}</a>
  </nav>
  <main>
    <article>
      <h1 class="page-heading">{{page_title}}</h1>
      {{content}}
    </article>
    {{backlinks}}
  </main>
</body>
</html>"#,
        index_template: r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{site_title}}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <nav class="top-nav">
    <a href="index.html" class="site-name">{{site_title}}</a>
  </nav>
  <main>
    <h1>{{site_title}}</h1>
    <ul class="page-list">
{{nav}}
    </ul>
  </main>
</body>
</html>"#,
        css: r#"*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.7;
  color: #222;
  background: #fff;
  max-width: 720px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}
.top-nav { margin-bottom: 2rem; }
.site-name { color: #222; text-decoration: none; font-weight: 600; font-size: 1.1rem; }
.page-heading { font-size: 2rem; margin-bottom: 1.5rem; line-height: 1.2; }
article > * + * { margin-top: 1rem; }
h1, h2, h3, h4 { margin-top: 1.5rem; line-height: 1.3; }
h2 { font-size: 1.5rem; }
h3 { font-size: 1.25rem; }
a { color: #0066cc; }
a:hover { text-decoration: underline; }
pre { background: #f6f6f6; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.9rem; }
code { font-family: "SF Mono", "Fira Code", monospace; font-size: 0.9em; }
:not(pre) > code { background: #f0f0f0; padding: 0.15em 0.35em; border-radius: 3px; }
blockquote { border-left: 3px solid #ddd; padding-left: 1rem; color: #555; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; }
th { background: #f6f6f6; font-weight: 600; }
figure { margin: 1.5rem 0; }
figure img { max-width: 100%; height: auto; border-radius: 4px; }
figcaption { font-size: 0.85rem; color: #666; margin-top: 0.5rem; text-align: center; }
hr { border: none; border-top: 1px solid #ddd; margin: 2rem 0; }
.checklist { list-style: none; padding-left: 0; }
.checklist li { display: flex; align-items: baseline; gap: 0.5rem; }
.callout { border-left: 4px solid #0066cc; background: #f0f7ff; padding: 1rem; border-radius: 4px; margin: 1rem 0; }
.callout-info { border-color: #0066cc; background: #f0f7ff; }
.callout-warning { border-color: #e6a700; background: #fffbf0; }
.callout-error, .callout-danger { border-color: #cc0000; background: #fff0f0; }
.callout-success { border-color: #00a854; background: #f0fff4; }
.callout-title { font-weight: 600; margin-bottom: 0.5rem; }
.broken-link { color: #cc0000; text-decoration: line-through; }
.block-ref { background: #f6f6f6; padding: 0.1em 0.3em; border-radius: 3px; font-style: italic; }
.block-ref.broken { color: #999; }
.page-list { list-style: none; padding: 0; }
.page-list li { margin-bottom: 0.5rem; }
.page-list a { text-decoration: none; font-size: 1.05rem; }
.page-list a:hover { text-decoration: underline; }
.backlinks { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #eee; }
.backlinks h2 { font-size: 1.1rem; color: #666; margin-bottom: 0.75rem; }
.backlinks ul { list-style: none; padding: 0; }
.backlinks li { margin-bottom: 0.35rem; }
.backlinks a { font-size: 0.95rem; }
"#,
    }
}

// ---------------------------------------------------------------------------
// Documentation Theme
// ---------------------------------------------------------------------------
fn theme_documentation() -> Theme {
    Theme {
        name: "documentation",
        js: None,
        page_template: r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{page_title}} — {{site_title}}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <aside class="sidebar">
    <div class="sidebar-header">
      <a href="index.html" class="site-name">{{site_title}}</a>
    </div>
    <nav class="sidebar-nav">
      <ul>
{{nav}}
      </ul>
    </nav>
  </aside>
  <main>
    <article>
      <h1 class="page-heading">{{page_title}}</h1>
      {{content}}
    </article>
    {{backlinks}}
  </main>
</body>
</html>"#,
        index_template: r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{site_title}}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <aside class="sidebar">
    <div class="sidebar-header">
      <a href="index.html" class="site-name">{{site_title}}</a>
    </div>
    <nav class="sidebar-nav">
      <ul>
{{nav}}
      </ul>
    </nav>
  </aside>
  <main>
    <h1>{{site_title}}</h1>
    <p>Welcome to the documentation. Select a page from the sidebar to get started.</p>
  </main>
</body>
</html>"#,
        css: r#"*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.7;
  color: #1a1a2e;
  background: #fff;
  display: flex;
  min-height: 100vh;
}
.sidebar {
  width: 260px;
  flex-shrink: 0;
  background: #f8f9fa;
  border-right: 1px solid #e0e0e0;
  padding: 1.5rem 0;
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  overflow-y: auto;
}
.sidebar-header { padding: 0 1.25rem 1rem; border-bottom: 1px solid #e0e0e0; margin-bottom: 1rem; }
.site-name { color: #1a1a2e; text-decoration: none; font-weight: 700; font-size: 1.15rem; }
.sidebar-nav ul { list-style: none; padding: 0; }
.sidebar-nav li { margin: 0; }
.sidebar-nav a {
  display: block;
  padding: 0.4rem 1.25rem;
  color: #444;
  text-decoration: none;
  font-size: 0.92rem;
  border-left: 3px solid transparent;
  transition: background 0.15s, border-color 0.15s;
}
.sidebar-nav a:hover { background: #eef1f5; border-left-color: #0066cc; color: #0066cc; }
main {
  margin-left: 260px;
  padding: 2.5rem 3rem;
  max-width: 800px;
  width: 100%;
}
.page-heading { font-size: 2rem; margin-bottom: 1.5rem; line-height: 1.2; }
article > * + * { margin-top: 1rem; }
h1, h2, h3, h4 { margin-top: 1.5rem; line-height: 1.3; }
h2 { font-size: 1.5rem; border-bottom: 1px solid #eee; padding-bottom: 0.4rem; }
h3 { font-size: 1.25rem; }
a { color: #0066cc; }
pre { background: #282c34; color: #abb2bf; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.88rem; }
code { font-family: "SF Mono", "Fira Code", monospace; font-size: 0.9em; }
:not(pre) > code { background: #f0f0f0; padding: 0.15em 0.35em; border-radius: 3px; }
blockquote { border-left: 3px solid #ddd; padding-left: 1rem; color: #555; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; }
th { background: #f6f6f6; font-weight: 600; }
figure { margin: 1.5rem 0; }
figure img { max-width: 100%; height: auto; border-radius: 4px; }
figcaption { font-size: 0.85rem; color: #666; margin-top: 0.5rem; text-align: center; }
hr { border: none; border-top: 1px solid #ddd; margin: 2rem 0; }
.checklist { list-style: none; padding-left: 0; }
.checklist li { display: flex; align-items: baseline; gap: 0.5rem; }
.callout { border-left: 4px solid #0066cc; background: #f0f7ff; padding: 1rem; border-radius: 4px; margin: 1rem 0; }
.callout-warning { border-color: #e6a700; background: #fffbf0; }
.callout-error, .callout-danger { border-color: #cc0000; background: #fff0f0; }
.callout-success { border-color: #00a854; background: #f0fff4; }
.callout-title { font-weight: 600; margin-bottom: 0.5rem; }
.broken-link { color: #cc0000; text-decoration: line-through; }
.block-ref { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; font-style: italic; }
.backlinks { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #eee; }
.backlinks h2 { font-size: 1.1rem; color: #666; }
.backlinks ul { list-style: none; padding: 0; }
.backlinks li { margin-bottom: 0.35rem; }
@media (max-width: 768px) {
  .sidebar { position: static; width: 100%; border-right: none; border-bottom: 1px solid #e0e0e0; }
  main { margin-left: 0; padding: 1.5rem; }
  body { flex-direction: column; }
}
"#,
    }
}

// ---------------------------------------------------------------------------
// Blog Theme
// ---------------------------------------------------------------------------
fn theme_blog() -> Theme {
    Theme {
        name: "blog",
        js: None,
        page_template: r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{page_title}} — {{site_title}}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="blog-header">
    <a href="index.html" class="site-name">{{site_title}}</a>
  </header>
  <main>
    <article class="post">
      <header class="post-header">
        <h1 class="post-title">{{page_title}}</h1>
        <time class="post-date">{{date}}</time>
      </header>
      <div class="post-body">
        {{content}}
      </div>
    </article>
    {{backlinks}}
  </main>
  <footer class="blog-footer">
    <p>Published with <a href="index.html">{{site_title}}</a></p>
  </footer>
</body>
</html>"#,
        index_template: r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{site_title}}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="blog-header">
    <a href="index.html" class="site-name">{{site_title}}</a>
  </header>
  <main>
    <div class="post-list">
{{nav}}
    </div>
  </main>
  <footer class="blog-footer">
    <p>Published with {{site_title}}</p>
  </footer>
</body>
</html>"#,
        css: r#"*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.8;
  color: #333;
  background: #fafafa;
}
.blog-header {
  text-align: center;
  padding: 2.5rem 1rem;
  border-bottom: 1px solid #e8e8e8;
  background: #fff;
}
.site-name { color: #111; text-decoration: none; font-weight: 700; font-size: 1.5rem; letter-spacing: -0.02em; }
main {
  max-width: 680px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}
.post { background: #fff; padding: 2.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.post-header { text-align: center; margin-bottom: 2rem; }
.post-title { font-size: 2.2rem; line-height: 1.2; margin-bottom: 0.5rem; }
.post-date { color: #888; font-size: 0.9rem; }
.post-body > * + * { margin-top: 1.25rem; }
h2, h3, h4 { margin-top: 2rem; line-height: 1.3; }
h2 { font-size: 1.5rem; }
h3 { font-size: 1.25rem; }
a { color: #0066cc; }
pre { background: #282c34; color: #abb2bf; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.88rem; }
code { font-family: "SF Mono", "Fira Code", monospace; font-size: 0.9em; }
:not(pre) > code { background: #f0f0f0; padding: 0.15em 0.35em; border-radius: 3px; }
blockquote { border-left: 3px solid #ddd; padding-left: 1rem; color: #555; font-style: italic; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; }
th { background: #f6f6f6; font-weight: 600; }
figure { margin: 2rem 0; }
figure img { max-width: 100%; height: auto; border-radius: 6px; }
figcaption { font-size: 0.85rem; color: #888; margin-top: 0.5rem; text-align: center; }
hr { border: none; border-top: 1px solid #e8e8e8; margin: 2rem 0; }
.checklist { list-style: none; padding-left: 0; }
.checklist li { display: flex; align-items: baseline; gap: 0.5rem; }
.callout { border-left: 4px solid #0066cc; background: #f0f7ff; padding: 1rem; border-radius: 4px; margin: 1rem 0; }
.callout-warning { border-color: #e6a700; background: #fffbf0; }
.callout-error, .callout-danger { border-color: #cc0000; background: #fff0f0; }
.callout-success { border-color: #00a854; background: #f0fff4; }
.callout-title { font-weight: 600; margin-bottom: 0.5rem; }
.broken-link { color: #cc0000; text-decoration: line-through; }
.block-ref { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 3px; font-style: italic; }
.backlinks { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #e8e8e8; }
.backlinks h2 { font-size: 1.1rem; color: #888; }
.backlinks ul { list-style: none; padding: 0; }
.backlinks li { margin-bottom: 0.35rem; }
.post-list { display: flex; flex-direction: column; gap: 1rem; }
.post-list-item { background: #fff; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.post-list-item a { text-decoration: none; font-size: 1.2rem; font-weight: 600; color: #111; }
.post-list-item a:hover { color: #0066cc; }
.post-list-item .date { color: #888; font-size: 0.85rem; display: block; margin-top: 0.25rem; }
.blog-footer {
  text-align: center;
  padding: 2rem 1rem;
  color: #aaa;
  font-size: 0.85rem;
  border-top: 1px solid #e8e8e8;
  margin-top: 3rem;
}
.blog-footer a { color: #888; }
"#,
    }
}

// ---------------------------------------------------------------------------
// Academic Theme
// ---------------------------------------------------------------------------
fn theme_academic() -> Theme {
    Theme {
        name: "academic",
        js: None,
        page_template: r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{page_title}} — {{site_title}}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="site-header">
    <a href="index.html" class="site-name">{{site_title}}</a>
  </header>
  <main>
    <article>
      <header class="article-header">
        <h1>{{page_title}}</h1>
        <div class="article-meta">{{date}}</div>
      </header>
      <div class="article-body">
        {{content}}
      </div>
    </article>
    {{backlinks}}
  </main>
</body>
</html>"#,
        index_template: r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{site_title}}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="site-header">
    <a href="index.html" class="site-name">{{site_title}}</a>
  </header>
  <main>
    <h1>{{site_title}}</h1>
    <ul class="page-list">
{{nav}}
    </ul>
  </main>
</body>
</html>"#,
        css: r#"*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: "Georgia", "Times New Roman", "Palatino Linotype", serif;
  line-height: 1.8;
  color: #1a1a1a;
  background: #fffff8;
  max-width: 700px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}
.site-header { margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 2px solid #1a1a1a; }
.site-name { color: #1a1a1a; text-decoration: none; font-weight: 700; font-size: 1.2rem; font-variant: small-caps; letter-spacing: 0.05em; }
.article-header { margin-bottom: 2rem; }
.article-header h1 { font-size: 2rem; line-height: 1.25; margin-bottom: 0.5rem; }
.article-meta { color: #666; font-size: 0.9rem; font-style: italic; }
.article-body > * + * { margin-top: 1.2rem; }
h1, h2, h3, h4 { font-family: "Georgia", serif; margin-top: 2rem; line-height: 1.3; }
h2 { font-size: 1.4rem; }
h3 { font-size: 1.2rem; }
p { text-align: justify; hyphens: auto; }
a { color: #8b0000; }
a:hover { text-decoration: underline; }
pre { background: #f5f5ef; padding: 1rem; border-radius: 2px; overflow-x: auto; font-size: 0.85rem; border: 1px solid #ddd; }
code { font-family: "Courier New", Courier, monospace; font-size: 0.9em; }
:not(pre) > code { background: #f0f0ea; padding: 0.1em 0.3em; border-radius: 2px; }
blockquote { border-left: 2px solid #999; padding-left: 1.25rem; color: #444; font-style: italic; margin: 1.5rem 0; }
table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
th, td { border: 1px solid #ccc; padding: 0.5rem 0.75rem; text-align: left; }
th { background: #f5f5ef; font-weight: 700; }
figure { margin: 2rem 0; text-align: center; }
figure img { max-width: 100%; height: auto; }
figcaption { font-size: 0.85rem; color: #666; margin-top: 0.5rem; font-style: italic; }
hr { border: none; border-top: 1px solid #ccc; margin: 2.5rem 0; }
.checklist { list-style: none; padding-left: 0; }
.checklist li { display: flex; align-items: baseline; gap: 0.5rem; }
.callout { border: 1px solid #ccc; background: #f9f9f4; padding: 1rem; margin: 1.5rem 0; }
.callout-title { font-weight: 700; margin-bottom: 0.5rem; font-variant: small-caps; }
.broken-link { color: #8b0000; text-decoration: line-through; }
.block-ref { background: #f0f0ea; padding: 0.1em 0.3em; font-style: italic; }
.backlinks { margin-top: 3rem; padding-top: 1.5rem; border-top: 2px solid #1a1a1a; }
.backlinks h2 { font-size: 1rem; font-variant: small-caps; color: #666; letter-spacing: 0.05em; }
.backlinks ul { list-style: none; padding: 0; }
.backlinks li { margin-bottom: 0.35rem; }
.page-list { list-style: none; padding: 0; }
.page-list li { margin-bottom: 0.6rem; }
.page-list a { text-decoration: none; font-size: 1.05rem; color: #8b0000; }
.page-list a:hover { text-decoration: underline; }
"#,
    }
}

// ---------------------------------------------------------------------------
// Modern Docs Theme
// ---------------------------------------------------------------------------
fn theme_docs() -> Theme {
    Theme {
        name: "docs",
        js: Some(DOCS_JS),
        page_template: DOCS_PAGE_TEMPLATE,
        index_template: DOCS_INDEX_TEMPLATE,
        css: DOCS_CSS,
    }
}

const DOCS_PAGE_TEMPLATE: &str = r#"<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{page_title}} — {{site_title}}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="top-bar">
    <button class="hamburger" aria-label="Toggle sidebar">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    </button>
    <a href="index.html" class="top-bar-title">{{site_title}}</a>
    <div class="top-bar-actions">
      <button class="search-trigger" aria-label="Search" title="Search (Ctrl+K)">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="7.5" cy="7.5" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M11.5 11.5L16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <span class="search-shortcut">Ctrl K</span>
      </button>
      <button class="theme-toggle" aria-label="Toggle dark mode">
        <svg class="icon-sun" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.3 3.3l1.4 1.4M13.3 13.3l1.4 1.4M3.3 14.7l1.4-1.4M13.3 4.7l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <svg class="icon-moon" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M15.1 10.4A7 7 0 117.6 2.9a5.5 5.5 0 007.5 7.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  </header>

  <aside class="sidebar">
    <div class="sidebar-header">
      <a href="index.html" class="sidebar-title">{{site_title}}</a>
    </div>
    <nav class="sidebar-nav">
{{nav}}
    </nav>
  </aside>

  <div class="content-wrapper">
    <main>
      <div class="breadcrumbs">{{breadcrumbs}}</div>
      <article>
        <h1 class="page-heading">{{page_title}}</h1>
        {{content}}
      </article>
      {{backlinks}}
      <nav class="page-nav">
        {{prev_link}}
        {{next_link}}
      </nav>
    </main>

    <aside class="toc-sidebar">
      <div class="toc-container">
        <div class="toc-title">On this page</div>
        {{toc}}
      </div>
    </aside>
  </div>

  <div class="search-modal" role="dialog" aria-label="Search">
    <div class="search-backdrop"></div>
    <div class="search-panel">
      <div class="search-input-wrap">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="7.5" cy="7.5" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M11.5 11.5L16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <input type="text" class="search-input" placeholder="Search pages..." autocomplete="off">
        <kbd class="search-esc">Esc</kbd>
      </div>
      <div class="search-results"></div>
    </div>
  </div>

  <script src="docs.js"></script>
</body>
</html>"#;

const DOCS_INDEX_TEMPLATE: &str = r#"<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{site_title}}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="top-bar">
    <button class="hamburger" aria-label="Toggle sidebar">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    </button>
    <a href="index.html" class="top-bar-title">{{site_title}}</a>
    <div class="top-bar-actions">
      <button class="search-trigger" aria-label="Search" title="Search (Ctrl+K)">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="7.5" cy="7.5" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M11.5 11.5L16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <span class="search-shortcut">Ctrl K</span>
      </button>
      <button class="theme-toggle" aria-label="Toggle dark mode">
        <svg class="icon-sun" width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.3 3.3l1.4 1.4M13.3 13.3l1.4 1.4M3.3 14.7l1.4-1.4M13.3 4.7l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <svg class="icon-moon" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M15.1 10.4A7 7 0 117.6 2.9a5.5 5.5 0 007.5 7.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  </header>

  <aside class="sidebar">
    <div class="sidebar-header">
      <a href="index.html" class="sidebar-title">{{site_title}}</a>
    </div>
    <nav class="sidebar-nav">
{{nav}}
    </nav>
  </aside>

  <div class="content-wrapper">
    <main>
      <article class="index-page">
        <h1>{{site_title}}</h1>
        <p>Select a page from the sidebar to get started.</p>
      </article>
    </main>
  </div>

  <div class="search-modal" role="dialog" aria-label="Search">
    <div class="search-backdrop"></div>
    <div class="search-panel">
      <div class="search-input-wrap">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="7.5" cy="7.5" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M11.5 11.5L16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <input type="text" class="search-input" placeholder="Search pages..." autocomplete="off">
        <kbd class="search-esc">Esc</kbd>
      </div>
      <div class="search-results"></div>
    </div>
  </div>

  <script src="docs.js"></script>
</body>
</html>"#;

const DOCS_CSS: &str = r#"*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ---- Light theme ---- */
:root, [data-theme="light"] {
  --bg: #ffffff;
  --bg-sidebar: #f8f9fb;
  --bg-code: #f4f5f7;
  --bg-hover: #eef1f5;
  --bg-search: #ffffff;
  --text: #1e293b;
  --text-secondary: #475569;
  --text-muted: #94a3b8;
  --border: #e2e8f0;
  --accent: #3b82f6;
  --accent-light: #eff6ff;
  --code-bg: #1e293b;
  --code-text: #e2e8f0;
}

/* ---- Dark theme ---- */
[data-theme="dark"] {
  --bg: #0f172a;
  --bg-sidebar: #1e293b;
  --bg-code: #1e293b;
  --bg-hover: #334155;
  --bg-search: #1e293b;
  --text: #e2e8f0;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --border: #334155;
  --accent: #60a5fa;
  --accent-light: rgba(96,165,250,0.1);
  --code-bg: #0f172a;
  --code-text: #e2e8f0;
}

html { scroll-behavior: smooth; }
body {
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  line-height: 1.7;
  color: var(--text);
  background: var(--bg);
}

/* ---- Top bar ---- */
.top-bar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 40;
  height: 56px;
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0 1.25rem;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.top-bar-title {
  font-weight: 600; font-size: 1rem;
  color: var(--text); text-decoration: none;
}
.top-bar-actions { margin-left: auto; display: flex; align-items: center; gap: 0.5rem; }
.hamburger { display: none; background: none; border: none; color: var(--text); cursor: pointer; padding: 4px; }
.search-trigger, .theme-toggle {
  background: none; border: 1px solid var(--border); border-radius: 6px;
  color: var(--text-secondary); cursor: pointer;
  padding: 6px 10px; display: flex; align-items: center; gap: 6px; font-size: 0.8rem;
}
.search-trigger:hover, .theme-toggle:hover { background: var(--bg-hover); color: var(--text); }
.search-shortcut { font-size: 0.7rem; color: var(--text-muted); }
[data-theme="light"] .icon-moon { display: none; }
[data-theme="dark"] .icon-sun { display: none; }

/* ---- Sidebar ---- */
.sidebar {
  position: fixed; top: 56px; left: 0; bottom: 0;
  width: 260px; overflow-y: auto;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  padding: 1rem 0;
  z-index: 30;
}
.sidebar-header {
  padding: 0 1rem 0.75rem;
  display: none;
}
.sidebar-title {
  font-weight: 700; font-size: 1rem;
  color: var(--text); text-decoration: none;
}
.sidebar-nav { padding: 0 0.5rem; }

/* Nav links */
.nav-link {
  display: block; padding: 0.35rem 0.75rem;
  color: var(--text-secondary); text-decoration: none;
  font-size: 0.875rem; border-radius: 6px;
  transition: background 0.12s, color 0.12s;
}
.nav-link:hover { background: var(--bg-hover); color: var(--text); }
.nav-link.active { color: var(--accent); background: var(--accent-light); font-weight: 500; }

/* Section titles */
.nav-section { margin-bottom: 0.75rem; }
.nav-section-title {
  padding: 0.4rem 0.75rem 0.25rem;
  font-size: 0.7rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--text-muted);
}

/* Collapsible folders */
.nav-folder { margin: 0; }
.nav-folder > summary {
  display: flex; align-items: center; gap: 0.25rem;
  padding: 0.35rem 0.75rem;
  font-size: 0.875rem; font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer; border-radius: 6px;
  list-style: none;
}
.nav-folder > summary::-webkit-details-marker { display: none; }
.nav-folder > summary::before {
  content: "";
  display: inline-block; width: 16px; height: 16px; flex-shrink: 0;
  background: currentColor;
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath d='M6 4l4 4-4 4' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
  mask-size: contain;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath d='M6 4l4 4-4 4' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
  -webkit-mask-size: contain;
  transition: transform 0.15s;
}
.nav-folder[open] > summary::before { transform: rotate(90deg); }
.nav-folder > summary:hover { background: var(--bg-hover); }
.nav-folder-items { padding-left: 1rem; }

/* ---- Content wrapper (3-column grid) ---- */
.content-wrapper {
  margin-left: 260px;
  padding-top: 56px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px;
  min-height: calc(100vh - 56px);
}

/* ---- Main content ---- */
main {
  padding: 2rem 2.5rem 3rem;
  max-width: 800px;
  width: 100%;
}
.page-heading { font-size: 2rem; margin-bottom: 1.5rem; line-height: 1.25; font-weight: 700; }
article > * + * { margin-top: 1rem; }
h1, h2, h3, h4 { margin-top: 2rem; line-height: 1.3; scroll-margin-top: 80px; }
h2 { font-size: 1.5rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--border); }
h3 { font-size: 1.25rem; }
a { color: var(--accent); }
a:hover { text-decoration: underline; }

/* Code blocks */
pre {
  background: var(--code-bg); color: var(--code-text);
  padding: 1rem; border-radius: 8px; overflow-x: auto;
  font-size: 0.875rem; position: relative;
}
pre code { background: none; padding: 0; }
code { font-family: "SF Mono", "Fira Code", "JetBrains Mono", monospace; font-size: 0.875em; }
:not(pre) > code {
  background: var(--bg-code); padding: 0.15em 0.4em; border-radius: 4px;
}
pre[class*="language-"]::before {
  content: attr(data-lang);
  position: absolute; top: 0.5rem; right: 0.75rem;
  font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;
}

blockquote {
  border-left: 3px solid var(--accent); padding: 0.5rem 1rem;
  color: var(--text-secondary); background: var(--accent-light);
  border-radius: 0 6px 6px 0;
}
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid var(--border); padding: 0.5rem 0.75rem; text-align: left; }
th { background: var(--bg-sidebar); font-weight: 600; }
figure { margin: 1.5rem 0; }
figure img { max-width: 100%; height: auto; border-radius: 6px; }
figcaption { font-size: 0.85rem; color: var(--text-muted); margin-top: 0.5rem; text-align: center; }
hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
.checklist { list-style: none; padding-left: 0; }
.checklist li { display: flex; align-items: baseline; gap: 0.5rem; }

/* Callouts */
.callout {
  border-left: 4px solid var(--accent); background: var(--accent-light);
  padding: 1rem 1.25rem; border-radius: 0 8px 8px 0; margin: 1.25rem 0;
}
.callout-info { border-color: #3b82f6; background: rgba(59,130,246,0.08); }
.callout-warning { border-color: #f59e0b; background: rgba(245,158,11,0.08); }
.callout-error, .callout-danger { border-color: #ef4444; background: rgba(239,68,68,0.08); }
.callout-success { border-color: #22c55e; background: rgba(34,197,94,0.08); }
.callout-title { font-weight: 600; margin-bottom: 0.5rem; }

.broken-link { color: #ef4444; text-decoration: line-through; }
.block-ref { background: var(--bg-code); padding: 0.1em 0.3em; border-radius: 3px; font-style: italic; }
.block-ref.broken { color: var(--text-muted); }

/* Backlinks */
.backlinks { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--border); }
.backlinks h2 { font-size: 0.9rem; color: var(--text-muted); border: none; padding: 0; margin-top: 0; }
.backlinks ul { list-style: none; padding: 0; }
.backlinks li { margin-bottom: 0.35rem; }
.backlinks a { font-size: 0.9rem; }

/* Breadcrumbs */
.breadcrumbs {
  font-size: 0.8rem; color: var(--text-muted);
  margin-bottom: 0.75rem;
  display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;
}
.breadcrumbs a { color: var(--text-muted); text-decoration: none; }
.breadcrumbs a:hover { color: var(--accent); text-decoration: underline; }
.breadcrumbs .sep { color: var(--text-muted); opacity: 0.5; }

/* Prev / Next nav */
.page-nav {
  display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;
  margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--border);
}
.prev-link, .next-link {
  display: flex; flex-direction: column; gap: 0.25rem;
  padding: 0.75rem 1rem; border: 1px solid var(--border); border-radius: 8px;
  text-decoration: none; color: var(--text); transition: border-color 0.15s;
}
.prev-link:hover, .next-link:hover { border-color: var(--accent); text-decoration: none; }
.next-link { text-align: right; grid-column: 2; }
.page-nav-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.page-nav-title { font-size: 0.9rem; font-weight: 500; color: var(--accent); }

/* ---- TOC sidebar ---- */
.toc-sidebar {
  position: sticky; top: 56px; height: calc(100vh - 56px);
  padding: 2rem 1rem 2rem 0; overflow-y: auto;
}
.toc-container { border-left: 1px solid var(--border); padding-left: 1rem; }
.toc-title {
  font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 0.75rem;
}
.toc-list { list-style: none; padding: 0; margin: 0; }
.toc-list li { margin-bottom: 0.35rem; }
.toc-list a {
  font-size: 0.8rem; color: var(--text-muted); text-decoration: none;
  display: block; padding: 2px 0; transition: color 0.12s;
}
.toc-list a:hover { color: var(--text); }
.toc-list a.active { color: var(--accent); font-weight: 500; }
.toc-list .toc-h3 { padding-left: 0.75rem; }

/* Index page */
.index-page { padding-top: 2rem; }
.index-page h1 { font-size: 2.5rem; margin-bottom: 0.75rem; }
.index-page p { font-size: 1.1rem; color: var(--text-secondary); }

/* ---- Search modal ---- */
.search-modal { display: none; position: fixed; inset: 0; z-index: 100; }
.search-modal.open { display: flex; align-items: flex-start; justify-content: center; padding-top: 15vh; }
.search-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
}
.search-panel {
  position: relative; width: 560px; max-height: 60vh;
  background: var(--bg-search); border: 1px solid var(--border);
  border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  display: flex; flex-direction: column; overflow: hidden;
}
.search-input-wrap {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.75rem 1rem; border-bottom: 1px solid var(--border);
  color: var(--text-muted);
}
.search-input {
  flex: 1; border: none; outline: none; font-size: 1rem;
  background: transparent; color: var(--text);
}
.search-input::placeholder { color: var(--text-muted); }
.search-esc {
  font-size: 0.7rem; padding: 2px 6px;
  background: var(--bg-code); border: 1px solid var(--border);
  border-radius: 4px; color: var(--text-muted);
}
.search-results { overflow-y: auto; padding: 0.5rem; }
.search-result {
  display: block; padding: 0.5rem 0.75rem; border-radius: 6px;
  text-decoration: none; color: var(--text);
}
.search-result:hover { background: var(--bg-hover); }
.search-result-title { font-weight: 500; font-size: 0.9rem; }
.search-result-snippet { font-size: 0.8rem; color: var(--text-muted); margin-top: 2px; }
.search-empty { padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.9rem; }

/* ---- Responsive ---- */
@media (max-width: 1200px) {
  .content-wrapper { grid-template-columns: 1fr; }
  .toc-sidebar { display: none; }
}
@media (max-width: 768px) {
  .hamburger { display: block; }
  .sidebar {
    transform: translateX(-100%); transition: transform 0.2s ease;
    z-index: 50; width: 280px;
  }
  body.sidebar-open .sidebar { transform: translateX(0); }
  body.sidebar-open::after {
    content: ""; position: fixed; inset: 0; z-index: 45;
    background: rgba(0,0,0,0.3);
  }
  .content-wrapper { margin-left: 0; }
  main { padding: 1.5rem 1rem; }
  .top-bar-title { display: block; }
  .search-shortcut { display: none; }
  .search-panel { width: calc(100vw - 2rem); }
}
"#;

const DOCS_JS: &str = r#"(function(){
  // Dark mode
  var html = document.documentElement;
  var stored = localStorage.getItem("docs-theme");
  if (stored) { html.setAttribute("data-theme", stored); }
  else if (window.matchMedia("(prefers-color-scheme: dark)").matches) { html.setAttribute("data-theme", "dark"); }

  document.querySelector(".theme-toggle").addEventListener("click", function() {
    var next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", next);
    localStorage.setItem("docs-theme", next);
  });

  // Active nav link
  var slug = location.pathname.split("/").pop().replace(".html", "") || "index";
  document.querySelectorAll(".nav-link").forEach(function(a) {
    if (a.getAttribute("data-slug") === slug) {
      a.classList.add("active");
      var p = a.closest(".nav-folder");
      while (p) { p.setAttribute("open", ""); p = p.parentElement.closest(".nav-folder"); }
    }
  });

  // Mobile sidebar
  var hamburger = document.querySelector(".hamburger");
  if (hamburger) {
    hamburger.addEventListener("click", function() { document.body.classList.toggle("sidebar-open"); });
    document.addEventListener("click", function(e) {
      if (document.body.classList.contains("sidebar-open") && !e.target.closest(".sidebar") && !e.target.closest(".hamburger")) {
        document.body.classList.remove("sidebar-open");
      }
    });
  }

  // Scroll spy for TOC
  var tocLinks = document.querySelectorAll(".toc-list a");
  if (tocLinks.length) {
    var headings = [];
    tocLinks.forEach(function(a) {
      var id = a.getAttribute("href").slice(1);
      var el = document.getElementById(id);
      if (el) headings.push({ el: el, link: a });
    });
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          tocLinks.forEach(function(l) { l.classList.remove("active"); });
          headings.forEach(function(h) {
            if (h.el === entry.target) h.link.classList.add("active");
          });
        }
      });
    }, { rootMargin: "-80px 0px -70% 0px" });
    headings.forEach(function(h) { observer.observe(h.el); });
  }

  // Search
  var modal = document.querySelector(".search-modal");
  var input = document.querySelector(".search-input");
  var resultsEl = document.querySelector(".search-results");
  var index = null;

  function openSearch() { modal.classList.add("open"); input.value = ""; resultsEl.innerHTML = ""; input.focus(); }
  function closeSearch() { modal.classList.remove("open"); }

  document.querySelector(".search-trigger").addEventListener("click", openSearch);
  document.querySelector(".search-backdrop").addEventListener("click", closeSearch);
  document.addEventListener("keydown", function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); openSearch(); }
    if (e.key === "/" && !e.target.closest("input,textarea,[contenteditable]")) { e.preventDefault(); openSearch(); }
    if (e.key === "Escape") closeSearch();
  });

  input.addEventListener("input", function() {
    var q = input.value.toLowerCase().trim();
    if (!q) { resultsEl.innerHTML = ""; return; }
    if (!index) {
      try { var x = new XMLHttpRequest(); x.open("GET", "search-index.json", false); x.send(); index = JSON.parse(x.responseText); } catch(e) { index = []; }
    }
    var matches = index.filter(function(p) { return p.t.toLowerCase().includes(q) || p.b.toLowerCase().includes(q); }).slice(0, 10);
    if (!matches.length) { resultsEl.innerHTML = '<div class="search-empty">No results found</div>'; return; }
    resultsEl.innerHTML = matches.map(function(m) {
      return '<a class="search-result" href="' + m.s + '.html"><div class="search-result-title">' + esc(m.t) + '</div><div class="search-result-snippet">' + esc(m.b.slice(0, 120)) + '</div></a>';
    }).join("");
  });

  function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
})();
"#;
