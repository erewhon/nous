#!/bin/bash
# Deploy the share viewer to Cloudflare Pages (project: nous-web → app.nous.page).
# merope (rsync target of the old version of this script) was decommissioned 2026-06.
set -e

cd "$(dirname "$0")"

echo "Building web viewer..."
npm run build

echo "Deploying to Cloudflare Pages (nous-web)..."
npx wrangler pages deploy dist --project-name=nous-web --commit-dirty=true

echo "Done! Web viewer is live at https://app.nous.page"
