#!/usr/bin/env bash
# Run the Nous daemon in dev mode with proper Python/PyO3 environment

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Ensure pkg-config can find system libraries (webkit2gtk, soup3, etc.)
export PKG_CONFIG_PATH="/usr/lib/x86_64-linux-gnu/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"

source "${SCRIPT_DIR}/setup-python-env.sh"

# Build the CLI binary
echo ""
echo "Building nous-cli..."
cargo build --manifest-path "${SCRIPT_DIR}/src-tauri/Cargo.toml" --bin nous-cli

echo ""
echo "Starting Nous daemon..."
export RUST_LOG="${RUST_LOG:-info}"
exec "${SCRIPT_DIR}/src-tauri/target/debug/nous-cli" daemon start "$@"
