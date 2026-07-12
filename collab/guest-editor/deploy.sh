#!/usr/bin/env bash
# Deploy the guest editor to Cloudflare Pages (project "nous-collab",
# serving collab.nous.page). merope, the previous rsync target, was
# decommissioned 2026-06 — see homeops/MEROPE-MIGRATION-PLAN.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Building guest editor ==="
npm run build

echo "=== Deploying to Cloudflare Pages (nous-collab) ==="
npx wrangler pages deploy dist --project-name=nous-collab --commit-dirty=true

echo "=== Done — serving at https://collab.nous.page ==="
