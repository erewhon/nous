# Katt - Personal Notebook & Data Organization Tool

## Project Overview

Katt is a comprehensive personal notebook and data organization tool supporting traditional notebooks, Zettelkasten methodology, and AI-powered research capabilities.

**Tech Stack:**
- **Frontend:** TypeScript, React, Vite, Editor.js
- **Desktop:** Tauri (Rust)
- **Backend:** Rust with PyO3-embedded Python (AI operations call Python via PyO3)
- **Storage:** File-based (Editor.js JSON format) with future SQLite option

---

## Phase 1: Foundation & Core Infrastructure

### 1.1 Project Setup
- Initialize Tauri + React + Vite + TypeScript project
- Configure build tooling (pnpm, ruff, prettier)
- Set up project structure:
  ```
  katt/
  ├── src-tauri/          # Rust backend (with PyO3)
  │   └── src/
  │       └── python/     # Python modules called via PyO3
  ├── src/                # React frontend
  │   ├── components/
  │   ├── hooks/
  │   ├── stores/
  │   ├── types/
  │   └── utils/
  ├── katt-py/            # Python package (AI operations)
  └── data/               # Default data directory
  ```
- Configure TypeScript with strict mode
- Set up Zod for runtime validation

### 1.2 Core Data Model
Define TypeScript types and Zod schemas for:
- **Notebook:** Collection of pages with metadata
- **Page:** Individual document with Editor.js content
- **Zettel:** Atomic note with links and tags (extends Page)
- **Block:** Editor.js block representation
- **Link:** Bi-directional linking support

### 1.3 File-Based Storage Layer
- Implement storage abstraction interface
- File structure:
  ```
  notebooks/
  ├── {notebook-id}/
  │   ├── notebook.json     # Notebook metadata
  │   └── pages/
  │       ├── {page-id}.json
  │       └── ...
  └── zettelkasten/         # Special notebook type
      ├── notebook.json
      └── zettels/
          └── {zettel-id}.json
  ```
- Rust commands for file operations (read, write, list, watch)
- File change watcher for external modifications

### 1.4 Basic UI Shell
- Main application layout (sidebar + editor area)
- Notebook list sidebar
- Page list view
- Basic navigation and routing

---

## Phase 2: Editor & Core Features

### 2.1 Editor.js Integration
- Integrate Editor.js with React
- Implement custom blocks:
  - Paragraph, Header, List, Checklist (built-in)
  - Code block with syntax highlighting
  - Image/media embedding
  - Internal link block (wiki-links)
  - Callout/admonition blocks
- Auto-save functionality
- Undo/redo support

### 2.2 Notebook Management
- Create, rename, delete notebooks
- Notebook settings (icon, color, type)
- Notebook types: Standard, Zettelkasten
- Import existing markdown directory as notebook

### 2.3 Page Management
- Create, rename, delete, move pages
- Page metadata (created, modified, tags)
- Page templates
- Duplicate page functionality

### 2.4 Zettelkasten Features
- Atomic note creation with unique IDs
- Bi-directional linking (`[[note-title]]` syntax)
- Backlinks panel showing incoming links
- Tag system with tag browser
- Graph view (basic node visualization)

---

## Phase 3: Search & Navigation

### 3.1 Search Infrastructure
- Full-text search across all notebooks
- Search index (Rust-based for performance)
- Fuzzy matching for quick navigation
- Search filters (notebook, tags, date range)

### 3.2 Quick Switcher
- Command palette (Cmd/Ctrl+K)
- Quick page/notebook switching
- Recent files list
- Keyboard-driven navigation

### 3.3 Graph View
- Interactive node graph using D3.js or similar
- Filter by notebook, tags, links
- Zoom and pan controls
- Click-to-navigate

---

## Phase 4: PyO3 Integration & AI Features

### 4.1 PyO3 Setup
- Configure PyO3 in Cargo.toml with `pyo3` and `maturin`
- Python module embedded in Rust backend
- Tauri commands invoke Python via PyO3
- Pydantic models for data validation on Python side
- Async bridge (tokio + Python asyncio via pyo3-asyncio)

### 4.2 AI Provider Abstraction
- Provider interface supporting:
  - OpenAI (GPT-4, O3)
  - Anthropic (Claude)
  - Local models (Ollama, llama.cpp)
- API key management (secure storage via Tauri)
- Model selection per operation

### 4.3 AI Features - Phase 1
- Chat with page context
- Summarize page/notebook
- Generate suggestions/completions
- Question answering about content

### 4.4 AI Features - Phase 2
- Web research assistant (search, scrape, summarize)
- Auto-generate Zettelkasten links
- Smart tagging suggestions
- Content analysis and insights

---

## Phase 5: Import/Export & Interoperability

### 5.1 Markdown Support
- Export pages to Markdown
- Import Markdown files
- "Open folder as notebook" mode
- Bi-directional sync with Markdown files

### 5.2 Other Formats
- Export to PDF
- Import from:
  - Notion (via export)
  - Obsidian vaults
  - Roam Research
- HTML export for web publishing

### 5.3 External Integrations
- Calendar integration (iCal, Google Calendar)
- Read external sources as reference material

---

## Phase 6: Advanced Features

### 6.1 Learning Assistant
- Spaced repetition system for notes
- Quiz generation from content
- Podcast/audio mode (TTS for notes)
- Study session tracking

### 6.2 Media Processing
- PDF import and annotation
- Video transcription (Whisper integration)
- Image OCR for text extraction
- Audio note recording

### 6.3 Templates & Workflows
- Page templates (meeting notes, daily journal, etc.)
- Agile Results daily/weekly/monthly views
- Custom workflows and automations

### 6.4 Specialized Modes
- **Script Writing Mode:** Screenplay/script formatting, character tracking, scene management
- **Research Mode:** Citation management, source linking, bibliography generation
- **Web Publishing:** Export notebooks/pages as static sites, Markdown-based publishing

### 6.5 External Sources of Truth
- Calendar integration (read-only or bidirectional)
- RSS feed aggregation into notebooks
- Bookmark/web clipper integration

---

## Phase 7: Multi-Platform & Security

### 7.1 Encryption
- Encrypted notebooks (at-rest encryption)
- Password-protected vaults
- Secure key derivation

### 7.2 Sync & Backup
- Git-based sync option
- Cloud storage integration (optional)
- Automatic backups

### 7.3 Additional Platforms (Future)
- Web-hosted version (separate deployment)
- Mobile apps (React Native or native)
- TUI version (terminal interface)

---

## Implementation Priority for MVP

**MVP Scope (Phases 1-2):**
1. Tauri + React + Vite setup
2. File-based storage with Editor.js JSON
3. Notebook and page CRUD operations
4. Editor.js integration with basic blocks
5. Zettelkasten with bi-directional links
6. Basic search functionality

**Post-MVP Priority:**
1. AI integration (Phase 4.1-4.3)
2. Markdown import/export (Phase 5.1)
3. Graph view (Phase 3.3)
4. Learning assistant basics (Phase 6.1)

---

## Key Files to Create (Phase 1)

```
katt/
├── package.json
├── pnpm-lock.yaml
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── src-tauri/
│   ├── Cargo.toml              # Include pyo3, pyo3-asyncio
│   ├── tauri.conf.json
│   ├── build.rs                # PyO3 build configuration
│   └── src/
│       ├── main.rs
│       ├── commands/
│       │   ├── mod.rs
│       │   ├── notebook.rs
│       │   ├── page.rs
│       │   └── ai.rs           # AI commands via PyO3
│       ├── storage/
│       │   ├── mod.rs
│       │   └── file_storage.rs
│       └── python_bridge/
│           ├── mod.rs          # PyO3 initialization
│           └── ai_ops.rs       # Python AI function calls
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── Layout/
│   │   ├── Sidebar/
│   │   ├── Editor/
│   │   └── NotebookList/
│   ├── stores/
│   │   ├── notebookStore.ts
│   │   └── pageStore.ts
│   ├── types/
│   │   ├── notebook.ts
│   │   └── page.ts
│   └── hooks/
│       ├── useNotebook.ts
│       └── usePage.ts
└── katt-py/                    # Python package (installed in venv, called via PyO3)
    ├── pyproject.toml
    └── katt_ai/
        ├── __init__.py
        ├── chat.py             # Chat/completion functions
        ├── research.py         # Web research functions
        └── providers/
            ├── __init__.py
            ├── base.py         # Abstract provider
            ├── openai.py
            ├── anthropic.py
            └── ollama.py
```

---

## Verification

After Phase 1-2 implementation:
1. Run `pnpm dev` - app launches without errors
2. Create a new notebook
3. Add pages with Editor.js content
4. Verify files are saved to disk in correct format
5. Create Zettelkasten notes with links
6. Verify backlinks are detected and displayed
7. Run `pnpm build` - production build succeeds
8. Run `cargo tauri build` - desktop app packages correctly

---

## Local CI Build

You can run the GitHub Actions build workflow locally using [`act`](https://github.com/nektos/act), which executes the workflow inside Docker containers.

**Prerequisites:** `act` and Docker must be installed and the Docker daemon running.

```bash
# Run the Ubuntu build locally
bash scripts/act-build.sh

# Dry-run (show what would execute without running)
bash scripts/act-build.sh --dryrun
```

The script runs the `build` job from `.github/workflows/build.yml` filtered to the `ubuntu-22.04` matrix entry. Build artifacts are written to `/tmp/act-artifacts`.

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| State Management | Zustand | Lightweight, TypeScript-friendly |
| Styling | Tailwind CSS | Rapid development, consistent design |
| Editor | Editor.js | Block-based, extensible, JSON output |
| File Watching | notify (Rust) | Native performance, cross-platform |
| Python Bridge | PyO3 | Direct Rust-Python calls, no IPC overhead |
| AI Framework | LangChain or LiteLLM (Python) | Multi-provider support, tooling |
| Search | Tantivy (Rust) | Fast full-text search |
| Graph Visualization | React Flow or D3 | Interactive, customizable |
| Async Bridge | pyo3-asyncio | Tokio ↔ Python asyncio interop |

---

## PyO3 Architecture Detail

The Rust backend embeds a Python interpreter via PyO3, enabling direct function calls without network overhead:

```
┌─────────────────────────────────────────────────────────────┐
│                     Tauri Frontend                          │
│                   (React + TypeScript)                      │
└─────────────────────┬───────────────────────────────────────┘
                      │ invoke()
┌─────────────────────▼───────────────────────────────────────┐
│                     Tauri Commands                          │
│                       (Rust)                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Storage    │  │   Search    │  │   AI Commands       │  │
│  │  Commands   │  │   Commands  │  │   (calls PyO3)      │  │
│  └─────────────┘  └─────────────┘  └──────────┬──────────┘  │
└───────────────────────────────────────────────┼─────────────┘
                                                │ PyO3
┌───────────────────────────────────────────────▼─────────────┐
│                   Embedded Python                           │
│                    (katt-py package)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Chat       │  │  Research   │  │   Providers         │  │
│  │  Functions  │  │  Functions  │  │   (OpenAI, etc.)    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Key considerations:**
- Python interpreter initialized once at app startup
- Python venv bundled with app distribution
- Async operations use `pyo3-asyncio` to bridge tokio and asyncio
- GIL management handled by PyO3 (use `Python::allow_threads` for CPU-bound Rust)
