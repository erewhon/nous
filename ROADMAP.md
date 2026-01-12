# Katt Development Roadmap

## Completed

- [x] **Markdown Import/Export** - Export pages to .md files, import .md files as pages
  - YAML frontmatter with title, tags, timestamps
  - Block type conversion (headers, lists, checklists, code, quotes)
  - Command Palette and Page Header UI integration

---

## Short-term (Next up)

### 1. Full-text Search Polish
Already implemented with Tantivy, may need refinement:
- [ ] Search result highlighting
- [ ] Search within current notebook vs. all notebooks
- [ ] Recent searches history
- [ ] Search filters (by date, tags, notebook)

### 2. Editor.js Enhancements
- [ ] Code syntax highlighting (integrate highlight.js or Prism)
- [ ] Callout/admonition blocks (info, warning, tip, danger)
- [ ] Table support
- [ ] Image upload and display

### 3. Wiki-link Support
- [ ] Parse `[[page-name]]` links in editor content
- [ ] Click-to-navigate between pages
- [ ] Backlinks panel (pages that link to current page)
- [ ] Link autocomplete when typing `[[`

### 4. Keyboard Shortcuts
- [ ] `Cmd+N` - New page
- [ ] `Cmd+Shift+N` - New notebook
- [ ] `Cmd+E` - Export current page
- [ ] `Cmd+D` - Duplicate page
- [ ] `Cmd+Backspace` - Delete page (with confirmation)

---

## Medium-term

### 5. AI Web Research
- [ ] Web search integration (via Python bridge)
- [ ] URL scraping and content extraction
- [ ] AI summarization of web content
- [ ] Save research to new page

### 6. Smart Tagging
- [ ] AI-powered tag suggestions based on content
- [ ] Tag management UI (rename, merge, delete)
- [ ] Tag cloud visualization
- [ ] Filter pages by tag

### 7. Auto-link Suggestions
- [ ] AI analyzes page content for Zettelkasten connections
- [ ] Suggest related pages to link
- [ ] "Similar pages" panel
- [ ] Graph view enhancements

### 8. Page Templates
- [ ] Meeting notes template
- [ ] Daily journal template
- [ ] Project template
- [ ] Custom user templates
- [ ] Template selection on new page

### 9. Backup & Restore
- [ ] Export entire notebook as ZIP
- [ ] Import notebook from ZIP
- [ ] Auto-backup schedule
- [ ] Backup to cloud storage (optional)

---

## Future

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
- [ ] Light/dark mode toggle
- [ ] Custom color schemes
- [ ] Font selection
- [ ] Editor width settings

### 14. Mobile & Sync
- [ ] Cloud sync between devices
- [ ] Conflict resolution
- [ ] Mobile companion app (or PWA)
- [ ] Offline support

---

## Technical Debt & Polish

- [ ] Fix unused `in_list` variable warning in markdown import
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
