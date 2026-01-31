#!/usr/bin/env bash
# Run the Nous development server with proper Python/PyO3 environment

set -e

source "$(dirname "$0")/setup-python-env.sh"

echo ""
echo "Starting Nous dev server..."
exec pnpm dev
