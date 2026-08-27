#!/usr/bin/env bash
# check-versions.sh — fail unless every k7s crate carries the SAME version and
# Cargo.lock agrees with the manifests. Run in CI and before releases.
#
# k7s-deps is exempt (own 0.x line). Exit 0 = consistent, exit 1 = mismatch.
# Plain POSIX-ish bash (macOS bash 3.2 compatible — no associative arrays).
set -euo pipefail

CRATES="k7s-core k7s-commands k7s-server k7s-desktop k7s-ios k7s-android"

manifest_version() {
  sed -n -E 's/^version = "(.*)"/\1/p' "crates/$1/Cargo.toml" | head -1
}

ref="$(manifest_version k7s-core)"
fail=0

for c in $CRATES; do
  v="$(manifest_version "$c")"
  if [[ "$v" != "$ref" ]]; then
    echo "✗ version mismatch: k7s-core=$ref but $c=$v" >&2
    fail=1
  fi
done

# Frontend + tauri.conf must match too.
for f in frontend/package.json crates/k7s-desktop/tauri.conf.json; do
  if [[ -f "$f" ]]; then
    v="$(sed -n -E 's/.*"version": "([^"]+)".*/\1/p' "$f" | head -1)"
    if [[ "$v" != "$ref" ]]; then
      echo "✗ version mismatch: $f=$v but k7s-core=$ref" >&2
      fail=1
    fi
  fi
done

# Cargo.lock: each k7s crate's locked version must equal its manifest version.
for c in $CRATES; do
  locked="$(awk -v pkg="$c" '
    $0 == "name = \"" pkg "\"" { in_pkg = 1; next }
    in_pkg && /^version = / { gsub(/"/, ""); print $3; exit }
    in_pkg && /^name = / { in_pkg = 0 }
  ' Cargo.lock | head -1)"
  if [[ -n "${locked:-}" && "$locked" != "$(manifest_version "$c")" ]]; then
    echo "✗ Cargo.lock pins $c=$locked but manifest says $(manifest_version "$c") (run cargo update -w)" >&2
    fail=1
  fi
done

if [[ "$fail" == "0" ]]; then
  echo "✓ all k7s crates on $ref; Cargo.lock in sync"
else
  echo "version check FAILED" >&2
  exit 1
fi
