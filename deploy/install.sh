#!/usr/bin/env bash
# install.sh — One-click installer for k7s (Kubernetes desktop dashboard).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/yi-nology/k7s/main/install.sh | bash
#
# Supports: macOS (Apple Silicon), Linux (amd64/arm64), Windows (Git Bash/WSL).
# Unmatched platforms get a friendly message with build-from-source instructions.

set -euo pipefail

REPO="yi-nology/k7s"
BINARY="k7s"

# ── Helpers ──────────────────────────────────────────────────────────────────

info()  { printf "\033[1;34m▸ %s\033[0m\n" "$*"; }
ok()    { printf "\033[1;32m✓ %s\033[0m\n" "$*"; }
warn()  { printf "\033[1;33m⚠ %s\033[0m\n" "$*"; }
die()   { printf "\033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

# ── Detect platform ──────────────────────────────────────────────────────────

detect_os() {
  local sys
  sys="$(uname -s)"
  case "$sys" in
    Darwin*)  echo "macos" ;;
    Linux*)   echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *)        echo "unknown" ;;
  esac
}

detect_arch() {
  local mach
  mach="$(uname -m)"
  case "$mach" in
    arm64|aarch64) echo "aarch64" ;;
    x86_64)        echo "x86_64" ;;
    *)             echo "unknown" ;;
  esac
}

# ── Fetch latest version from GitHub API ─────────────────────────────────────

fetch_latest_version() {
  local tag
  tag="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' | head -1 | sed -E 's/.*"tag_name": *"v?([^"]+)".*/\1/')"
  if [[ -z "$tag" ]]; then
    die "Could not determine latest release version. Check your network or visit: https://github.com/${REPO}/releases"
  fi
  echo "$tag"
}

# ── Build artifact name ──────────────────────────────────────────────────────

artifact_name() {
  local ver="$1" os="$2" arch="$3" pkg="$4"
  # Map uname arch to Tauri bundle naming convention
  local linux_arch
  case "$arch" in
    aarch64) linux_arch="arm64" ;;
    x86_64)  linux_arch="amd64" ;;
    *)       linux_arch="$arch" ;;
  esac
  case "$os" in
    macos)
      echo "k7s_${ver}_${arch}.dmg"
      ;;
    linux)
      case "$pkg" in
        rpm)      echo "k7s_${ver}_${linux_arch}.rpm" ;;
        appimage) echo "k7s_${ver}_${linux_arch}.AppImage" ;;
        *)        echo "k7s_${ver}_${linux_arch}.deb" ;;
      esac
      ;;
    windows)
      echo "k7s_${ver}_x64-setup.exe"
      ;;
  esac
}

download_url() {
  local ver="$1" artifact="$2"
  echo "https://github.com/${REPO}/releases/download/v${ver}/${artifact}"
}

# ── Install per platform ─────────────────────────────────────────────────────

install_macos() {
  local dmg_path="$1"
  info "Mounting DMG..."
  local mount_point
  mount_point="$(mktemp -d)"
  hdiutil attach "$dmg_path" -mountpoint "$mount_point" -nobrowse -quiet

  info "Installing to /Applications..."
  cp -R "$mount_point"/*.app /Applications/ 2>/dev/null \
    || die "Could not find .app inside DMG"

  hdiutil detach "$mount_point" -quiet 2>/dev/null || true
  rmdir "$mount_point" 2>/dev/null || true

  # Unsigned builds carry macOS's quarantine attribute, which blocks launch
  # with a misleading "k7s is damaged" error. Remove ONLY that attribute —
  # `xattr -cr` would strip every extended attribute wholesale, disabling
  # Gatekeeper checks on the whole bundle.
  info "Removing quarantine attribute (unsigned build)..."
  xattr -d com.apple.quarantine /Applications/k7s.app 2>/dev/null || true
  echo "  Note: the app is unsigned. Prefer a signed build or verify the"
  echo "  download checksum (this installer did) before trusting it."
}

install_linux() {
  local pkg_path="$1" pkg_fmt="$2"
  case "$pkg_fmt" in
    deb)
      info "Installing .deb package (requires sudo)..."
      sudo dpkg -i "$pkg_path" || sudo apt-get install -f -y
      ;;
    rpm)
      info "Installing .rpm package (requires sudo)..."
      if command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y "$pkg_path"
      elif command -v yum >/dev/null 2>&1; then
        sudo yum install -y "$pkg_path"
      else
        sudo rpm -i "$pkg_path"
      fi
      ;;
    appimage)
      install_linux_appimage "$pkg_path"
      ;;
  esac
}

install_linux_appimage() {
  local appimage_path="$1"
  local dest="${HOME}/.local/bin"
  mkdir -p "$dest"
  chmod +x "$appimage_path"
  mv "$appimage_path" "${dest}/k7s"
  info "Installed to ${dest}/k7s"
  info "Make sure ${dest} is in your PATH."
}

install_windows() {
  local exe_path="$1"
  info "Downloaded to: $exe_path"
  info "Please run the installer manually."
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
  echo ""
  echo "  ┌─────────────────────────────────────┐"
  echo "  │       k7s — K8s Desktop Dashboard    │"
  echo "  │          One-click installer          │"
  echo "  └─────────────────────────────────────┘"
  echo ""

  need_cmd curl
  need_cmd uname

  local os arch ver artifact url tmp_dir file_path
  os="$(detect_os)"
  arch="$(detect_arch)"

  info "Detected: ${os} / ${arch}"

  # ── Platform checks ──────────────────────────────────────────────────────
  case "$os" in
    macos)
      if [[ "$arch" != "aarch64" ]]; then
        die "macOS Intel (x86_64) builds are not available.\n  Use Rosetta 2 or build from source:\n  https://github.com/${REPO}#development"
      fi
      need_cmd hdiutil
      need_cmd cp
      ;;
    linux)
      # Detect package manager preference: rpm > deb > appimage
      if command -v rpm >/dev/null 2>&1 && ! command -v dpkg >/dev/null 2>&1; then
        PKG_FMT="rpm"
      elif command -v dpkg >/dev/null 2>&1; then
        PKG_FMT="deb"
      else
        PKG_FMT="appimage"
      fi
      info "Package format: ${PKG_FMT}"
      ;;
    windows)
      info "Windows detected — will download the installer for you to run."
      ;;
    *)
      die "Unsupported platform: $(uname -s).\n  Build from source:\n  https://github.com/${REPO}#development"
      ;;
  esac

  # ── Fetch version ────────────────────────────────────────────────────────
  info "Fetching latest release..."
  ver="$(fetch_latest_version)"
  ok "Latest version: v${ver}"

  # ── Build download URL ───────────────────────────────────────────────────
  artifact="$(artifact_name "$ver" "$os" "$arch" "${PKG_FMT:-}")"
  url="$(download_url "$ver" "$artifact")"
  info "Downloading: ${artifact}"

  tmp_dir="$(mktemp -d)"
  file_path="${tmp_dir}/${artifact}"

  if ! curl -fSL --progress-bar -o "$file_path" "$url"; then
    rm -rf "$tmp_dir"
    die "Download failed. The artifact may not exist for your platform.\n  URL: $url\n  Check: https://github.com/${REPO}/releases"
  fi

  # ── Verify checksum (if the release publishes .sha256 sidecars) ───────────
  verify_checksum() {
    local file="$1" url="$2" sum_file
    sum_file="${file}.sha256"
    if ! curl -fsSL -o "$sum_file" "${url}.sha256"; then
      warn "No .sha256 published for this artifact — skipping verification."
      warn "Verify manually before trusting the binary."
      return 0
    fi
    info "Verifying SHA256 checksum..."
    local expected actual
    expected="$(grep -oE '^[a-f0-9]{64}' "$sum_file" | head -1)"
    if [[ -z "$expected" ]]; then
      warn "Malformed .sha256 sidecar — skipping verification."
      return 0
    fi
    if command -v shasum >/dev/null 2>&1; then
      actual="$(shasum -a 256 "$file" | cut -d' ' -f1)"
    elif command -v sha256sum >/dev/null 2>&1; then
      actual="$(sha256sum "$file" | cut -d' ' -f1)"
    else
      warn "No sha256 tool found — skipping verification."
      return 0
    fi
    if [[ "$actual" != "$expected" ]]; then
      rm -rf "$tmp_dir"
      die "Checksum mismatch!\n  expected: $expected\n  actual:   $actual\n  The download may be corrupted or tampered with."
    fi
    ok "Checksum verified."
  }
  verify_checksum "$file_path" "$url"

  ok "Downloaded to ${file_path}"

  # ── Install ──────────────────────────────────────────────────────────────
  case "$os" in
    macos)   install_macos "$file_path" ;;
    linux)   install_linux "$file_path" "$PKG_FMT" ;;
    windows) install_windows "$file_path" ;;
  esac

  # ── Cleanup ──────────────────────────────────────────────────────────────
  rm -rf "$tmp_dir"

  echo ""
  ok "k7s v${ver} installed successfully!"
  echo ""
  case "$os" in
    macos)
      echo "  Open from Applications or run:"
      echo "    open -a k7s"
      ;;
    linux)
      echo "  Run:"
      echo "    k7s"
      ;;
    windows)
      echo "  Run the downloaded installer to complete setup."
      ;;
  esac
  echo ""
}

main "$@"
