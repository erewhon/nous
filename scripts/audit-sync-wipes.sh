#!/usr/bin/env bash
# Audit all notebooks for the WebDAV-sync "merge wipe" signature.
#
# Background: the 2026-05-01 incident (see
# docs/incident-2026-05-01-webdav-sync-data-loss.md) had the sync "merge" path
# serialize a stale CRDT doc over the live page .json, wiping ~24 pages of an
# actively-edited notebook back to a days-old state. The wipe was silent. The
# same bug may have caused smaller, unnoticed losses on other notebooks or
# earlier dates. This script walks every notebook and flags the signature so a
# human can triage. It is READ-ONLY — it never modifies notebook data.
#
# Detection signature (all shell-checkable; .crdt is Yjs-binary so we don't
# decode it, we use mtimes + the CRDT mutation-log bypass instead):
#   1. A cluster of pages/*.json files written within ~2s of each other
#      (a notebook-wide sync write event, not a human edit).
#   2. Sync alignment: the cluster window matches syncConfig.lastSync and/or the
#      folders.json/sections.json mtimes (sync rewrites those too).
#   3. CRDT-mutation bypass: affected pages' sync/pages/<id>.updates log was NOT
#      appended in the window (the merge wrote .json/.crdt directly, bypassing
#      apply_save). A normal bulk human edit would have appended .updates.
#   4. Damage: a snapshot taken before the cluster has MORE content blocks than
#      the page has now → content was lost and is still missing on disk.
#
# Clusters are classified:
#   [WIPE]  damage present AND sync/CRDT-bypass signature  → triage now
#   [SIG ]  sync/CRDT-bypass signature but no current loss → likely a real sync
#           event; either harmless (import / already recovered) or the loss was
#           later overwritten by edits. Worth a glance.
#   [BULK]  large simultaneous write with no sync signature → import or a
#           genuine bulk edit. Shown only with -v.
#
# Usage:
#   scripts/audit-sync-wipes.sh                 # report across all notebooks
#   scripts/audit-sync-wipes.sh -v              # also list BULK clusters + pages
#   scripts/audit-sync-wipes.sh --notebook agile   # one notebook (id prefix or
#                                                  # name substring, case-insens)
#   scripts/audit-sync-wipes.sh --window 3 --min-cluster 8
#   NB_ROOT=/path/to/notebooks scripts/audit-sync-wipes.sh
#
# Exit status: 0 always (it's a report). Look at the [WIPE] rows.

set -uo pipefail

NB_ROOT="${NB_ROOT:-$HOME/.local/share/nous/notebooks}"
WINDOW=2          # seconds: max gap between consecutive writes in one cluster
MIN_CLUSTER=5     # min page files in a cluster to consider it a bulk event
BYPASS_RATIO=50   # percent of cluster pages with stale/absent .updates to call
                  # it a CRDT-bypass (sync) signature
ALIGN_SLOP=30     # seconds of slop when matching a cluster to lastSync
VERBOSE=false
ONLY_NB=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -v|--verbose)     VERBOSE=true; shift ;;
    --notebook)       ONLY_NB="$2"; shift 2 ;;
    --window)         WINDOW="$2"; shift 2 ;;
    --min-cluster)    MIN_CLUSTER="$2"; shift 2 ;;
    -h|--help)        grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2; exit 2
fi
if [[ ! -d "$NB_ROOT" ]]; then
  echo "error: notebooks dir not found: $NB_ROOT" >&2; exit 2
fi

ONLY_NB_LC=$(printf '%s' "$ONLY_NB" | tr '[:upper:]' '[:lower:]')

# Parse an ISO-8601 timestamp to epoch seconds (UTC). Echoes "" on failure.
iso_to_epoch() {
  local ts="$1"
  [[ -z "$ts" ]] && { echo ""; return; }
  date -u -d "$ts" +%s 2>/dev/null || echo ""
}

# Parse a snapshot filename (YYYYMMDD_HHMMSS[...]) to epoch seconds (UTC).
snap_to_epoch() {
  local bn="$1" d t
  d="${bn:0:8}"; t="${bn:9:6}"
  [[ "$d" =~ ^[0-9]{8}$ && "$t" =~ ^[0-9]{6}$ ]] || { echo ""; return; }
  date -u -d "${d:0:4}-${d:4:2}-${d:6:2} ${t:0:2}:${t:2:2}:${t:4:2}" +%s 2>/dev/null || echo ""
}

# Latest snapshot for a page strictly before $2 (epoch). Echoes the file path.
latest_snapshot_before() {
  local snapdir="$1" before="$2" s bn se best="" bestt=0
  [[ -d "$snapdir" ]] || { echo ""; return; }
  for s in "$snapdir"/*.json; do
    [[ -e "$s" ]] || continue
    case "$s" in *.meta.json) continue ;; esac
    bn="$(basename "$s" .json)"
    se="$(snap_to_epoch "$bn")"
    [[ -z "$se" ]] && continue
    if (( se < before && se > bestt )); then bestt="$se"; best="$s"; fi
  done
  echo "$best"
}

human_ts() { date -u -d "@$1" +%FT%TZ; }

# ---- counters across the whole run --------------------------------------
total_nb=0; scanned_nb=0; wipe_clusters=0; loss_clusters=0; sig_clusters=0; bulk_clusters=0
total_loss_pages=0; total_loss_blocks=0
declare -a WIPE_SUMMARY=()

printf '== Sync-wipe audit ==\n'
printf 'root: %s   window: %ss   min-cluster: %s\n\n' "$NB_ROOT" "$WINDOW" "$MIN_CLUSTER"

for NB in "$NB_ROOT"/*/; do
  [[ -f "$NB/notebook.json" ]] || continue
  total_nb=$((total_nb + 1))
  nbid="$(basename "$NB")"
  name="$(jq -r '.name // "(unnamed)"' "$NB/notebook.json" 2>/dev/null)"
  name_lc="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
  id_lc="$(printf '%s' "$nbid" | tr '[:upper:]' '[:lower:]')"

  if [[ -n "$ONLY_NB" ]]; then
    [[ "$id_lc" == "$ONLY_NB_LC"* || "$name_lc" == *"$ONLY_NB_LC"* ]] || continue
  fi

  last_sync="$(jq -r '.syncConfig.lastSync // empty' "$NB/notebook.json" 2>/dev/null)"
  sync_enabled="$(jq -r '.syncConfig.enabled // false' "$NB/notebook.json" 2>/dev/null)"
  has_sync=false
  [[ -n "$last_sync" ]] && has_sync=true
  [[ -d "$NB/sync" ]] && has_sync=true
  if ! $has_sync; then
    $VERBOSE && printf -- '- %s  [%s]  — sync never used, skipped\n' "$name" "${nbid:0:8}"
    continue
  fi
  scanned_nb=$((scanned_nb + 1))

  last_sync_epoch="$(iso_to_epoch "$last_sync")"
  fold_epoch="$(stat -c %Y "$NB/folders.json" 2>/dev/null || echo 0)"
  sec_epoch="$(stat -c %Y "$NB/sections.json" 2>/dev/null || echo 0)"

  # Pass 1: gather "epoch id" for every page file, sorted by mtime.
  mapfile -t ROWS < <(
    find "$NB/pages" -maxdepth 1 -name '*.json' -printf '%T@ %f\n' 2>/dev/null \
      | awk '{ printf "%d %s\n", $1, substr($2, 1, length($2)-5) }' \
      | sort -n
  )
  npages=${#ROWS[@]}

  nb_header_printed=false
  print_nb_header() {
    $nb_header_printed && return
    printf '\n### %s  [%s]\n' "$name" "${nbid:0:8}"
    printf '    pages: %s   sync.enabled(now): %s   lastSync: %s\n' \
      "$npages" "$sync_enabled" "${last_sync:-never}"
    nb_header_printed=true
  }

  # Pass 2: cluster consecutive writes within $WINDOW seconds.
  cl_epochs=(); cl_ids=()
  flush_cluster() {
    local size=${#cl_ids[@]}
    (( size >= MIN_CLUSTER )) || { cl_epochs=(); cl_ids=(); return; }

    local wstart="${cl_epochs[0]}" wend="${cl_epochs[size-1]}"

    # Sync alignment: lastSync OR folders/sections mtime inside the window(+slop).
    local aligned=false reason=""
    if [[ -n "$last_sync_epoch" ]] \
       && (( last_sync_epoch >= wstart - WINDOW && last_sync_epoch <= wend + ALIGN_SLOP )); then
      aligned=true; reason="lastSync"
    fi
    if (( fold_epoch >= wstart - WINDOW && fold_epoch <= wend + WINDOW )); then
      aligned=true; reason="${reason:+$reason,}folders/sections"
    elif (( sec_epoch >= wstart - WINDOW && sec_epoch <= wend + WINDOW )); then
      aligned=true; reason="${reason:+$reason,}sections"
    fi

    # CRDT-mutation bypass: .updates not appended in the window.
    local bypass=0 i id upd umt
    for ((i=0; i<size; i++)); do
      id="${cl_ids[i]}"
      upd="$NB/sync/pages/$id.updates"
      if [[ ! -e "$upd" ]]; then
        bypass=$((bypass + 1))
      else
        umt="$(stat -c %Y "$upd" 2>/dev/null || echo 0)"
        (( umt < wstart - 60 )) && bypass=$((bypass + 1))
      fi
    done
    local bypass_pct=$(( bypass * 100 / size ))
    local bypassed=false
    (( bypass_pct >= BYPASS_RATIO )) && bypassed=true

    # Damage: snapshot-before-cluster blocks vs current blocks.
    local loss_pages=0 loss_blocks=0 nosnap=0
    local -a loss_detail=()
    for ((i=0; i<size; i++)); do
      id="${cl_ids[i]}"
      local pf="$NB/pages/$id.json"
      [[ -f "$pf" ]] || continue
      local snap; snap="$(latest_snapshot_before "$NB/pages/$id.snapshots" "$wstart")"
      if [[ -z "$snap" ]]; then nosnap=$((nosnap + 1)); continue; fi
      local live snapb
      live="$(jq '(.content.blocks // []) | length' "$pf" 2>/dev/null || echo 0)"
      snapb="$(jq '((.content.blocks // .data.blocks) // []) | length' "$snap" 2>/dev/null || echo 0)"
      if (( snapb > live )); then
        loss_pages=$((loss_pages + 1))
        loss_blocks=$((loss_blocks + (snapb - live)))
        local title; title="$(jq -r '.title // "(untitled)"' "$pf" 2>/dev/null)"
        loss_detail+=("$(printf '        - %s  %s  %s→%s blocks (-%s)  [snap %s]' \
          "${id:0:8}" "$title" "$snapb" "$live" "$((snapb - live))" \
          "$(basename "$snap" .json | cut -c1-15)")")
      fi
    done

    # Classify. crdt-bypass is ~always high (most pages never had a .updates
    # log) so it can't *confirm* a sync — it only excludes human bulk edits
    # (low bypass = .updates appended = a person typed). Sync-alignment is the
    # confirmation, but only the *last* sync's timestamps survive on disk, so
    # older wipes can't be alignment-confirmed — those surface via damage alone.
    #   WIPE   damage + alignment-confirmed sync           → the smoking gun
    #   LOSS?  damage + sync-ish (high bypass) but no       → likely an older
    #          surviving alignment timestamp                  wipe; triage
    #   SIG    alignment-confirmed sync, no current loss    → real sync, benign
    #   BULK   no alignment, no loss (or low bypass)        → import / human edit
    local tag
    if (( loss_pages > 0 )) && $aligned; then
      tag="WIPE "; wipe_clusters=$((wipe_clusters + 1))
    elif (( loss_pages > 0 )) && $bypassed; then
      tag="LOSS?"; loss_clusters=$((loss_clusters + 1))
    elif $aligned; then
      tag="SIG  "; sig_clusters=$((sig_clusters + 1))
    else
      tag="BULK "; bulk_clusters=$((bulk_clusters + 1))
    fi

    # Both WIPE and LOSS? carry actionable on-disk loss → add to triage list.
    if (( loss_pages > 0 )) && [[ "$tag" == "WIPE "* || "$tag" == "LOSS?"* ]]; then
      total_loss_pages=$((total_loss_pages + loss_pages))
      total_loss_blocks=$((total_loss_blocks + loss_blocks))
      WIPE_SUMMARY+=("$(printf '  [%s] %-22s [%s]  %s  %s pages, -%s blocks' \
        "${tag// /}" "$name" "${nbid:0:8}" "$(human_ts "$wstart")" "$loss_pages" "$loss_blocks")")
    fi

    # Print (BULK only in verbose).
    if [[ "$tag" != "BULK "* ]] || $VERBOSE; then
      print_nb_header
      printf '  [%s] %s  ×%s pages  span=%ss  aligned=%s%s  crdt-bypass=%s%%  loss=%s pages/-%s blocks%s\n' \
        "$tag" "$(human_ts "$wstart")" "$size" "$((wend - wstart))" \
        "$aligned" "${reason:+ ($reason)}" "$bypass_pct" "$loss_pages" "$loss_blocks" \
        "$([[ $nosnap -gt 0 ]] && echo "  ($nosnap no-snapshot)")"
      if (( ${#loss_detail[@]} > 0 )); then
        printf '%s\n' "${loss_detail[@]}"
      fi
      if $VERBOSE && [[ "$tag" == "BULK" ]]; then
        printf '        (no sync signature — likely import or bulk edit)\n'
      fi
    fi

    cl_epochs=(); cl_ids=()
  }

  local_prev=""
  for row in "${ROWS[@]}"; do
    ep="${row%% *}"; id="${row#* }"
    if [[ -n "$local_prev" ]] && (( ep - local_prev > WINDOW )); then
      flush_cluster
    fi
    cl_epochs+=("$ep"); cl_ids+=("$id"); local_prev="$ep"
  done
  flush_cluster
done

# ---- summary ------------------------------------------------------------
printf '\n== Summary ==\n'
printf 'notebooks: %s total, %s sync-capable scanned\n' "$total_nb" "$scanned_nb"
printf 'clusters: %s confirmed-wipe, %s suspected-loss, %s sync-signature, %s bulk%s\n' \
  "$wipe_clusters" "$loss_clusters" "$sig_clusters" "$bulk_clusters" \
  "$($VERBOSE || echo ' (run -v to list bulk)')"

if (( wipe_clusters + loss_clusters > 0 )); then
  printf '\nClusters with current on-disk content loss (triage these):\n'
  printf '%s\n' "${WIPE_SUMMARY[@]}"
  printf '\nTo inspect a page: diff its latest pre-cluster snapshot vs live with\n'
  printf '  scripts/recover-2026-05-01-wipe.sh --diff --page <id-or-title>\n'
  printf '(adjust NB_DIR for the notebook). Recover with --apply only after the\n'
  printf 'sync merge bug is fixed and sync is disabled on that notebook.\n'
else
  printf '\nNo clusters with current content loss found.\n'
  printf 'Note: a wipe whose lost content was later overwritten by new edits\n'
  printf 'will not show as loss — review [SIG ] clusters above for those.\n'
fi
