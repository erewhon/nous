use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Theme {
    pub name: &'static str,
    pub page_template: &'static str,
    pub index_template: &'static str,
    pub css: &'static str,
}

pub fn get_theme(name: &str) -> Theme {
    match name {
        "documentation" => theme_documentation(),
        "blog" => theme_blog(),
        "academic" => theme_academic(),
        _ => theme_minimal(),
    }
}

pub fn available_themes() -> Vec<&'static str> {
    vec!["minimal", "documentation", "blog", "academic"]
}

// ---------------------------------------------------------------------------
// Minimal Theme
// ---------------------------------------------------------------------------
fn theme_minimal() -> Theme {
    Theme {
        name: "minimal",
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
