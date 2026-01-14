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
  - Support for OpenAI, Anthropic, and Ollama providers

- [x] **Sections, Color Coding & Cover Pages**
  - Color coding for notebooks, sections, and folders
  - Sections - OneNote-style organizational layer (Notebook → Section → Folders → Pages)
  - Section tabs with colored indicators
  - Enable/disable sections per notebook
  - Cover pages - Optional styled entry page for notebooks
  - Cover page editor with notebook color theming
  - ColorPicker component with 16 presets and custom hex input

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
- [ ] Backup to cloud storage (optional)

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
- [ ] Branch support (future):
  - [ ] Create/switch branches for experimental edits
  - [ ] Merge branches back
  - [ ] Branch indicator in UI
- [ ] Conflict resolution (future):
  - [ ] Detect merge conflicts on pull
  - [ ] Simple conflict resolution UI
  - [ ] Manual resolution fallback

---

## Future

### 14. Spaced Repetition
- [ ] Mark content as "flashcard"
- [ ] Review queue with spaced intervals
- [ ] Progress tracking
- [ ] Integration with page content

### 15. PDF Import & Annotation
- [ ] Import PDF files
- [ ] PDF viewer in app
- [ ] Highlight and annotate
- [ ] Extract highlights to page

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
- [ ] Cloud sync between devices
- [ ] Conflict resolution
- [ ] Mobile companion app (or PWA)
- [ ] Offline support

### 19. Import from Other Apps
- [ ] OneNote notebook import
- [x] Scrivener project import (.scriv folders with RTF content)
- [x] Evernote export import (.enex XML with HTML content)
- [x] Notion export import (ZIP with markdown & CSV databases)
- [x] Obsidian vault import (markdown with YAML frontmatter, wiki-links, attachments)
- [ ] Apple Notes import

---

## Technical Debt & Polish

- [ ] Add comprehensive error handling for file operations
- [ ] Add loading states for async operations
- [ ] Improve accessibility (keyboard navigation, screen readers)
- [ ] Add unit tests for markdown conversion
- [ ] Performance optimization for large notebooks

---

## Notes

- Priority order within sections is flexible
- AI features depend on Python bridge (katt-py) being properly configured
- Some features may require additional Tauri plugins
