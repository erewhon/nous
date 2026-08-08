#!/usr/bin/env bash
# Provision a hosted-Nous VM on the hekaton Incus cluster.
#
# Creates the VM (Debian trixie, OVN fabric, dmz-egress ACL), the nous
# system user, the uv-managed Python runtime, and the nous-py checkout +
# venv, then installs a bootstrap systemd unit and pushes a
# freshly-built daemon binary. Companion runbook: docs/hosting.md.
#
# Run from the repo root on a cluster member (needs `incus` and a repo
# checkout with a release binary built, or pass --skip-binary).
#
# Usage:
#   deploy/provision-vm.sh [name] [ipv4]        # defaults: nous-staging 10.115.0.61
#   deploy/provision-vm.sh nous-prod 10.115.0.62

set -euo pipefail

VM_NAME="${1:-nous-staging}"
VM_IP="${2:-10.115.0.61}"
TARGET="${INCUS_TARGET:-hekaton}"
NETWORK="${INCUS_NETWORK:-ovn0}"
IMAGE="${INCUS_IMAGE:-images:debian/trixie}"
CPU="${VM_CPU:-4}"
MEM="${VM_MEM:-8GiB}"
DISK="${VM_DISK:-60GiB}"
PYTHON_VERSION="3.13"   # keep in lockstep with setup-python-env.sh

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINARY="${REPO_ROOT}/src-tauri/target/release/nous-cli"

say() { printf '\n== %s\n' "$*"; }

# ---- 1. VM ----------------------------------------------------------
if ! incus info "${VM_NAME}" >/dev/null 2>&1; then
    say "Creating ${VM_NAME} on ${TARGET} (${NETWORK} ${VM_IP})"
    incus init "${IMAGE}" "${VM_NAME}" --vm --target "${TARGET}" \
        -c "limits.cpu=${CPU}" -c "limits.memory=${MEM}" \
        -d "root,size=${DISK}" -n "${NETWORK}"
    incus config device set "${VM_NAME}" eth0 \
        ipv4.address="${VM_IP}" \
        security.acls=dmz-egress \
        security.acls.default.egress.action=allow \
        security.acls.default.ingress.action=allow
else
    say "${VM_NAME} already exists — reusing"
fi

if [ "$(incus list "${VM_NAME}" -c s -f csv)" != "RUNNING" ]; then
    incus start "${VM_NAME}"
fi
say "Waiting for the guest agent"
incus exec "${VM_NAME}" -- sh -c 'until systemctl is-system-running >/dev/null 2>&1; do sleep 2; done; true'

# ---- 2. Guest base --------------------------------------------------
say "Base packages, time sync, nous user"
incus exec "${VM_NAME}" -- sh -c '
    set -e
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    # libgit2: the daemon links the system library (git-backed features).
    apt-get install -y -qq systemd-timesyncd curl ca-certificates git libgit2-1.9 >/dev/null
    systemctl enable --now systemd-timesyncd
    id nous >/dev/null 2>&1 || useradd --system --home-dir /var/lib/nous \
        --create-home --shell /usr/sbin/nologin nous
    chmod 750 /var/lib/nous
    # The daemon writes its PID file into the data dir before creating
    # it — pre-create or the unit crash-loops on first boot.
    install -d -o nous -g nous -m 750 /var/lib/nous/nous
    mkdir -p /opt/nous/bin && chown -R nous:nous /opt/nous
'

# Sanity: OVN MTU picked up + egress works + lateral movement blocked.
say "Network sanity (MTU / egress / dmz-egress)"
incus exec "${VM_NAME}" -- sh -c '
    ip link show enp5s0 | grep -q "mtu 1442" || { echo "WARNING: MTU is not 1442 — check UseMTU=true (OVN-DESIGN.md trap #1)"; exit 1; }
    ping -c2 -W3 1.1.1.1 >/dev/null || { echo "WARNING: no internet egress"; exit 1; }
    if ping -c1 -W2 192.168.42.20 >/dev/null 2>&1; then echo "WARNING: internal LAN reachable — dmz-egress ACL missing?"; exit 1; fi
    echo OK
'

# ---- 3. Python runtime ----------------------------------------------
say "uv + Python ${PYTHON_VERSION} (as nous)"
incus exec "${VM_NAME}" -- sh -c '
    command -v uv >/dev/null 2>&1 || curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
'
incus exec "${VM_NAME}" --cwd /var/lib/nous --env HOME=/var/lib/nous -- \
    runuser -u nous -- /usr/local/bin/uv python install "${PYTHON_VERSION}"

say "nous-py checkout + venv"
TARBALL="$(mktemp --suffix=.tar.gz)"
tar czf "${TARBALL}" -C "${REPO_ROOT}" \
    --exclude='.venv' --exclude='__pycache__' --exclude='*.pyc' \
    --exclude='.pytest_cache' nous-py
incus file push --quiet "${TARBALL}" "${VM_NAME}/opt/nous/nous-py.tar.gz"
rm -f "${TARBALL}"
incus exec "${VM_NAME}" -- sh -c '
    set -e
    cd /opt/nous
    rm -rf nous-py.prev
    [ -d nous-py ] && mv nous-py nous-py.prev
    tar xzf nous-py.tar.gz && rm nous-py.tar.gz
    # Carry the venv across refreshes so uv sync is incremental.
    [ -d nous-py.prev/.venv ] && mv nous-py.prev/.venv nous-py/.venv || true
    rm -rf nous-py.prev
    chown -R nous:nous nous-py
'
incus exec "${VM_NAME}" --cwd /opt/nous/nous-py --env HOME=/var/lib/nous -- \
    runuser -u nous -- /usr/local/bin/uv sync

# Prefer uv's minor-version symlink dir (survives 3.13.x patch
# upgrades); fall back to the interpreter's resolved LIBDIR.
LIBDIR="/var/lib/nous/.local/share/uv/python/cpython-${PYTHON_VERSION}-linux-x86_64-gnu/lib"
if ! incus exec "${VM_NAME}" -- test -e "${LIBDIR}/libpython${PYTHON_VERSION}.so.1.0"; then
    LIBDIR="$(incus exec "${VM_NAME}" --env HOME=/var/lib/nous -- runuser -u nous -- \
        sh -c '"$(/usr/local/bin/uv python find '"${PYTHON_VERSION}"')" -c "import sysconfig; print(sysconfig.get_config_var(\"LIBDIR\"))"')"
fi
say "Guest libpython LIBDIR: ${LIBDIR}"

# ---- 4. Bootstrap unit ----------------------------------------------
# Minimal on purpose: the hardened units (ProtectSystem=strict, syscall
# filter, …) land with the deploy-recipe leaf and replace this file.
say "Bootstrap systemd unit"
incus exec "${VM_NAME}" -- sh -c "cat > /etc/systemd/system/nous-daemon.service" <<EOF
[Unit]
Description=Nous daemon (bootstrap unit - superseded by deploy/ hardened units)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=nous
Group=nous
ExecStart=/opt/nous/bin/nous-cli daemon start
Restart=on-failure
RestartSec=5
Environment=RUST_LOG=info
Environment=XDG_DATA_HOME=/var/lib/nous
Environment=NOUS_PY_PATH=/opt/nous/nous-py
Environment=LD_LIBRARY_PATH=${LIBDIR}

[Install]
WantedBy=multi-user.target
EOF
incus exec "${VM_NAME}" -- systemctl daemon-reload

# ---- 5. Binary + smoke ----------------------------------------------
if [ "${3:-}" = "--skip-binary" ] || [ ! -x "${BINARY}" ]; then
    say "No binary pushed (missing or --skip-binary) — build with:
    source setup-python-env.sh && cargo build --release --bin nous-cli --manifest-path src-tauri/Cargo.toml
then rerun, or push manually per docs/hosting.md."
    exit 0
fi

say "Pushing daemon binary"
incus file push --quiet "${BINARY}" "${VM_NAME}/opt/nous/bin/nous-cli.new"
incus exec "${VM_NAME}" -- sh -c '
    set -e
    chown nous:nous /opt/nous/bin/nous-cli.new && chmod 755 /opt/nous/bin/nous-cli.new
    mv /opt/nous/bin/nous-cli.new /opt/nous/bin/nous-cli
    systemctl enable --now nous-daemon
    sleep 3
    systemctl is-active nous-daemon
'

say "Smoke"
incus exec "${VM_NAME}" -- sh -c '
    journalctl -u nous-daemon -b --no-pager | grep "Python AI bridge path" || { echo "FAIL: bridge line missing"; exit 1; }
    curl -sf http://127.0.0.1:7667/healthz && echo
'
say "Done: ${VM_NAME} at ${VM_IP}"
