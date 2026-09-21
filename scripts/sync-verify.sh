#!/bin/sh
# Gate for the daily upstream sync: does merged commit AFTER break anything
# that BEFORE (the pre-merge fork tip) did not already break?
#
# Usage: sh scripts/sync-verify.sh <before-sha> <after-sha>
#
# The fork carries its own features, and upstream's tests know nothing about
# them, so the fork's own tip can already fail some upstream tests. Requiring
# a fully green run would then block every sync forever. Instead: run the
# checks on AFTER; if they are all green, done. If not, run them on BEFORE too
# and fail only on failures that are new. Failures both share are reported but
# do not block the merge.
#
# Exit: 0 no new failures, 1 new failures (listed on stdout).

set -u

BEFORE="$1"
AFTER="$2"
OUT="$(git rev-parse --git-dir)/sync-verify"
mkdir -p "$OUT"

# Writes one signature per failure to $1: a failing test name, or the name of
# a failing whole-repo check. Test names have their timing stripped so the
# same failure compares equal across runs.
run_checks() {
  sig="$1"
  : > "$sig"
  npm ci --no-audit --no-fund >/dev/null 2>&1 || echo "npm ci" >> "$sig"
  npm test > "$OUT/test.log" 2>&1
  test_rc=$?
  awk '/failing tests:/{f=1} f' "$OUT/test.log" | grep '^✖' | grep -v 'failing tests:' \
    | sed -E 's/ \([0-9.]+m?s\)$//; s/^/test: /' >> "$sig"
  # A non-zero exit with no parsed failing test (crash, timeout) still counts.
  if [ "$test_rc" -ne 0 ] && ! grep -q '^test: ' "$sig"; then
    echo "test: (unparsed failure)" >> "$sig"
  fi
  npm run check:boundaries >/dev/null 2>&1 || echo "check:boundaries" >> "$sig"
  npm run format:check >/dev/null 2>&1 || echo "format:check" >> "$sig"
  sort -u -o "$sig" "$sig"
}

git checkout -q --detach "$AFTER" || exit 1
run_checks "$OUT/after.txt"
if [ ! -s "$OUT/after.txt" ]; then
  echo "All checks pass on the merged tree."
  exit 0
fi

echo "Merged tree has failing checks; comparing with the pre-merge tree."
git checkout -q --detach "$BEFORE" || exit 1
run_checks "$OUT/before.txt"
git checkout -q --detach "$AFTER"

new="$(comm -13 "$OUT/before.txt" "$OUT/after.txt")"
if [ -n "$new" ]; then
  echo "NEW failures introduced by the merge:"
  echo "$new"
  exit 1
fi
echo "No new failures. Already failing before the merge (not blocking):"
cat "$OUT/before.txt"
exit 0
