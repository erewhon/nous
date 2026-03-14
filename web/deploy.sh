#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Building web viewer..."
npm run build

echo "Deploying to merope..."
rsync -av --delete --exclude='serve.mjs' dist/ merope:/srv/nous-web/

echo "Restarting service..."
ssh merope "sudo systemctl restart nous-web"

echo "Done! Web viewer is live at https://app.nous.page"
