# Nous Development Roadmap

## Completed

- [x] **Markdown Import/Export** - Export pages to .md files, import .md files as pages
  - YAML frontmatter with title, tags, timestamps
  - Block type conversion (headers, lists, checklists, code, quotes)
  - Command Palette and Page Header UI integration

- [x] **Editor.js Enhancements**
  - Code syntax highlighting with highlight.js (12 languages)
  - Callout/admonition blocks (info, warning, tip, danger)
  - Table support with @editorjs/table
  - Image upload with local storage in notebook assets folder
  - Full markdown round-trip for all new block types

- [x] **AI Web Research**
  - Tavily API integration for web search
  - URL scraping with trafilatura
  - AI summarization using existing providers (OpenAI/Anthropic/Ollama)
  - Floating panel UI with result selection
  - Unified Settings dialog for all configuration

- [x] **AI Chat Enhancements**
  - Streaming responses (word-by-word display)
  - AI can create notebooks and pages via tool use
  - Thinking/reasoning display (collapsible, for Claude models)
  - Response stats (elapsed time, tokens, tok/s, model name)
  - Support for OpenAI, Anthropic, Ollama, and LM Studio providers
  - Notebook-level AI provider/model override (in notebook settings)

- [x] **Sections, Color Coding & Cover Pages**
  - Color coding for notebooks, sections, and folders
  - Sections - OneNote-style organizational layer (Notebook → Section → Folders → Pages)
  - Section tabs with colored indicators
  - Enable/disable sections per notebook
  - Cover pages - Optional styled entry page for notebooks
  - Cover page editor with notebook color theming
  - ColorPicker component with 16 presets and custom hex input

- [x] **Overview UI Mode**
  - Alternative tiled notebook view (switchable in Appearance settings)
  - Physical notebook-style cards with cover page preview
  - Search/filter notebooks
  - Sort by name, updated date, created date, or page count (persisted)
  - Notebook dropdown for switching between notebooks
  - Quick access to notebook settings from cards

---

## Short-term (Next up)

### 1. Full-text Search Polish
Already implemented with Tantivy, may need refinement:
- [x] Search result highlighting
- [x] Search within current notebook vs. all notebooks
- [x] Recent searches history
- [x] Search filters (by notebook scope)

### 2. Wiki-link Support
- [x] Parse `[[page-name]]` links in editor content
- [x] Backlinks panel (pages that link to current page)
- [x] Click-to-navigate (delegated event handler)
- [x] Link autocomplete when typing `[[`
- [x] Broken link detection (visual styling)
- [x] Create page from broken link click

### 3. Keyboard Shortcuts
- [x] `Cmd+N` - New page
- [x] `Cmd+Shift+N` - New notebook
- [x] `Cmd+E` - Export current page
- [x] `Cmd+D` - Duplicate page
- [x] `Cmd+Backspace` - Delete page (with confirmation)

---

## Medium-term

### 4. Smart Tagging
- [x] AI-powered tag suggestions based on content
- [x] Tag management UI (rename, merge, delete)
- [x] Tag cloud visualization
- [x] Filter pages by tag

### 5. Auto-link Suggestions
- [x] AI analyzes page content for Zettelkasten connections
- [x] Suggest related pages to link
- [x] "Similar pages" panel
- [x] Graph view enhancements

### 6. Page Templates
- [x] Meeting notes template
- [x] Daily journal template
- [x] Project template
- [x] Reading notes template
- [x] Blank page template
- [x] Template selection on new page (Cmd+N)
- [x] Custom user templates (save current page as template)
- [x] "Use Template" button on template pages to create new page from template

### 7. Backup & Restore
- [x] Export entire notebook as ZIP
- [x] Import notebook from ZIP
- [x] Auto-backup with local storage (manual trigger + auto cleanup)
- [x] Scheduled automatic backups (daily/weekly/monthly with configurable time)
- [ ] Backup to cloud storage (optional) - Note: WebDAV sync now available for cloud access

### 8. Folders & Organization
- [x] Folders within notebooks for organizing pages
- [x] Drag-and-drop pages into folders
- [x] Folder tree view in sidebar
- [x] Archive folder for each notebook
- [x] Archive/unarchive pages (moves to/from Archive folder)
- [x] Filter to show/hide archived pages

---

### 9. Custom Actions & Automations
- [x] Define custom actions with triggers and steps
- [x] Action editor wizard (basics, triggers, steps, review)
- [x] Trigger types: Manual, AI Chat (keywords), Scheduled (daily/weekly/monthly)
- [x] Step types: CreatePageFromTemplate, CreateNotebook, CreateFolder, MovePages, ArchivePages, ManageTags, CarryForwardItems, Delay, Conditional
- [x] Variable substitution ({{date}}, {{dayOfWeek}}, {{weekNumber}}, {{monthName}}, {{year}})
- [x] Invoke actions via AI chat (e.g., "create my daily goals")
- [x] Command Palette integration (search and run actions)
- [x] Agile Results workflow support:
  - [x] Daily outcomes template with auto-date
  - [x] Weekly outcomes with day breakdown
  - [x] Monthly/yearly goal templates
  - [x] Carry forward incomplete items
- [x] Scheduled automations (tokio-based in-app scheduler)
- [x] Action library with pre-built workflows (6 built-in actions)
- [x] Action enable/disable toggle
- [x] UI components: ActionLibrary, ActionEditor, ActionCard, TriggerEditor, ScheduleEditor, StepBuilder

---

## Short-term (Next up)

### 10. AI Page Summarization
- [x] AiSummarize action step implementation
- [x] Summarize pages matching selector criteria
- [x] Custom prompts for different summary styles (concise, detailed, bullets, narrative)
- [x] Output to new page, prepend to page, or store as variable
- [x] Integration with existing AI providers (OpenAI/Anthropic/Ollama)
- [x] Batch summarization of multiple pages (e.g., weekly review)
- [x] Extracts key points, action items, and themes automatically
- [x] Frontend API and Tauri command for direct invocation

---

## Short-term (Next up)

### 11. AI Chat Enhancements
- [x] Pinnable AI chat window (stays open while navigating)
  - [x] Pin button in header - panel stays open when pinned
  - [x] Context lock button - lock to specific page or follow current page
  - [x] Visual indicators for pinned/locked state
  - [x] State persisted across sessions
- [x] Resizable chat panel (drag to resize width/height)
  - [x] Drag left edge to resize width
  - [x] Drag top edge to resize height
  - [x] Drag top-left corner to resize both
  - [x] Min/max size constraints (320-800px width, 400-900px height)
  - [x] Reset size button when size has changed
  - [x] Size persisted across sessions
- [x] Movable/detachable chat window (floating mode)
  - [x] Detach button to enter floating mode
  - [x] Drag header to move panel anywhere on screen
  - [x] Bounds checking to keep panel visible
  - [x] Reset position button
  - [x] Visual "Floating" badge indicator
  - [x] Position persisted across sessions
- [x] System prompt configuration:
  - [x] Application-level default system prompt (in Settings)
  - [x] Notebook-level system prompt override
  - [x] Page-level system prompt override
  - [x] Prompt inheritance (page → notebook → app fallback)
  - [x] Section-level system prompt (between notebook and page in hierarchy)
  - [x] Override vs concatenate mode toggle
    - Checkbox on each prompt level to choose behavior
    - Override: replaces all higher-level prompts (current behavior)
    - Concatenate: appends to higher-level prompts (for additive context)

### 12. Inbox & Quick Capture
- [x] Global quick capture hotkey (`Cmd+Shift+C` for capture, `Cmd+Shift+I` for inbox)
- [x] Quick capture button in sidebar toolbar
- [x] Inbox storage with file-based persistence
- [x] Minimal capture UI (title + content + tags, instant save)
- [x] AI-powered inbox classification:
  - [x] Analyze inbox items to suggest target notebook
  - [x] Suggest existing page to append to (or create new)
  - [x] Confidence scoring for suggestions
- [x] Inbox review panel:
  - [x] List all inbox items with AI-suggested actions
  - [x] Select/deselect items for batch processing
  - [x] Override suggested destination per item (architecture ready)
  - [x] "Apply" button to move/merge items
- [x] Badge indicator showing unprocessed item count

### 13. Git-Backed Notebooks
- [x] Git integration for notebooks:
  - [x] Add `git2` crate for native Git operations
  - [x] Initialize notebook directory as Git repository
  - [x] Auto-commit on page save (debounced, meaningful commit messages)
  - [x] Commit on notebook/folder changes
  - [x] Git status tracking (dirty/clean state)
- [x] Remote repository support:
  - [x] Configure remote URL (GitHub, GitLab, self-hosted)
  - [x] Push/pull commands via UI
  - [x] Fetch and show remote status
- [x] Page history via Git:
  - [x] Browse page revisions from git log
  - [x] Preview previous versions
  - [x] Restore any previous version (git checkout)
- [x] Notebook settings UI:
  - [x] Enable/disable Git for notebook
  - [x] Remote configuration
  - [x] Push/pull buttons
  - [x] History viewer
- [x] Branch support:
  - [x] Create/switch branches for experimental edits
  - [x] Merge branches back
  - [x] Delete branches
  - [x] Branch indicator and selector in UI
- [x] Conflict resolution:
  - [x] Detect merge conflicts on pull/merge
  - [x] Conflict resolution dialog with side-by-side view
  - [x] Accept ours/theirs/all resolution strategies
  - [x] Abort merge option

---

## Future

### 14. Spaced Repetition
- [x] Flashcard decks per notebook
- [x] Editor block for inline flashcards
- [x] SM-2 spaced repetition algorithm
- [x] Full-screen and floating panel review modes
- [x] Due card tracking and statistics
- [x] Keyboard shortcut (`Cmd+Shift+F`)

### 15. PDF Import & Annotation
- [x] Import PDF files (drag-drop or file picker)
- [x] PDF viewer in app (embedded block and full-screen mode)
- [x] Highlight and annotate (text selection, color options, notes)
- [x] Extract highlights to page (creates new page with quotes)

### 16. Notebook Encryption
- [x] Password-protected notebooks
- [x] Encrypt notebook data at rest (ChaCha20-Poly1305 + Argon2id)
- [x] Secure unlock flow (auto-lock timeout, in-memory key management)
- [x] Library-level encryption
- [ ] Optional biometric unlock

### 17. Theme Customization
- [x] Light/dark mode toggle (with system preference support)
- [x] Custom color schemes (Catppuccin, Default, Nord, Dracula)
- [x] Font selection (System, Inter, JetBrains Mono, Fira Code)
- [x] Editor width settings (Narrow, Medium, Wide, Full)
- [x] Font size and line height customization

### 18. Mobile & Sync
- [x] Cloud sync via WebDAV
  - [x] WebDAV client (Nextcloud, ownCloud, etc.)
  - [x] Per-notebook sync configuration
  - [x] Credential storage in OS keyring
  - [x] Manual and periodic sync modes
  - [x] Sync UI in Notebook Settings
- [x] CRDT-based conflict resolution (Yrs/Yjs)
  - [x] EditorData <-> Yrs document conversion
  - [x] Automatic merge on sync conflicts
  - [x] Binary CRDT state files for efficient sync
- [x] Offline support
  - [x] Local-first architecture
  - [x] Offline change queue
  - [x] Queue persistence across app restarts
- [ ] Mobile companion app (Tauri-based, future)
- [x] Parallel sync
  - [x] Concurrent page sync with semaphore-bounded WebDAV requests
  - [x] Concurrent asset sync
  - [x] Parallel notebook sync in sync_library
  - [x] Parallel initial fetches (manifest, changelog, pages_meta)
  - [x] Remove Arc<Mutex<SyncManager>> wrapper for non-blocking UI
- [x] Change notification
  - [x] Sideband sentinel file for lightweight remote change detection (single HEAD per poll)
  - [x] Nextcloud server detection (status.php + capabilities endpoint)
  - [x] Nextcloud notify_push SSE integration for real-time change events
- [x] Content-addressable storage for assets
  - [x] SHA256-based CAS directory shared across notebooks
  - [x] Asset manifest per notebook mapping relative paths to content hashes
  - [x] Deduplication across notebooks (same content = one remote copy)
  - [x] Migration path from legacy per-notebook asset storage
- [x] Implement OnSave sync mode (trigger sync when a page is saved)
- [ ] Sync integration tests
  - [ ] Nextcloud WebDAV sync validation using testcontainers
- [x] Goals synchronization across instances

### 19. Page Stats & Writing Assistance
- [x] Page statistics (word count, character count, reading time) - toggleable in page header
- [x] Reading level analysis (Flesch-Kincaid Reading Ease and Grade Level)
- [x] Spell checking (browser native on contenteditable)
- [x] Grammar checking (LanguageTool API integration)
- [x] Writing Assistance panel with issue categorization (spelling, grammar, punctuation, style)

### 20. Editor Customization
- [x] VI key bindings mode
  - Modal editing (Normal/Insert modes)
  - Navigation: h, j, k, l, w, b, e, 0, $, gg, G
  - Insert mode: i, a, A, I, o, O
  - Operations: dd (delete block), yy (yank), p/P (paste), u (undo)
  - jj or Escape to exit insert mode
  - Visual mode indicator
  - Settings toggle (Appearance > Editor Keybindings)
- [x] Emacs key bindings mode
  - Navigation: C-f, C-b, C-n, C-p, C-a, C-e, M-f, M-b, M-<, M->
  - Editing: C-d, C-h, C-k (kill line), C-w (kill region), M-w (copy), C-y (yank)
  - Mark: C-Space (set mark), C-g (cancel)
  - Undo: C-/, C-Shift-/ (redo)
  - Settings toggle (Appearance > Editor Keybindings)
- [x] External editor support (open page in VS Code, Vim, etc.)
  - Export page to temp markdown file for editing
  - Open in configurable external editors (VS Code, Vim, Neovim, Sublime, Emacs, Zed, etc.)
  - Detect external file changes with polling
  - Sync changes back with one-click import
  - Session management (end session, cleanup old sessions)
- [x] Zen editing mode
  - Distraction-free writing environment
  - Hide sidebar, toolbar, and UI chrome
  - Centered, focused content area
  - Optional typewriter scrolling (keep cursor vertically centered)
  - Keyboard shortcut to toggle (Cmd+Shift+.)
  - Exit via ESC key or button
- [x] Undo / Redo enhancements
  - Multi-level undo/redo with history stack
  - Undo history panel (view and jump to previous states)
  - Persistent undo across sessions (optional, configurable in Settings)
  - Keyboard shortcuts: Cmd+Z (undo), Cmd+Shift+Z (redo)
  - Configurable history size (10-100 states)
  - Clear history option

### 21. Import from Other Apps
- [x] OneNote notebook import (standalone CLI tool via Apache Tika)
  - `tools/onenote_to_nous.py` converts desktop backup `.one` files to `.nous.zip`
  - Parses OneNote binary format via Tika (requires Java 11+)
  - Converts XHTML to Editor.js blocks (headers, paragraphs, lists, tables, images)
  - Groups `.one` files by directory into folders
  - See `tools/ONENOTE_IMPORT.md` for usage
- [x] Scrivener project import (.scriv folders with RTF content)
- [x] Evernote export import (.enex XML with HTML content)
- [x] Notion export import (ZIP with markdown & CSV databases)
- [x] Obsidian vault import (markdown with YAML frontmatter, wiki-links, attachments)
- [x] Joplin export import (JEX archive or raw directory)
- [x] Org-mode import (.org files)
  - Parse org-mode syntax (headers, lists, TODOs, tags, properties)
  - Convert org timestamps and scheduling to page metadata
  - Handle org-mode links and attachments
  - Import single .org file or folder of .org files
  - Preserves inline formatting (*bold*, /italic/, =code=)
  - Converts code blocks, quotes, checklists
- [ ] Apple Notes import
  - **Complexity: Medium-High** (1-2 days with existing tools, 3-4 days from scratch)
  - Notes stored in SQLite at `~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite`
  - Content is protobuf-encoded (undocumented, changes between macOS versions)
  - Embedded images, drawings, tables, checklists stored separately
  - Locked notes require password
  - Options: (1) Parse SQLite + protobuf directly, (2) AppleScript export (text only), (3) Use `apple-notes-liberator` or similar

### 22. Page Markup & Drawing
- [x] Drawing/annotation tool for pages
  - Drawing block for Editor.js with Fabric.js canvas
  - Freehand drawing with PencilBrush
  - Shape tools (rectangles, circles, ellipses, arrows, lines)
  - Text tool with editable IText
  - Color and stroke width options (9 presets + custom hex)
  - Eraser and selection/move tools
  - Undo/redo with JSON history
  - Display modes: compact (200px), standard (400px), large (600px)
  - Full-screen editor with keyboard shortcuts
- [x] Page annotation overlay
  - Fixed overlay covering entire viewport
  - Draggable floating toolbar
  - Transparent canvas over page content
  - Toggle from page header button
- [x] Save drawings as page annotations
  - Vector JSON storage (resolution-independent, editable)
  - Stored in notebook assets/annotations folder
  - Tauri commands for CRUD operations
- [x] Export drawings as images
  - PNG export via Fabric.js toDataURL
  - Download button in toolbar
- [x] Touch/stylus support for tablet users
  - Fabric.js native touch handling

### 23. Video Transcription
- [x] Import video files (MP4, WebM, MOV, MKV, AVI, M4V, FLV)
  - Video player block in editor (VideoTool.ts)
  - Store videos in notebook assets folder
  - Drag-and-drop or click to upload
  - Display modes: compact, standard, large
- [x] Transcribe video audio to text
  - Integration with faster-whisper (CTranslate2-optimized, local)
  - Word-level timestamps for precise synchronization
  - Auto-detect language with confidence scoring
  - Python module: `nous_ai/video_transcribe.py`
  - Tauri commands: transcribe_video, get_video_duration, is_supported_video
- [x] Sync transcription with video playback
  - Click transcript segment to jump to timestamp
  - Auto-scroll to current segment during playback
  - Inline transcript preview in editor block
  - Full-screen viewer with transcript sidebar panel
  - Searchable transcript with keyword highlighting
- [x] Export transcriptions
  - Plain text with timestamps (.txt)
  - SRT subtitle format (.srt)
  - WebVTT format (.vtt)

### 24. Potential Integrations
- [x] **markitdown** integration
  - Microsoft's tool for converting documents to markdown
  - Support for PDF, Word, Excel, PowerPoint, images, audio, HTML, CSV, JSON, XML, ZIP, EPUB
  - Python module: `nous_ai/document_convert.py`
  - Rust bridge: `python_bridge/mod.rs` (convert_document, convert_documents_batch)
  - Tauri commands: convert_document, convert_documents_batch, get_supported_document_extensions, is_supported_document
  - Command Palette: "Import Document" command
  - https://github.com/microsoft/markitdown
- [x] **browser-use** integration
  - AI-powered browser automation for web research
  - Integrated as AI chat tool (`browse_web`)
  - AI can autonomously browse websites, fill forms, extract data
  - Works with OpenAI and Anthropic providers
  - Screenshot capture support
  - Optional dependency (install with `uv pip install browser-use && uvx browser-use install`)
  - Python module: `nous_ai/browser_automation.py`
  - Tauri command: `browser_run_task`
  - https://github.com/browser-use/browser-use

### 25. Libraries
- [x] Library concept for organizing notebooks
  - Libraries are collections of notebooks stored in different locations
  - Default library contains all existing notebooks (current behavior)
  - Add/remove libraries from settings
  - Switch between libraries in sidebar
  - Each library has its own storage path

---

## Multi-Format Page Support Enhancements

### 26. Multi-Format Pages (Core Complete)
- [x] Import files as pages (Markdown, PDF, Jupyter, EPUB, Calendar)
- [x] File import dialog with embed/link storage mode selection
- [x] Dedicated viewers for each file type:
  - [x] MarkdownEditor (CodeMirror 6 with syntax highlighting)
  - [x] PDFPageViewer (react-pdf with zoom, page navigation)
  - [x] JupyterViewer (cell rendering, syntax highlighting, outputs)
  - [x] EpubReader (epub.js with TOC navigation)
  - [x] CalendarViewer (ical.js with list/month views)

### 27. Multi-Format UI Polish
- [x] File type icons in sidebar (distinct icons for PDF, Jupyter, EPUB, Calendar pages)
- [x] Drag-drop import (drop files directly into page tree)
- [x] Search results display by page type

### 28. Multi-Format Search Indexing
- [x] Extract text from PDF files for search (via markitdown)
- [x] Index Jupyter notebook content (code cells + markdown cells)
- [x] Index EPUB text content (via markitdown)
- [x] Index Calendar events (event summaries and descriptions)

### 29. Multi-Format Advanced Features
- [x] Linked file sync detection (detect external file changes, prompt to reload)
- [x] Jupyter cell editing (add, delete, reorder, edit cell content)
- [x] Jupyter cell execution via Python kernel
- [x] PDF annotation persistence (save highlights/notes)
- [x] EPUB reading progress tracking
- [ ] EPUB highlight/annotation support

---

## AI Chat Pages

### 30. Chat Page Type (Complete)
- [x] New page type for AI conversations (.chat extension)
- [x] Cell-based interface (like Jupyter notebooks for AI)
  - [x] Prompt cells with editable textarea and Run button
  - [x] Response cells with markdown rendering
  - [x] Markdown cells for notes/context
- [x] Streaming responses with real-time display
- [x] Conversation context (previous cells inform new prompts)
- [x] Cell management (add, delete, move up/down)
- [x] Chat settings (model, system prompt, context limit)
- [x] Extended thinking display (collapsible)
- [x] Response stats (elapsed time, tokens, model)
- [x] Keyboard shortcut (Shift+Enter to run prompt)
- [x] Auto-save with debouncing
- [x] Page type dropdown in sidebar (Standard, AI Chat, Markdown, Calendar)
- [x] Distinct icons for each page type in sidebar

### 31. Chat Page Enhancements (Next)
- [x] **Code Execution** - Run code blocks in responses via Jupyter kernel
  - Connect to existing Jupyter kernel infrastructure
  - Execute code cells inline with output display
  - Run button on Python code blocks with inline output rendering
  - Outputs persist in chat file via `codeOutputs` field
  - Shared `OutputRenderer` component with Jupyter viewer
- [x] **Regenerate Response** - Re-run a prompt to get alternative responses
  - Button on response cells to regenerate
  - Retry button on error responses
- [x] **Conversation Branching** - Fork conversation at any point
  - Branch button on prompt cells to create new branch
  - Branch selector dropdown in header to switch between branches
  - Each branch maintains its own conversation path
  - Context history follows branch lineage correctly
- [x] **Template Variables** - Use placeholders in prompts
  - `{{selection}}` - current text selection
  - `{{page_title}}` - title of current page
  - `{{date}}`, `{{time}}`, `{{datetime}}` - timestamps
  - Variable picker dropdown in prompt cell header
- [x] **Export Chat** - Convert chat to other formats
  - Save as Markdown file (.md)
  - Copy as Markdown to clipboard
  - Export dropdown in header
- [ ] **Jupyter AI Integration** - Add AI cells to Jupyter notebooks
  - AI prompt/response cells in .ipynb files
  - Seamless mixing of code and AI cells
- [x] **Cell Collapsing** - Collapse/expand cells for better overview
  - Per-cell collapse toggle button
  - Truncated preview when collapsed
  - Collapse all / Expand all buttons in header
- [x] **Search in Chat** - Find text within chat conversation
  - Search bar toggle in header
  - Real-time match highlighting
  - Match count display
  - Visual highlight on matching cells
- [x] **Drag-and-Drop Reorder** - Drag cells to reorder
  - Uses @dnd-kit library
  - Drag handle appears on hover
  - Smooth animations during drag

---

## NotebookLM-like Study Tools

### 33. AI-Powered Study Tools (Complete)

NotebookLM-inspired features for generating study materials from notebook content.

#### Content Generation
- [x] **Study Guide Generation** - Structured learning materials from pages
  - Learning objectives, key concepts with definitions
  - Section summaries with key points
  - Practice questions with answers
  - Configurable depth (brief, standard, comprehensive)
  - Focus areas selection
- [x] **FAQ Generation** - Extract Q&A pairs from content
  - Configurable number of questions
  - Source page tracking
  - Output to new page, prepend, or variable
- [x] **Briefing Documents** - Executive summaries with action items
  - Executive summary paragraph
  - Key findings and recommendations
  - Action items with owner, deadline, priority
  - Detailed sections
- [x] **Flashcard Auto-Generation** - AI-generated flashcards
  - Integration with existing FlashcardStorage
  - Card types: basic, cloze, reversible
  - Configurable number of cards

#### Source-Grounded Intelligence
- [x] **Source-Cited Chat** - Q&A with clickable source citations
  - Inline citation badges [1], [2] in responses
  - Citation component with expandable excerpts
  - Click to navigate to source page
  - Relevance scoring per citation

#### Visualizations (D3.js)
- [x] **Timeline Visualization** - Chronological event display
  - D3.js horizontal timeline with zoom/pan
  - Category color coding
  - Hover tooltips and click-to-select events
  - Navigate to source pages
- [x] **Concept Map Visualization** - Visual relationship mapping
  - D3.js force-directed graph
  - Node types: concept (circle), example (rectangle), definition (diamond)
  - Draggable nodes with connection highlighting
  - Relationship labels on edges

#### UI Integration
- [x] **Study Tools Panel** - Dedicated modal for all study tools
  - Page selector for source content
  - Tool grid with descriptions
  - Generation progress and error handling
- [x] **Page Context Menu** - Right-click menu for quick access
  - Generate Study Guide, FAQ, Flashcards, Briefing
  - Extract Timeline, Concept Map

#### Actions System Integration
- [x] **New ActionStep types** for automated workflows
  - `GenerateStudyGuide` - Create study guide from page selector
  - `GenerateFaq` - Generate FAQ with output options
  - `GenerateFlashcards` - Add AI cards to deck
  - `GenerateBriefing` - Executive summary with action items
  - `ExtractTimeline` - Timeline page from dated content
  - `ExtractConceptMap` - Concept map page from content

### 34. Study Tools Enhancements (Future)

#### Advanced Media Generation
- [x] **Infographic Generation** - Visual summaries
  - SVG-based layout with svgwrite (key concepts, executive summary, timeline, concept map templates)
  - Theme support (light/dark)
  - Size presets (Social Media, Story/Reel, Presentation, Poster, Wide Banner, Custom)
  - PNG export via cairosvg
  - Export as PNG/SVG with download buttons
- [x] **Video Generation** - Narrated presentations
  - Auto-generate slides from study guides/briefings
  - Integration with existing TTS infrastructure (OpenAI, ElevenLabs, Kokoro)
  - Pillow for slide rendering, FFmpeg for video assembly
  - Theme support (light/dark), aspect ratio presets
  - Transition styles (cut/fade with xfade filter)
  - Slide editor with live preview
  - Speaker notes field, duration hints
  - Progress tracking via Tauri events
  - Keyboard shortcuts for slide navigation
- [x] **Media Library** - Browse and manage generated media
  - List all videos and infographics in notebook
  - Filter by type (all/video/infographic)
  - Delete with confirmation
  - File size and creation date display

#### Media Generation Enhancements (Not Yet Implemented)
- [x] **Drag-and-drop slide reordering** - Reorder slides via drag-and-drop in slide list
- [x] **Export from Media Library** - Open/export media files directly from library
- [x] **Batch delete in Media Library** - Select and delete multiple media files at once
- [ ] **Slide templates** - Pre-built slide layouts (title slide, bullet points, image, quote)
- [ ] **Undo/redo for slides** - History stack for slide edits with keyboard shortcuts
- [x] **Video thumbnails** - Generate and display thumbnails in Media Library
- [ ] **Re-generate single slide audio** - Regenerate TTS for individual slides without full rebuild
- [x] **Custom accent colors** - User-defined accent color for slides and infographics

#### Visualization Enhancements
- [x] **Timeline Export** - Save as SVG/PNG/PDF
- [x] **Concept Map Export** - SVG/PNG and Mermaid/GraphViz formats
- [x] **Vertical Timeline** - Alternative layout option
- [x] **Hierarchical Concept Map** - Tree layout mode
- [x] **Cross-Notebook Knowledge Graph** - Concepts across all notebooks

#### UI Enhancements
- [x] **Text Selection Context Menu** - Generate from highlighted text
- [x] **Quick Generate Dialog** - Minimal UI for fast generation
- [ ] **AIChatPanel Citation Integration** - Citations in regular chat
- [x] **FlashcardStorage Direct Integration** - Add cards to decks automatically

#### Built-in Action Templates
- [x] **Weekly Study Review** - Summarize week's notes + flashcards
- [x] **Exam Prep Workflow** - Study Guide → Flashcards → Practice Questions
- [x] **Daily Learning Summary** - Combine multiple study tools

---

## iPhone Contact Activity Integration

### 32. Contact Activity Harvester (macOS)

Read iMessage and call history directly from macOS system SQLite databases. The macOS instance harvests data periodically; it syncs to the Linux instance via existing WebDAV/Git infrastructure.

**Approach:** macOS stores iMessage and call history in well-known SQLite databases that can be read directly (no Apple APIs needed, but Full Disk Access permission is required).

**Source databases (macOS):**
| Database | Path | Contents |
|----------|------|----------|
| iMessage/SMS | `~/Library/Messages/chat.db` | All messages, attachments metadata, read receipts |
| Call History | `~/Library/Application Support/CallHistoryDB/CallHistory.storedata` | Phone + FaceTime calls via Continuity |
| Contacts | `~/Library/Application Support/AddressBook/AddressBook-v22.abcddb` | Names, phone numbers, emails |

**Implementation phases:**

#### Phase 1: Backend Harvester (Rust, macOS-only)
- [ ] New module: `src-tauri/src/contacts/`
  - `harvester.rs` — macOS-only (`#[cfg(target_os = "macos")]`) SQLite reader
  - `models.rs` — Contact, ContactActivity, ActivityType definitions
  - `storage.rs` — File-based persistence in library data directory
  - `mod.rs` — Public API + Tauri commands
- [ ] Read `chat.db`: query `message` + `handle` + `chat_handle_join` tables
  - Extract: sender/recipient phone/email, timestamp, text preview (first 100 chars), direction (sent/received)
  - Resolve handles to contact names via AddressBook DB or handle.id
  - Normalize phone numbers for matching (strip +1, spaces, dashes)
- [ ] Read `CallHistory.storedata`: query `ZCALLRECORD` table
  - Extract: phone number, timestamp, duration, call type (incoming/outgoing/missed), was_answered
- [ ] Read `AddressBook-v22.abcddb`: query `ZABCDRECORD` + `ZABCDPHONENUMBER` + `ZABCDEMAILADDRESS`
  - Build local contact directory: name, phone numbers, email addresses
  - Used to resolve phone numbers/emails in messages and calls to named contacts
- [ ] Data model:
  ```
  Contact { id, name, phone_numbers, emails, tags, notes, last_contacted, created_at }
  ContactActivity { id, contact_id, activity_type, direction, timestamp, preview, duration_seconds }
  ActivityType: Message | Call | FaceTimeAudio | FaceTimeVideo | MissedCall
  ```
- [ ] Storage: `{library}/contacts/contacts.json` + `{library}/contacts/activity.json`
  - Append-only activity log with dedup by (contact_id, activity_type, timestamp)
  - Incremental harvesting: track `last_harvest_timestamp` to only read new rows

#### Phase 2: Polling Scheduler
- [ ] Reuse existing scheduler pattern (`tokio::time::Interval` + `mpsc` channel)
  - Configurable poll interval (default: 15 minutes)
  - Only runs on macOS (no-op on Linux/Windows)
  - Started at app launch, respects enable/disable toggle
- [ ] Incremental updates: each poll reads only rows newer than `last_harvest_timestamp`
- [ ] Settings UI: enable/disable harvester, configure poll interval
- [ ] TCC permission guidance: prompt user to grant Full Disk Access if `chat.db` read fails with permission error

#### Phase 3: Frontend — People Panel
- [ ] New store: `src/stores/contactStore.ts` (Zustand)
  - CRUD for contacts + activity feed
  - Tauri command bindings for fetching data
- [ ] Types: `src/types/contact.ts` matching Rust models
- [ ] People panel (sidebar or dedicated view):
  - Contact list sorted by `last_contacted` (most recent first)
  - Per-contact detail view: activity timeline (messages, calls)
  - "Last contacted" badge (e.g., "3 days ago", "2 weeks ago")
  - Filter: all / messages only / calls only
  - Search contacts by name
- [ ] Contact quick-view: click contact → see recent activity timeline
  - Message entries: direction arrow, preview text, timestamp
  - Call entries: incoming/outgoing/missed icon, duration, timestamp
- [ ] Link contacts to notebook pages (optional): associate a contact with a page for meeting notes, etc.

#### Phase 4: Sync to Linux
- [ ] Contact and activity data syncs via existing WebDAV/Git sync
  - `contacts.json` and `activity.json` are regular library files — sync works automatically
  - On Linux, the frontend reads synced data (read-only, harvester doesn't run)
  - CRDT merge for contacts (name edits, tags, notes); activity log is append-only (timestamp-ordered, minimal conflicts)
- [ ] Conflict strategy: contacts use last-write-wins on fields; activities deduplicate by (contact_id, type, timestamp)

#### Future Extensions
- [ ] AI-powered insights: "You haven't contacted [person] in 30 days" nudges
- [ ] Link contact activity to journal/daily notes pages automatically
- [ ] Group contacts by tags (family, work, friends) with per-group views
- [ ] Apple Notes import integration (contact mentions in notes)
- [ ] Optional: WhatsApp/Signal message harvesting (separate databases, different formats)

**Privacy & permissions:**
- Full Disk Access required on macOS (user must grant in System Settings > Privacy)
- All data stays local — no cloud services involved beyond user's own sync
- Message previews are truncated (100 chars) — full message text is not stored
- Feature is opt-in (disabled by default, enabled in Settings)
- No message content is sent to AI unless user explicitly requests analysis

---

## Technical Debt & Polish

- [x] Move video storage from `/tmp/nous-videos` to main data directory
  - Videos now stay in notebook assets directory, served via embedded HTTP video server
  - Dynamic allowed_dirs on VideoServer (Arc<RwLock<Vec<PathBuf>>>)
  - Migration function moves existing /tmp/nous-videos back to notebook assets
  - Removed legacy asset protocol registration in lib.rs
- [x] Add comprehensive error handling for file operations
  - Toast notification system (success, error, warning, info)
  - ToastContainer component with auto-dismiss and manual close
  - Wired up to external editor, backup, and quick capture operations
- [x] Add loading states for async operations
  - LoadingSpinner, LoadingOverlay, LoadingButton components
  - Reusable loading indicators for buttons and overlays
- [x] Improve accessibility (keyboard navigation, screen readers)
  - Focus trap hook for modal dialogs
  - ARIA attributes on dialogs (role="dialog", aria-modal, aria-labelledby)
  - aria-labels on icon-only buttons
  - Proper keyboard handling (Tab trapping, Escape to close)
- [x] Add unit tests for markdown conversion
  - 35 tests covering export and import
  - Tests for all block types: headers, paragraphs, lists, checklists, code, tables, callouts, images, quotes
  - Tests for frontmatter parsing, inline formatting, special characters
- [x] Performance optimization for large notebooks
  - React.memo on list item components (FolderTreeItem, PageItem, DraggablePageItem)
  - React.memo on NotebookCard and ActionCard components
  - useCallback for event handlers to maintain stable references
  - Extracted PageListItem as a memoized component
  - Prevents unnecessary re-renders when parent state changes

---

## Data Flow Robustness Overhaul

Phased plan to make the editor save path bulletproof, add operation logging, integrate CRDTs into local saves, and enable block-level version history.

### Phase 0: Fix Invisible Pages
- [x] Backend `move_page_to_folder` syncs `page.section_id` with `folder.section_id`
- [x] Frontend orphan safety net — pages whose folder is hidden appear at root level
- [x] `repair_section_consistency` runs on notebook load, fixes stale section metadata
- [x] Recovered orphaned Astronomy notebook pages

### Phase 1: Atomic Writes & Crash Safety
- [x] Atomic file writes via temp+rename (`atomic_write` writes `.json.tmp` then renames)
- [x] Recovery of orphaned `.tmp` files on next load (`recover_tmp_file`)
- [x] Safety-net auto-save reduced from 60s to 5s
- [x] `selectPage` awaits pending save promise before switching pages

### Phase 2: Operation Log & Page Versioning
- [x] Per-page append-only operation log (JSONL with hash chain)
  - Each save appends: timestamp, clientId, op type, contentHash, affected blockIds, prevHash
  - Enables corruption detection (hash mismatch) and recovery
- [x] Block-level change tracking in oplog
  - Diff consecutive saves to identify per-block insert/modify/delete
  - Enables block-level undo across sessions, blame/attribution
- [x] Periodic snapshots with oplog compaction
  - Keep last N full page JSON snapshots alongside oplog
  - Compact oldest oplogs when snapshot count exceeds threshold
- [x] Python page_storage module for external agents (`nous-py/nous_ai/page_storage.py`)
  - Cross-language compatible content hashing (SHA-256)
  - Atomic writes, automatic oplog entries with block-level diffs
  - Documentation: `docs/AGENT_PAGE_STORAGE.md`

### Phase 3: CRDT Integration into Local Save Path
- [x] Maintain live Yrs CRDT document per open page
  - Load/create `.crdt` file on page open
  - On save, compute Yrs update (diff) instead of full JSON replacement
  - Page JSON derived from CRDT state (source of truth moves to CRDT)
- [x] Binary Yrs update log (replay-able)
  - Append binary updates per save, reconstruct state by replaying from last snapshot
  - More space-efficient than JSON oplog
- [x] Multi-pane CRDT conflict resolution
  - Each pane maintains own update stream, merged on save
  - Convergent result — no data loss from concurrent edits
  - Per-pane base tracking ensures concurrent edits merge correctly

### Phase 4: Block-Level Version History (see also Section 36)
- [x] Block version counts via oplog analysis (pragmatic alternative to CRDT lamport timestamps)
- [x] Block history UI — hover gutter for version count, click for diff history panel
- [x] Block revert — restore individual blocks to previous snapshot state
- [x] Git correlation — `git_commit_id` field on `OplogEntry`, linked in block history

---

## Future Feature Ideas

Inspired by other note-taking and organization software (Notion, Obsidian, Roam, Logseq, Craft, Mem, Evernote, Apple Notes, etc.)

### Top Recommendations (High Impact)

These features are recommended as high-priority additions:

1. ~~**Daily notes** - Central to many workflows, leverages existing templates~~ ✅ Complete
2. ~~**Canvas/whiteboard** - Visual thinking, very popular in Obsidian~~ ✅ Complete
3. ~~**Block references** - Major upgrade to linking capabilities~~ ✅ Complete
4. ~~**Web clipper** - Key capture workflow currently missing~~ ✅ Complete
5. ~~**Starred/recent pages** - Simple but impactful navigation improvement~~ ✅ Complete (starred/pinned)
6. ~~**Live queries** - Power feature for dynamic organization~~ ✅ Complete
7. ~~**Publish to web** - Sharing capability many users want~~ ✅ Complete

### Current Priorities

These are the active focus areas:

1. ~~**Data Flow Robustness Overhaul** - Operation logging, CRDT local integration, block-level versioning (Phases 0-4)~~ ✅ Complete
2. ~~**Energy & Focus Tracking** - Energy-aware daily planning with pattern detection and external agent API~~ ✅ Complete
3. ~~**Move video storage out of /tmp** - Videos served from notebook assets via HTTP video server~~ ✅ Complete

---

### 35. Databases & Structured Data (Notion, Tana, Capacities)

- [x] **Database pages** - Structured data with table view
  - [x] Table view with editable cells, column resize, row add/delete
  - [x] Properties: text, number, select, multi-select, checkbox, date, URL
  - [x] Filter and sort by any property
  - [x] Property editor (rename, change type, manage select options, delete)
  - [x] Toolbar with add property, filter, sort popovers
  - [x] Notion CSV import creates database pages with type inference
  - [x] Full-text search indexing of database content
  - [x] Multi-view architecture (V2 schema with per-view sorts/filters/config)
  - [x] View tabs (add, rename, duplicate, delete views)
  - [x] Group by any property (table view, collapsible groups with counts)
  - [x] Board (kanban) view with drag-and-drop via @dnd-kit
  - [x] Gallery view (CSS grid cards with configurable size)
  - [x] List view (compact rows with primary/secondary properties)
  - [x] Calendar view (month grid with date navigation, unscheduled section)
  - [x] Row detail modal (shared property editor for non-table views)
  - [x] V1→V2 automatic migration (existing databases upgrade seamlessly)
  - [x] Relation property type
  - [x] Inline databases within pages
- [x] **Object types** - Custom content types
  - [x] Built-in types (Book, Person, Project, Meeting) with typed fields
  - [x] Custom type creation, editing, and deletion
  - [x] Object type picker when creating database pages
  - [x] Object type management UI
  - [x] Templates per object type (default cell values for new rows, per-property default value editor in PropertyEditor and ObjectTypeManager)
  - [x] Type-specific views and queries (default sorts, filters, group-by, date property per object type; auto-applied when creating database from type)
- [x] **Relations & rollups** - Link and aggregate data
  - [x] Relate database items to each other
  - [x] Rollup properties (count, sum, average, min, max, range, percent empty/not empty, show original, count values, count unique)
  - [x] Bidirectional relations (auto-created back-relation in target DB, editable from both sides, cascade delete)
- [x] **Live queries** - Dynamic embedded lists
  - Editor.js block tool with React component (LiveQueryBlockTool + LiveQueryBlock)
  - Filter pages by title, tag, pageType, folder, or content (contains, equals, not_equals, starts_with)
  - Sort by title, createdAt, or updatedAt with configurable limit
  - Three display modes: list (default), table, compact
  - Auto-updating via Zustand page store subscription
  - Inline config editor for filters, sort, and limit
  - Click result to navigate to page

---

### 36. Block-Level Features (Roam, Logseq)

- [x] **Block references** - Reference individual blocks
  - `((block-id))` syntax to reference any block
  - Backlinks panel shows block-level references
  - Click to navigate to source block (with highlight animation)
  - Block ref preview text auto-updates when target block changes
  - Broken ref detection when target block is deleted
  - Graph view integration (purple dashed edges)
- [x] **Block embedding** - Embed blocks inline
  - Embed referenced blocks with live sync
  - Edit embedded block in place, updates original
  - Visual indicator for embedded vs. native blocks
- [x] **Transclusion** - Same content in multiple places
  - Synced blocks that appear in multiple pages
  - Single source of truth, all instances update together
  - Notion-style synced blocks
- [x] **Block-level version history** - Granular change tracking (see "Data Flow Robustness Overhaul" Phase 4)
  - Track changes at block level, not just page level
  - See who changed what block and when
  - Restore individual blocks to previous state

---

### 37. Visual & Spatial (Obsidian, Logseq, Miro)

- [x] **Canvas/whiteboard** - Infinite visual workspace ⭐ TOP RECOMMENDATION
  - Infinite canvas with pan and zoom
  - Add cards, images, embedded pages, arrows/connections
  - Freeform spatial organization
  - Group and frame elements
  - Export as image
- [x] **Outline/TOC panel** - Table of contents
  - Auto-generated from page headers
  - Click to jump to section with highlight animation
  - Active heading tracking on scroll
  - Right sidebar panel (220px, toggle button in page header)
  - Hidden in zen mode and for non-standard page types
  - Preference persisted via themeStore
- [ ] **Mind map view** - Visual hierarchy
  - Convert page structure to interactive mind map
  - Expand/collapse branches
  - Drag to reorganize
- [ ] **Card/gallery view** - Visual page browsing
  - View pages as cards with cover images
  - Grid layout with customizable card size
  - Preview on hover

---

### 38. Daily Notes & Journaling (Logseq, Roam, Capacities)

- [x] **Daily notes** - Date-based pages ⭐ TOP RECOMMENDATION
  - Auto-create page for today's date
  - Quick access button/shortcut (Cmd+Shift+D)
  - Calendar picker for past dates
  - Customizable daily note template (optional daily-journal template)
  - Forward/back navigation between days
  - Mark existing pages as daily notes
  - Daily Notes panel with calendar view
  - Carry Forward Daily Notes action
- [x] **Weekly/monthly rollups** - Aggregate journals
  - Auto-generate weekly/monthly summary from daily notes via AI
  - Period selector (this/last week/month)
  - Summary style options (concise, detailed, bullets, narrative)
  - Custom prompt support
  - Save rollup as new page
- [x] **Reflection prompts** - AI-generated prompts
  - Category tabs (Gratitude, Learning, Goals, Review, Free)
  - AI-generated prompts based on recent journal entries
  - Static fallback prompts when AI unavailable
  - "Use" button to insert prompt into daily note
  - Collapsible card in Daily Notes panel
- [x] **Mood/habit tracking** - Quick daily check-ins
  - Editor.js block tool with emoji mood selector (5 levels)
  - Configurable habit checkboxes (add/remove habits)
  - D3 mood line chart and habit completion bars
  - Date range filtering (7/14/30 days)
  - Habits persisted via Zustand store
- [x] **Energy & focus tracking** - Energy-aware daily planning
  - Morning check-in: quick 1-click energy level (1-5) and focus capacity (deep work / light work / physical / creative)
  - Optional: sleep quality, notes ("didn't sleep well", "feeling restless")
  - Stored as structured JSON alongside daily note (not just an editor block)
  - Combined daily check-in with mood, energy, and habits in DailyNotesPanel
  - Pattern detection over time:
    - Day-of-week energy and mood trends
    - Streak and rhythm visibility
  - Integration with existing systems:
    - Daily notes: combined check-in widget at top of panel
    - Mood tracker: energy as separate axis from mood on charts
    - Habits: configurable habit tracking with completion bars
  - External agent API:
    - JSON export of energy/focus history for external planning agents
    - Tauri commands: `get_energy_log`, `log_energy_checkin`
    - Agents can read patterns and factor energy into scheduling recommendations
  - Visualizations:
    - Check-in heatmap (calendar grid, color-coded by energy level)
    - Mood line chart and habit completion bars
    - WebDAV sync for energy check-ins across devices

---

### 39. Collaboration (Notion, Craft)

- [ ] **Page comments** - Threaded discussions
  - Comment on pages or individual blocks
  - Reply threads
  - Resolve/unresolve comments
  - Comment notifications
- [ ] **@mentions** - Reference content inline
  - @page-name to link pages
  - @date for date references
  - Future: @person for shared notebooks
- [ ] **Shared notebooks** - Multi-user access
  - Share specific notebooks with others
  - Permission levels (view, edit, admin)
  - Sync shared content
- [ ] **Real-time collaboration** - Simultaneous editing
  - Multiple users editing same page
  - Cursor presence indicators
  - Conflict-free via CRDT (already have Yrs)

---

### 40. Publishing & Sharing (Obsidian, Craft, Notion)

- [x] **Publish to web** - Static site generation ⭐ TOP RECOMMENDATION
  - One-click publish pages as website (4 themes: Minimal, Documentation, Blog, Academic)
  - Theme/styling options with preview
  - Choose whole notebook or selected pages to publish
  - Wiki-link resolution and backlinks support
  - Image asset copying
  - Command Palette integration ("Publish to Web")
- [ ] **Share as link** - Single page sharing
  - Generate shareable link for any page
  - Optional expiration date
  - View-only or allow comments
- [x] **Export as presentation** - Slides from pages
  - Convert page to Reveal.js slide deck (H1/H2 headers split slides)
  - 5 themes (white, black, moon, solarized, dracula) + 4 transitions
  - Fullscreen in-app presenter with ESC to exit
  - Export as standalone HTML with CDN assets
- [x] **Print-friendly export** - PDF with proper formatting
  - Clean print-optimized HTML (serif font, A4 page breaks)
  - Optional table of contents from headers
  - Optional metadata (tags, dates)
  - Preview iframe with browser print dialog (Ctrl+P for PDF)

---

### 41. Capture & Input (Evernote, Apple Notes)

- [x] **Web clipper** - In-app URL clipper ⭐ TOP RECOMMENDATION
  - Clip any URL via dialog (sidebar button or editor trigger)
  - Readability-based article extraction (Rust `readability` crate)
  - Metadata capture (title, favicon, site name via OpenGraph)
  - Block preview with title editing before save
  - Notebook and folder selection for target page
  - Source attribution block auto-added
  - Smart URL normalization (auto-adds https://)
- [ ] **Document scanning** - Camera-based capture
  - Scan documents with device camera
  - Auto-crop and perspective correction
  - OCR text extraction
  - Save as image or searchable PDF
- [ ] **Audio recording** - Voice notes
  - Record audio attached to page
  - Optional transcription via Whisper
  - Timestamp links in transcript
  - Playback controls in page
- [ ] **Email to notebook** - Email capture
  - Unique email address per notebook
  - Forward emails to create pages
  - Parse attachments
  - Tag via subject line prefixes

---

### 42. Task Management (Notion, Todoist)

- [x] **Task database** - Centralized task list
  - Zustand+persist store with full CRUD
  - Priority levels (low/medium/high/urgent), due dates, projects, tags
  - Quick add tasks via modal editor
  - Sidebar button with overdue/due-today badge
- [x] **Due date reminders** - Notifications
  - Set due dates and times on tasks
  - Browser notifications for overdue/due-today (15-min check interval)
  - Overdue task highlighting (red badge) and due-today (orange badge)
- [x] **Recurring tasks** - Repeating items
  - Daily, weekly, monthly, yearly recurrence with configurable interval
  - Days-of-week selection for weekly, optional end date
  - Regenerate on completion (creates next instance linked via parentTaskId)
- [x] **Task views** - Multiple perspectives
  - Today view (due today + overdue)
  - Upcoming view (future tasks)
  - By project (with project dropdown filter)
  - By priority (sorted urgent → low)
  - All tasks view

---

### 43. AI Enhancements (Mem, Notion AI, Reflect)

- [x] **Smart collections** - AI-curated groups
  - Automatically group related pages
  - "Notes about X" collections
  - Update as content changes
- [ ] **Meeting notes integration** - Calendar-aware
  - Connect to calendar (Google, Outlook)
  - Auto-create meeting pages
  - Pull attendees, agenda from invite
  - Post-meeting summary generation
- [x] **Semantic search** - Beyond keywords
  - "Find similar" to current page
  - Natural language queries ("notes from last week about project X")
  - Conceptual matching, not just text
- [x] **Daily AI digest** - Automated summaries
  - Summary of what you wrote/learned today
  - Connections to past notes
  - Suggested follow-ups
- [x] **Inline AI assistance** - Writing helpers
  - Summarize selection
  - Expand bullet points
  - Translate text
  - Fix grammar/spelling inline
  - Change tone (formal, casual)

---

### 44. Navigation & Organization

- [ ] **Workspaces** - Save window layouts
  - Save current panel arrangement, open pages
  - Switch between workspaces (e.g., "Writing", "Research", "Review")
  - Per-project workspaces
- [x] **Starred/pinned pages** - Quick access ⭐ TOP RECOMMENDATION
  - Star frequently used pages
  - Starred section in sidebar
  - Keyboard shortcut to toggle star
- [x] **Recent pages** - History
  - List of recently viewed pages
  - Quick switcher with recent pages first
  - Clear history option
- [x] **Random note** - Rediscovery
  - Surface a random page for review
  - Filter by notebook, age, or tag
  - "Surprise me" feature
- [x] **Nested tags** - Tag hierarchy
  - Hierarchical tags (`#work/project-a/tasks`)
  - Browse tag tree
  - Filter by parent or child tags

---

### 45. Writing Tools

- [x] **Word count goals** - Writing targets
  - Set target word count per page or session (daily/session period)
  - Progress bar in page header
  - Streak tracking from daily history (last 90 days)
  - Settings modal with target, period toggle, and recent history
- [x] **Focus mode enhancements** - Concentration aids
  - Paragraph mode: dim non-active blocks (opacity 0.25)
  - Sentence mode: highlight active sentence via Range API
  - Configurable in Settings > Zen Mode (none/paragraph/sentence)
  - 50ms debounced selectionchange listener with cleanup
- [x] **Typewriter scrolling** - Centered cursor
  - Keep cursor vertically centered while typing
  - Reduces eye movement
  - Toggle in Zen mode settings
- [x] **Pomodoro timer** - Focus sessions
  - 25/5/15 min work/short break/long break with configurable durations
  - Floating pill (minimized) and expanded view with arc progress
  - Session tracking (sessions before long break, today's count)
  - Browser notifications on session end
  - Auto-start breaks toggle, pause/resume/skip/reset controls

---

---

### 46. CLI for Notebooks

A command-line interface for viewing and searching notebook content without launching the GUI.

- [x] **CLI binary** - Standalone CLI tool (`nous-cli` or subcommand)
  - Separate Rust binary with `tui` feature flag
  - Reuses existing storage layer (`src-tauri/src/storage/`)
  - Library/notebook discovery from default data directory
- [x] **List & browse** - Navigate notebook structure from terminal
  - `nous-cli list` — list all libraries and notebooks
  - `nous-cli ls <notebook>` — list pages/folders in a notebook
  - `nous-cli show <notebook> <page>` — render page content to terminal
  - `nous-cli tree <notebook>` — tree view of folder hierarchy
- [x] **Full-text search** - Search across notebooks from CLI
  - `nous-cli search <query>` — search all notebooks (uses existing Tantivy index)
  - `nous-cli search --notebook <name> <query>` — scoped search
  - Output: page title, notebook, matched excerpt
- [x] **Tag operations** - Query and filter by tags
  - `nous-cli tags` — list all tags with counts
  - `nous-cli tags --notebook <name>` — scoped to notebook
- [x] **Output formats** - Machine-readable output
  - `--format json` flag for JSON output (for piping/scripting)
  - `--format plain` for plain text (default)
- [x] **Page creation** - Create pages from CLI
  - `nous-cli new <notebook> [title]` — create page with optional folder, tags, content
  - Stdin piping support for content (`echo "text" | nous-cli new Agile`)
- [x] **Inbox capture** - Quick capture from CLI
  - `nous-cli inbox capture <title>` — capture to inbox with optional content/tags
  - `nous-cli inbox list [--unprocessed]` — list inbox items
- [x] **Interactive TUI** - Terminal UI for browsing
  - Tree navigation with vim-style keys
  - Page content viewer with scrolling
  - Full-text search integration
  - `n` key for quick note creation, `i` key for inbox capture

---

### 47. MCP Server for AI Agents

Expose Nous notebooks to external AI agents (Claude Code, etc.) via the Model Context Protocol.

- [x] **MCP server** - Python FastMCP server (`nous-py/nous_mcp/`)
  - 8 tools: list_notebooks, list_sections, list_folders, list_pages, get_page, search_pages, create_page, append_to_page
  - Name resolution (case-insensitive exact match, then prefix match, UUID support)
  - Multi-library support via `--library` flag or `NOUS_LIBRARY` env var
  - Editor.js → Markdown conversion (Python port of export.rs, including wiki-link/block-ref)
  - Write operations use NousPageStorage (atomic writes + oplog)
  - Configured as `nous-mcp` script entry point in pyproject.toml
- [x] **Section support on `create_page`** - Add `section` parameter (name/UUID) so pages can be placed in sections; underlying NousPageStorage already supports `section_id`
- [x] **Richer markdown-to-blocks conversion** - Parse `#` headers, `- ` unordered lists, `1. ` ordered lists, `- [ ]` checklists, ``` code blocks, `> ` blockquotes, `---` delimiters (not just paragraphs)
- [x] **Page update tool** - Replace full page content, title, or tags (not just append)
- [x] **Folder/tag management tools** - Create folders, move pages between folders, add/remove tags via MCP

---

### 48. Distribution & Packaging

- [ ] **Homebrew Linux binaries** - Add Linux builds to Homebrew tap
  - Produce `nous-{target}.tar.gz` tarballs in CI (alongside existing .deb/.AppImage/.dmg)
  - Create `Formula/nous.rb` with platform-conditional URLs (x86_64 + aarch64 Linux, aarch64 macOS)
  - Update release workflow to compute SHA-256s for all tarballs and template into formula
  - Keep existing `Casks/nous.rb` for macOS users who prefer `brew install --cask`
  - Requires verifying Tauri binary runs standalone without bundled webview resources
- [ ] **Flatpak/Snap packaging** - Alternative Linux distribution channels
- [ ] **AUR package** - Arch Linux user repository

---

## Notes

- Priority order within sections is flexible
- AI features depend on Python bridge (nous-py) being properly configured
- Some features may require additional Tauri plugins
- ⭐ marks top recommended features for high impact
