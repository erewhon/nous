#!/usr/bin/env bash
# Run the Nous TUI with proper Python/PyO3 environment

set -e

source "$(dirname "$0")/setup-python-env.sh"

exec "$(dirname "$0")/src-tauri/target/debug/nous-cli" "$@"
