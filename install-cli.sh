#!/usr/bin/env bash
# Build and install nous-cli to ~/.local/bin
#
# Usage:
#   ./install-cli.sh          # Release build + install
#   ./install-cli.sh --debug  # Install current debug build (skip compile)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="${HOME}/.local/bin"
BINARY_NAME="nous"

# Parse args
DEBUG_ONLY=false
if [[ "${1}" == "--debug" ]]; then
    DEBUG_ONLY=true
fi

# Ensure install directory exists
mkdir -p "${INSTALL_DIR}"

if [[ "${DEBUG_ONLY}" == "true" ]]; then
    BINARY="${SCRIPT_DIR}/src-tauri/target/debug/nous-cli"
    if [[ ! -f "${BINARY}" ]]; then
        echo "Error: Debug binary not found at ${BINARY}"
        echo "Build it first: just daemon (or cargo build --bin nous-cli)"
        exit 1
    fi
    echo "Installing debug build..."
else
    # Setup Python/PyO3 environment (needed for build)
    export PKG_CONFIG_PATH="/usr/lib/x86_64-linux-gnu/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
    source "${SCRIPT_DIR}/setup-python-env.sh"

    echo ""
    echo "Building nous-cli (release)..."
    cargo build --manifest-path "${SCRIPT_DIR}/src-tauri/Cargo.toml" --bin nous-cli --release

    BINARY="${SCRIPT_DIR}/src-tauri/target/release/nous-cli"
fi

# Copy binary (don't symlink — release builds may be cleaned)
cp "${BINARY}" "${INSTALL_DIR}/${BINARY_NAME}"
chmod +x "${INSTALL_DIR}/${BINARY_NAME}"

echo ""
echo "Installed: ${INSTALL_DIR}/${BINARY_NAME}"
echo ""
echo "Verify with: nous --help"
echo "Start daemon: nous daemon start"
echo "Install as service: nous daemon install"
