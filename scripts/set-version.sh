#!/usr/bin/env bash
# set-version.sh — bump every k7s crate to one version from a single place.
#
# The 9-repo layout means the same version string lives in 8 manifests +
# the frontend package.json + tauri.conf.json; updating them by hand is how
# releases end up with a mismatched crate. This script is the single writer.
#
# Usage:   scripts/set-version.sh 0.6.0
# After:   cargo update -w  (or any build) refreshes Cargo.lock.
set -euo pipefail

VER="${1:-}"
if [[ -z "$VER" ]]; then
  echo "usage: $0 <version>   e.g. $0 0.6.0" >&2
  exit 1
fi
if ! [[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "✗ '$VER' is not a semver string" >&2
  exit 1
fi

# k7s-deps stays on its own 0.x line — it has no user-facing version.
for m in crates/k7s-core crates/k7s-commands crates/k7s-server \
         crates/k7s-desktop crates/k7s-ios crates/k7s-android; do
  sed -i.bak -E "s/^version = \".*\"/version = \"$VER\"/" "$m/Cargo.toml"
  rm -f "$m/Cargo.toml.bak"
  echo "✓ $m/Cargo.toml → $VER"
done

for f in frontend/package.json crates/k7s-desktop/tauri.conf.json; do
  if [[ -f "$f" ]]; then
    sed -i.bak -E "s/\"version\": \"[^\"]+\"/\"version\": \"$VER\"/" "$f"
    rm -f "$f.bak"
    echo "✓ $f → $VER"
  fi
done

echo ""
echo "next: cargo update -w && scripts/check-versions.sh"
