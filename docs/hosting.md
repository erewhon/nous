# Hosting the Nous daemon

The hosted Nous service is the daemon (`nous-cli daemon start`, an axum
HTTP server over the per-tenant file/Tantivy/CRDT stack) running in a
dedicated Incus VM, exposed through a Cloudflare Tunnel so no inbound
ports are opened. Multi-user mode (tenant registry + OIDC sign-in) is
enabled by environment; see [Runtime environment](#runtime-environment).

This doc is the provisioning runbook. It was written standing up the
staging VM (`nous-staging`, 2026-08-07) and is meant to be replayed for
the prod VM. `deploy/provision-vm.sh` automates the VM-side steps.

## Topology

```
browser ──► Cloudflare edge (app.nous.page, proxied CNAME)
                │
                ▼
        cloudflared tunnel                    (nous-tunnel.service)
                │  /etc/cloudflared/config.yml
                ▼
        nous-cli daemon on 127.0.0.1:7667     (nous-daemon.service)
                │
                ▼
        /var/lib/nous/nous   (data dir: notebooks, tenants/, web-app/)
```

## VM shape (hekaton Incus cluster)

One cluster spans delphi/euclid/hekaton; VMs for hosted services live on
**hekaton** (decision in `multi-user-daemon-plan.md`). Networking is the
**OVN fabric** (`ovn0`, `10.115.0.0/24`, MTU 1442) — greenfield services
attach to it from day 1; `incusbr0` is legacy. Pattern copied from the
`astra` VM:

```sh
incus init images:debian/trixie nous-staging --vm --target hekaton \
    -c limits.cpu=4 -c limits.memory=8GiB -d root,size=60GiB -n ovn0
incus config device set nous-staging eth0 \
    ipv4.address=10.115.0.61 \
    security.acls=dmz-egress \
    security.acls.default.egress.action=allow \
    security.acls.default.ingress.action=allow
incus start nous-staging
```

Notes, all load-bearing:

- **`dmz-egress` ACL** is the cluster's internet-facing-VM policy: default
  allow, explicit drops to every internal subnet — a compromised VM can
  reach the internet but not the LAN. Verify after boot: pinging
  `1.1.1.1` works, pinging `192.168.42.20` does not.
- **MTU**: `ovn0` runs 1442 (Geneve overhead on the interim 1500
  underlay). The Debian `images:` VMs ship a networkd config with
  `UseMTU=true` under `[DHCPv4]`, so the guest picks 1442 up via DHCP —
  **verify** (`ip link show enp5s0`); a guest stuck at 1500 shows up as
  hangs on large responses, not a clean failure. This is trap #1 in
  homeops `infra-map/OVN-DESIGN.md`.
- **Static IP** via `ipv4.address` on the NIC device (allocations:
  `incus network list-allocations | grep 10.115`). Staging is `.61`.
- **Clock**: JWT verification (OIDC) needs a sane clock. The minimal
  Debian image does not ship `systemd-timesyncd` — install and enable
  it, then check `timedatectl show -p NTPSynchronized`.
- **Guest packages**: `libgit2-1.9` is a hard runtime dependency of the
  binary (`ldd` shows it unresolved otherwise); `systemd-timesyncd`,
  `curl`, `ca-certificates`, `git` round out the base set.
- **Data dir must pre-exist**: the daemon writes
  `{data_dir}/.nous-daemon.pid` before creating the data dir, so
  `install -d -o nous -g nous -m 750 /var/lib/nous/nous` first or the
  unit crash-loops with "Failed to write PID file".

## VM-side layout

| Path | Owner | Purpose |
|---|---|---|
| `/opt/nous/bin/nous-cli` | nous | daemon binary (pushed from a build host) |
| `/opt/nous/nous-py` | nous | `nous-py` checkout + `.venv` (Python AI bridge) |
| `/var/lib/nous` | nous (home) | service root; uv-managed Python under `.local/share/uv` |
| `/var/lib/nous/nous` | nous | **daemon data dir** (`XDG_DATA_HOME=/var/lib/nous`): notebooks, `tenants/{id}` trees, `web-app/`, `daemon-config.toml`, `tenants.json` |

The `nous` user is a dedicated non-login system user
(`useradd --system --home-dir /var/lib/nous --shell /usr/sbin/nologin`).
Code lives under `/opt/nous` (redeployable, not precious); state lives
under `/var/lib/nous` (precious, backed up).

## Python runtime (the part Astra didn't need)

The daemon links **libpython via PyO3** — unlike Astra's nearly-static
binary, copying `nous-cli` alone is not enough. The VM needs:

1. **uv** (system-wide: `curl -LsSf https://astral.sh/uv/install.sh |
   env UV_INSTALL_DIR=/usr/local/bin sh`).
2. **Python 3.13** installed *as the `nous` user*
   (`uv python install 3.13`) — lands under
   `/var/lib/nous/.local/share/uv/python/cpython-3.13-linux-x86_64-gnu/`.
   The minor version must match the build host's (PyO3 links
   `libpython3.13.so`); keep both sides pinned to the
   `PYTHON_VERSION` in `setup-python-env.sh`.
3. **`nous-py` checkout + synced venv** at `/opt/nous/nous-py`: push the
   checkout (exclude `.venv`, `__pycache__`, `.git`), then
   `uv sync` in it as the `nous` user. A bare `uv sync` (no
   `--extra mcp-server`) is correct here — the VM runs no MCP server,
   only the daemon bridge.

### Runtime environment

The unit needs exactly these (values discovered the same way
`setup-python-env.sh` / `build-daemon.sh` do —
`LIBDIR = python3.13 -c "import sysconfig; print(sysconfig.get_config_var('LIBDIR'))"`):

| Variable | Staging value | Why |
|---|---|---|
| `LD_LIBRARY_PATH` | `/var/lib/nous/.local/share/uv/python/cpython-3.13-linux-x86_64-gnu/lib` | dynamic linker finds `libpython3.13.so` |
| `NOUS_PY_PATH` | `/opt/nous/nous-py` | explicit bridge path for daemons outside the repo (`find_nous_py_path` in `bin/cli/daemon.rs`); the bridge adds `{NOUS_PY_PATH}/.venv/…/site-packages` itself, so `PYTHONPATH` is not needed |
| `XDG_DATA_HOME` | `/var/lib/nous` | data dir resolves to `/var/lib/nous/nous` |
| `RUST_LOG` | `info` | the smoke check reads the startup log |

Multi-user mode is switched on by environment (see
`multi-user-daemon-plan.md`): `NOUS_MULTI_USER=1`, or implicitly by
setting `NOUS_OIDC_ISSUER` + `NOUS_OIDC_CLIENT_ID` (public PKCE client).
Request/rate limits and hosted-tenant policy live in
`{data_dir}/daemon-config.toml` (`[limits]`, `[hosted]`).

## Deploying

```sh
just deploy-staging   # build daemon + web bundle → push → swap → restart → healthz
just daemon-status    # unit status inside the VM
just daemon-logs      # follow daemon + tunnel journals
```

`deploy-staging` builds the release daemon (glibc-compatible host —
both sides Debian trixie today) and the browser bundle, pushes the
binary via push-to-temp + rename (overwriting a running binary fails
with "text file busy"; it stays root-owned so the daemon can't
overwrite itself), swaps the web bundle into
`/var/lib/nous/nous/web-app`, installs the **hardened units** from
`deploy/` (`nous-daemon.service`, `nous-tunnel.service` — full Astra
hardening block: ProtectSystem=strict, NoNewPrivileges, syscall
filter, empty capability set), restarts, and curls `/healthz`
(VM-local until `NOUS_STAGING_URL` is set once the tunnel exists).
The tunnel unit is skipped until cloudflared is installed by the
tunnel/DNS step. Overrides via env / gitignored `.env`:
`NOUS_STAGING_VM`, `NOUS_DEPLOY_DIR` (environment-specific units
outside the repo, Astra's `$ASTRA_DEPLOY_DIR` pattern),
`NOUS_STAGING_URL`.

## Backups

Hekaton production VMs are backed up **automatically**: the nightly
`backup-data-hekaton.sh` job (homeops repo, systemd system timer on
hekaton) auto-discovers every VM zvol under
`data/incus/virtual-machines/` and streams an atomic ZFS snapshot into
restic on the mouseion NAS. `nous-staging` was verified present in that
set — nothing to configure per-VM, and `/var/lib/nous` rides along as
part of the block image. Restore is documented in the backup script
header (restic dump → `zfs recv` → re-register with Incus).

## Front door (Zitadel + cloudflared + DNS)

Live since 2026-08-07: **`https://staging.nous.page`** → cloudflared
tunnel `nous-staging` (`f89bcdad-…`) → `127.0.0.1:7667` in the VM. No
inbound ports. Set up in this order — **the daemon must be in
multi-user (default-deny) mode before the tunnel exists**, because
legacy localhost mode has auth disabled:

1. **Zitadel app** (public PKCE SPA — no client secret): provisioned in
   the `homelab` project via the management API
   (HOMELAB-ACCESS-FOR-AGENTS.md §3, `ho secret get zitadel/mgmt-pat`),
   with `appType: OIDC_APP_TYPE_USER_AGENT`,
   `authMethodType: OIDC_AUTH_METHOD_TYPE_NONE`, redirect URIs for both
   `https://staging.nous.page/auth/callback` and
   `https://app.nous.page/auth/callback` (prod cutover needs no Zitadel
   change). Client id: `ho secret get nous/oidc-client-id`.
2. **OIDC env on the VM** via a systemd drop-in
   (`/etc/systemd/system/nous-daemon.service.d/oidc.conf`,
   `NOUS_OIDC_ISSUER=https://auth.bcc.sh` + `NOUS_OIDC_CLIENT_ID`) —
   a drop-in so `just deploy-staging` unit pushes don't clobber it.
   Restart, then verify anonymous `/api/notebooks` → 401 VM-locally.
3. **Tunnel**: `cloudflared tunnel create nous-staging` on a machine
   with an origin cert; credentials JSON → `/etc/cloudflared/` on the
   VM (0600, owner `cloudflared`; also in
   `ho secret get nous/tunnel-credentials`). Config: `protocol: http2`,
   NOT QUIC — OVN NAT conntrack times out idle UDP and QUIC flaps
   (learned on astra). Ingress: `staging.nous.page` →
   `http://127.0.0.1:7667`, then `http_status:404`.
4. **DNS**: proxied CNAME `staging.nous.page` →
   `<tunnel-id>.cfargotunnel.com` in the `nous.page` zone, created via
   the Cloudflare API (`ho secret get cloudflare/provisioning-token`).
   ⚠️ `cloudflared tunnel route dns` uses the zone baked into
   `cert.pem` — with a cert for another zone it silently creates
   `<fqdn>.<cert-zone>` in the wrong zone. Use the API directly.
   Hostname note: `staging.app.nous.page` would be two levels under the
   apex — outside Universal SSL — hence `staging.<apex>`, mirroring
   Astra's `staging.astra.gallery`; `app.nous.page` stays reserved for
   prod.

Public-edge verification: `/healthz` 200, anonymous `/api/notebooks`
and `/share/*` 401, `/app` 200, `/api/session/config` returns issuer +
client id.

## Smoke check

Done-condition for a provisioned VM:

```sh
incus exec nous-staging -- journalctl -u nous-daemon -b --no-pager | grep "Python AI bridge path"
incus exec nous-staging -- curl -s http://127.0.0.1:7667/healthz
```

The bridge line proves libpython loaded and `nous_ai` is importable; the
`/healthz` body (`{"status":"ok","version":…}`) proves the router is up.

## Public surface

In multi-user mode the anonymous surface is exactly (enforced by
`is_public_route_multi_user`, contract-tested):

| Route | Notes |
|---|---|
| `/app`, `/app/*`, `/auth/callback` | SPA bundle + OIDC redirect shell |
| `/healthz` | version + status, no data |
| `/api/status` | status/pid/uptime, no data |
| `GET /api/session/config`, `POST /api/session` | session bootstrap |

Everything else — including the desktop-share surfaces (`/share`,
`/gallery`, `/finance`, `/api/image-cache`) — requires auth. `POST
/api/session` is rate-limited per client IP (`[limits]
session_rate_per_min`, default 10/min).
