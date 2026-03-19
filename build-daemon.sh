#!/usr/bin/env bash
# Build the Nous daemon (release) and install to ~/.local/bin.
# Uses the same Python environment as run-dev.sh.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Setup Python + pkg-config environment
export PKG_CONFIG_PATH="/usr/lib/x86_64-linux-gnu/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
source "${SCRIPT_DIR}/setup-python-env.sh"

echo ""
echo "Building nous-cli (release)..."
cargo build --release --bin nous-cli --manifest-path "${SCRIPT_DIR}/src-tauri/Cargo.toml"

# Install
mkdir -p ~/.local/bin
DAEMON_RUNNING=false
if systemctl --user is-active --quiet nous-daemon 2>/dev/null; then
    DAEMON_RUNNING=true
    echo "Stopping daemon..."
    systemctl --user stop nous-daemon
    sleep 1
fi

cp "${SCRIPT_DIR}/src-tauri/target/release/nous-cli" ~/.local/bin/nous-cli
echo "Installed to ~/.local/bin/nous-cli"

# Update systemd service with correct Python paths
LIBDIR="$("${PYO3_PYTHON}" -c "import sysconfig; print(sysconfig.get_config_var('LIBDIR'))")"
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/nous-daemon.service << EOF
[Unit]
Description=Nous Daemon - Headless notebook service
After=network.target

[Service]
Type=simple
ExecStart=%h/.local/bin/nous-cli daemon start
Restart=on-failure
RestartSec=5
Environment=RUST_LOG=info
Environment=LD_LIBRARY_PATH=${LIBDIR}
Environment=PYTHONPATH=${SCRIPT_DIR}/nous-py

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload

if [ "$DAEMON_RUNNING" = true ]; then
    echo "Restarting daemon..."
    systemctl --user start nous-daemon
    sleep 2
    systemctl --user status nous-daemon --no-pager | head -8
fi

echo ""
echo "Done! Daemon binary: ~/.local/bin/nous-cli"
