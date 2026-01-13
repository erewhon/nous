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

---

## Short-term (Next up)

### 1. Full-text Search Polish
Already implemented with Tantivy, may need refinement:
- [ ] Search result highlighting
- [ ] Search within current notebook vs. all notebooks
- [ ] Recent searches history
- [ ] Search filters (by date, tags, notebook)

### 2. Wiki-link Support
- [x] Parse `[[page-name]]` links in editor content
- [x] Click-to-navigate between pages
- [x] Backlinks panel (pages that link to current page)
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
- [ ] AI-powered tag suggestions based on content
- [ ] Tag management UI (rename, merge, delete)
- [ ] Tag cloud visualization
- [ ] Filter pages by tag

### 5. Auto-link Suggestions
- [ ] AI analyzes page content for Zettelkasten connections
- [ ] Suggest related pages to link
- [ ] "Similar pages" panel
- [ ] Graph view enhancements

### 6. Page Templates
- [ ] Meeting notes template
- [ ] Daily journal template
- [ ] Project template
- [ ] Custom user templates
- [ ] Template selection on new page

### 7. Backup & Restore
- [ ] Export entire notebook as ZIP
- [ ] Import notebook from ZIP
- [ ] Auto-backup schedule
- [ ] Backup to cloud storage (optional)

---

## Future

### 9. Spaced Repetition
- [ ] Mark content as "flashcard"
- [ ] Review queue with spaced intervals
- [ ] Progress tracking
- [ ] Integration with page content

### 10. PDF Import & Annotation
- [ ] Import PDF files
- [ ] PDF viewer in app
- [ ] Highlight and annotate
- [ ] Extract highlights to page

### 11. Notebook Encryption
- [ ] Password-protected notebooks
- [ ] Encrypt notebook data at rest
- [ ] Secure unlock flow
- [ ] Optional biometric unlock

### 12. Theme Customization
- [ ] Light/dark mode toggle
- [ ] Custom color schemes
- [ ] Font selection
- [ ] Editor width settings

### 13. Mobile & Sync
- [ ] Cloud sync between devices
- [ ] Conflict resolution
- [ ] Mobile companion app (or PWA)
- [ ] Offline support

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
