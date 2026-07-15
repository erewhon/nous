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

/// Mermaid runtime + palette bridge, injected into a page's `<head>` (through
/// the `{{head_extra}}` slot) when the page contains a diagram. It maps
/// Mermaid's `base` theme variables onto the theme's CSS custom properties and
/// re-renders on the light/dark toggle so diagrams flip with the page. Returns
/// `None` for themes that don't ship the palette tokens this bridge reads —
/// they degrade to the raw diagram source in a code box. Delivery is a pinned
/// CDN ESM build (matches the app's mermaid ^11.16.0).
pub fn mermaid_head(theme_name: &str) -> Option<&'static str> {
    match theme_name {
        "academic" => Some(ACADEMIC_MERMAID_HEAD),
        _ => None,
    }
}

/// Parent-side bridge for interactive animation blocks, injected into a page's
/// `<head>` when the page contains one. Animation frames are null-origin
/// sandboxed iframes and cannot read the page theme, so the parent pushes it:
/// `postMessage({type:'nous-theme', theme})` to each `iframe.nous-animation`
/// once it loads and again whenever the reader clicks the theme toggle. The
/// frame's own listener (in the srcdoc) flips its `data-theme`, re-theming any
/// `var()`-based animation. `None` for themes without the toggle/palette.
pub fn animation_head(theme_name: &str) -> Option<&'static str> {
    match theme_name {
        "academic" => Some(ACADEMIC_ANIMATION_HEAD),
        _ => None,
    }
}

const ACADEMIC_ANIMATION_HEAD: &str = r#"<script type="module">
function currentTheme() {
  var t = document.documentElement.getAttribute('data-theme');
  return (t === 'dark' || t === 'light')
    ? t
    : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function push(frame) {
  try { frame.contentWindow.postMessage({ type: 'nous-theme', theme: currentTheme() }, '*'); } catch (e) {}
}
function pushAll() { document.querySelectorAll('iframe.nous-animation').forEach(push); }
document.querySelectorAll('iframe.nous-animation').forEach(function (f) {
  f.addEventListener('load', function () { push(f); });
  push(f); // already-loaded frames
});
// Re-push after the toggle flips data-theme (its own handler runs on the same click).
document.querySelectorAll('.theme-toggle').forEach(function (b) {
  b.addEventListener('click', function () { setTimeout(pushAll, 0); });
});
</script>"#;

/// Combined `{{head_extra}}` for a page: the Mermaid runtime and/or the
/// animation theme bridge, in that order, for whatever the page contains.
pub fn page_head_extra(theme_name: &str, has_mermaid: bool, has_animation: bool) -> String {
    let mut out = String::new();
    if has_mermaid {
        out.push_str(mermaid_head(theme_name).unwrap_or(""));
    }
    if has_animation {
        out.push_str(animation_head(theme_name).unwrap_or(""));
    }
    out
}

const ACADEMIC_MERMAID_HEAD: &str = r#"<style>
/* Scroll reveal (default): nodes/edges fade in as the diagram enters view.
   The whole effect lives inside prefers-reduced-motion:no-preference, so
   reduced-motion readers (and any diagram opted out with class "no-reveal")
   see it fully drawn with no animation. */
@media (prefers-reduced-motion: no-preference) {
  pre.mermaid.mreveal-rendering svg { opacity: 0; }
  pre.mermaid.mreveal:not(.no-reveal):not(.mreveal-shown):not(.mstep) [data-reveal] { opacity: 0; }
  pre.mermaid.mreveal:not(.no-reveal):not(.mstep) [data-reveal] {
    transition: opacity 480ms ease;
    transition-delay: calc(var(--reveal-i, 0) * 55ms);
  }
}
/* Sequence step-through (opt-in via a "%% nous:step" comment). Parts past the
   current step are hidden; the hide is unconditional so reduced-motion still
   works (it just starts fully shown), and only the fade is motion-gated. */
pre.mermaid.mstep [data-step]:not(.mstep-on) { opacity: 0; }
@media (prefers-reduced-motion: no-preference) {
  pre.mermaid.mstep [data-step] { transition: opacity 300ms ease; }
}
.mstep-controls { display: flex; align-items: center; gap: 0.75rem; margin: 0.3rem 0 1.4rem; font-family: Georgia, "Times New Roman", serif; font-size: 0.85rem; color: var(--muted); }
.mstep-controls button { font: inherit; color: var(--text); background: transparent; border: 1px solid var(--border); border-radius: 3px; padding: 0.15rem 0.7rem; cursor: pointer; }
.mstep-controls button:hover:not(:disabled) { background: var(--code-bg); border-color: var(--muted); }
.mstep-controls button:disabled { opacity: 0.4; cursor: default; }
.mstep-controls:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.mstep-count { font-variant: small-caps; letter-spacing: 0.04em; min-width: 4.5em; text-align: center; }
</style>
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.esm.min.mjs';
const nodes = Array.from(document.querySelectorAll('pre.mermaid'));
// Stash each diagram's source so we can re-render when the palette flips.
nodes.forEach(function (n) { n.dataset.src = n.textContent; n.classList.add('mreveal'); });
var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Diagram parts to reveal in order, covering flowchart + sequence shapes.
var REVEAL_SEL = '.node, .cluster, .edgePath, .flowchart-link, .edgeLabel, .actor, .actor-line, .messageLine0, .messageLine1, .messageText, .note, .loopLine, .loopText, .labelBox, .labelText, .activation0, .activation1';
// Steppable parts of a sequence diagram (participants + lifelines stay put).
var STEP_SEL = '.messageText, .messageLine0, .messageLine1, .note, .noteText, .activation0, .activation1, .loopLine, .loopText, .labelBox, .labelText';
function bboxTop(el) { try { return el.getBBox().y; } catch (e) { return 0; } }
function hasClass(el, c) { return (' ' + (el.getAttribute('class') || '') + ' ').indexOf(' ' + c + ' ') !== -1; }
function armReveal(pre, svg) {
  var parts = Array.prototype.slice.call(svg.querySelectorAll(REVEAL_SEL));
  // Reveal in reading order (top-to-bottom, then left-to-right).
  parts.sort(function (a, b) {
    var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return (ra.top - rb.top) || (ra.left - rb.left);
  });
  parts.forEach(function (el, i) { el.setAttribute('data-reveal', ''); el.style.setProperty('--reveal-i', String(i)); });
  // Already shown (e.g. re-render on theme toggle), reduced motion, or no
  // observer support: show immediately with no animation.
  if (reduce || pre.dataset.shown === '1' || typeof IntersectionObserver === 'undefined') {
    pre.classList.add('mreveal-shown'); pre.dataset.shown = '1'; return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { pre.classList.add('mreveal-shown'); pre.dataset.shown = '1'; io.disconnect(); }
    });
  }, { threshold: 0.15 });
  io.observe(pre);
}
// Step-through for sequence diagrams: each message (and note) is one step;
// participants + lifelines are always visible. Messages render in source order
// with the label ~a line above its arrow, so we anchor steps on the arrows/notes
// (sorted by y) and attach labels/activations to the anchor just below them.
function armStep(pre, svg) {
  var stepEls = Array.prototype.slice.call(svg.querySelectorAll(STEP_SEL));
  var anchors = stepEls.filter(function (el) {
    return hasClass(el, 'messageLine0') || hasClass(el, 'messageLine1') || hasClass(el, 'note');
  }).sort(function (a, b) { return bboxTop(a) - bboxTop(b); });
  var total = anchors.length;
  if (!total) { armReveal(pre, svg); return; }  // no messages to step through
  pre.classList.add('mstep');
  var rank = new Map();
  anchors.forEach(function (a, i) { rank.set(a, i + 1); });
  stepEls.forEach(function (el) {
    var s;
    if (rank.has(el)) { s = rank.get(el); }
    else {
      var y = bboxTop(el); s = total;
      for (var i = 0; i < total; i++) { if (bboxTop(anchors[i]) >= y - 14) { s = i + 1; break; } }
    }
    el.setAttribute('data-step', String(s));
  });
  var oldBar = pre.nextElementSibling;
  if (oldBar && oldBar.classList && oldBar.classList.contains('mstep-controls')) oldBar.remove();
  var bar = document.createElement('div');
  bar.className = 'mstep-controls'; bar.tabIndex = 0;
  bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Diagram step controls');
  var prev = document.createElement('button'); prev.type = 'button'; prev.textContent = '← Prev';
  var count = document.createElement('span'); count.className = 'mstep-count';
  var next = document.createElement('button'); next.type = 'button'; next.textContent = 'Next →';
  bar.appendChild(prev); bar.appendChild(count); bar.appendChild(next);
  pre.insertAdjacentElement('afterend', bar);
  var cur = reduce ? total : Math.min(parseInt(pre.dataset.cur || '1', 10) || 1, total);
  function apply() {
    pre.dataset.cur = String(cur);
    stepEls.forEach(function (el) { el.classList.toggle('mstep-on', parseInt(el.getAttribute('data-step'), 10) <= cur); });
    count.textContent = cur + ' / ' + total;
    prev.disabled = cur <= 1; next.disabled = cur >= total;
  }
  prev.addEventListener('click', function () { if (cur > 1) { cur--; apply(); } });
  next.addEventListener('click', function () { if (cur < total) { cur++; apply(); } });
  bar.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft' && cur > 1) { cur--; apply(); e.preventDefault(); }
    else if (e.key === 'ArrowRight' && cur < total) { cur++; apply(); e.preventDefault(); }
  });
  apply();
}
function arm(pre) {
  var svg = pre.querySelector('svg');
  if (svg && !pre.classList.contains('no-reveal')) {
    var src = pre.dataset.src || '';
    if (/%%\s*nous:step/.test(src) && /(^|\n)\s*sequenceDiagram\b/.test(src)) armStep(pre, svg);
    else armReveal(pre, svg);
  }
  pre.classList.remove('mreveal-rendering');
}
function palette() {
  var cs = getComputedStyle(document.documentElement);
  var v = function (name) { return cs.getPropertyValue(name).trim(); };
  return {
    background: v('--bg'),
    mainBkg: v('--panel'),
    primaryColor: v('--panel'),
    primaryTextColor: v('--text'),
    primaryBorderColor: v('--accent'),
    secondaryColor: v('--callout-bg'),
    tertiaryColor: v('--code-bg'),
    lineColor: v('--muted'),
    textColor: v('--text'),
    noteBkgColor: v('--panel'),
    noteTextColor: v('--text'),
    noteBorderColor: v('--border'),
    fontFamily: 'Georgia, "Times New Roman", serif'
  };
}
async function renderAll() {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: palette() });
  // Hide the SVG while it re-renders so the reveal starts from blank, not a flash.
  nodes.forEach(function (n) {
    n.textContent = n.dataset.src; n.removeAttribute('data-processed');
    n.classList.remove('mreveal-shown'); n.classList.add('mreveal-rendering');
    var bar = n.nextElementSibling;  // drop stale step controls before re-render
    if (bar && bar.classList && bar.classList.contains('mstep-controls')) bar.remove();
  });
  try { await mermaid.run({ nodes: nodes }); } catch (e) { nodes.forEach(function (n) { n.classList.remove('mreveal-rendering'); }); return; }
  nodes.forEach(arm);
}
renderAll();
// Re-render after the toggle flips data-theme so diagrams follow the palette.
document.querySelectorAll('.theme-toggle').forEach(function (b) {
  b.addEventListener('click', function () { requestAnimationFrame(renderAll); });
});
</script>"#;

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
        page_template: concat!(
            r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{page_title}} — {{site_title}}</title>
  <link rel="stylesheet" href="style.css">
  "#,
            r#"<script>(function(){try{var t=localStorage.getItem('nous-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>"#,
            r#"
  {{head_extra}}
</head>
<body>
  <header class="site-header">
    <a href="index.html" class="site-name">{{site_title}}</a>
    "#,
            r#"<button type="button" class="theme-toggle" aria-label="Toggle dark mode" title="Toggle dark mode">
      <svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" fill="currentColor"/></svg>
      <svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.4" fill="currentColor"/><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><line x1="12" y1="2.5" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21.5"/><line x1="2.5" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21.5" y2="12"/><line x1="5.2" y1="5.2" x2="6.9" y2="6.9"/><line x1="17.1" y1="17.1" x2="18.8" y2="18.8"/><line x1="18.8" y1="5.2" x2="17.1" y2="6.9"/><line x1="6.9" y1="17.1" x2="5.2" y2="18.8"/></g></svg>
    </button>"#,
            r#"
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
  "#,
            r#"<script>document.querySelectorAll('.theme-toggle').forEach(function(b){b.addEventListener('click',function(){var d=document.documentElement,n=d.getAttribute('data-theme')==='dark'?'light':'dark';d.setAttribute('data-theme',n);try{localStorage.setItem('nous-theme',n);}catch(e){}});});</script>"#,
            r#"
</body>
</html>"#
        ),
        index_template: concat!(
            r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{site_title}}</title>
  <link rel="stylesheet" href="style.css">
  "#,
            r#"<script>(function(){try{var t=localStorage.getItem('nous-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>"#,
            r#"
  {{head_extra}}
</head>
<body>
  <header class="site-header">
    <a href="index.html" class="site-name">{{site_title}}</a>
    "#,
            r#"<button type="button" class="theme-toggle" aria-label="Toggle dark mode" title="Toggle dark mode">
      <svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" fill="currentColor"/></svg>
      <svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.4" fill="currentColor"/><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><line x1="12" y1="2.5" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21.5"/><line x1="2.5" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21.5" y2="12"/><line x1="5.2" y1="5.2" x2="6.9" y2="6.9"/><line x1="17.1" y1="17.1" x2="18.8" y2="18.8"/><line x1="18.8" y1="5.2" x2="17.1" y2="6.9"/><line x1="6.9" y1="17.1" x2="5.2" y2="18.8"/></g></svg>
    </button>"#,
            r#"
  </header>
  <main>
    <h1>{{site_title}}</h1>
    <ul class="page-list">
{{nav}}
    </ul>
  </main>
  "#,
            r#"<script>document.querySelectorAll('.theme-toggle').forEach(function(b){b.addEventListener('click',function(){var d=document.documentElement,n=d.getAttribute('data-theme')==='dark'?'light':'dark';d.setAttribute('data-theme',n);try{localStorage.setItem('nous-theme',n);}catch(e){}});});</script>"#,
            r#"
</body>
</html>"#
        ),
        css: r#":root {
  --bg: #fffff8;
  --text: #1a1a1a;
  --accent: #8b0000;
  --panel: #f5f5ef;
  --code-bg: #f0f0ea;
  --callout-bg: #f9f9f4;
  --muted: #666;
  --quote: #444;
  --border: #ccc;
  --pre-border: #ddd;
  --quote-border: #999;
}
/* Warm complementary dark palette — follows the OS until the visitor chooses. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    --bg: #1a1712; --text: #ece8dc; --accent: #e79285;
    --panel: #231f18; --code-bg: #2a2620; --callout-bg: #201d16;
    --muted: #a49e8c; --quote: #c4bfb0;
    --border: #38342a; --pre-border: #38342a; --quote-border: #4a463b;
  }
}
/* Explicit visitor choice — wins over the OS media query in both directions. */
:root[data-theme="dark"] {
  --bg: #1a1712; --text: #ece8dc; --accent: #e79285;
  --panel: #231f18; --code-bg: #2a2620; --callout-bg: #201d16;
  --muted: #a49e8c; --quote: #c4bfb0;
  --border: #38342a; --pre-border: #38342a; --quote-border: #4a463b;
}
:root[data-theme="light"] {
  --bg: #fffff8; --text: #1a1a1a; --accent: #8b0000;
  --panel: #f5f5ef; --code-bg: #f0f0ea; --callout-bg: #f9f9f4;
  --muted: #666; --quote: #444;
  --border: #ccc; --pre-border: #ddd; --quote-border: #999;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { background: var(--bg); }
body {
  font-family: "Georgia", "Times New Roman", "Palatino Linotype", serif;
  line-height: 1.8;
  color: var(--text);
  background: var(--bg);
  max-width: 700px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}
.site-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 2px solid var(--text); }
.site-name { color: var(--text); text-decoration: none; font-weight: 700; font-size: 1.2rem; font-variant: small-caps; letter-spacing: 0.05em; }
.theme-toggle { width: 34px; height: 34px; flex: none; border-radius: 50%; border: 1px solid var(--border); background: transparent; color: var(--text); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; transition: background 0.15s ease, border-color 0.15s ease; }
.theme-toggle:hover { background: var(--code-bg); border-color: var(--muted); }
.theme-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.theme-toggle svg { width: 17px; height: 17px; display: block; }
.theme-toggle .icon-sun { display: none; }
:root[data-theme="dark"] .theme-toggle .icon-moon { display: none; }
:root[data-theme="dark"] .theme-toggle .icon-sun { display: block; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) .theme-toggle .icon-moon { display: none; }
  :root:not([data-theme]) .theme-toggle .icon-sun { display: block; }
}
.article-header { margin-bottom: 2rem; }
.article-header h1 { font-size: 2rem; line-height: 1.25; margin-bottom: 0.5rem; }
.article-meta { color: var(--muted); font-size: 0.9rem; font-style: italic; }
.article-body > * + * { margin-top: 1.2rem; }
h1, h2, h3, h4 { font-family: "Georgia", serif; margin-top: 2rem; line-height: 1.3; }
h2 { font-size: 1.4rem; }
h3 { font-size: 1.2rem; }
p { text-align: justify; hyphens: auto; }
a { color: var(--accent); }
a:hover { text-decoration: underline; }
pre { background: var(--panel); padding: 1rem; border-radius: 2px; overflow-x: auto; font-size: 0.85rem; border: 1px solid var(--pre-border); }
code { font-family: "Courier New", Courier, monospace; font-size: 0.9em; }
:not(pre) > code { background: var(--code-bg); padding: 0.1em 0.3em; border-radius: 2px; }
blockquote { border-left: 2px solid var(--quote-border); padding-left: 1.25rem; color: var(--quote); font-style: italic; margin: 1.5rem 0; }
table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
th, td { border: 1px solid var(--border); padding: 0.5rem 0.75rem; text-align: left; }
th { background: var(--panel); font-weight: 700; }
figure { margin: 2rem 0; text-align: center; }
figure img { max-width: 100%; height: auto; }
figcaption { font-size: 0.85rem; color: var(--muted); margin-top: 0.5rem; font-style: italic; }
hr { border: none; border-top: 1px solid var(--border); margin: 2.5rem 0; }
.checklist { list-style: none; padding-left: 0; }
.checklist li { display: flex; align-items: baseline; gap: 0.5rem; }
.callout { border: 1px solid var(--border); background: var(--callout-bg); padding: 1rem; margin: 1.5rem 0; }
.callout-title { font-weight: 700; margin-bottom: 0.5rem; font-variant: small-caps; }
.broken-link { color: var(--accent); text-decoration: line-through; }
.block-ref { background: var(--code-bg); padding: 0.1em 0.3em; font-style: italic; }
.backlinks { margin-top: 3rem; padding-top: 1.5rem; border-top: 2px solid var(--text); }
.backlinks h2 { font-size: 1rem; font-variant: small-caps; color: var(--muted); letter-spacing: 0.05em; }
.backlinks ul { list-style: none; padding: 0; }
.backlinks li { margin-bottom: 0.35rem; }
.page-list { list-style: none; padding: 0; }
.page-list li { margin-bottom: 0.6rem; }
.page-list a { text-decoration: none; font-size: 1.05rem; color: var(--accent); }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn academic_css_defines_tokens_and_dark_palette() {
        let css = theme_academic().css;
        // Palette is driven by custom properties, not hardcoded hex.
        for token in ["--bg:", "--text:", "--accent:", "--panel:", "--muted:"] {
            assert!(css.contains(token), "academic CSS missing token {token}");
        }
        // Explicit dark override + OS-preference default both present.
        assert!(css.contains(r#":root[data-theme="dark"]"#));
        assert!(css.contains(r#":root[data-theme="light"]"#));
        assert!(css.contains("prefers-color-scheme: dark"));
        // Approved dark ground + lightened accent.
        assert!(css.contains("#1a1712"), "dark background missing");
        assert!(css.contains("#e79285"), "dark accent missing");
    }

    #[test]
    fn academic_templates_embed_toggle_and_no_flash_init() {
        for template in [theme_academic().page_template, theme_academic().index_template] {
            // No-FOUC init runs in <head> before <body>.
            let init = template
                .find("localStorage.getItem('nous-theme')")
                .expect("theme init script missing");
            let body = template.find("<body>").expect("no <body>");
            assert!(init < body, "init script must precede <body> (no flash)");
            // The sun/moon toggle button + persistence listener are present.
            assert!(template.contains(r#"class="theme-toggle""#), "toggle button missing");
            assert!(template.contains("icon-moon") && template.contains("icon-sun"));
            assert!(
                template.contains("localStorage.setItem('nous-theme'"),
                "persistence listener missing"
            );
        }
    }

    #[test]
    fn academic_page_template_exposes_head_extra_slot() {
        assert!(
            theme_academic().page_template.contains("{{head_extra}}"),
            "academic page template must expose the {{head_extra}} injection slot"
        );
    }

    #[test]
    fn animation_head_bridges_theme_toggle_to_sandboxed_frames() {
        assert!(animation_head("minimal").is_none());
        assert!(animation_head("docs").is_none());

        let head = animation_head("academic").expect("academic ships an animation bridge");
        // Deferred module script so the iframes/toggle exist when it runs.
        assert!(head.contains(r#"type="module""#));
        // Pushes the theme to each animation frame on load and on toggle click.
        assert!(head.contains("iframe.nous-animation"), "no frame selector");
        assert!(head.contains("postMessage"), "no postMessage push");
        assert!(head.contains("type: 'nous-theme'"), "wrong message shape");
        assert!(head.contains("querySelectorAll('.theme-toggle')"), "not wired to toggle");
        // Self-contained: no external/CDN dependency.
        assert!(!head.contains("cdn.jsdelivr.net"), "animation bridge must not load a CDN");
    }

    #[test]
    fn page_head_extra_concatenates_only_what_the_page_needs() {
        // Nothing needed → empty (clean head).
        assert_eq!(page_head_extra("academic", false, false), "");
        // Mermaid only.
        let m = page_head_extra("academic", true, false);
        assert!(m.contains("mermaid@11.16.0") && !m.contains("iframe.nous-animation"));
        // Animation only.
        let a = page_head_extra("academic", false, true);
        assert!(a.contains("iframe.nous-animation") && !a.contains("mermaid@11.16.0"));
        // Both, in order.
        let both = page_head_extra("academic", true, true);
        assert!(both.find("mermaid@11.16.0").unwrap() < both.find("iframe.nous-animation").unwrap());
        // A theme without the tokens gets nothing even when the page has blocks.
        assert_eq!(page_head_extra("minimal", true, true), "");
    }

    #[test]
    fn mermaid_head_is_academic_only_and_themes_to_the_palette() {
        assert!(mermaid_head("minimal").is_none());
        assert!(mermaid_head("docs").is_none());

        let head = mermaid_head("academic").expect("academic ships a mermaid runtime");
        // Pinned CDN ESM delivery (matches the app's mermaid ^11.16.0).
        assert!(head.contains("cdn.jsdelivr.net/npm/mermaid@11.16.0"), "pinned CDN missing");
        assert!(head.contains(r#"type="module""#));
        // Initialised per the task: no auto-start, strict sanitising, base theme.
        assert!(head.contains("startOnLoad: false"));
        assert!(head.contains("securityLevel: 'strict'"));
        assert!(head.contains("theme: 'base'"));
        assert!(head.contains("themeVariables"));
        // Palette is read from the theme's CSS custom properties, not hardcoded.
        assert!(head.contains("'--bg'") && head.contains("'--text'") && head.contains("'--accent'"));
        // Re-renders on the light/dark toggle so diagrams follow the page.
        assert!(head.contains(r#"querySelectorAll('.theme-toggle')"#));
        assert!(head.contains("mermaid.run"));
    }

    #[test]
    fn mermaid_head_embeds_scroll_reveal_with_reduced_motion_guard() {
        let head = mermaid_head("academic").unwrap();
        // Reveal is IntersectionObserver-driven and staggered per element.
        assert!(head.contains("IntersectionObserver"), "no scroll observer");
        assert!(head.contains("data-reveal") && head.contains("--reveal-i"), "no staggered reveal");
        // The whole effect is gated on prefers-reduced-motion: no-preference,
        // and there's a JS reduced-motion short-circuit too.
        assert!(head.contains("prefers-reduced-motion: no-preference"), "reveal not motion-gated");
        assert!(head.contains("prefers-reduced-motion: reduce"), "no JS reduced-motion guard");
        // Opt-out hook so a diagram can skip the animation.
        assert!(head.contains("no-reveal"), "no opt-out hook");
    }

    #[test]
    fn mermaid_head_embeds_sequence_step_through() {
        let head = mermaid_head("academic").unwrap();
        // Opt-in gate: a sequence diagram tagged `%% nous:step` steps through.
        assert!(head.contains("nous:step"), "no step opt-in token");
        assert!(head.contains("sequenceDiagram"), "no sequence-type detection");
        // Per-step gating + themed prev/next controls.
        assert!(head.contains("data-step") && head.contains("mstep-on"), "no per-step gating");
        assert!(head.contains("mstep-controls"), "no step controls");
        assert!(head.contains("Prev") && head.contains("Next"), "no prev/next buttons");
        // Keyboard support and reduced-motion (starts fully shown).
        assert!(head.contains("ArrowLeft") && head.contains("ArrowRight"), "no keyboard stepping");
    }
}
