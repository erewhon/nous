# Nous build, dev, and deploy tasks
#
# Run `just` (no args) to list recipes.
#
# Recipes that compile Rust source `setup-python-env.sh` to populate
# PYO3_PYTHON / LD_LIBRARY_PATH dynamically (matches what `uv` resolves);
# the script also runs `uv sync` for nous-py on first invocation.

# pkg-config for system libs (webkit2gtk, soup3, etc.) — Tauri needs these
export PKG_CONFIG_PATH := "/usr/lib/x86_64-linux-gnu/pkgconfig:" + env_var_or_default("PKG_CONFIG_PATH", "")

# Hosted staging VM (hekaton Incus cluster — docs/hosting.md).
# Environment-specific unit files can live outside the repo via
# NOUS_DEPLOY_DIR (gitignored .env), matching Astra's pattern.
staging_vm := env_var_or_default("NOUS_STAGING_VM", "nous-staging")
deploy_dir := env_var_or_default("NOUS_DEPLOY_DIR", "deploy")
staging_url := env_var_or_default("NOUS_STAGING_URL", "")

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

# === Web (browser) build — desktop frontend without the Tauri shell ===

# Build the browser bundle into dist-web/ (served by the daemon at /app)
web-build:
    pnpm typecheck
    pnpm exec vite build --config vite.web.config.ts

# Run the Vite dev server for the browser build against a local daemon
web-dev:
    pnpm exec vite --config vite.web.config.ts

# Preview the built browser bundle from dist-web/
web-preview:
    pnpm exec vite preview --config vite.web.config.ts

# Build and deploy the browser bundle where the daemon serves it (/app).
# Override the target with NOUS_WEB_APP_DIR (daemon reads the same variable).
web-deploy: web-build
    #!/usr/bin/env bash
    set -e
    TARGET="${NOUS_WEB_APP_DIR:-${HOME}/.local/share/nous/web-app}"
    mkdir -p "${TARGET}"
    rsync -a --delete dist-web/ "${TARGET}/"
    echo "Deployed dist-web/ -> ${TARGET} (served at /app)"

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

# Run the frontend (Vitest) test suite
test-frontend *ARGS:
    pnpm vitest run {{ARGS}}

# Run all tests (Rust + Python + frontend)
test: test-rust test-py test-frontend

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

# === Collab (Cloudflare Workers, party.nous.page) ===

# Collab server: dev (local worker via wrangler + miniflare)
collab-dev:
    cd collab/server && npm run dev

# Collab server: deploy (wrangler). Auth via the Cloudflare deploy token from `ho`.
# That token has Workers Scripts:Edit but NOT Workers Routes:Edit, so the route
# re-assertion step warns — harmless: the party.nous.page custom-domain route is
# already configured and never changes.
collab-deploy:
    cd collab/server && CLOUDFLARE_API_TOKEN="$(ho secret get cloudflare/deploy-token)" npm run deploy

# === Guest editor (collab.nous.page) ===

# Guest editor: dev (Vite)
guest-editor-dev:
    cd collab/guest-editor && npm run dev

# Guest editor: build & deploy to merope
guest-editor-deploy:
    bash collab/guest-editor/deploy.sh

# === Python SDK / MCP server ===

# Sync nous-py dependencies via uv (incl. the mcp-server extra the MCP server
# needs — a bare `uv sync` prunes it and breaks `nous-mcp`).
mcp-deps:
    cd nous-py && uv sync --extra mcp-server

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

# === Hosted staging (hekaton VM) ===

# Build and deploy daemon + web bundle + hardened units to the staging VM
deploy-staging: web-build
    #!/usr/bin/env bash
    set -euo pipefail
    source setup-python-env.sh > /dev/null
    cargo build --release --bin nous-cli --manifest-path src-tauri/Cargo.toml

    # Binary: push-to-temp + rename — overwriting a running binary
    # fails with "text file busy". Left root-owned on purpose (the
    # daemon must not be able to overwrite its own binary).
    incus file push --quiet src-tauri/target/release/nous-cli {{staging_vm}}/opt/nous/bin/nous-cli.new --mode 0755
    incus exec {{staging_vm}} -- mv /opt/nous/bin/nous-cli.new /opt/nous/bin/nous-cli

    # Web bundle -> {data_dir}/web-app (dist-web staged, then swapped)
    incus exec {{staging_vm}} -- rm -rf /var/lib/nous/nous/dist-web
    incus file push -r --quiet dist-web {{staging_vm}}/var/lib/nous/nous/
    incus exec {{staging_vm}} -- sh -c 'rm -rf /var/lib/nous/nous/web-app && mv /var/lib/nous/nous/dist-web /var/lib/nous/nous/web-app'

    # Hardened units (replace the provisioning bootstrap unit)
    incus file push --quiet {{deploy_dir}}/nous-daemon.service {{deploy_dir}}/nous-tunnel.service {{staging_vm}}/etc/systemd/system/ --mode 0644
    incus exec {{staging_vm}} -- sh -c 'systemctl daemon-reload && systemctl enable nous-daemon >/dev/null 2>&1; systemctl restart nous-daemon'
    # Tunnel only once cloudflared exists (installed by the tunnel/DNS leaf)
    incus exec {{staging_vm}} -- sh -c 'if command -v cloudflared >/dev/null 2>&1 && id cloudflared >/dev/null 2>&1; then systemctl enable nous-tunnel >/dev/null 2>&1; systemctl restart nous-tunnel; else echo "(cloudflared not installed — skipping nous-tunnel)"; fi'

    sleep 3
    if [ -n "{{staging_url}}" ]; then
        curl -sf "{{staging_url}}/healthz"
    else
        incus exec {{staging_vm}} -- curl -sf http://127.0.0.1:7667/healthz
    fi
    echo

# Status of the staging daemon + tunnel units
daemon-status:
    incus exec {{staging_vm}} -- systemctl status nous-daemon nous-tunnel --no-pager || true

# Follow the staging daemon + tunnel journals
daemon-logs:
    incus exec {{staging_vm}} -- journalctl -u nous-daemon -u nous-tunnel -f

# === Cleanup ===

# Clean Rust build artifacts
clean:
    cargo clean --manifest-path src-tauri/Cargo.toml
