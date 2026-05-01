# Incident: WebDAV sync overwrote local edits with stale CRDT-derived content

**Date observed:** 2026-05-02
**Incident time:** 2026-05-01 14:28:03 UTC (09:28:03 CDT)
**Notebook:** Agile Results (`b67b98ae-d5d2-4947-b40d-6fc6410500b6`)
**Primary affected page:** Tech Purchases (`c1ec38bd-421d-4484-8765-11e4b3883376`)
**Severity:** High — silent data loss across 24 pages of an actively-edited notebook
**Status:** Resolved — data fully recovered. Code fixes queued in Forge; sync disabled on all notebooks pending the P1 merge-branch fix.

## Summary

The WebDAV sync's "merge" path serialized a stale CRDT document over the live page `.json` file, wiping 24 locally-edited pages back to a state from ~5 days earlier. The wipe was silent — sync logs report it as a normal "Merged" outcome.

Root cause: **two divergent sources of truth on disk.** Page content lives in `pages/{id}.json`. Yjs CRDT state lives in `sync/pages/{id}.crdt`. The desktop Tauri editor keeps both in step (via `crdt_store.apply_save`). The daemon's HTTP `update_page` — used by MCP/Emacs — only writes `.json` and **does not update the CRDT doc**. Over the past few days the user edited primarily through Emacs, so `.json` grew to 37 blocks while `.crdt` stayed at 9 blocks (last touched April 26). Then sync ran. The merge code at `src-tauri/src/sync/manager.rs:1864-1885` reads the CRDT doc as "local", merges in the remote update, serializes the result, and writes that serialized content back to `.json` — overwriting the live edits.

Contributing factors:

- **Sync hadn't run since 2026-04-19** (12-day gap; `last_sync` and `last_changelog_seq` confirm). The Tantivy index writer on the desktop has been panicking on commit (Tantivy 0.22.1 `fastfield/writer.rs:137` — index out of bounds), which appears to have been blocking sync attempts. When sync finally ran, it had a large divergence to resolve and trusted the wrong side.
- **Git auto-commits also stopped on 2026-04-26**, eliminating the secondary on-disk backstop. (Git auto-commit is wired into the Tauri `update_page` path, not the daemon path; same root cause as the CRDT divergence — Emacs writes bypass it.)

## Resolution

Full data recovery achieved on 2026-05-02:

- **Tech Purchases (`c1ec38bd-...`)** — fully recovered. The latest in-app snapshot (`pages/c1ec38bd-....snapshots/20260501_012426.json`, 32 blocks, ~13h before wipe) was applied via `scripts/recover-2026-05-01-wipe.sh --apply --page "tech purchases"`. The 5 blocks of edits made between the snapshot and the wipe were preserved in the user's nightly filesystem backup at 07:00 local time on 2026-05-01 (~2.5 hours before the wipe). Diffing the post-restore live `.json` against that backup confirmed byte equivalence (modulo subsequent edits made after recovery).
- **Other 22 "Merged" pages** — diff'd via `scripts/recover-2026-05-01-wipe.sh --diff --page <name>`. All verified as either unaffected by the wipe or showing only daily-note carry-forward churn (live had ≥ snapshot block counts and no missing user content). No further restores needed.
- **Sync disabled** on all 21 sync-enabled notebooks. Originals backed up to `~/.local/share/nous/sync-disabled-backup-20260502T162449Z/`. Re-enable per-notebook only after the P1 merge-branch fix lands and the audit task verifies other notebooks have no hidden wipes.

The nightly filesystem backup at 07:00 local time was the load-bearing recovery source for the last few hours of edits — the in-app snapshot cadence (~daily) wasn't tight enough on its own. This reinforces the case for the queued **"Surface snapshots and oplog as a Version History UI"** task, plus a snapshot-cadence increase. Both are P3 in Forge.

## Impact

- 24 of 272 pages in the Agile Results notebook reverted to their April 26 state (the ones with local edits since then; the other 248 already matched remote so they were untouched).
- `notebook.json`, `folders.json`, `sections.json` rewritten to April 26 versions.
- ~30 `.crdt` files in `sync/pages/` rewritten to April 26 versions.
- No data destroyed permanently — full state recoverable from `pages/{id}.snapshots/` and `pages/{id}.oplog`.

## Timeline

All times UTC unless noted.

| When | Event |
|---|---|
| 2026-04-19 21:31:25 | `local_state.last_sync` set. **Last successful sync before the incident.** |
| 2026-04-26 21:46:44 | Last successful Tauri save with `commit=true` for this page. Git commit `3e86d07 Update page: Tech Purchases` (9 blocks). |
| 2026-04-26 21:46:58 | Git commit `36b413d Auto-save changes` (notebook metadata + CRDT files). **Last git commit ever made to this notebook's `.git`.** Last write to `sync/pages/c1ec38bd-...crdt` and `.updates`. |
| 2026-04-26 → 2026-04-30 | User edits the page in Emacs over multiple days. Local `.json` grows from 9 blocks to 37 blocks. Snapshots accumulate at `pages/c1ec38bd-...snapshots/`. **No git auto-commits.** **No CRDT updates** (Emacs writes via daemon HTTP do not touch the CRDT store). **No syncs** (Tantivy panics blocking sync — see below). The local `.crdt` stays frozen at the April 26 state. |
| 2026-05-01 01:24:26 | Last snapshot before wipe: `20260501_012426.json` (32 blocks). |
| 2026-05-01 02:54:27 | Last "good" oplog entry: `op=modify, blockCount=37, contentHash=sha256:728d16125b967c0be...`. |
| 2026-05-01 14:28:00 | OnSave-sync triggered. Tantivy commit prepared. **Tantivy thread panics** on `fastfield/writer.rs:137` (`index out of bounds`). Sync continues anyway. |
| 2026-05-01 14:28:00 | Sync reads `local_state`: `last_sync=2026-04-19T21:31:25Z, last_changelog_seq=1778`. Reads remote: 244 pages in manifest, changelog at next_seq=1929. Detects 0 remote changes via changelog (correct — remote was untouched), but 24 pages have differing manifest ETags. Falls back to ETag detection: `"page X detected via manifest ETag (changelog missed it)"` for all 24. Decides to sync 85 pages total. |
| 2026-05-01 14:28:07 | Sync result for 24 pages: **`Merged`** (the rest are `Pushed`/`Pulled`/`Unchanged`). The "merge" code path at `manager.rs:1860-1893` reads CRDT-as-local, applies remote update, serializes the result, writes it to `.json` — collapsing 37 blocks to 9. |
| 2026-05-01 14:28:09 | Sync completes: `29 pushed, 24 pulled` (the 24 "Merged" pages are counted as "pulled" in the summary). `lastSync` updated. |
| 2026-05-02 (next morning) | User opens the page in Emacs (without saving), sees the wiped state. Switches to desktop app, sees the same. Reports the loss. |

## Evidence

### The wiped content matches git HEAD's content byte-for-byte

```
sha256 of git HEAD (commit 3e86d07) `.content`:  92fc56cff73fb3985482251efdf917beb7ca1a8f3a82f4e9f9671dd2a1862fcc
sha256 of live file `.content`:                  92fc56cff73fb3985482251efdf917beb7ca1a8f3a82f4e9f9671dd2a1862fcc
```

The structural diff between git HEAD and the live page is just two metadata fields:

```
+ "color": "#8b5cf6"               (added some time after April 26)
- "updatedAt": "2026-04-26T21:46:44.334475290Z"
+ "updatedAt": "2026-05-01T02:54:27.324038558Z"   (carried forward from the last good local save)
```

So the wipe wrote remote `.content` + a few local-side fields. Looks like a load-from-disk-then-rewrite pattern: read the local Page (which has live `color` and `updatedAt`), replace `.content` with the remote version, write the merged result back.

### The WebDAV sync timestamp lines up to the second

`notebook.json.syncConfig`:

```json
{
  "enabled": true,
  "serverUrl": "http://localhost:11000/remote.php/dav/files/erewhon/Nous/",
  "remotePath": "/nous-sync/default-library/b67b98ae-...",
  "syncMode": "onsave",
  "lastSync": "2026-05-01T14:28:09.894314577Z"
}
```

The `lastSync` is 6 seconds after the wipe timestamp on `pages/c1ec38bd-...json`. Strong correlation: the sync ran, wrote the files, then updated its own timestamp.

### The CRDT mutation path was bypassed

The `.updates` binary update log at `sync/pages/c1ec38bd-...updates` was **not** appended at 14:28 — it's still untouched since 2026-04-26 16:46. Every legitimate CRDT write (via `apply_save`) appends to this log. So the wipe wrote to `.json` and `.crdt` directly without going through CRDT mutation. This is consistent with a sync-pull doing a file replacement.

### Bulk pattern, not a single-page event

Files modified at 2026-05-01 14:28:03 ± 1 second:

- `notebook.json`
- `folders.json`
- `sections.json`
- 24 page `.json` files in `pages/`
- ~30 `.crdt` files in `sync/pages/`

This is a notebook-wide event, not an edit. Only files where local differed from remote got touched (the unaffected 248 pages already matched remote). That's exactly the WebDAV sync algorithm's expected file-level behavior.

### Daemon journal silent during the wipe

```
journalctl --user -u nous-daemon --since "2026-05-01 09:00" --until "2026-05-01 10:00"
```

Returned no entries. The daemon was running (it logged before and after this window), but didn't log the sync operation. Either:
- The sync was performed by the desktop Tauri app (separate process, separate logs)
- The daemon performed the sync but the sync code doesn't emit log lines
- The log level filtered out sync messages

## Root cause

The merge code at `src-tauri/src/sync/manager.rs:1860-1893` (the `Merged` branch in `sync_page_concurrent_inner`):

```rust
if remote_changed {
    let (remote_data, fetched_etag) = client.get_with_etag(&remote_path).await?;
    let remote_etag = fetched_etag.or(remote_etag);

    local_doc.apply_update(&remote_data)?;   // local_doc is the CRDT loaded from .crdt
    // ... push to live CRDT store ...

    if sync_info.needs_sync {
        // Merge case
        let merged_content = local_doc.to_editor_data()?;     // serialize CRDT to EditorData
        {
            let storage_guard = storage.lock().unwrap();
            let mut updated_page = page.clone();
            updated_page.content = merged_content;             // ← OVERWRITES live .json content
            storage_guard.update_page_metadata(&updated_page)?;
        }
        // ... write merged CRDT state to .crdt and remote ...
        return Ok((PageSyncResult::Merged, ...));
    }
    // ...
}
```

The function reads `local_doc` from `sync/pages/{id}.crdt`. It treats this as the canonical local state. **It does not read or compare against `pages/{id}.json`.** When the merge serializes `local_doc` and writes it to `.json`, any content in `.json` that wasn't reflected in `.crdt` is silently lost.

The `.json` and `.crdt` files diverge whenever a writer touches one but not the other. Two writers do this:

- **Tauri editor** (desktop app): touches both via `crdt_store.apply_save` then `storage.update_page`. Stays consistent.
- **Daemon HTTP `update_page`** (used by MCP, Emacs nous.el, anything not the Tauri editor): touches `.json` only — the daemon currently has no `crdt_store` integration. After every Emacs save, `.json` is fresh; `.crdt` is stale.

Over the past 5 days the user edited primarily through Emacs. By the time the sync ran:

- `.json`: 37 blocks (May 1 02:54 UTC, fresh)
- `.crdt`: 9 blocks (April 26 16:46 UTC, frozen since the last desktop save)
- WebDAV remote: 9 blocks (also frozen since April 26)

The sync's CRDT merge sees `local_doc` and `remote` agree on 9 blocks. There's nothing to merge. It serializes 9 blocks back to `.json`, treating that as authoritative — and the live edits in `.json` are erased.

### Contributing factor: 12-day sync gap

`local_state.last_sync = 2026-04-19T21:31:25Z` — the last sync before the incident was 12 days earlier. Without that gap the divergence between `.crdt` and `.json` would have been smaller (only one Emacs session's worth, not five days'). The Tantivy panic at `tantivy-0.22.1/src/fastfield/writer.rs:137:54` (`index out of bounds: the len is 5 but the index is 5`) appears to have been blocking earlier sync attempts on this notebook — the panic happens on commit, and sync waits on commits. The May 1 sync ran despite the panic (the panic killed only `thrd-tantivy-index3`; the rest of the process continued).

### Why it stayed silent

- **Sync logs the wipe as `Merged`** — a normal-looking outcome term, not a warning.
- **The oplog records the wipe as a single `modify` op** — same shape as any user edit. No "synced from remote" marker.
- **`mcp_watcher` re-emits `sync-pages-updated`** to the frontend after sync, which causes the editor to refresh from disk — silently loading the wiped state into the open editor.
- **No comparison against `.json` content** anywhere in the merge path; nothing notices "we just wrote dramatically less content than was there."

## Recovery

The data is fully recoverable.

### Snapshot ladder

`pages/c1ec38bd-...snapshots/`:

| File | Size | Time | Block count |
|---|---|---|---|
| `20260429_004035.json` | 2731 B | 2026-04-29 00:40 UTC | early state |
| `20260430_062745.json` | 3769 B | 2026-04-30 06:27 UTC | mid state |
| `20260501_012426.json` | 8680 B | 2026-05-01 01:24 UTC | **32 blocks** (most recent) |

Latest snapshot is from ~13 hours before the wipe and has 32 blocks — closest restore point on disk.

### Oplog replay

`pages/c1ec38bd-...oplog` is a JSONL log of every block-level change since the page was created. The last good entry before the wipe is:

```json
{"ts":"2026-05-01T02:54:27.324874136Z","clientId":"delphi","op":"modify",
 "contentHash":"sha256:728d16125b967c0be...","blockCount":37,"changes":74}
```

The 37-block state is reconstructable by replaying the oplog from the snapshot to that timestamp, or by hashing intermediate `contentHash` values to find a content-addressable lookup.

### Recommended recovery procedure

1. Disable sync on this notebook **before** any restore work, otherwise the next sync repeats the wipe.
2. Take a full filesystem backup of the notebook directory as-is, in case anything goes wrong during recovery.
3. Restore from the latest snapshot (32 blocks) into the live `.json`, then replay oplog entries from snapshot timestamp forward to the last good `02:54:27` entry to reconstruct the 37-block state.
4. Verify the restored content; bump `updatedAt` to a fresh timestamp.
5. Re-enable sync only after the underlying bug is fixed (or push local-to-remote first to make remote authoritative).

## Recommended next actions

In priority order:

1. **Stop the bleeding** — disable WebDAV sync on this notebook (and any other actively-Emacs-edited notebooks) until the merge code is fixed. Otherwise: edit in Emacs, sync runs, wipe again. The fix is one boolean flip in `notebook.json:syncConfig.enabled`.
2. **Recover the Tech Purchases page** from `pages/c1ec38bd-....snapshots/20260501_012426.json` (32 blocks, ~13h before wipe), then replay `pages/c1ec38bd-....oplog` entries from `2026-05-01T01:24:26Z` to the last good `2026-05-01T02:54:27Z` entry (37 blocks). Verify visually before swapping the live file. The other 23 affected pages have the same recovery path — script it.
3. **Fix the merge bug.** The `Merged` branch needs to either:
   - **Read `.json` and seed CRDT with any blocks that aren't already there** before merging with remote (so `local_doc` actually represents local state), OR
   - **Refuse to merge** when `.json` content has changes not reflected in `.crdt` (detect via content hash), bubbling a conflict to the user, OR
   - **Use `.json` as the source of truth** for the merged content and update CRDT to match (rather than the other direction).
   
   The first option is closest to the existing intent — `crdt_store.open_page` already does this kind of catch-up when a page is opened. The merge path should do the equivalent before serializing.
4. **Fix the daemon's `update_page`** to update the CRDT store on writes (the work captured in the "Daemon — move CRDT into daemon" task). Once daemon writes go through CRDT, the divergence stops happening in the first place. This incident is concrete justification for prioritizing that task.
5. **Investigate the Tantivy panic.** `index out of bounds: the len is 5 but the index is 5` on `fastfield/writer.rs:137` in 0.22.1 — likely a fastfield schema/segment corruption. Either:
   - Upgrade Tantivy (newer versions may have fixed it),
   - Reset and rebuild the search index from disk content (`POST /api/search/rebuild` once the daemon owns the writer),
   - Or capture a backtrace and file a bug. The panic is likely silent for users but blocks sync, so tracking it down has high payoff.
6. **Add destructive-sync detection.** If a sync's `Merged`/`Pulled` outcome would shrink `.content.blocks.length` by more than (say) 20% or N blocks, refuse and surface a conflict UI. The user gets a clear "remote and local diverged, here are both versions" prompt.
7. **Surface snapshots + oplog as a Version History panel** in the editor. Both data sources exist; rendering a timeline and supporting restore is mostly UI work. Doubles as a recovery tool for any future incidents.

## Open questions

- **What's actually on the WebDAV server?** Confirms the order of events: did `local_doc` and remote agree on 9 blocks, or was something more confused? Read `http://localhost:11000/remote.php/dav/files/erewhon/Nous/nous-sync/default-library/b67b98ae-.../sync/pages/c1ec38bd-....crdt` and check.
- **What's the Tantivy panic root cause?** `fastfield/writer.rs:137` index OOB suggests a schema/segment mismatch — maybe an old segment from before a schema change. Could a corrupted index file be reproduced? Is upgrading Tantivy enough?
- **Did this happen to other notebooks?** All notebooks with `syncConfig.enabled=true` are at risk if they've been edited primarily through Emacs/MCP. Check `lastSync` timestamps and `.crdt` mtimes vs `.json` mtimes for anomalies.
- **Sync was silent for 12 days — did anything succeed during that window?** If every sync attempt aborted on the Tantivy panic until something cleared, what changed at 14:28 to let the May 1 sync proceed? (May be relevant to whether disabling sync needs to also reset some state.)
- **Daemon vs desktop sync attribution** — the logs are clearly from the desktop Tauri app (mcp_watcher, tantivy). Does the daemon also run sync independently? If yes, both processes could race. If no, that's reassuring.

## Follow-up tasks

To be created in Forge:

- **Fix the WebDAV sync `Merged` branch in `manager.rs:1860-1893`.** Bug fix; **highest priority** (this is the bug that caused the incident). Sync_page must seed `local_doc` with any blocks present in `.json` but missing from `.crdt` before merging, OR refuse to merge when the two diverge.
- **Sync should be a no-op (or refuse) when local content is structurally newer than remote.** Add a destructive-sync guard: if a merge would shrink content blocks by >N% or >N blocks, surface a conflict UI rather than silently overwriting.
- **Recover the 24 wiped pages from snapshot + oplog.** Recovery; immediate.
- **Audit other notebooks for similar wipes.** Look for any notebook with `syncConfig.lastSync` timestamps that align with file-mtime clusters across many `.json` files. Prophylactic.
- **Investigate the Tantivy 0.22.1 panic** at `fastfield/writer.rs:137`. Bug fix; high priority. Try upgrading Tantivy and/or rebuilding the search index. Was blocking sync for 12 days; will block again if not addressed.
- **Surface snapshots + oplog as a Version History UI.** New feature; medium priority. Recovery tool for future incidents.
- **(Already exists in Forge) Move CRDT into daemon** — the underlying architectural fix that eliminates `.json`/`.crdt` divergence. This incident is concrete justification for prioritizing it.
- **Investigate why git auto-commits stopped on April 26.** Lower priority; same root cause as the CRDT divergence (Emacs writes bypass Tauri's commit hook). Resolves itself once daemon becomes the single writer with its own commit hook.

## Files referenced

- `~/.local/share/nous/notebooks/b67b98ae-d5d2-4947-b40d-6fc6410500b6/pages/c1ec38bd-421d-4484-8765-11e4b3883376.json` — live page (wiped)
- `~/.local/share/nous/notebooks/b67b98ae-.../pages/c1ec38bd-....snapshots/` — snapshot directory (recovery source)
- `~/.local/share/nous/notebooks/b67b98ae-.../pages/c1ec38bd-....oplog` — JSONL log (recovery source)
- `~/.local/share/nous/notebooks/b67b98ae-.../sync/pages/c1ec38bd-....crdt` — CRDT state (also overwritten)
- `~/.local/share/nous/notebooks/b67b98ae-.../sync/pages/c1ec38bd-....updates` — CRDT update log (untouched — confirms wipe bypassed CRDT path)
- `~/.local/share/nous/notebooks/b67b98ae-.../notebook.json` — `syncConfig` with `lastSync` timestamp aligning to wipe
- `~/.local/share/nous/notebooks/b67b98ae-.../.git/` — git history shows last commit on 2026-04-26
