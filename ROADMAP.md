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

## Future

### 9. Custom Actions & Automations
- [ ] Define custom actions with triggers and steps
- [ ] Invoke actions via AI chat (e.g., "create my daily goals")
- [ ] Agile Results workflow support:
  - [ ] Daily outcomes template with auto-date
  - [ ] Weekly outcomes with day breakdown
  - [ ] Monthly/yearly goal templates
  - [ ] Carry forward incomplete items
- [ ] Scheduled automations (daily/weekly triggers)
- [ ] Action library with pre-built workflows

### 10. Spaced Repetition
- [ ] Mark content as "flashcard"
- [ ] Review queue with spaced intervals
- [ ] Progress tracking
- [ ] Integration with page content

### 11. PDF Import & Annotation
- [ ] Import PDF files
- [ ] PDF viewer in app
- [ ] Highlight and annotate
- [ ] Extract highlights to page

### 12. Notebook Encryption
- [ ] Password-protected notebooks
- [ ] Encrypt notebook data at rest
- [ ] Secure unlock flow
- [ ] Optional biometric unlock

### 13. Theme Customization
- [x] Light/dark mode toggle (with system preference support)
- [x] Custom color schemes (Catppuccin, Default, Nord, Dracula)
- [x] Font selection (System, Inter, JetBrains Mono, Fira Code)
- [x] Editor width settings (Narrow, Medium, Wide, Full)
- [x] Font size and line height customization

### 14. Mobile & Sync
- [ ] Cloud sync between devices
- [ ] Conflict resolution
- [ ] Mobile companion app (or PWA)
- [ ] Offline support

### 15. Import from Other Apps
- [ ] OneNote notebook import
- [ ] Scrivener project import
- [ ] Evernote export import (.enex)
- [x] Notion export import (ZIP with markdown & CSV databases)
- [ ] Obsidian vault import
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
