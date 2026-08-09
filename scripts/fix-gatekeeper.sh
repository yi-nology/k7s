#!/usr/bin/env bash
# fix-gatekeeper.sh — One-click fix for macOS "k7s is damaged" error.
#
# This script removes the Gatekeeper quarantine attribute that macOS applies
# to unsigned apps downloaded from the internet. After running this script,
# k7s will open normally.
#
# Usage:
#   Double-click this file from the DMG, or run from Terminal:
#   bash fix-gatekeeper.sh

set -euo pipefail

APP_PATH="/Applications/k7s.app"

# ── Check if k7s is installed ─────────────────────────────────────────────────

if [[ ! -d "$APP_PATH" ]]; then
  osascript -e 'display dialog "k7s.app not found in /Applications.\n\nPlease drag k7s.app to the Applications folder first, then run this script again." buttons {"OK"} default button "OK" with icon stop with title "k7s Fix"'
  exit 1
fi

# ── Confirm with user ─────────────────────────────────────────────────────────

response=$(osascript -e 'display dialog "This will fix the \"k7s is damaged\" error by removing the macOS Gatekeeper quarantine attribute.\n\nApp path: /Applications/k7s.app\n\nContinue?" buttons {"Cancel", "Fix & Open"} default button "Fix & Open" with icon caution with title "k7s — Fix Gatekeeper"')

if [[ "$response" != *"Fix & Open"* ]]; then
  exit 0
fi

# ── Remove quarantine attribute ────────────────────────────────────────────────

if xattr -cr "$APP_PATH" 2>/dev/null; then
  osascript -e 'display dialog "Done! k7s has been fixed and is ready to use." buttons {"OK"} default button "OK" with icon note with title "k7s — Fix Gatekeeper"'
else
  osascript -e 'display dialog "Failed to remove quarantine attribute.\n\nPlease run this command manually in Terminal:\n\nsudo xattr -cr /Applications/k7s.app" buttons {"OK"} default button "OK" with icon stop with title "k7s — Fix Gatekeeper"'
  exit 1
fi

# ── Offer to open k7s ─────────────────────────────────────────────────────────

open_response=$(osascript -e 'display dialog "Open k7s now?" buttons {"Not Now", "Open"} default button "Open" with icon note with title "k7s"')

if [[ "$open_response" == *"Open"* ]]; then
  open "$APP_PATH"
fi
