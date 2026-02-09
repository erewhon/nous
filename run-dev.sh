#!/usr/bin/env bash
# Run the Nous development server with proper Python/PyO3 environment

set -e

source "$(dirname "$0")/setup-python-env.sh"

# Clean up stale Tantivy writer locks from previous crashed sessions
find "${HOME}/.local/share/com.nous.dev" -name "*.tantivy-writer.lock" -delete 2>/dev/null || true

echo ""
echo "Starting Nous dev server..."
exec pnpm dev
