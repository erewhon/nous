# Nous — Board view (Kanban) · "The Study" scheme

Two board treatments for the database Board view, built as siblings of the grouped
table (`../direction-a-database.html` chrome + the grouped-table primitives grafted
from Direction B per the decision record). Same dataset as the grouped table —
`Release 0.9 — Sync & Publish`, the same NOU-2xx records — so board and table are
literally two lenses on one object set.

Shared skeleton (both files): the Study token contract verbatim (both modes), the
A-database topbar/db-head/viewbar, Cormorant on the view title only, DM Sans chrome,
IBM Plex Mono IDs — as font *stacks*, no network fonts (self-contained prototypes).
Shared primitives on every card, copied not reinterpreted from the table:

- **Column header = the group row stood upright**: 8px status dot + mono count,
  `bg-panel` header strip. Status colors match the table exactly (Ready=info,
  In Progress=accent, Review=warning, Backlog=text-muted, Done=success).
- **Mono ID** (`NOU-231`), **P0–P3 bar-glyph** (identical CSS), **selected card =
  violet index-mark** (same 3×16px accent bar) + selection wash, **Done = muted +
  strikethrough** with the same decoration-color mix. Cards dropped into Done pick
  up the treatment live.
- Over-WIP: count renders `4 / 3` in warning. Empty column: dashed quiet hint.
  Collapsed column = vertical rail (Backlog ships collapsed; the header menu's
  "Collapse column" produces the same rail). Add-card = the table's ghost
  "+ New task" affordance, inline-editable.
- Interactions: pointer drag (lift → dashed violet drop-slot → drop reflows counts,
  WIP flags, empty hints, Done styling, footer aggregate), Escape cancels; column
  menu (sort by priority/due, collapse, WIP…); arrow-key selection across
  columns/cards; theme toggle + `?theme=light|dark`; faint star-twinkle in dark
  mode only, killed by `prefers-reduced-motion`.

## Board A — "The Ledger" (`board-a-ledger.html`)

Dense power-user card, closest to a table row folded onto two lines: mono ID +
priority glyph/label in the top rule, 13px title, then phase chip · tags ·
estimate · due (mono) · 18px assignee initials. 264px columns on `bg-secondary`
with `r-lg`; cards `bg-elevated`, `r-sm`, border-only at rest (shadow appears on
hover) — the whole 16-task board fits one desktop screen.

License taken: the assignee avatar (table doesn't surface one) and the estimate
in the meta rule — both mono/receded so they read as ledger columns, not new
ornament.

## Board B — "The Corkboard" (`board-b-corkboard.html`)

Airier and warmer: 296px columns on `bg-panel` at `r-xl`, cards `r-md` with
resting lamplight shadow and a 1px hover lift. Each card carries a **3px status
spine** in the column's color — the Study's bookshelf/notebook-spine motif doing
the status-color job. Fewer fields: ID + bare priority glyph, 14px title, tags +
due only. The index-mark sits just right of the spine so selection stays the
same violet mark as the table.

License taken: the spine itself (a board-only element, but built from the
notebook-card spine motif and the column's status color, no new hue), and
slightly warmer empty-state copy ("The review shelf is clear.").

## Craft notes / kept consistent

- Every color is a study token or a `color-mix` of tokens (audited: zero orphan
  hex/rgba outside the token blocks; radii all on the 4/7/10/14/20/full scale —
  the 1–2.5px micro-radii are verbatim from the shipped primitives).
- AA fix designed in: `text-muted` misses 4.5:1 on `bg-elevated` in dark, so card
  meta uses `--text-meta` (muted mixed 55% toward secondary). All other pairs
  audited ≥4.5:1 in both modes.
- Tags wrap-and-clip: when a card runs out of room, whole tag pills drop out
  instead of tearing mid-pill.
- Motion stays on the Study scale (130/190ms settle ease); drag is transform +
  shadow only; `prefers-reduced-motion` zeroes all animation/transitions.

## Verification (2026-07-20, Playwright)

Both boards, both themes: desktop 1440 / tablet 768 / mobile 390 screenshots in
`screenshots/` (plus mid-drag and column-menu captures). Confirmed: drag updates
counts/WIP/empty-hint/aggregate and applies Done styling on drop; add-card mints
NOU-248+ inline; sorts reorder correctly; collapse/expand works; arrow-key
selection moves; `?theme=` param + toggle work; zero console errors; zero
horizontal document overflow at 390; star animation `none` under reduced motion.
