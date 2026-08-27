#!/usr/bin/env bash
# sync-repos.sh — push the local aggregation tree back to the 9 independent
# GitHub repos (yi-nology/k7s-*), using `git subtree split` so each repo keeps
# its own history.
#
# The local k7/ directory is the development root: crates/k7s-* and frontend/
# are plain directories here (no nested .git), so a normal `git push` can't
# update the per-crate repos. `git subtree split --prefix=<dir>` rewrites the
# local history down to that prefix into a temp branch, which is then pushed.
#
# Usage:
#   scripts/sync-repos.sh              # split + push every repo
#   scripts/sync-repos.sh core server  # only k7s-core and k7s-server
#   scripts/sync-repos.sh --dry-run    # show what would run, change nothing
set -euo pipefail

ORG="${K7S_ORG:-yi-nology}"
DRY_RUN=0
FILTER=()

for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    *) FILTER+=("$arg") ;;
  esac
done

# name:prefix:branch — short name ↔ local prefix ↔ branch on the target repo.
REPOS=(
  "deps:crates/k7s-deps:main"
  "core:crates/k7s-core:main"
  "commands:crates/k7s-commands:main"
  "server:crates/k7s-server:main"
  "desktop:crates/k7s-desktop:main"
  "ios:crates/k7s-ios:main"
  "android:crates/k7s-android:main"
  "frontend:frontend:main"
)

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

for entry in "${REPOS[@]}"; do
  name="${entry%%:*}"
  rest="${entry#*:}"
  prefix="${rest%%:*}"
  branch="${rest#*:}"

  if [[ "${#FILTER[@]}" -gt 0 ]] && ! printf '%s\0' "${FILTER[@]}" | grep -qxz "$name"; then
    continue
  fi

  repo="k7s-$name"
  url="${K7S_REMOTE_SCHEME:-https}://github.com/${ORG}/${repo}.git"
  tmp_branch="sync/${name}-$(date +%s)"

  echo "▶ $repo  ($prefix → $branch)"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "  [dry-run] git subtree split --prefix=$prefix -b $tmp_branch"
    echo "  [dry-run] git push $url $tmp_branch:$branch"
    echo "  [dry-run] git branch -D $tmp_branch"
    continue
  fi

  if ! git subtree split --prefix="$prefix" -b "$tmp_branch"; then
    echo "  ✗ split failed for $repo — is '$prefix' committed?" >&2
    git branch -D "$tmp_branch" 2>/dev/null || true
    exit 1
  fi
  if ! git push "$url" "$tmp_branch:$branch"; then
    echo "  ✗ push failed for $repo" >&2
    git branch -D "$tmp_branch" 2>/dev/null || true
    exit 1
  fi
  git branch -D "$tmp_branch"
  echo "  ✓ pushed"
done

if [[ "$DRY_RUN" == "1" ]]; then
  echo "dry run — nothing was pushed"
else
  echo "all requested repos synced"
fi
