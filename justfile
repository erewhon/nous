# Nous build, dev, and deploy tasks
#
# Run `just` (no args) to list recipes.
#
# Recipes that compile Rust source `setup-python-env.sh` to populate
# PYO3_PYTHON / LD_LIBRARY_PATH dynamically (matches what `uv` resolves);
# the script also runs `uv sync` for nous-py on first invocation.

# pkg-config for system libs (webkit2gtk, soup3, etc.) — Tauri needs these
export PKG_CONFIG_PATH := "/usr/lib/x86_64-linux-gnu/pkgconfig:" + env_var_or_default("PKG_CONFIG_PATH", "")

# === Default ===

default:
    @just --list

# === Dev: full Tauri app ===

# Run the Tauri desktop app in dev mode (frontend + Rust backend)
dev:
    #!/usr/bin/env bash
    set -e
    source setup-python-env.sh > /dev/null
    find "${HOME}/.local/share/com.nous.dev" -name "*.tantivy-writer.lock" -delete 2>/dev/null || true
    echo "Starting Nous dev server..."
    pnpm dev

# Run only the Vite frontend (no Tauri shell)
dev-web:
    pnpm dev:vite

# Build the Tauri desktop app (release)
build:
    #!/usr/bin/env bash
    set -e
    source setup-python-env.sh > /dev/null
    pnpm build

# Vite preview of the built frontend
preview:
    pnpm preview

# === Daemon / CLI ===

# Run the nous daemon (debug build) with PyO3 env set up
daemon *ARGS:
    #!/usr/bin/env bash
    set -e
    source setup-python-env.sh > /dev/null
    cargo build --manifest-path src-tauri/Cargo.toml --bin nous-cli
    export RUST_LOG="${RUST_LOG:-info}"
    exec ./src-tauri/target/debug/nous-cli daemon start {{ARGS}}

# Run the nous TUI / CLI against the existing debug build
tui *ARGS:
    #!/usr/bin/env bash
    set -e
    source setup-python-env.sh > /dev/null
    exec ./src-tauri/target/debug/nous-cli {{ARGS}}

# Build + install nous-cli to ~/.local/bin (release; pass --debug for debug build)
install-cli *ARGS:
    bash install-cli.sh {{ARGS}}

# Build the release daemon, install it, and (re)register the systemd unit
build-daemon:
    bash build-daemon.sh

# === Checks & tests ===

# Compile-check the whole Rust crate
check:
    #!/usr/bin/env bash
    set -e
    source setup-python-env.sh > /dev/null
    cargo check --manifest-path src-tauri/Cargo.toml

# Run the Rust test suite
test-rust *ARGS:
    #!/usr/bin/env bash
    set -e
    source setup-python-env.sh > /dev/null
    cargo test --manifest-path src-tauri/Cargo.toml {{ARGS}}

# Run the Python (nous-py / MCP server / SDK) test suite
test-py *ARGS:
    cd nous-py && uv run pytest {{ARGS}}

# Run all tests (Rust + Python)
test: test-rust test-py

# TypeScript type-check (frontend)
typecheck:
    pnpm typecheck

# Prettier — write changes
format:
    pnpm format

# Prettier — check only
format-check:
    pnpm format:check

# === Cloud Workers (api.nous.page) ===

# Cloud Worker: dev (cloud/)
cloud-dev:
    cd cloud && npm run dev

# Cloud Worker: deploy
cloud-deploy:
    cd cloud && npm run deploy

# Cloud Worker: type-check
cloud-typecheck:
    cd cloud && npm run typecheck

# D1 schema migration — remote
cloud-db-migrate:
    cd cloud && npm run db:migrate

# D1 schema migration — local
cloud-db-migrate-local:
    cd cloud && npm run db:migrate:local

# === Collab (PartyKit, party.nous.page) ===

# Collab server: dev
collab-dev:
    cd collab/server && npm run dev

# Collab server: deploy
collab-deploy:
    cd collab/server && npm run deploy

# === Guest editor (collab.nous.page) ===

# Guest editor: dev (Vite)
guest-editor-dev:
    cd collab/guest-editor && npm run dev

# Guest editor: build & deploy to merope
guest-editor-deploy:
    bash collab/guest-editor/deploy.sh

# === Python SDK / MCP server ===

# Sync nous-py dependencies via uv
mcp-deps:
    cd nous-py && uv sync

# === Release ===

# Trigger a CalVer release. Args: --dry-run, --local, or explicit version (e.g. 2026.5.0)
release *ARGS:
    bash scripts/release.sh {{ARGS}}

# Bundle Python runtime for the desktop release tarball
bundle-python:
    bash scripts/bundle-python.sh

# Run the GitHub Actions build locally via `act`
act-build:
    bash scripts/act-build.sh

# === Cleanup ===

# Clean Rust build artifacts
clean:
    cargo clean --manifest-path src-tauri/Cargo.toml
