/**
 * Interactive animation block — a self-contained, author-supplied graphic
 * (SVG + JS, or canvas) that runs live in the editor and in published pages.
 *
 * Security model (the crux): the author's HTML/JS is UNTRUSTED. It never runs
 * in the app's origin. Instead it renders inside
 *   <iframe sandbox="allow-scripts" srcdoc="…">   ← no allow-same-origin
 * which gives the frame a unique null/opaque origin: scripts run, but they
 * cannot reach the parent DOM, `localStorage` (the daemon key), Tauri
 * `invoke`, cookies, or other shares. A restrictive CSP inside the srcdoc
 * blocks all external network/resource loads, so the animation is fully
 * self-contained. This is the Claude-artifacts isolation model, and the same
 * mechanism is used verbatim in the Rust publish path (`render_animation`).
 *
 * Source lives in the `html` prop (string, on-disk `data.html`). Double-click
 * to edit; blur commits. The preview iframe lazy-mounts on scroll so offscreen
 * animations don't run. Inline styles only — this file is also bundled by the
 * guest editor (no Tailwind, no app stores).
 */
import { useEffect, useRef, useState } from "react";
import type {
  CustomBlockContribution,
  CustomBlockRenderProps,
} from "../custom-block";

/**
 * CSP for the sandboxed document. `default-src 'none'` plus `connect-src 'none'`
 * kills fetch/XHR/WebSocket; assets must be inlined as `data:`/`blob:` URIs.
 * Inline `<style>`/`<script>` are the only executable surfaces allowed.
 */
const SANDBOX_CSP =
  "default-src 'none'; img-src data: blob:; media-src data: blob:; " +
  "style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'";

/**
 * Academic-theme light/dark token values. Kept byte-identical to the palette in
 * `src-tauri/src/publish/html.rs` so editor and published output theme the same.
 */
const LIGHT_VARS =
  "--bg:#fffff8;--text:#1a1a1a;--accent:#8b0000;--panel:#f5f5ef;" +
  "--code-bg:#f0f0ea;--callout-bg:#f9f9f4;--muted:#666;--border:#ccc;";
const DARK_VARS =
  "--bg:#1a1712;--text:#ece8dc;--accent:#e79285;--panel:#231f18;" +
  "--code-bg:#2a2620;--callout-bg:#201d16;--muted:#a49e8c;--border:#38342a;";

/**
 * The page palette, injected as CSS custom properties so an animation can theme
 * itself with `var(--accent)` etc. Custom properties do NOT cross the
 * null-origin iframe boundary, so the values are inlined here. Defaults to the
 * OS preference; an explicit `data-theme` (pushed by the host via postMessage)
 * always wins — matching the main Academic theme's `:root:not([data-theme])`.
 */
const PALETTE_CSS =
  `:root{color-scheme:light dark;${LIGHT_VARS}}` +
  `@media (prefers-color-scheme:dark){:root:not([data-theme]){${DARK_VARS}}}` +
  `:root[data-theme="dark"]{${DARK_VARS}}:root[data-theme="light"]{${LIGHT_VARS}}`;

/**
 * Listener inside the sandboxed frame: the host pushes `{type:'nous-theme',
 * theme}` on load and on every theme flip; we set `data-theme` (re-theming any
 * `var()`-based animation) and re-dispatch a `nous-themechange` event that
 * canvas authors can hook to repaint.
 */
const THEME_LISTENER =
  "<script>addEventListener('message',function(e){" +
  "var d=e&&e.data,t=d&&d.type==='nous-theme'&&d.theme;" +
  "if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);" +
  "window.dispatchEvent(new CustomEvent('nous-themechange',{detail:{theme:t}}));}});<\/script>";

/** Wrap author source in the sandboxed document shell (CSP + palette + reset). */
export function buildAnimationSrcdoc(html: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">` +
    `<style>${PALETTE_CSS} html,body{margin:0;padding:0;height:100%;}` +
    "body{background:var(--bg);color:var(--text);" +
    "font-family:Georgia,'Times New Roman',serif;overflow:hidden;}</style>" +
    `${THEME_LISTENER}</head><body>${html}</body></html>`
  );
}

/** The host's current theme, read from the document root (falls back to OS). */
function hostTheme(): "light" | "dark" {
  const t =
    typeof document !== "undefined"
      ? document.documentElement.getAttribute("data-theme")
      : null;
  if (t === "dark" || t === "light") return t;
  return typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Sanitize an `aspect-ratio` value; fall back to 16/9 on anything unexpected. */
function safeAspect(aspect: string | undefined): string {
  const a = (aspect ?? "").trim();
  return /^[0-9]+(\.[0-9]+)?\s*(\/\s*[0-9]+(\.[0-9]+)?)?$/.test(a) ? a : "16/9";
}

function AnimationRender({
  props,
  updateProps,
  readOnly,
}: CustomBlockRenderProps) {
  const html = props.html ?? "";
  const aspect = safeAspect(props.aspect);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(html);
  const [visible, setVisible] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Lazy-mount the preview: don't run an animation that's offscreen.
  useEffect(() => {
    if (visible) return;
    const el = boxRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  // Push the host theme into the sandboxed frame (it can't read the parent):
  // once the frame loads and again whenever the app's `data-theme` flips.
  useEffect(() => {
    if (!visible) return;
    const frame = iframeRef.current;
    if (!frame) return;
    const push = () => {
      try {
        frame.contentWindow?.postMessage(
          { type: "nous-theme", theme: hostTheme() },
          "*"
        );
      } catch {
        /* frame not ready yet — the load handler will retry */
      }
    };
    frame.addEventListener("load", push);
    push();
    let mo: MutationObserver | undefined;
    if (
      typeof MutationObserver !== "undefined" &&
      typeof document !== "undefined"
    ) {
      mo = new MutationObserver(push);
      mo.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
    }
    return () => {
      frame.removeEventListener("load", push);
      mo?.disconnect();
    };
  }, [visible, html]);

  useEffect(() => {
    if (editing) {
      setDraft(html);
      textareaRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset draft only when opening
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== html) updateProps({ html: draft });
  };

  if (editing && !readOnly) {
    return (
      <div contentEditable={false} style={{ width: "100%" }}>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") commit();
            e.stopPropagation();
          }}
          rows={Math.max(6, draft.split("\n").length + 1)}
          placeholder={
            '<canvas id="c" width="640" height="360"></canvas>\n' +
            "<script>/* draw to #c — runs sandboxed, no network */</script>"
          }
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: "0.85em",
            padding: "8px",
            border: "1px solid var(--color-border, #8884)",
            borderRadius: "6px",
            background: "var(--color-bg-secondary, transparent)",
            color: "inherit",
            resize: "vertical",
          }}
        />
      </div>
    );
  }

  return (
    <div
      ref={boxRef}
      contentEditable={false}
      onDoubleClick={readOnly ? undefined : () => setEditing(true)}
      title={readOnly ? undefined : "Double-click to edit animation source"}
      style={{
        width: "100%",
        aspectRatio: aspect,
        cursor: readOnly ? "default" : "pointer",
      }}
    >
      {html.trim() ? (
        visible ? (
          <iframe
            ref={iframeRef}
            title="Interactive animation"
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={buildAnimationSrcdoc(html)}
            style={{
              width: "100%",
              height: "100%",
              border: "1px solid var(--color-border, #8884)",
              borderRadius: "6px",
              background: "var(--color-bg-secondary, transparent)",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              border: "1px solid var(--color-border, #8884)",
              borderRadius: "6px",
            }}
          />
        )
      ) : (
        <div
          style={{
            padding: "8px 10px",
            border: "1px dashed var(--color-border, #8884)",
            borderRadius: "6px",
            fontSize: "0.85em",
            color: "var(--color-text-muted, #888)",
          }}
        >
          Empty animation — double-click to add HTML/SVG/canvas source
        </div>
      )}
    </div>
  );
}

export const animationBlock: CustomBlockContribution = {
  id: "animation",
  title: "Interactive Animation",
  group: "Custom",
  keywords: ["animation", "interactive", "canvas", "svg", "sketch"],
  propSchema: {
    html: { default: "" },
    aspect: { default: "16/9" },
  },
  content: "none",
  Render: AnimationRender,
};
