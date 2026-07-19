---

## Paste-ready prompt

You're redesigning the look of **Nous** — a real, local-first personal notebook and thinking tool I use every day
and am proud of. It's my daily driver, and right now it works beautifully but _looks_ like what it is: a
developer-built power tool. I want it to look **designed** — like something with a point of view — without losing an
ounce of what makes it fast and capable. I'll ship what you make. Show me your best work.

**What Nous is.** A local-first knowledge workspace — think the love-child of Obsidian, Notion, and a good
Zettelkasten, but yours and offline-first. The name is Greek — _nous_: mind, intellect, reason — and the product's
soul is "where thinking takes form." What a user actually does in it:

- **Writes** in a block editor (headings, quotes, callouts, code, to-dos, images, embeds) with **wiki-links**
  (`[[page]]`) and **block references** that weave notes into a graph.
- **Organizes** into notebooks → sections → folders → pages, with daily notes, tags, favorites, and a
  **command palette** (⌘K) as the primary way to move.
- **Builds databases** — Notion-style multi-view (table / board / gallery / calendar / timeline) over structured pages.
- **Sees the shape of their thinking** — a force-directed **graph view**, plus tasks, goals, flashcards, a
  calendar, and an AI chat panel.
- It's **free software (AGPL-3.0)**, private, offline-first, and deeply customizable.

**The honest current state — this is what you're improving.** Nous is dense, dark-first, and IDE-flavored (closer
to Obsidian/Logseq/Linear than to a warm consumer notebook). It's competent but _utilitarian_: small type, tight
rhythm, lots of hairline dividers, muted uppercase micro-labels, subtle grey hover fills, a violet accent. The
polish is **uneven** — a few surfaces (command palette, notebook cards, settings modal, the editor empty-state) are
genuinely nice (rounded corners, backdrop blur, a gradient, a hover-scale), while the everyday chrome is flat and
plain. There is **no distinct typeface** (it ships on the system sans stack), and **no scale for radii, shadows,
spacing, or motion** — those are ad-hoc per component. Your job is to give it a _face_ and make the craft
consistent and intentional everywhere.

**The house architecture you must design through — this is non-negotiable and it's what makes the port clean.**
Nous already has a real, tokenized theme system. Respect it and build inside it:

- **~22 CSS custom properties per theme**, set on `:root` at runtime. Backgrounds:
  `--color-bg-primary / -secondary / -tertiary / -elevated / -sidebar / -panel`. Text:
  `--color-text-primary / -secondary / -muted`. Accent:
  `--color-accent / -hover / -secondary / -tertiary`. Semantic:
  `--color-success / -warning / -error / -info`. Borders: `--color-border / -border-muted`. Plus
  `--color-selection`. **Every color you choose must map onto exactly these tokens** — no orphan hexes.
- It's a **multi-theme, light+dark system.** Today's default is Catppuccin-Mocha dark
  (`--color-bg-primary:#1e1e2e`, `--color-text-primary:#cdd6f4`) with a **violet** accent
  (`--color-accent:#8b5cf6`, Tailwind violet-500 — not Catppuccin mauve). Four other schemes (a zinc/indigo
  "default", nord, dracula, and a cream-serif "tufte") each ship light **and** dark variants. Your new signature
  theme is a **sixth** scheme that becomes the default — the existing five all stay.
- **Violet is the brand through-line.** Keep purple as Nous's color — but you have license to _take it somewhere
  better_ than cold Catppuccin (warmer, deeper, more considered). The graph, links, and accents lean violet today.
- **Offline-first desktop app → fonts must be self-hosted, never a CDN.** If you introduce a typeface (please do —
  this is the "face"), it has to be bundleable as local `.woff2`. Design with web-safe/Google fonts in the
  prototype, but pick faces that can be self-hosted at port time. No runtime network font loads.
- **It's deeply configurable** (UI scale 0.8–1.3, editor width narrow→full, font picker, a full 3-panel sidebar
  _or_ a 48px icon rail, zen mode, auto-hide panels). Your system has to survive that — don't design a look that
  only works at one density or one panel config.

**Your new signature identity — the heart of this.** Give Nous a default theme and a typographic voice with a clear
idea behind it. At minimum:

- **A display/brand face** for page titles, notebook names, section headings, and the wordmark — the thing that
  makes Nous feel like _thinking made visible_. And **a refined UI/text face** for body, chrome, and controls.
  (There's a natural seed here: the existing marketing site already speaks in **Cormorant Garamond + DM Sans**,
  cosmic-violet, editorial and literary. You may pull the app toward that identity to unify the brand — or
  deliberately go your own way. That's the A/B below.)
- **A new default palette** (full light + dark token maps) — deeper, warmer, more intentional than stock
  Catppuccin, still unmistakably Nous-violet.
- **The craft scales the app is missing:** a spacing rhythm, a **radius scale**, an **elevation/shadow system**, and
  a small, quiet **motion system** (hover, focus, panel transitions, reveal). Consistent hover / focus-visible /
  active / selected states for the everyday primitives (list rows, buttons, inputs, tabs, pills, cards). This is
  what turns "flat and plain" into "designed."

**Build TWO complete directions** so I can pick from finished work. Each direction = a **style tile** + the **hero
screens** below, all as self-contained `.html` files (CSS/JS inlined, opens straight in a browser), all driven by
your new `--color-*` token set so they translate 1:1 into the real theme system. The two directions should be
genuinely different _ideas_, both honoring the architecture above:

- **Direction A — "The Study" (editorial).** Bring the marketing site's identity _inside_. Literary and warm: a
  display serif (Cormorant Garamond or kin) for titles and the wordmark, a humanist sans for UI; deeper, warmer
  violets; a touch of ivory/parchment in light mode. Nous as _a mind, a place for thinking_ — generous where the
  eye reads (the editor page body), still tight where it works (tool chrome). This unifies app + landing into one
  brand.
- **Direction B — "The Workshop" (calm modern tool).** A contemporary, Linear/Craft/Things-lineage tool identity:
  one excellent sans used throughout with a strong, confident type scale; crisper, calmer neutrals (off
  Catppuccin's slightly muddy greys); a real elevation system, soft radii, tuned violet accent, and a quiet
  motion language. Its own thing, not tied to the serif-cosmic landing — pure calm-density craft.

**Each direction delivers:**

1. **A style tile** (`direction-{a,b}-style-tile.html`) — the system on one page, in **both light and dark**: all
   ~22 color tokens as labeled swatches; the type scale with your chosen faces (wordmark, H1–H4, body, UI label,
   code); buttons (primary / secondary / ghost) in all states; inputs & the ⌘K search field; a list row (default /
   hover / selected); a card; tabs and filter pills; the four callouts (info/warn/tip/danger); a code block; the
   radius, shadow, and spacing scales visualized; focus-visible rings. This is the contract that ports into the
   token system — make it complete.
2. **Hero screen — the Editor** (the screen a Nous user stares at all day), in **both light and dark**: the
   three-panel shell (sidebar with notebooks/recent + editor + an outline rail), and a real page body showing a
   title, headings, paragraphs, a `[[wiki-link]]`, a callout, a blockquote, a code block, and a to-do. Get the
   _reading_ experience right — this is where taste shows.
3. **Hero screen — the Library / notebook home**: the grid of notebook cards + a recent list. The warm front door.
4. **Hero screen — a Database view** (table or board): the dense, structured surface — prove the new craft holds up
   under high information density without feeling cramped.
5. **One "moment of delight" surface of your choosing** — the ⌘K command palette, daily-notes with its habit/energy
   charts, or the graph view. Pick the one that best sells the direction.

(Screens 3–5 can be dark-only if that's the shipped default mode; the style tile and the editor **must** show both
light and dark, since the token system requires both.)

**Hard constraints (both directions):**

- Self-contained HTML for the prototype — I'll port the winner into the real CSS-variable theme system + React
  components, so keep colors as your `--color-*` tokens (not scattered literals) and keep structure clean.
- **Complete, portable token maps.** Each direction must yield a full light **and** dark set of all ~22
  `--color-*` values — I should be able to paste them straight into `COLOR_SCHEMES`.
- **Don't break the other four themes.** The craft-pass parts (spacing, radii, shadows, motion, states) are shared
  chrome — they must still look right under catppuccin/nord/dracula/tufte. Only the _palette and type_ are the new
  signature; the _structure_ serves every theme.
- Keep Nous **information-dense and fast**. This is a power tool — a real user has hundreds of pages and lives in
  the keyboard. More air is good; a precious, sparse, "one thought per screen" redesign is wrong. Calm density.
- Realistic placeholder content — real-feeling page titles, notebook names, a plausible database, believable graph.
  No lorem, no fake-perfect dashboards.
- Footer/credit where natural: **AGPL-3.0**, local-first, private.

**What to avoid.** Don't turn a working tool into a landing page — no giant hero moments inside the editor, no
motion for its own sake, nothing that adds a click or a scroll to daily work. Don't abandon violet (it's the
brand). Don't invent colors outside the token set. Don't design a look that only survives at one density or breaks
the icon-rail / full-sidebar / zen configurations. And don't just recolor Catppuccin and call it new — I asked for a
**face**, an identity with an idea behind it.

**Craft is yours.** The palette, the typefaces, the exact scales, how much air the editor gets, the motion
character, which delight surface to feature — all your call. Get the _feeling_ right: a tool that's calm,
considered, and quietly beautiful, that a thoughtful person is happy to spend all day inside.

**Verify your own work — in BOTH light and dark for the new default.** Use the browser tools: screenshot the style
tile and every hero screen at desktop / tablet / mobile widths, **in both light and dark**; confirm text/interactive
contrast meets **WCAG AA** in both modes (this is a read-all-day app — contrast matters); confirm no console errors;
confirm any motion stays smooth and never pins the CPU. Sanity-check that your token set is **complete** (all ~22
`--color-*` present for light and dark in each direction) so it drops into the theme engine cleanly.

**Iterate.** Before you call either direction done, make **at least three iteration passes** — each pass, go through
every screen fine-toothed for inconsistency (a radius that doesn't match the scale, a hover state that's missing, a
label that's the wrong weight), for anything that reads "developer-built" rather than "designed," and for chances to
enrich the craft. This is my daily driver — restraint and consistency beat spectacle.

Work fully autonomously — build both directions (style tile + hero screens each), verify in both themes, iterate,
and don't ask me anything until both are done. When finished, give me the files plus a short note per direction:
the core idea, the palette + type choices, the token map, and where you took the most license.
