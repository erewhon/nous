# Editor Migration Research: Yjs-Native Collaborative Editors vs Extending Editor.js

**Research date:** 2026-03-01
**Scope:** Evaluating options for upgrading Nous from block-level Yjs CRDT to character-level (Google Docs-style) real-time collaboration.

---

## Executive Summary

Extending Editor.js with character-level Yjs bindings is technically feasible but deeply impractical. The architecture — one independent `contenteditable` per block — directly conflicts with how production Yjs text bindings work, and the only existing `yjs-editorjs-binding` is an abandoned work-in-progress operating at block level only. The cleanest path to true character-level collaboration is migrating to a ProseMirror-based editor. **BlockNote** is the closest conceptual equivalent to Editor.js (block-based, Notion-style UX, Yjs-native from day one, built on Tiptap/ProseMirror), but it carries a dual-license constraint for its column/export XL packages. **Tiptap directly** offers more control at the cost of significantly more construction work. **Lexical** has a first-party `@lexical/yjs` package but has documented architectural limitations for collaborative cursors that make it a weaker choice.

---

## Part 1: Extending Editor.js with Yjs Character-Level Bindings

### How Editor.js Handles Content Internally

Editor.js is architecturally unique: each block is an **independent `contenteditable` element** (or a non-contenteditable widget) implemented by a plugin. The editor's core is a block orchestrator, not a document editor. Each block renders its own DOM, owns its own event handling, and exposes `render()` and `save()` methods.

Key implications for collaboration:
- There is no unified document model. Text is not in a single `contenteditable`.
- Collaboration must be implemented at the block boundary, not character boundary.
- The `save()` method does a full DOM traversal of all blocks to extract structured JSON — it cannot read individual character operations.
- Inline tools (like wiki-links and block refs) attach to the browser's `Selection` API and inject custom HTML; they are not part of a typed schema.

### Existing Yjs Binding for Editor.js

Two GitHub repositories attempt this:

1. **`hughfenghen/y-editorjs`** — Original attempt, described as needing "a little more love that includes breaking changes." Status: stale.
2. **`mrspence/yjs-editorjs-binding`** — Built as an alternative starting point. Readme explicitly says "THIS IS A WORK-IN-PROGRESS." Last meaningful activity: April 2023. Approach: binds Yjs via the `onChange` event, operating at **block level** (whole block replacement), not character level.

Neither provides character-level CRDT. Both essentially replicate what Nous already has.

### Why Character-Level Collaboration in Editor.js Is Architecturally Blocked

A proper Yjs text binding (as used by y-prosemirror, y-codemirror, y-quill) works by:
- Mapping a `Y.Text` instance to a single `contenteditable`
- Intercepting every character-level DOM mutation
- Translating them into Yjs operations (insertions/deletions with CRDT IDs)

Editor.js has **N contenteditable elements** (one per block). To do proper character-level collaboration you would need to:
1. Bind a separate `Y.Text` to every block's contenteditable at mount time.
2. Track block creation, deletion, and reordering as `Y.Array` operations.
3. Re-bind on every block add/remove.
4. Intercept Editor.js's inline tool rendering (which injects arbitrary HTML) and map it to Yjs attributes.
5. Solve the empty-block problem: Editor.js rejects blocks with empty content, causing data consistency failures across peers.

The Editor.js GitHub discussions confirm this. From Discussion #1874: "EditorJS (v2.x) has some issues with compatibility design for the collaboration scenarios." From Issue #1684: "Swapping block content by ID is not possible with the current Core API." The team is aware and has acknowledged it as a goal for version 3.0, but v3 has no release date and resources are limited (the team is volunteer/spare-time).

### Fundamental Limitations of Extending Editor.js

- No unified document model — per-block contenteditable makes Y.Text binding laborious and fragile.
- No block update API in v2.x — remote updates can only re-render entire blocks.
- Empty block validation failure causes CRDT sync inconsistencies.
- Inline tools are HTML-injection, not schema-typed — they cannot participate in Yjs-level formatting marks.
- Editor.js v3.0 might resolve some of these, but timeline is unknown and community flagged slow development pace.
- **Verdict: Building character-level collaboration on Editor.js is not a viable path. It would require effectively rewriting Editor.js internals.**

---

## Part 2: Yjs-Native Editor Evaluation

### 2.1 Tiptap (ProseMirror-based)

**What it is:** A headless rich text editor framework built on ProseMirror. Provides the primitives; you build the UI.

**Yjs Integration Maturity: Excellent.**
- Uses `y-prosemirror` (maintained by the core Yjs team) which maps `Y.XmlFragment` to ProseMirror state.
- Provides `ySyncPlugin`, `yCursorPlugin`, and `yUndoPlugin`.
- Character-level CRDTs via Yjs YATA algorithm: every character has a unique Lamport Timestamp ID.
- Collaborative cursors and presence awareness built-in.
- Offline support via IndexedDB persistence.
- Hocuspocus is the official open-source WebSocket backend, compatible with Yrs (the Rust port).
- This is the most battle-tested Yjs integration in the browser editor space.

**Block-Based Editing Support:**
- StarterKit includes: Heading (h1-h6), Paragraph, Blockquote, BulletList, OrderedList, CodeBlock, HorizontalRule, HardBreak.
- Additional official extensions: Table + TableRow + TableHeader + TableCell, TaskList + TaskItem, Image, Highlight, Typography, Placeholder.
- In June 2025, Tiptap open-sourced 10 formerly Pro extensions under MIT license — these include things like file handlers, unique IDs, and more. Collaboration extension itself has always been open source.
- Columns: Community extensions exist (`@tiptap-extend/columns`, `@gocapsule/column-extension`) but no official maintained first-party columns extension. The community extensions use CSS Grid. This is a gap for Nous.

**Extensibility for Custom Block Types:**
- Full ProseMirror schema control. Custom Node with `Node.create()`, custom Mark with `Mark.create()`.
- Inline nodes (atom nodes, `inline: true`) are the natural fit for wiki-links and block references — they render as non-editable atoms within a text flow, exactly like the existing `<wiki-link>` custom elements.
- Node views allow React/Svelte/Vue components to render custom nodes.
- Custom marks for text styles (bold, italic, custom highlighting, etc.).
- The Tiptap mention extension is the canonical reference for implementing wiki-links — it's an inline atom node with autocomplete.

**License:** MIT for core and all StarterKit extensions. Collaboration extension is MIT. As of June 2025, formerly-Pro extensions also MIT. The Tiptap Cloud/collaboration server is a paid SaaS product, but Hocuspocus (self-hosted backend) is MIT.

**Community Size:**
- ~35,000 GitHub stars on the main repo.
- @tiptap/core: 5.3 million weekly npm downloads.
- 1,400+ downstream npm packages depend on it.
- Actively maintained by ueberdosis GmbH with commercial backing.

**Migration Effort from Editor.js:** Tiptap provides an official migration guide (updated March 2026). A converter library `editorjs-to-tiptap` exists for data format conversion. The core differences:
- Editor.js: flat `{blocks: [{id, type, data}]}` array.
- Tiptap/ProseMirror JSON: hierarchical tree `{type: "doc", content: [{type: "heading", attrs: {level: 2}, content: [{type: "text", text: "..."}]}]}`.
- Every Editor.js block type maps to a Tiptap node type.
- Custom inline tools (wiki-links, block refs) must be reimplemented as Tiptap inline atom nodes — the concepts map directly but the API is entirely different.

### 2.2 BlockNote (Built on Tiptap/ProseMirror)

**What it is:** A React-first block-based editor that looks and feels like Notion, built on top of Tiptap and ProseMirror. It is the closest functional analog to Editor.js in the ProseMirror world.

**Yjs Integration Maturity: First-class.**
- Yjs is a core design pillar, not an add-on.
- The `@blocknote/core` package exports `useCreateBlockNote` with a `collaboration` option that accepts a Yjs provider and `Y.XmlFragment`.
- PartyKit is supported out of the box (same provider Nous already uses).
- Character-level CRDT is inherited from y-prosemirror underneath.
- Collaborative cursors, presence awareness, user names/colors all built-in.
- The `@blocknote/core/yjs` export provides conversion utilities between BlockNote blocks and `Y.Doc` for importing existing content.
- Actively maintained; the BlockNote team are stated contributors to Yjs, Hocuspocus, and Tiptap.

**Block-Based Editing Support (default schema):**
- Paragraph, Heading (h1-h3), Quote/Blockquote, BulletList, NumberedList, CheckList (with toggle), ToggleList, CodeBlock (with syntax highlighting), Table (with headers, cell background color, cell text color), Image, Video, Audio, File, Embed.
- Slash menu, drag handles, formatting toolbar — all built-in.
- This covers most of Nous's current block set: headers, paragraphs, lists, checklists, code blocks, quotes, tables, image upload. Gaps: delimiters (horizontal rules), callouts, drawings, columns (XL package only), custom block types (nested editors not supported for custom blocks — see limitation below).

**Extensibility:**
- Custom block types via `createReactBlockSpec()` — renders any React component.
- Custom inline content via `createReactInlineContentSpec()` — this is the path for wiki-links and block references.
- Custom text styles (marks) also supported.
- **Known limitation:** Custom blocks cannot be nested. If a user creates a heading inside a custom block, it appears below the block rather than inside it (Issue #1540). This affects the Nous "columns" block which relies on nested editors.
- TypeScript-native with full type safety across custom schemas.

**Columns / Multi-Column Layout:**
- The `@blocknote/xl-multi-column` package provides column support.
- **Licensing:** XL packages are dual-licensed: GPL-3.0 for open source, or a commercial license (BlockNote Business tier) for closed-source apps.
- Nous is a desktop commercial app — if it remains closed-source, using columns would require a paid BlockNote Business subscription or keeping the columns feature out.
- The core `@blocknote/core` is MPL-2.0: can be used in commercial apps, modifications to BlockNote's source files must be published, but your own application code can remain proprietary.

**Is BlockNote Essentially "Editor.js but Yjs-Native"?**
Yes, with important caveats:
- Conceptually: both are block-based, both output structured block data, both support custom block types, both use drag-and-drop block manipulation, both have slash menus.
- BlockNote has true character-level Yjs collaboration; Editor.js does not.
- BlockNote's data model is ProseMirror under the hood (hierarchical XML tree), not Editor.js's flat JSON. The API surface is different.
- BlockNote's custom block extensibility has the nesting limitation.
- The UX is more polished and Notion-like out of the box.
- The XL column package creates a commercial licensing dependency.

**License:** MPL-2.0 (core), GPL-3.0 / Commercial (XL packages).

**Community Size:**
- Active development: version 0.46.x as of early 2026, published frequently.
- Backed by TypeCellOS with significant investment in the Yjs ecosystem.
- Smaller community than Tiptap but growing rapidly; the GitHub repo is among the rising stars in the space.

### 2.3 Novel (Built on Tiptap)

**What it is:** A Notion-style editor demo/template with AI autocompletion, built on Tiptap by Steven Tey (Vercel). Primarily a showcase/starter, not a library.

**Yjs Integration Maturity: None built-in.**
- There is a GitHub discussion (#104) about adding Yjs collaboration, but no PR has been merged.
- Novel is not designed as a collaboration-first editor.
- It is a thin Tiptap wrapper — you could add y-prosemirror yourself but you are essentially using Tiptap at that point.

**Verdict:** Not a viable option for this use case. Novel is a demo, not a production editor framework. Skip it.

### 2.4 Lexical (Meta)

**What it is:** An extensible editor framework from Meta. Powers some Facebook/Instagram text inputs. MIT license.

**Yjs Integration Maturity: First-party but with documented limitations.**
- The `@lexical/yjs` package provides Yjs bindings.
- `LexicalCollaborationPlugin` and `useCollaborationContext` hook for React.
- Character-level text sync via Yjs.
- **However:** The collaboration cursor implementation has a documented architectural problem. Lexical's "decorator nodes" mutate the document content (unlike ProseMirror decorations which are read-only view-layer overlays). This means collaborative cursors must be drawn as positioned HTML divs on top of content, listening to scroll/resize events. This is fragile and has multiple open issues about cursor positioning being wrong near decorator nodes.
- GitHub issues #3157 and #3426 document cursor positioning failures that are still open.
- Only `y-websocket` is the officially supported Yjs provider. PartyKit (which Nous uses) may work but is not officially supported.
- The playground demo with collaboration is explicitly labeled "not production ready."

**Block-Based Editing Support:**
- Lexical is lower-level than BlockNote. It supports block-level nodes (HeadingNode, ParagraphNode, QuoteNode, CodeNode, ListNode, ListItemNode, TableNode) and inline nodes (LinkNode, custom nodes).
- No built-in slash menu or drag handles — you build the UI.
- Custom nodes (DecoratorNodes) can render arbitrary React components.
- Image upload, tables, etc. are available via community/official plugins.

**Extensibility:**
- Plugin-based architecture. Strongly typed node system.
- Custom inline nodes work for wiki-links and block refs.
- No built-in columns support.

**License:** MIT. Free and fully open.

**Community Size:**
- ~19,000 GitHub stars.
- Meta uses it internally.
- Actively maintained but primarily driven by Meta's internal needs.
- The ProseMirror community is larger and the Yjs integrations are more mature on the ProseMirror side.

**Verdict:** Lexical is a serious option for pure text editing, but the collaboration cursor limitation, the decorator node mutation issue, the lack of PartyKit support, and the weaker ecosystem compared to ProseMirror make it a riskier choice for Nous specifically. The fundamental architectural difference (vs ProseMirror's pure decoration model) means collaborative presence features will always be harder to get right.

### 2.5 Other Notable Options

**Remirror:** ProseMirror-based with 30+ plugins, React hooks, good accessibility. Less popular than Tiptap. Yjs support via y-prosemirror. Not block-based in the Editor.js sense. Probably not worth the additional learning investment given Tiptap's larger community.

**Plate (formerly Slate-based):** Built on Slate.js. Collaboration is only via Hocuspocus. Slate has known limitations around collaboration and extensibility. Not recommended.

**ProseMirror directly:** The foundation everything else sits on. Maximum control, no UI. Using it directly would mean building everything BlockNote/Tiptap already provide. Not practical for a solo developer timeline.

---

## Part 3: Migration Effort Analysis

### Data Format Migration

**Current Nous format:**
```json
{
  "blocks": [
    {"id": "abc", "type": "header", "data": {"text": "Title", "level": 2}},
    {"id": "def", "type": "paragraph", "data": {"text": "Body text with <b>bold</b>"}},
    {"id": "ghi", "type": "checklist", "data": {"items": [{"text": "Item", "checked": true}]}}
  ]
}
```

**Tiptap/ProseMirror JSON format:**
```json
{
  "type": "doc",
  "content": [
    {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Title"}]},
    {"type": "paragraph", "content": [{"type": "text", "text": "Body text with "}, {"type": "text", "marks": [{"type": "bold"}], "text": "bold"}]},
    {"type": "taskList", "content": [{"type": "taskItem", "attrs": {"checked": true}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Item"}]}]}]}
  ]
}
```

**BlockNote's internal format** is ProseMirror XML under the hood, but it exposes a higher-level block API that looks more like Editor.js. BlockNote provides `@blocknote/core/yjs` utilities to import existing content into a `Y.Doc`.

**The Rust/Yrs CRDT side:** Yrs and Yjs are binary-protocol compatible. If the Yrs server currently stores Yjs binary updates (not just the final JSON), those updates encode operations on a `Y.Array<Y.Map>` structure (block-level). A migration to character-level would require discarding the Yrs update history and restarting with `Y.XmlFragment`-based documents (what y-prosemirror uses). The final persisted JSON format on disk would need a migration script.

### Feature Coverage Matrix

| Nous Feature | Tiptap | BlockNote | Lexical | Notes |
|---|---|---|---|---|
| Paragraph | Yes (built-in) | Yes (built-in) | Yes | |
| Headers h1-h6 | Yes | h1-h3 only | Yes | BlockNote caps at h3 |
| Bullet/Numbered Lists | Yes | Yes | Yes | |
| Checklist | Yes (TaskList) | Yes (CheckList) | Yes (community) | |
| Code blocks | Yes | Yes (w/ syntax highlighting) | Yes | |
| Blockquote | Yes | Yes | Yes | |
| Tables | Yes (extension) | Yes (built-in, with headers) | Yes (community) | |
| Horizontal Rule / Delimiter | Yes | Not in default schema (custom) | Yes | BlockNote needs custom block |
| Image upload | Yes (extension) | Yes (built-in, File/Image/Video/Audio) | Community | BlockNote has better UX |
| Callouts | Community/custom | Custom block | Custom | None have built-in callouts |
| Columns / nested editors | Community only | XL package (GPL/commercial) | Custom | Major gap for both |
| Drawings | Custom (embed iframe) | Custom (embed React component) | Custom | All require custom block |
| Wiki-links (custom inline) | Yes (custom inline node) | Yes (custom inline content spec) | Yes (custom node) | All require reimplementation |
| Block references (custom inline) | Yes (custom inline node) | Yes (custom inline content spec) | Yes (custom node) | All require reimplementation |
| Slash menu | Community/custom | Built-in | Community | BlockNote ahead |
| Drag handles | Community/custom | Built-in | Community | BlockNote ahead |
| Collaborative cursors | Excellent | Excellent | Fragile (see above) | |
| PartyKit provider | Yes | Yes (documented example) | Unofficial | |

### Custom Inline Tools: Wiki-Links and Block References

Both tools currently work by:
1. Detecting `[[` or `((` trigger text in a contenteditable.
2. Showing a dropdown positioned at the caret.
3. Replacing the trigger text with a custom HTML element (`<wiki-link data-page-id="...">` or `<block-ref data-block-id="...">`).
4. Using event delegation for click handling.
5. Static extraction methods for scanning all links/refs from saved content.

**In Tiptap/BlockNote**, the equivalent is:
- An inline atom Node (`inline: true`, `atom: true`) with `parseHTML` and `renderHTML`.
- A Tiptap/ProseMirror suggestion plugin (like `@tiptap/suggestion`) handles the `[[` trigger, dropdown positioning, and insertion.
- A NodeView renders the custom element in the DOM.
- The node's `attrs` carry `pageId`/`blockId`.
- Extraction is querying the document JSON.

**Effort:** The concepts map well but the implementation is a complete rewrite. The suggestion/autocomplete machinery in ProseMirror is more principled and less fragile than the current caret-coordinate approach. Estimated time: 1.5-2 weeks per custom inline tool with thorough testing.

Critically: **custom inline content in Tiptap/BlockNote participates in Yjs character-level CRDT automatically** — the inline node attrs and position are part of the `Y.XmlFragment` and will sync correctly across peers, including cursor positions around them.

### The Columns / Nested Editors Problem

Nous has a columns block that creates multiple side-by-side Editor.js instances. This is a significant feature to replicate:

- **Tiptap:** No official columns. Community extensions exist but are not maintained for 2025. Would need to implement a custom column node using ProseMirror's node spec. Feasible but non-trivial (2-3 weeks, including testing nested collaborative behavior).
- **BlockNote:** The `@blocknote/xl-multi-column` package provides this, but it is GPL-3.0 / commercial. If Nous is a closed-source commercial product, this requires a BlockNote Business subscription or alternative implementation. This is the key licensing decision point.
- **Lexical:** Would require fully custom implementation.

---

## Part 4: Key Questions Answered

### Is BlockNote essentially "Editor.js but Yjs-native"?

Mostly yes, with important differences:
- Same conceptual model: document as an array of blocks, each with a type, data, and ID.
- Both have slash menus, drag handles, custom block types.
- BlockNote has true character-level Yjs collaboration; Editor.js does not.
- BlockNote's extensibility has the nesting limitation for custom blocks.
- BlockNote's XL column package has a commercial licensing burden.
- BlockNote's data layer is ProseMirror (XML tree) under the hood, making it interoperable with the entire y-prosemirror ecosystem.
- BlockNote is React-only for its UI layer; core logic works in vanilla JS.

For Nous, BlockNote is the shortest conceptual jump from Editor.js while gaining proper collaboration. However, the column/licensing issue and the custom-block nesting limitation are real friction points.

### Which option gives the best path to Google Docs-style character-level collaboration?

**Tiptap with y-prosemirror** gives the most robust, production-proven path. The `y-prosemirror` binding was built by the Yjs author and handles the hardest edge cases (undo, cursor positions, relative position encoding, schema recovery after conflicting concurrent edits). It is used in production by Tiptap Cloud (thousands of documents), Hocuspocus users, and apps like Liveblocks + Tiptap.

**BlockNote** provides this same path but with a higher-level API, trading some control for faster bootstrapping.

**Lexical** provides character-level sync but collaborative cursor rendering is architecturally weaker.

### How much of the custom inline tools need to be rewritten?

All of them — this is a full rewrite. The current implementation uses direct DOM manipulation and custom HTML elements that are outside any schema. In Tiptap/BlockNote, every piece of inline content must be a typed node or mark in the ProseMirror schema. However:

- The **logic** (page lookup, autocomplete filtering, click navigation, extraction for backlinks) can be ported with minimal changes.
- The **rendering** (what the wiki-link looks like in the editor) is simpler — a NodeView or React component.
- The **trigger mechanism** is replaced by ProseMirror's suggestion plugin, which is more reliable.
- The **Yjs benefit** is that these nodes participate in CRDT automatically.

Estimate: 1.5-2 weeks per tool (wiki-link + block ref = 3-4 weeks total).

### What is the approximate effort for a single developer?

Rough breakdown for migrating Nous to **BlockNote** (the faster path):

| Task | Estimate |
|---|---|
| BlockNote setup, basic editor rendering, PartyKit provider integration | 1 week |
| Data migration: write converter from Editor.js JSON to BlockNote/ProseMirror JSON, handle all block types | 1-2 weeks |
| Rust/Yrs side: decide whether to migrate Yjs update history or do clean cut-over; update WebDAV sync to use Y.XmlFragment structure | 1-2 weeks |
| Implement wiki-link custom inline content (autocomplete, rendering, click handling) | 1.5-2 weeks |
| Implement block reference custom inline content | 1.5-2 weeks |
| Port remaining custom blocks: callouts, delimiters, drawings embed | 1.5-2 weeks |
| Columns: either implement custom or evaluate XL license cost | 2-3 weeks |
| Match existing UX: theme, keyboard shortcuts, performance validation in WebKitGTK | 1-2 weeks |
| Testing: collaborative session testing, data integrity, edge cases | 1-2 weeks |
| **Total** | **~12-19 weeks (3-5 months)** |

For **Tiptap directly** (more control, more work up front):

Add 3-4 weeks for building the block manipulation UI (slash menu, drag handles, floating toolbar) that BlockNote gives you for free. Total: 15-23 weeks (4-6 months).

These estimates assume no major surprises with WebKitGTK rendering (the existing app already has lessons learned here) and that the developer is learning ProseMirror concepts while building.

**Risk factors that could extend the estimate:**
- ProseMirror has a steep learning curve; the schema/transaction/plugin model takes time to internalize.
- Collaborative editing edge cases (split-brain, reconnect, conflict with offline edits) require careful testing.
- The Rust/Yrs migration is non-trivial if the existing Yrs document structure is deeply integrated into WebDAV sync logic.
- WebKitGTK-specific rendering issues with ProseMirror (likely fewer than Editor.js given ProseMirror uses a single `contenteditable`, but not guaranteed).

---

## Recommendation Summary

**For the fastest path to character-level collaboration with minimum conceptual disruption:** BlockNote. It maps closely to how Nous currently works, has first-class PartyKit support, and its Yjs integration is foundational rather than bolted-on. The column licensing issue requires a decision: either pay for BlockNote Business, implement columns as a custom block (possible but complex), or accept columns as a post-launch feature.

**For maximum long-term control and flexibility:** Tiptap directly. More initial work, but you own the entire stack, there are no commercial licensing dependencies, and you have the full ProseMirror ecosystem. Better for a product that continues to add unusual block types and custom behaviors.

**Avoid:** Editor.js extension for character-level collaboration (not viable), Novel (not a library), Lexical (weaker collaboration cursor model, less mature Yjs ecosystem, PartyKit not officially supported).

**The Yrs compatibility question:** Yrs (Rust) and Yjs (JavaScript) are binary-protocol compatible. The issue is not Yrs itself but the document structure: the current block-level `Y.Array<Y.Map>` would need to become `Y.XmlFragment` (what y-prosemirror expects). This is a breaking change to the sync protocol. A clean cutover (accepting that collaborative history is reset) is the pragmatic approach. Existing file content can be migrated via the JSON conversion.

---

## Sources

1. [GitHub - mrspence/yjs-editorjs-binding](https://github.com/mrspence/yjs-editorjs-binding) - Community project
2. [Editor Bindings | Yjs Docs](https://docs.yjs.dev/ecosystem/editor-bindings) - Official
3. [Real-time collaborative editing with editor.js - Discussion #1874](https://github.com/codex-team/editor.js/discussions/1874) - Community discussion
4. [Is this project dying? - Discussion #2381](https://github.com/codex-team/editor.js/discussions/2381) - Community discussion
5. [CRUD via block ID - Issue #1684](https://github.com/codex-team/editor.js/issues/1684) - Official issue
6. [Editor.js base concepts](https://editorjs.io/base-concepts/) - Official
7. [GitHub - yjs/y-prosemirror](https://github.com/yjs/y-prosemirror) - Official
8. [ProseMirror | Yjs Docs](https://docs.yjs.dev/ecosystem/editor-bindings/prosemirror) - Official
9. [Tiptap | Yjs Docs](https://docs.yjs.dev/ecosystem/editor-bindings/tiptap2) - Official
10. [GitHub - ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) - Official
11. [Migrate from Editor.js | Tiptap Docs](https://tiptap.dev/docs/guides/migrate-from-editorjs) - Official
12. [GitHub - hsnfirdaus/editorjs-to-tiptap](https://github.com/hsnfirdaus/editorjs-to-tiptap) - Community converter
13. [Custom extension | Tiptap Docs](https://tiptap.dev/docs/editor/extensions/custom-extensions) - Official
14. [StarterKit extension | Tiptap Docs](https://tiptap.dev/docs/editor/extensions/functionality/starterkit) - Official
15. [Tiptap open-sources 10 formerly Pro extensions under MIT license | Hacker News](https://news.ycombinator.com/item?id=44202103) - News
16. [We're open-sourcing more of Tiptap](https://tiptap.dev/blog/release-notes/were-open-sourcing-more-of-tiptap) - Official blog
17. [GitHub - TypeCellOS/BlockNote](https://github.com/TypeCellOS/BlockNote) - Official
18. [BlockNote - Real-time Collaboration](https://www.blocknotejs.org/docs/advanced/real-time-collaboration) - Official
19. [BlockNote - Collaborative Editing with PartyKit](https://www.blocknotejs.org/examples/collaboration/partykit) - Official
20. [BlockNote - Custom Blocks](https://www.blocknotejs.org/docs/features/custom-schemas/custom-blocks) - Official
21. [BlockNote - Custom Inline Content](https://www.blocknotejs.org/docs/features/custom-schemas/custom-inline-content) - Official
22. [Custom blocks cannot be nested - Issue #1540](https://github.com/TypeCellOS/BlockNote/issues/1540) - Official issue
23. [BlockNote - Pricing](https://www.blocknotejs.org/pricing) - Official
24. [BlockNote - BlockNote XL Commercial License](https://www.blocknotejs.org/legal/blocknote-xl-commercial-license) - Official
25. [MPL-2.0 License Explained | TLDRLegal](https://www.tldrlegal.com/license/mozilla-public-license-2-0-mpl-2) - Reference
26. [BlockNote vs. Tiptap: Simplicity Meets Full Control](https://tiptap.dev/alternatives/blocknote-vs-tiptap) - Official Tiptap
27. [Which rich text editor framework should you choose in 2025? | Liveblocks](https://liveblocks.io/blog/which-rich-text-editor-framework-should-you-choose-in-2025) - Analysis
28. [Collaboration FAQ | Lexical](https://lexical.dev/docs/collaboration/faq) - Official
29. [@lexical/yjs | Lexical](https://lexical.dev/docs/packages/lexical-yjs) - Official
30. [Bug: Impossible to set cursor between decorator nodes - Issue #3157](https://github.com/facebook/lexical/issues/3157) - Official issue
31. [Feature: Improving selection around decorator nodes - Issue #3426](https://github.com/facebook/lexical/issues/3426) - Official issue
32. [Differences between Prosemirror and Lexical - discuss.ProseMirror](https://discuss.prosemirror.net/t/differences-between-prosemirror-and-lexical/4557) - Community
33. [Deep dive into Yrs architecture](https://www.bartoszsypytkowski.com/yrs-architecture/) - Technical deep-dive
34. [GitHub - y-crdt/y-crdt](https://github.com/y-crdt/y-crdt) - Official Yrs
35. [Yrs binary protocol compatibility | y-sync](https://github.com/y-crdt/y-sync) - Official
36. [Novel - GitHub](https://github.com/steven-tey/novel) - Official
37. [Real-time collaboration with Y-js - Novel Discussion #104](https://github.com/steven-tey/novel/discussions/104) - Community
38. [Tiptap vs Lexical comparison | Medium](https://medium.com/@faisalmujtaba/tiptap-vs-lexical-which-rich-text-editor-should-you-pick-for-your-next-project-17a1817efcd9) - Analysis
39. [Yjs Integration | BlockNote DeepWiki](https://deepwiki.com/TypeCellOS/BlockNote/8.1-yjs-integration) - Analysis
40. [BlockNote Built-in Blocks](https://www.blocknotejs.org/docs/features/blocks) - Official
41. [BlockNote Tables](https://www.blocknotejs.org/docs/features/blocks/tables) - Official
