# Nous — two signature design directions

> **✅ Chosen: Direction A — "The Study" (the `study` scheme).** Decided 2026-07-19.
> Port the `study` light+dark token map (below) as the new default `COLOR_SCHEMES` entry.
> **Graft in from B:** the grouped/status database table — group headers with dot + count, priority
> bar-glyphs (P0–P3), a mono ID column, index-mark on the selected row, strikethrough on Done. It's
> shared chrome, so it drops into A's palette + type. A's flat table stays for simple databases.
> Full decision record + verify-at-port notes: `meta/design-briefs/nous-app.md` § "Decision record".



Two complete, self-contained prototype directions for the Nous redesign. Every file opens directly
in a browser, carries a **theme toggle** (moon button) plus a `?theme=light|dark` URL parameter,
and drives every color through the exact 20-token `--color-*` contract from `themeStore.ts` —
each style tile renders a **paste-ready `COLOR_SCHEMES` object** at the bottom of the page.

Reference captures of every screen in both modes live in `shots/`.

| Screen | Direction A — The Study | Direction B — The Workshop |
|---|---|---|
| Style tile | `direction-a-style-tile.html` | `direction-b-style-tile.html` |
| Editor (light+dark) | `direction-a-editor.html` | `direction-b-editor.html` |
| Library | `direction-a-library.html` | `direction-b-library.html` |
| Database | `direction-a-database.html` (Reading Log table) | `direction-b-database.html` (grouped release table) |
| Delight surface | `direction-a-graph.html` (the constellation) | `direction-b-palette.html` (⌘K) |

---

## Direction A — "The Study" (editorial)

**Core idea.** The landing page's cosmic-editorial identity, brought inside the tool. Dark mode is
a lamplit study at night: warm ink-violet surfaces (hue ~262°, never Catppuccin's cold navy), ivory
text like lamplight on paper. Light mode is the same room by morning: parchment, ink, deep violet.
Titles open like chapters (eyebrow + Cormorant + accent-tipped hairline), wiki-links read as a
scholar's marginalia (soft violet underline that fills on hover), and the graph view is literally
the landing page's constellation — CSS-twinkling stars in dark mode that disappear "by daylight."

**Type.** Cormorant Garamond 500–700 (titles, notebook names, H1/H2, wordmark, blockquotes) ·
DM Sans 400–700 (body, UI chrome) · IBM Plex Mono 400–500 (code, data). All self-hostable .woff2;
these are the marketing site's own faces, so app and landing become one brand.

**Craft scales.** 4px spacing rhythm (`4…64`) · radii 4/7/10/14/20/full · lamplight elevation
(4 warm-tinted shadow levels — never pure black) · motion 130/190/260ms with a "settle" ease
`cubic-bezier(.22,.61,.36,1)`. Notebook cards carry a 3px colored **spine** (bookshelf motif).

**Most license taken.** Serif blockquotes set in Cormorant italic at 20px; the "Good evening."
library greeting; the constellation graph with decorative star layer (reduced-motion kills the
twinkle; light mode hides the stars entirely).

### Token maps — `COLOR_SCHEMES.study`

```js
study: {
  dark: {
    "--color-bg-primary": "#1b1526",   "--color-bg-secondary": "#171120",
    "--color-bg-tertiary": "#272033",  "--color-bg-elevated": "#241c33",
    "--color-bg-sidebar": "#120d1b",   "--color-bg-panel": "#150f1e",
    "--color-text-primary": "#ece7de", "--color-text-secondary": "#b3aac2",
    "--color-text-muted": "#8a80a0",
    "--color-accent": "#ab87fc",       "--color-accent-hover": "#bfa3ff",
    "--color-accent-secondary": "#8a5cf5", "--color-accent-tertiary": "#6e46d9",
    "--color-success": "#a9c98b", "--color-warning": "#e3b96f",
    "--color-error": "#e58e87",   "--color-info": "#8fb8e8",
    "--color-border": "#322a44",  "--color-border-muted": "#251e35",
    "--color-selection": "rgba(171, 135, 252, 0.28)",
  },
  light: {
    "--color-bg-primary": "#faf7f0",   "--color-bg-secondary": "#f3eee3",
    "--color-bg-tertiary": "#eae3d3",  "--color-bg-elevated": "#fffdf8",
    "--color-bg-sidebar": "#f1ecdf",   "--color-bg-panel": "#f6f2e8",
    "--color-text-primary": "#241d33", "--color-text-secondary": "#564c6b",
    "--color-text-muted": "#6f6584",
    "--color-accent": "#6d40cf",       "--color-accent-hover": "#5a30b8",
    "--color-accent-secondary": "#5a34ad", "--color-accent-tertiary": "#48288c",
    "--color-success": "#3f6827", "--color-warning": "#7d5507",
    "--color-error": "#aa332a",   "--color-info": "#2f639e",
    "--color-border": "#ded5c2",  "--color-border-muted": "#ebe5d6",
    "--color-selection": "rgba(109, 64, 207, 0.16)",
  },
},
```

---

## Direction B — "The Workshop" (calm modern tool)

**Core idea.** A beautifully made hand tool — Linear/Craft/Things lineage, but its own bench.
One excellent sans doing the whole hierarchy through weight and size; zinc neutrals warmed ~2°
toward violet so the accent never sits on foreign grey; a real elevation system (1px "machined"
edge highlight + layered shadow); quick physical motion (pressed things compress to 98.5%). The
signature device is the **index mark**: a 3×14px rounded violet bar that marks the active thing
*everywhere* — selected sidebar page, active TOC entry, selected table row, chosen palette result.
Violet asserts itself in chrome in exactly one way, consistently.

**Type.** Instrument Sans variable 400–700 (everything; tracking tightens as size grows:
wordmark −3.5%, H1 −2.2%, body 0) · Geist Mono 400–500 (code, dates, counts, IDs). Both
self-hostable .woff2.

**Craft scales.** Same 4px rhythm · radii 5/8/10/14/full · elevation = `--edge-highlight` inset +
4 shadow levels · motion 120/160/220ms, ease `cubic-bezier(.25,.1,.25,1)`, press `scale(.985)`.

**Most license taken.** The grouped release table (status groups with dots + counts, priority
bar-glyphs, machined editing cell); notebook icon tiles instead of colored dots; the ⌘K palette
with grouped results and match highlighting in accent rather than highlighter-yellow.

### Token maps — `COLOR_SCHEMES.workshop`

```js
workshop: {
  dark: {
    "--color-bg-primary": "#17171d",   "--color-bg-secondary": "#141419",
    "--color-bg-tertiary": "#22222b",  "--color-bg-elevated": "#1d1d25",
    "--color-bg-sidebar": "#0e0e12",   "--color-bg-panel": "#131317",
    "--color-text-primary": "#ececf1", "--color-text-secondary": "#a3a3b2",
    "--color-text-muted": "#80808f",
    "--color-accent": "#8b7cf8",       "--color-accent-hover": "#a29af9",
    "--color-accent-secondary": "#6c5ce7", "--color-accent-tertiary": "#5646c6",
    "--color-success": "#56c186", "--color-warning": "#dfae4f",
    "--color-error": "#ec6a5e",   "--color-info": "#5aa7e8",
    "--color-border": "#26262f",  "--color-border-muted": "#1e1e26",
    "--color-selection": "rgba(139, 124, 248, 0.25)",
  },
  light: {
    "--color-bg-primary": "#fdfdfd",   "--color-bg-secondary": "#f5f5f7",
    "--color-bg-tertiary": "#ebebef",  "--color-bg-elevated": "#ffffff",
    "--color-bg-sidebar": "#f8f8fa",   "--color-bg-panel": "#fafafb",
    "--color-text-primary": "#1b1b21", "--color-text-secondary": "#55555f",
    "--color-text-muted": "#6e6e79",
    "--color-accent": "#5b48d8",       "--color-accent-hover": "#5443c4",
    "--color-accent-secondary": "#4f3fbd", "--color-accent-tertiary": "#40339c",
    "--color-success": "#136c3d", "--color-warning": "#7d5608",
    "--color-error": "#af352c",   "--color-info": "#1e639f",
    "--color-border": "#e5e5ea",  "--color-border-muted": "#efeff3",
    "--color-selection": "rgba(91, 72, 216, 0.16)",
  },
},
```

---

## Verification record

- **WCAG AA (4.5:1)** — audited programmatically in-browser across 31 foreground/background pairs
  per direction per mode, including composited washes (callout tints, status pills, selection):
  **all pairs pass in both directions, both modes** (worst case 4.54:1, A-light success pill;
  dark modes bottom out at 4.76 / 5.62). The light semantic tokens were darkened one step during
  this audit specifically so semantic-on-wash text clears AA.
- **No console errors** across all 10 files × both themes × 1440/1024/390.
- **No page-level horizontal overflow** at 390/520/768/1024/1440 in any file (wide tables scroll
  inside their own container).
- **`prefers-reduced-motion`** disables all animation and transitions in every file.
- Fonts load from Google Fonts in the prototypes only; all six faces (Cormorant Garamond, DM Sans,
  IBM Plex Mono, Instrument Sans, Geist Mono) are self-hostable .woff2 for the port.

## Port notes

- The tile pages render their token maps from the same CSS constants the pages are styled with,
  so the JSON shown in "Port map" can be pasted into `COLOR_SCHEMES` verbatim.
- Everything outside palette + type (spacing, radii, shadows, motion, hover/focus/selected states)
  is shared chrome and holds under catppuccin/nord/dracula/tufte unchanged.
- Notebook identity colors in the prototypes are drawn from the token set (accent/info/success/
  warning/error/muted) — no orphan hexes anywhere.
