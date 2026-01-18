# Katt Development Roadmap

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
- [ ] Password-protected notebooks
- [ ] Encrypt notebook data at rest
- [ ] Secure unlock flow
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
  - [x] Manual, on-save, and periodic sync modes
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

### 21. Import from Other Apps
- [ ] OneNote notebook import
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
  - Python module: `katt_ai/video_transcribe.py`
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
  - Python module: `katt_ai/document_convert.py`
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
  - Python module: `katt_ai/browser_automation.py`
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
- [ ] File type icons in sidebar (distinct icons for PDF, Jupyter, EPUB, Calendar pages)
- [ ] Drag-drop import (drop files directly into page tree)
- [ ] Search results display by page type

### 28. Multi-Format Search Indexing
- [ ] Extract text from PDF files for search (via pdfplumber or similar)
- [ ] Index Jupyter notebook content (code cells + markdown cells)
- [ ] Index EPUB text content (chapter text)
- [ ] Index Calendar events (event summaries and descriptions)

### 29. Multi-Format Advanced Features
- [ ] Linked file sync detection (detect external file changes, prompt to reload)
- [ ] Jupyter cell execution via Python kernel
- [ ] PDF annotation persistence (save highlights/notes)
- [ ] EPUB reading progress tracking
- [ ] EPUB highlight/annotation support

---

## Technical Debt & Polish

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

## Notes

- Priority order within sections is flexible
- AI features depend on Python bridge (katt-py) being properly configured
- Some features may require additional Tauri plugins
