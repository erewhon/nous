#!/usr/bin/env bash
# Recovery script for the 2026-05-01 14:28 UTC WebDAV-sync wipe.
#
# Modes:
#   (default)            — DRY RUN: report what would be restored.
#   --apply              — actually restore. Pages where snapshot has more
#                          blocks than live are restored from snapshot.
#   --diff               — for each affected page, show a unified diff of
#                          live vs latest snapshot. No changes made.
#   --page <id-or-name>  — limit to one page. Accepts UUID prefix (8+ chars)
#                          OR a substring of the page title (case-insensitive).
#
# Combine: --diff --page weekly  → diff just the page whose title contains "weekly"
#          --apply --page c1ec    → restore just the page whose UUID starts with c1ec
#
# Background: 23 pages in the Agile Results notebook were tagged "Merged"
# in that sync. The merge serialized stale CRDT state over .json content.
# Some pages lost content (snapshot > live); some are fine (live >= snapshot).
# Restore policy: if snapshot has MORE blocks than live, restore from snapshot.
# If live has equal or more, skip (likely unaffected). If no snapshot, manual.
#
# Pre-requisites:
#   - desktop app shut down (already done)
#   - daemon stopped (recommended before --apply)
#   - sync disabled on this notebook (already done)

set -euo pipefail

NB_DIR="${NB_DIR:-/home/erewhon/.local/share/nous/notebooks/b67b98ae-d5d2-4947-b40d-6fc6410500b6}"
DRY_RUN=true
DIFF_MODE=false
ONLY_PAGE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) DRY_RUN=false; shift ;;
    --diff)  DIFF_MODE=true; shift ;;
    --page)  ONLY_PAGE="$2"; shift 2 ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# //'; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# The 23 pages logged as "Merged" by the sync at 2026-05-01T14:28:07.
PAGES=(
  "54617e2f-75b8-4f65-9eda-74e8cb0290f8|Monthly Plan"
  "c1ec38bd-421d-4484-8765-11e4b3883376|Tech Purchases"
  "c1da0196-50a3-49f2-b8fd-379c7be961ec|Weekly Plan"
  "294b843a-5af5-4d15-bdd1-207fd553c58c|Weekly Dashboard - Apr 27-3, 2026"
  "de879aa2-da1e-4b6e-849e-a1c486445da0|Weekly Dashboard - Apr 27-3, 2026"
  "181d4edf-a608-462d-a50f-939c0b7a2a2b|April 28, 2026"
  "bd94f7d8-0540-4b2d-b404-4af1a150768f|April 27, 2026"
  "0ad40768-98e3-442f-aa1b-dd13212e88c8|April 26, 2026"
  "7b6e2d09-ae38-4807-a260-48b203207a8f|April 24, 2026"
  "97408a3a-ce24-41ea-8097-26d81c880cc1|April 25, 2026"
  "83d59b69-5e56-4665-ad1a-d743b341e09d|Weekly Dashboard - Apr 20-26, 2026 (a)"
  "a6526dfc-6b5a-41c1-a50f-6da90c51741c|Weekly Dashboard - Apr 20-26, 2026 (b)"
  "d0db8fa4-565d-4e44-b2e0-8299883bcfe8|Weekly Dashboard - Apr 20-26, 2026 (c)"
  "f85ae85e-e363-4872-be02-c6e318810051|Weekly Dashboard - Apr 20-26, 2026 (d)"
  "3edcf934-e9df-4648-90ce-c3cb849a40cc|April 23, 2026"
  "837962d3-9087-4338-b6c4-4d785d69544d|April 22, 2026"
  "aecf7625-ab57-4de6-aaeb-b66f491a7141|Weekly Dashboard - Apr 20-26, 2026 (e)"
  "3288e7b0-6277-4c99-a59d-6cbca746e733|Weekly Dashboard - Apr 20-26, 2026 (f)"
  "671c2062-4401-4876-8cb8-b861f88eb09c|April 21, 2026"
  "4611f579-80ab-4405-86cb-688de9807e00|Weekly Dashboard - Apr 20-26, 2026 (g)"
  "3e201f5e-288f-48d9-8b72-29b5304d2354|April 20, 2026"
  "c507213e-7a87-4241-b1e9-b3334f0f95a9|Yearly Vision"
  "0d5d0da5-d8d7-4c3d-bcca-80ee7ba21626|April 19, 2026"
)

TS=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="$NB_DIR/.recovery-backup-$TS"

if [[ "$DRY_RUN" == "false" && "$DIFF_MODE" == "false" ]]; then
  echo "Creating backup directory: $BACKUP_DIR"
  mkdir -p "$BACKUP_DIR"
fi

if [[ "$DIFF_MODE" == "true" ]]; then
  echo "Mode: DIFF (no changes)"
elif [[ "$DRY_RUN" == "true" ]]; then
  echo "Mode: DRY RUN"
else
  echo "Mode: APPLY"
fi
echo "Notebook: $NB_DIR"
echo

# Lower-case ONLY_PAGE for case-insensitive title matching.
ONLY_PAGE_LC=$(printf '%s' "$ONLY_PAGE" | tr '[:upper:]' '[:lower:]')

# Render a page's content for diffing.
# Each block becomes one or more lines:
#   [N] <type>: <text>                                — paragraph, header, etc.
#   [N.M] <type>[<flag>]: <item text>                 — items in checklist/list (one per item)
# Reads from a JSON object that has either .content.blocks or .data.blocks.
render_blocks_for_diff() {
  local file="$1"
  jq -r '
    def stringify_data:
      if has("text") then .text
      elif has("caption") then .caption
      elif has("url") then .url
      elif has("file") then (.file.url // (.file | tojson))
      else (. | tojson) end;

    (.content // .data) as $c
    | $c.blocks // []
    | to_entries
    | map(
        .key as $i
        | .value as $b
        | $b.type as $t
        | $b.data as $d
        | if ($t == "checklist") then
            ($d.items // [])
            | to_entries
            | map(
                .key as $j
                | .value as $it
                | "[\($i).\($j)] checklist[\(if $it.checked then "x" else " " end)]: \($it.text // "")"
              )
            | (["[\($i)] checklist:"] + .)
          elif ($t == "list" or $t == "nestedList" or $t == "orderedList") then
            ($d.items // [])
            | to_entries
            | map(
                .key as $j
                | .value as $it
                | "[\($i).\($j)] list: \($it | if type == "string" then . else (.content // .text // (. | tojson)) end)"
              )
            | (["[\($i)] \($t):"] + .)
          else
            ["[\($i)] \($t): \(($d | stringify_data) // "")"]
          end
      )
    | flatten
    | .[]
  ' "$file" 2>/dev/null
}

restore_count=0
skip_count=0
manual_count=0
err_count=0

for entry in "${PAGES[@]}"; do
  ID="${entry%%|*}"
  TITLE="${entry##*|}"
  TITLE_LC=$(printf '%s' "$TITLE" | tr '[:upper:]' '[:lower:]')

  # Page filter: match by UUID prefix OR title substring (both case-insensitive).
  if [[ -n "$ONLY_PAGE" ]]; then
    if [[ "$ID" != "$ONLY_PAGE"* && "$TITLE_LC" != *"$ONLY_PAGE_LC"* ]]; then
      continue
    fi
  fi

  PAGE_FILE="$NB_DIR/pages/$ID.json"
  SNAP_DIR="$NB_DIR/pages/$ID.snapshots"

  if [[ ! -f "$PAGE_FILE" ]]; then
    printf "[ERR ] %s  %s  — page file missing\n" "${ID:0:8}" "$TITLE"
    err_count=$((err_count + 1))
    continue
  fi

  LIVE_BLOCKS=$(jq '.content.blocks | length' "$PAGE_FILE" 2>/dev/null)

  # Find latest snapshot (skip .meta.json files)
  LATEST_SNAP=""
  if [[ -d "$SNAP_DIR" ]]; then
    LATEST_SNAP=$(find "$SNAP_DIR" -maxdepth 1 -name '*.json' ! -name '*.meta.json' 2>/dev/null | sort | tail -1)
  fi

  if [[ -z "$LATEST_SNAP" ]]; then
    printf "[MAN ] %s  %s  live=%s, no snapshot — manual review needed\n" "${ID:0:8}" "$TITLE" "$LIVE_BLOCKS"
    manual_count=$((manual_count + 1))
    continue
  fi

  # Snapshot may be in either {content: ...} or {data: ...} envelope shape
  SNAP_BLOCKS=$(jq '(.content.blocks // .data.blocks) | length' "$LATEST_SNAP" 2>/dev/null)
  SNAP_NAME=$(basename "$LATEST_SNAP" .json)

  # Diff mode: show live-vs-snapshot diff and continue. No counters touched.
  if [[ "$DIFF_MODE" == "true" ]]; then
    printf "\n=== %s — %s ===\n" "${ID:0:8}" "$TITLE"
    printf "    live=%s blocks   snapshot=%s blocks (%s)\n\n" \
      "$LIVE_BLOCKS" "$SNAP_BLOCKS" "$SNAP_NAME"
    LIVE_TXT=$(mktemp)
    SNAP_TXT=$(mktemp)
    render_blocks_for_diff "$PAGE_FILE" > "$LIVE_TXT"
    render_blocks_for_diff "$LATEST_SNAP" > "$SNAP_TXT"
    # diff -u with explicit labels; pipe through colordiff if available for color.
    if command -v colordiff >/dev/null 2>&1; then
      diff -u \
        --label "snapshot ($SNAP_NAME)" \
        --label "live (post-wipe)" \
        "$SNAP_TXT" "$LIVE_TXT" | colordiff || true
    else
      diff -u \
        --label "snapshot ($SNAP_NAME)" \
        --label "live (post-wipe)" \
        "$SNAP_TXT" "$LIVE_TXT" || true
    fi
    rm -f "$LIVE_TXT" "$SNAP_TXT"
    continue
  fi

  if [[ "$SNAP_BLOCKS" -le "$LIVE_BLOCKS" ]]; then
    printf "[SKIP] %s  %s  live=%s ≥ snap=%s (%s) — likely unaffected\n" \
      "${ID:0:8}" "$TITLE" "$LIVE_BLOCKS" "$SNAP_BLOCKS" "$SNAP_NAME"
    skip_count=$((skip_count + 1))
    continue
  fi

  DELTA=$((SNAP_BLOCKS - LIVE_BLOCKS))
  printf "[REST] %s  %s  live=%s → snap=%s (+%s blocks, %s)" \
    "${ID:0:8}" "$TITLE" "$LIVE_BLOCKS" "$SNAP_BLOCKS" "$DELTA" "$SNAP_NAME"

  if [[ "$DRY_RUN" == "true" ]]; then
    printf "  [DRY RUN]\n"
    restore_count=$((restore_count + 1))
    continue
  fi

  # APPLY: backup current page, replace .content from snapshot, bump updatedAt.
  # We don't touch .crdt — daemon is offline and sync is disabled, so .crdt
  # divergence is harmless until the merge bug is fixed and CRDT integration
  # is moved into the daemon.
  cp "$PAGE_FILE" "$BACKUP_DIR/$ID.json.pre-recovery"

  NEW_UPDATED_AT=$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)

  jq --slurpfile snap "$LATEST_SNAP" \
     --arg updatedAt "$NEW_UPDATED_AT" \
     '.content = ($snap[0].content // $snap[0].data) | .updatedAt = $updatedAt' \
     "$PAGE_FILE" > "$PAGE_FILE.tmp" && mv "$PAGE_FILE.tmp" "$PAGE_FILE"

  printf "  ✓ restored\n"
  restore_count=$((restore_count + 1))
done

if [[ "$DIFF_MODE" == "true" ]]; then
  echo
  echo "Diff mode complete. No changes made."
  exit 0
fi

echo
echo "Summary:"
echo "  Restored:        $restore_count"
echo "  Skipped (OK):    $skip_count"
echo "  Manual review:   $manual_count"
echo "  Errors:          $err_count"

if [[ "$DRY_RUN" == "true" ]]; then
  echo
  echo "This was a DRY RUN. Re-run with --apply to make changes."
  echo "  bash $0 --apply"
  echo "  bash $0 --apply --page weekly                    # title substring"
  echo "  bash $0 --apply --page c1ec                      # UUID prefix"
  echo "  bash $0 --diff --page weekly                     # see what changed first"
fi

if [[ "$DRY_RUN" == "false" && "$restore_count" -gt 0 ]]; then
  echo
  echo "Originals backed up to: $BACKUP_DIR"
  echo "Each file is named <page-id>.json.pre-recovery."
  echo
  echo "Next: don't restart the daemon or desktop app yet — the merge bug"
  echo "is still in the code and sync is still disabled. Verify the restored"
  echo "pages by reading them directly:"
  echo "  jq '.content.blocks | length' $NB_DIR/pages/c1ec38bd-421d-4484-8765-11e4b3883376.json"
fi
