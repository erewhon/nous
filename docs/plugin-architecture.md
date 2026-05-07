# Plugin Architecture

**Status:** Adopted — direction set 2026-05-06. Backend plugin host shipped; frontend extension API being scoped.

## Context

Nous originally aimed at a "rich plugin system" — Lua/WASM backend plugins, JS UI bundles served from the daemon, hybrid plugins spanning both, sandboxed iframes, eventually a marketplace. The original Forge spec ("Plugin architecture rethink — UI vs backend plugins") laid out the full version.

In practice, the rich-plugin model creates more friction than it removes for Nous's actual contribution shape. Nous is a personal-organization tool whose primary surfaces — task planner, nutrition tracker, goals, databases, daily notes, inbox — need first-class integration with command palette, keyboard, settings, sync, theming, accessibility, and (eventually) mobile. Those things leak through any plugin SDK and are better served by built-in code.

The contribution friction argument also reverses on closer inspection. Plugins reduce friction for "add an entirely new vertical that doesn't need to be in core." They *increase* friction for "fix a bug in the task planner" or "make the nutrition tracker integrate better with goals" — because contributors learn a plugin API, work within sandbox limits, and end up with worse UX than if they'd edited core directly.

## Decision

**Build the apps within Nous as first-class features. Ship a small, typed extension API for the long tail.**

Concretely:

- "Apps within Nous" (task planner, nutrition, goals, databases, daily notes, inbox, calendar, energy, spending, and similar) are **built-in**. Web parity means: build them in both the desktop and web frontends.
- A small set of typed **contribution points** lets contributors add narrow, well-defined extensions without touching core.
- **No iframes.** Extensions are typed ES modules loaded directly into the host. Trust model: vetted at merge time. If a marketplace happens later, the trust model gets revisited.

Roughly the VS Code model. Explicitly *not* the Notion (no plugins) or Obsidian (everything-is-a-plugin) model.

## What's a contribution point

A small, typed contract a plugin opts into. The host calls or renders the contribution at the right time; the plugin doesn't reach into core internals.

Initial inventory — APIs subject to change as they're built:

| Contribution point | What it does | Where it runs | Status |
|---|---|---|---|
| **Backend hook** | React to data events (`OnPageUpdated`, `OnInboxCaptured`, `OnGoalProgress`, etc.) | Daemon (Lua) | **Shipped** |
| **Custom block** | New inline block type in the editor | Frontend | Planned |
| **Custom database view** | New visualization for a database | Frontend | Planned |
| **Document processor** | LSP-style: receive page state, return decorations / diagnostics / actions | Frontend or daemon | Planned |
| **Page action** | Button in page header or command palette entry | Frontend | Planned |
| **Sidebar widget** | Pane in a sidebar slot | Frontend | Planned |
| **Importer / exporter** | Read/write external formats | Daemon + optional UI | Partial (built-ins exist) |
| **Theme** | CSS variable overrides | Frontend (manifest-only, no code) | Planned |

The **document processor** is the one to lean on. Same shape as an LSP language server: plugin sees document state, returns structured annotations. A grammar checker, a wiki-link suggester, a broken-image finder, an "extract action items via AI" — all the same contract. Powerful because it pays back across many use cases and across both backend and frontend.

## Criterion for adding a new contribution point

Three questions. If a proposed contribution point fails any, the answer is usually "build it in" or "not yet."

1. **Are there 3+ realistic plugins that need this same hook?** If no, it's a wishlist item, not a contribution point.
2. **Can the contract fit in ~20 lines of TS interface?** If no, narrow it or make it built-in.
3. **Does the plugin only need data the host can pass via a typed `ctx`?** Plugins shouldn't reach into stores or the DOM directly — the contract is what they get.

## Built-in extensions follow the same pattern

Some core features are good candidates to *internally* be implemented as contribution points (most often document processors), shipped in the binary but using the same API a third-party plugin would.

Benefits:

- The extension API is dogfooded by core, so it stays usable and the contract gets exercised by real code.
- Users can cleanly disable any of them in settings (e.g., "turn off spell checker") without forking the binary.
- New contributors writing similar features have a working template to copy.

Candidates that fit the document-processor shape:

- Spell checker
- Wiki-link broken-link marking
- Tag suggester
- Outline / TOC generator
- AI sentence-completion suggestions
- Link-rot / broken-image detection

VS Code does this with its built-in extensions (Markdown preview, JS/TS support); it's a well-trodden pattern.

## What this is *not*

- **Not iframes.** No sandboxed bundle hosting in the daemon. Extensions are vetted at merge time.
- **Not a marketplace.** Plugins live under `{library}/plugins/` or ship in the binary.
- **Not "build a custom CRM out of pure plugins."** Verticals become first-class features.
- **Not a hybrid manifest with backend + frontend bundles spanning both.** Backend plugins are Lua scripts in the daemon; frontend plugins are typed ES modules. They can be paired by convention, but there's no single "hybrid plugin" object spanning the boundary.

## Status of the in-progress work

The Forge task "Plugin architecture rethink — UI vs backend plugins" is being narrowed. Slice 1 (daemon-side Lua host, hook dispatch on page/inbox/goals events, `GET /api/plugins`, `POST /api/plugins/{id}/reload`) shipped 2026-05-04. The remaining work splits into smaller, focused tasks:

- Custom block contribution point
- Custom database view contribution point
- Document processor contribution point
- Migrate the existing built-in UI plugin scaffolding (`PluginBlock.tsx`, etc.) onto whichever of the above subsumes it

Out of scope for this direction: iframe sandbox, daemon-served opaque JS bundles, hybrid-plugin manifest, plugin marketplace.
