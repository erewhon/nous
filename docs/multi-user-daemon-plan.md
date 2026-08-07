# Multi-User Daemon Plan

Status: decisions resolved, ready to decompose into Forge — 2026-08-06
Goal: replace the console-pasted API key with real sign-in, make the daemon
multi-user, and run it on an internet-facing Incus VM, invite-only.

The blueprint is Astra, which made exactly this transition (single-user
Tauri app → hosted multi-tenant daemon). Most of the auth layer ports
directly; the genuinely new work is tenancy, because Nous's storage model
differs from Astra's in a way that matters (files-per-library vs. rows in
one SQLite).

## Where we start (advantages)

- **The desktop app is already a daemon client.** The Daemon API migration
  (16/16 tasks Done) means all reads/writes go through the daemon HTTP API +
  `/api/events` WS. There is no second data path to secure — web, desktop,
  MCP, SDK, and Emacs all hit the same axum router.
- **The web bundle is already served by the daemon** at `/app`
  (`src/platform/` parity layer, `just web-deploy`).
- **Current auth** (`src-tauri/src/bin/cli/auth.rs`): static keys
  `rw:<random>` / `ro:<random>` in `{data_dir}/daemon-api-key`, validated by
  `auth_middleware` in `api.rs`; browser stores one in
  `localStorage["nous-daemon-api-key"]` (`src/utils/daemonConfig.ts`). This
  is the tactical hack we are retiring for the hosted case (it stays for
  local dev).

## What we inherit from Astra (port, don't invent)

| Concern | Astra source | Notes |
|---|---|---|
| OIDC JWT verification (Zitadel) | `astra/src-tauri/src/daemon/oidc.rs` | JWKS discovery keyed by `kid`, rate-limited refresh, RS256, `iss`+`aud` validation. ~600 lines incl. tests with a fixture keypair. |
| Invite-gated JIT provisioning | same, `resolve_user` | State machine: known subject → auth; invited row matching token email w/ no subject → link + activate; anything else → 403 "invite required". Explicitly does NOT auto-link active rows by email (account-takeover guard). |
| Personal access tokens | `astra/src-tauri/src/daemon/auth.rs` | `astra_`-prefixed, SHA-256 hash stored, revocable, `last_used_at`. Ours: `nous_` prefix, and keep Nous's rw/ro scope on the token. |
| Default-deny middleware | same, `require_auth` | Inserts `AuthedUser {user_id, role}` extension; the `AuthedUser` extractor 500s on routes outside the authed scope (misconfig fails loudly). |
| Browser session | `astra/src-tauri/src/daemon/session.rs` | Stateless HMAC-signed HttpOnly cookie (`<user_b64>.<exp>.<hmac>`), key generated once at `{data_dir}/session-key` (0600), 7-day TTL. `POST /api/session` takes a Zitadel **ID token** (access tokens lack the email claim). User status re-checked per request, so disabling a user kills live sessions. Cookies also fix `<img>`/WS auth. |
| SPA login flow | `astra/src/lib/auth-web.ts` | Auth-code + PKCE; SPA never stores tokens — ID token exists only for the one POST to `/api/session`. Issuer/client-id fetched from `/api/session/config`. Redirect URI `{origin}/auth/callback` handled before the router mounts. |
| Roles/status enums | `astra/src-tauri/src/db/tenancy.rs` | owner/member; invited/active/disabled. |
| VM deploy | `astra/justfile deploy-staging`, `astra/deploy/*.service`, `astra/docs/hosting.md` | Incus file push + rename-swap binary, hardened units (ProtectSystem=strict, NoNewPrivileges, syscall filter), dedicated non-login user, cloudflared tunnel, healthz smoke check. |

## The Nous-specific part: tenancy

Astra's tenancy was cheap because everything is rows in one SQLite +
HoardFS volumes — add `user_id` columns and filter. Nous is a **stack of
per-library singletons** (`DaemonState` in `bin/cli/daemon.rs`):
FileStorage, Tantivy index, CRDT store, inbox/goals/energy/contacts
storages, action scheduler, backup scheduler, sync manager, plugin host.

**Decision: tenant = data-dir.** Each user gets their own directory that
looks exactly like today's `{data_dir}` (library + energy + contacts +
their own search index, CRDT state, op logs):

```
{data_dir}/
  tenants.json            # users + PAT hashes (atomic writes, storage/atomic.rs)
  session-key
  tenants/
    {user_id}/            # per-tenant "data_dir"
      libraries/…         # their library (FileStorage, CRDT, plugins/, search_index)
      energy/ contacts/ …
```

- New `TenantManager`: `Map<user_id, Arc<TenantState>>`, where
  `TenantState` is today's `DaemonState` minus process-globals. Built
  lazily on a tenant's first authenticated request; evictable later
  (not needed at invite-only scale).
- Handlers change mechanically: instead of pulling storages off the global
  `AppState`, they resolve `AuthedUser → Arc<TenantState>` via an
  extractor. This is the wide-but-shallow sweep across `api.rs`
  (~6.6k lines, ~120 routes) — the single biggest chunk of work.
- `/api/events` WS becomes per-tenant (event channel lives on
  `TenantState`), so users only see their own events.
- Process-globals stay shared: `PythonAI` (one interpreter/GIL per
  process — calls already serialize today), RAG config, daemon config.
- **Local mode is unchanged.** Loopback + no OIDC config → single implicit
  tenant mapped to the existing data dir, auth optional exactly as today.
  Same binary; multi-tenant activates when `NOUS_OIDC_ISSUER` +
  `NOUS_OIDC_CLIENT_ID` are set. Existing desktop installs never notice.

**Users registry: flat file, not SQLite.** Astra used Diesel because it was
already there; the Nous daemon has no SQL dependency and invite-only N is
tiny. `tenants.json` via the crash-atomic `storage/atomic.rs` primitive
keeps the idiom (revisit only if we ever open registration).

**Rejected alternative — process-per-user.** Run today's daemon N times
behind an auth proxy (systemd template units, one port each). Pros: almost
no daemon refactor, hard isolation. Cons: the auth/OIDC/session code must
be written anyway (it just moves into the proxy), each process carries a
full Python interpreter + Tantivy + schedulers (hundreds of MB × N),
provisioning means unit orchestration, and it forks the architecture away
from Astra's. In-process tenancy is the better end-state; process-per-user
remains the escape hatch if the api.rs sweep stalls.

## Per-tenant policy (v1, hosted)

| Subsystem | Hosted v1 | Why |
|---|---|---|
| AI (`/api/ai/*`, PyO3 bridge) | **On**, operator-keyed (global `daemon-config.toml`), per-tenant later | The GIL serializes calls anyway; per-tenant API keys are a follow-up. |
| RAG | Off initially | Vector collections need per-tenant namespacing first. |
| Plugins (Lua) | **Off for hosted tenants** | One VM per plugin per tenant is a memory/attack-surface cost; revisit. |
| WebDAV sync | Off (hosted daemon IS the source of truth) | Avoids DL-class sync hazards on day one. |
| Action scheduler | On per tenant, started with `TenantState` | Daily notes etc. are core value. |
| Backups | Per-tenant, plus whole-VM restic off-VM | Two layers. |
| Collab (PartyKit), publish (pub.nous.page), cloud API | Out of scope v1 | Separate infra; tokens/HMAC flows unchanged. |

## Security hardening (internet checklist)

- **Public-route audit.** `is_public_route` currently exempts `/share/*`,
  `/gallery/*`, `/finance/*`, `/api/image-cache/*`, `/app`. On the hosted
  daemon: `/app` + `/healthz` + `/api/session*` stay public; the share and
  gallery surfaces must be re-audited for tenant scoping before exposure
  (v1: disable on hosted, they're desktop-share features).
- WS auth: session cookie covers same-origin WS; `?token=` query param
  stays for PAT clients (MCP over the mesh).
- Request body limits (axum `DefaultBodyLimit`), asset upload caps, and a
  simple per-IP rate limit on `/api/session` (tower-governor or hand-rolled).
- Per-tenant disk quota: soft check on asset upload + page write (v1: log
  + refuse over N GB).
- systemd hardening block ported from `astra/deploy/astra-daemon.service`;
  dedicated `nous` system user; `systemd-timesyncd` on (JWT clock skew).
- Secrets via homelab plumbing: Zitadel mgmt PAT via
  `ho secret get zitadel/mgmt-pat` to provision the OIDC app; the PKCE
  client is public (no client secret); session key generated on the VM.

## Deployment topology (proposed)

```
browser ──► Cloudflare edge (app.nous.page, proxied)
                 │
             cloudflared tunnel        (nous-tunnel.service)
                 │
         nous daemon on 127.0.0.1:7667 (nous-daemon.service, hardened)
                 │
         /var/lib/nous/{tenants.json, tenants/, web/}
```

- Incus VMs on the **hekaton cluster** (staging + prod as cluster
  instances; OVN networking, deploy recipe targets the cluster remote
  rather than Astra's local `incus exec`).
- The daemon links libpython (PyO3) — unlike Astra's nearly-static binary,
  the VM needs a uv-managed Python + `nous-py` checkout + venv;
  `build-daemon.sh` already computes the LD_LIBRARY_PATH/PYTHONPATH env,
  reuse it for the unit file.
- Zitadel: provision one native-OIDC app in the `homelab` project via the
  management API (per HOMELAB-ACCESS-FOR-AGENTS.md §3), redirect URI
  `https://app.nous.page/auth/callback`.
- Alternative front door (if we decide "internet" can wait): hub Caddy +
  NetBird, same daemon config — only the tunnel piece changes.

## Phases

Ordered to de-risk: OIDC login lands and is useful (replacing the
console-pasted key on the current homelab deployment) *before* the big
tenancy sweep.

**Phase 1 — Identity foundation (no behavior change until enabled)**
1. `tenants.json` registry: users (id, email, username, role, status,
   external_subject), atomic read/write, unit tests.
2. PATs: mint/revoke/authenticate (`nous_` prefix, SHA-256, rw/ro scope),
   `nous-cli daemon token mint|revoke|list`.
3. `nous-cli daemon user invite|list|disable` (CLI-only admin for v1).
4. `require_auth` middleware + `AuthedUser` extractor (Astra port), wired
   behind config so legacy key-file auth still works untouched.

**Phase 2 — OIDC sign-in (single-tenant: every login maps to owner)**
5. `OidcVerifier` port + `resolve_user` invite state machine + tests.
6. Session cookie module port; `POST /api/session`, `DELETE /api/session`,
   `GET /api/session/config`, `GET /api/me`.
7. Frontend: port `auth-web.ts` PKCE flow, sign-in screen, `/auth/callback`
   handling before router mount, `credentials: same-origin` on the daemon
   client, sign-out; keep localStorage key path for local dev only.
8. Deploy to the current homelab setup → the pasted-key hack dies here.

**Phase 3 — Tenancy**
9. `TenantState` extraction from `DaemonState`; `TenantManager` with lazy
   init; migration: existing data dir becomes the owner tenant.
10. The api.rs sweep: tenant-resolving extractor on every route; per-tenant
    `/api/events`; per-tenant scheduler lifecycle. (Largest task; split by
    route family: notebooks/pages, databases, search, goals/inbox/energy/
    contacts, ai, admin.)
11. Per-tenant policy switches (plugins off, sync off, RAG off for hosted).
12. Two-tenant integration test: full isolation (pages, search, events, WS).

**Phase 4 — Hosted hardening**
13. Public-route audit + hosted disables; body/upload limits; session rate
    limit; quota soft-check.
14. Multi-user load sanity: 2–3 tenants × search rebuild + AI call + WS.

**Phase 5 — VM + front door**
15. Incus VM provisioning script/doc (Python env, `nous` user, restic).
16. `deploy/` units (hardened) + `just deploy-staging` (Astra recipe shape).
17. Zitadel app provisioning; cloudflared tunnel; `app.nous.page` DNS.
18. Smoke: healthz, sign-in round-trip, invite → activate flow, PAT via MCP.

**Phase 6 — Launch**
19. Invite first users; monitor journals + healthz; document runbook
    (`docs/hosting.md`, Astra-style).

Sequencing note: Phases 1–2 are pure wins even if tenancy slips — better
auth for the current single-user homelab deployment. Phase 3 is the long
pole and can proceed at its own pace behind the OIDC-enabled flag.

## Decisions (resolved 2026-08-06)

1. **Tenancy**: in-process multi-tenant (TenantManager); process-per-user
   rejected (see above).
2. **Front door**: cloudflared tunnel + `app.nous.page`.
3. **Hosted AI**: on, operator-keyed; per-tenant keys and RAG later.
4. **VM placement**: hekaton Incus cluster (staging + prod instances).
