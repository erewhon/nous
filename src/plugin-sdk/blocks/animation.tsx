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
import type * as React from "react";
import type {
  CustomBlockContribution,
  CustomBlockRenderProps,
} from "../custom-block";
import { ANIMATION_TEMPLATES } from "./animationTemplates";

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
 * These are only the fallback: when the host pushes its actual palette values
 * (see THEME_LISTENER), those land as inline custom properties and win.
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
 * Shape of an acceptable pushed color value: hex, a bare keyword, or an
 * rgb()/hsl() function with a digits-and-separators body. Anything else (raw
 * CSS, url(), var()) is rejected. Validated on both sides of the boundary:
 * the host only pushes values that pass, the frame only applies values that
 * pass.
 */
const COLOR_VALUE_RE =
  /^(#[0-9A-Fa-f]{3,8}|[A-Za-z]+|(rgb|rgba|hsl|hsla)\([0-9,.% /-]+\))$/;

/**
 * Listener inside the sandboxed frame: the host pushes `{type:'nous-theme',
 * theme, palette}` on load and on every theme flip. We set `data-theme`
 * (re-theming any `var()`-based animation), overwrite the inlined academic
 * defaults with the page's actual palette values — only a fixed allowlist of
 * tokens, only color-shaped values, never arbitrary CSS — and then re-dispatch
 * a `nous-themechange` event that canvas authors can hook to repaint (values
 * land before the event so repaints read the new palette). A message without
 * `palette` flips the theme against the inlined defaults, so frames behind an
 * older bridge still work. Kept byte-identical to `ANIMATION_THEME_LISTENER`
 * in `src-tauri/src/publish/html.rs`.
 */
const THEME_LISTENER =
  "<script>addEventListener('message',function(e){" +
  "var d=e&&e.data,t=d&&d.type==='nous-theme'&&d.theme;" +
  "if(t!=='dark'&&t!=='light')return;" +
  "var r=document.documentElement,p=d.palette;" +
  "r.setAttribute('data-theme',t);" +
  "if(p&&typeof p==='object'){" +
  "['bg','text','accent','panel','code-bg','callout-bg','muted','border'].forEach(function(k){" +
  "var v=typeof p[k]==='string'?p[k].trim():'';" +
  "if(/^(#[0-9A-Fa-f]{3,8}|[A-Za-z]+|(rgb|rgba|hsl|hsla)\\([0-9,.% /-]+\\))$/.test(v)){r.style.setProperty('--'+k,v);}" +
  "else{r.style.removeProperty('--'+k);}});}" +
  "window.dispatchEvent(new CustomEvent('nous-themechange',{detail:{theme:t}}));});<\/script>";

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

/**
 * Where each frame palette token is read from in the parent document, first
 * match wins: the token itself (a host already speaking the frame contract),
 * the desktop app's `--color-*` theme tokens, then the guest editor's
 * `--guest-*` set. A token that resolves to nothing (or to a non-color) is
 * omitted from the push, so the frame keeps its inlined default for it.
 */
const PALETTE_SOURCES: ReadonlyArray<[string, string[]]> = [
  ["bg", ["--bg", "--color-bg-primary", "--guest-bg"]],
  ["text", ["--text", "--color-text-primary", "--guest-text"]],
  ["accent", ["--accent", "--color-accent", "--guest-accent"]],
  ["panel", ["--panel", "--color-bg-secondary", "--guest-surface"]],
  ["code-bg", ["--code-bg", "--color-bg-tertiary", "--guest-surface"]],
  ["callout-bg", ["--callout-bg", "--color-bg-secondary", "--guest-surface"]],
  ["muted", ["--muted", "--color-text-muted", "--guest-text-muted"]],
  ["border", ["--border", "--color-border", "--guest-border"]],
];

/**
 * The host's palette as frame-contract tokens, for pushing into the sandboxed
 * frame (which can't read the parent's custom properties across the
 * null-origin boundary). Exported for tests.
 */
export function hostPalette(): Record<string, string> {
  const out: Record<string, string> = {};
  if (
    typeof document === "undefined" ||
    typeof getComputedStyle === "undefined"
  ) {
    return out;
  }
  const cs = getComputedStyle(document.documentElement);
  for (const [token, sources] of PALETTE_SOURCES) {
    for (const source of sources) {
      const v = cs.getPropertyValue(source).trim();
      if (COLOR_VALUE_RE.test(v)) {
        out[token] = v;
        break;
      }
    }
  }
  return out;
}

/** Common aspect-ratio presets offered in the editor. */
const ASPECT_PRESETS = ["16/9", "4/3", "1/1", "21/9"];

/** Shared style for the starter-template picker buttons. */
const templateButtonStyle: React.CSSProperties = {
  font: "inherit",
  fontSize: "0.8em",
  padding: "4px 10px",
  border: "1px solid var(--color-border, #8884)",
  borderRadius: "999px",
  background: "var(--color-bg-secondary, transparent)",
  color: "inherit",
  cursor: "pointer",
};

/** Sanitize an `aspect-ratio` value; fall back to 16/9 on anything unexpected. */
export function safeAspect(aspect: string | undefined): string {
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
  const poster = (props.poster ?? "").trim();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(html);
  const [posterDraft, setPosterDraft] = useState(poster);
  const [aspectDraft, setAspectDraft] = useState(aspect);
  const [visible, setVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Track the reader's motion preference so a poster can replace live motion.
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

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

  // Push the host theme + palette values into the sandboxed frame (it can't
  // read the parent): once the frame loads and again whenever the app's
  // `data-theme` flips. themeStore.applyTheme() writes the `--color-*` values
  // before setting `data-theme`, so a re-push here always reads fresh colors.
  useEffect(() => {
    if (!visible) return;
    const frame = iframeRef.current;
    if (!frame) return;
    const push = () => {
      try {
        frame.contentWindow?.postMessage(
          { type: "nous-theme", theme: hostTheme(), palette: hostPalette() },
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
      setPosterDraft(poster);
      setAspectDraft(aspect);
      textareaRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset drafts only when opening
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const nextAspect = safeAspect(aspectDraft);
    const patch: Record<string, string> = {};
    if (draft !== html) patch.html = draft;
    if (posterDraft !== poster) patch.poster = posterDraft;
    if (nextAspect !== aspect) patch.aspect = nextAspect;
    if (Object.keys(patch).length) updateProps(patch);
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
        <input
          value={posterDraft}
          onChange={(e) => setPosterDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") commit();
            e.stopPropagation();
          }}
          placeholder="Poster image (data: URI or URL) — shown when motion is reduced"
          style={{
            width: "100%",
            marginTop: "6px",
            fontFamily: "monospace",
            fontSize: "0.8em",
            padding: "6px 8px",
            border: "1px solid var(--color-border, #8884)",
            borderRadius: "6px",
            background: "var(--color-bg-secondary, transparent)",
            color: "inherit",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "6px",
            marginTop: "6px",
            fontSize: "0.8em",
          }}
        >
          <span style={{ color: "var(--color-text-muted, #888)" }}>Aspect</span>
          {ASPECT_PRESETS.map((preset) => {
            const active = safeAspect(aspectDraft) === preset;
            return (
              <button
                key={preset}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setAspectDraft(preset);
                }}
                style={{
                  ...templateButtonStyle,
                  borderColor: active
                    ? "var(--color-accent, #8b0000)"
                    : "var(--color-border, #8884)",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {preset}
              </button>
            );
          })}
          <input
            value={aspectDraft}
            onChange={(e) => setAspectDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Escape") commit();
              e.stopPropagation();
            }}
            placeholder="custom (e.g. 3/2)"
            style={{
              width: "8em",
              fontFamily: "monospace",
              fontSize: "0.95em",
              padding: "4px 8px",
              border: "1px solid var(--color-border, #8884)",
              borderRadius: "6px",
              background: "var(--color-bg-secondary, transparent)",
              color: "inherit",
            }}
          />
        </div>
      </div>
    );
  }

  // Reduced motion + a poster → show the still instead of running the animation.
  if (reduceMotion && poster) {
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
        <img
          src={poster}
          alt="Animation (static poster)"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            border: "1px solid var(--color-border, #8884)",
            borderRadius: "6px",
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
        ) : poster ? (
          <img
            src={poster}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              border: "1px solid var(--color-border, #8884)",
              borderRadius: "6px",
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
      ) : readOnly ? (
        <div
          style={{
            padding: "8px 10px",
            border: "1px dashed var(--color-border, #8884)",
            borderRadius: "6px",
            fontSize: "0.85em",
            color: "var(--color-text-muted, #888)",
          }}
        >
          Empty animation
        </div>
      ) : (
        <div
          style={{
            padding: "12px",
            border: "1px dashed var(--color-border, #8884)",
            borderRadius: "6px",
          }}
        >
          <div
            style={{
              fontSize: "0.85em",
              color: "var(--color-text-muted, #888)",
              marginBottom: "8px",
            }}
          >
            Insert an animation — pick a starter or begin blank:
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {ANIMATION_TEMPLATES.map((t) => (
              <button
                key={t.id}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  updateProps({ html: t.html });
                }}
                style={templateButtonStyle}
              >
                {t.label}
              </button>
            ))}
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
              style={templateButtonStyle}
            >
              Blank
            </button>
          </div>
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
    poster: { default: "" },
  },
  content: "none",
  Render: AnimationRender,
};
