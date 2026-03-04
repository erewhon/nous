#!/usr/bin/env bash
# Deploy the guest editor to merope.
# Builds the Vite SPA and rsyncs dist/ to /srv/nous-collab/ on merope,
# then restarts the Node serve process.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Building guest editor ==="
pnpm build

echo "=== Deploying to merope:/srv/nous-collab/ ==="
rsync -av --delete \
  --exclude='serve.mjs' \
  dist/ merope:/srv/nous-collab/

echo "=== Restarting guest editor service ==="
ssh merope "sudo systemctl restart nous-collab-guest"

echo "=== Done ==="
