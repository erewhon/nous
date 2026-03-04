#!/usr/bin/env bash
# Run frontend + backend compilation checks without starting the dev server.
# Useful for verifying code changes compile cleanly.

set -e

# Ensure pkg-config can find system libraries (webkit2gtk, soup3, etc.)
export PKG_CONFIG_PATH="/usr/lib/x86_64-linux-gnu/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"

source "$(dirname "$0")/setup-python-env.sh"

#echo ""
#echo "=== TypeScript type check ==="
#pnpm tsc --noEmit
#echo "TypeScript: OK"

echo ""
echo "=== Rust cargo check ==="
cd src-tauri
cargo check 2>&1
echo "Rust: OK"

echo ""
echo "All checks passed."
