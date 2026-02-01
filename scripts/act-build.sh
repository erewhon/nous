#!/usr/bin/env bash
# Run the GitHub Actions build workflow locally using `act`.
# This targets the Ubuntu job by default.
#
# Usage:
#   bash scripts/act-build.sh          # Ubuntu build (default)
#   bash scripts/act-build.sh --dryrun  # Show what would run without executing
#
# Prerequisites:
#   - act (https://github.com/nektos/act)
#   - Docker

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ---- Check prerequisites ----
if ! command -v act &>/dev/null; then
    echo "ERROR: 'act' is not installed." >&2
    echo "  Install: https://github.com/nektos/act#installation" >&2
    exit 1
fi

if ! command -v docker &>/dev/null; then
    echo "ERROR: 'docker' is not installed or not in PATH." >&2
    exit 1
fi

# Determine whether we need sudo for docker access
SUDO=""
if ! docker info &>/dev/null 2>&1; then
    if sudo docker info &>/dev/null 2>&1; then
        SUDO="sudo --preserve-env=PATH env PATH=$PATH"
        echo "  Note: Using sudo for Docker access"
    else
        echo "ERROR: Cannot connect to Docker daemon." >&2
        echo "  Either start Docker or add your user to the 'docker' group:" >&2
        echo "    sudo usermod -aG docker \$(whoami) && newgrp docker" >&2
        exit 1
    fi
fi

# ---- Configuration ----
# Use the act-compatible Ubuntu 22.04 image (large enough for system deps + Rust builds)
UBUNTU_IMAGE="catthehacker/ubuntu:act-22.04"

DRYRUN=""
EXTRA_ARGS=()

for arg in "$@"; do
    case "${arg}" in
        --dryrun|-n)
            DRYRUN="--dryrun"
            ;;
        *)
            EXTRA_ARGS+=("${arg}")
            ;;
    esac
done

echo "==> Running Ubuntu build locally with act..."
echo "    Image: ${UBUNTU_IMAGE}"
echo "    Workflow: .github/workflows/build.yml"
echo ""

cd "${PROJECT_ROOT}"

${SUDO} act workflow_dispatch \
    --job build \
    --matrix os:ubuntu-22.04 \
    --platform "ubuntu-22.04=${UBUNTU_IMAGE}" \
    -W .github/workflows/build.yml \
    --artifact-server-path /tmp/act-artifacts \
    ${DRYRUN} \
    "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"
