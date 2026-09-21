#!/bin/sh
# Merge the public upstream repo (and optionally a sibling fork) into the
# currently checked-out branch, resolving what can safely be resolved.
#
# Used by both the GitLab schedule (.gitlab-ci.yml) and the GitHub schedule
# (.github/workflows/sync-upstream.yml) so the two forks merge identically.
# This script only merges locally; testing, pushing and notifying stay with
# the caller.
#
# Env:
#   UPSTREAM_REPO    upstream URL (default: bilawalsidhu/gods-eye-view)
#   UPSTREAM_BRANCH  upstream branch (default: main)
#   MIRROR_REPO      optional sibling fork to merge first, so two forks that
#                    each sync from upstream end up with the same history
#                    instead of two different merge commits
#   MIRROR_BRANCH    that fork's branch (default: main)
#
# Conflict policy: a conflict confined to Markdown files is resolved with a
# union merge (keep both sides). Fork-added and upstream-added entries in
# CHANGELOG.md / DATA_SOURCES.md / README.md are additive, and the test gate
# catches anything that goes wrong. A conflict in any other file aborts the
# merge and leaves the branch untouched.
#
# Exit: 0 merged or already up to date (compare HEAD before/after to tell),
#       10 conflict needing a human (merge aborted, files listed on stdout),
#       20 could not fetch a remote.

set -u

UPSTREAM_REPO="${UPSTREAM_REPO:-https://github.com/bilawalsidhu/gods-eye-view.git}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
MIRROR_BRANCH="${MIRROR_BRANCH:-main}"

git config user.email >/dev/null 2>&1 || git config user.email "sync-bot@users.noreply.invalid"
git config user.name >/dev/null 2>&1 || git config user.name "gods-eye-view sync bot"

fetch_remote() {
  name="$1"; url="$2"; branch="$3"
  git remote set-url "$name" "$url" 2>/dev/null || git remote add "$name" "$url"
  # Explicit refspec: don't rely on the remote's default fetch config.
  git fetch --no-tags "$name" "+refs/heads/$branch:refs/remotes/$name/$branch"
}

# Keep both sides of every conflicted Markdown file. Returns non-zero if any
# unmerged path is not a both-sides-modified Markdown file.
resolve_docs_with_union() {
  unresolved=""
  for f in $(git diff --name-only --diff-filter=U); do
    case "$f" in
      *.md) ;;
      *) unresolved="$unresolved $f"; continue ;;
    esac
    stages="$(git ls-files -u -- "$f" | awk '{print $3}' | sort -u | tr '\n' ' ')"
    case "$stages" in
      *2*3*) ;;
      *) unresolved="$unresolved $f"; continue ;;
    esac
    # Under .git (relative path): native Windows git cannot read msys /tmp paths.
    tmp="$(git rev-parse --git-dir)/sync-union"
    rm -rf "$tmp"; mkdir -p "$tmp"
    git show ":2:$f" > "$tmp/ours"
    git show ":3:$f" > "$tmp/theirs"
    git show ":1:$f" > "$tmp/base" 2>/dev/null || : > "$tmp/base"
    if ! git merge-file --union -p "$tmp/ours" "$tmp/base" "$tmp/theirs" > "$tmp/merged"; then
      unresolved="$unresolved $f"; rm -rf "$tmp"; continue
    fi
    cat "$tmp/merged" > "$f"
    rm -rf "$tmp"
    git add -- "$f"
    echo "Union-merged $f"
  done
  if [ -n "$unresolved" ]; then
    echo "UNRESOLVED:$unresolved"
    return 1
  fi
}

merge_ref() {
  ref="$1"
  if git merge --no-edit "$ref"; then
    return 0
  fi
  if resolve_docs_with_union; then
    git commit --no-edit
    return 0
  fi
  git merge --abort
  return 10
}

if [ -n "${MIRROR_REPO:-}" ]; then
  # A missing mirror is not fatal: upstream is what matters.
  if fetch_remote mirror "$MIRROR_REPO" "$MIRROR_BRANCH"; then
    merge_ref "mirror/$MIRROR_BRANCH" || exit $?
  else
    echo "Warning: could not fetch mirror $MIRROR_REPO; continuing with upstream only."
  fi
fi

fetch_remote upstream "$UPSTREAM_REPO" "$UPSTREAM_BRANCH" || exit 20
merge_ref "upstream/$UPSTREAM_BRANCH" || exit $?
exit 0
