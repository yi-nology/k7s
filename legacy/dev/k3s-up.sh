#!/usr/bin/env bash
#
# dev/k3s-up.sh — bring up a throwaway local cluster for k7s development.
#
# Two paths are supported, in order of preference:
#   1) k3d  — runs k3s in Docker; fastest startup, best on macOS / Linux.
#   2) kind — runs the cluster as Docker containers; works on every host
#              that has Docker, including CI runners.
#   3) k3s  — installs k3s as a system service; the most "real" setup, but
#              needs root and ties up a host port.
#
# Usage:
#   ./dev/k3s-up.sh           # create cluster "k7s-dev" if missing
#   ./dev/k3s-up.sh down      # destroy the cluster
#   ./dev/k3s-up.sh status    # show current cluster info
#   ./dev/k3s-up.sh kc        # print the kubeconfig path
#
# Once the cluster is up, the kubeconfig lives at
# `~/.kube/k7s-dev.kubeconfig` (k3d) or the default `~/.kube/config` (k3s).
# Point k7s at it via:
#   pnpm tauri:dev
#   # in the UI: Cluster switcher → "Import kubeconfig" → pick the file

set -euo pipefail

CLUSTER_NAME="${K7S_CLUSTER:-k7s-dev}"
KUBECONFIG_OUT="${HOME}/.kube/${CLUSTER_NAME}.kubeconfig"
K3S_INSTALL_URL="${K3S_INSTALL_URL:-https://get.k3s.io}"

log()  { printf "\033[1;34m[k7s-up]\033[0m %s\n" "$*" >&2; }
warn() { printf "\033[1;33m[k7s-up]\033[0m %s\n" "$*" >&2; }
die()  { printf "\033[1;31m[k7s-up]\033[0m %s\n" "$*" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"
}

# -----------------------------------------------------------------
# Pick a backend
# -----------------------------------------------------------------

backend=""
detect_backend() {
  if command -v k3d >/dev/null 2>&1; then
    backend="k3d"
  elif command -v kind >/dev/null 2>&1 && command -v docker >/dev/null 2>&1; then
    backend="kind"
  elif command -v k3s >/dev/null 2>&1; then
    backend="k3s"
  fi
}

up_k3d() {
  log "Using k3d backend"
  need k3d
  need docker
  if k3d cluster get "$CLUSTER_NAME" >/dev/null 2>&1; then
    log "cluster '$CLUSTER_NAME' already exists; reusing"
  else
    log "creating k3d cluster '$CLUSTER_NAME'"
    k3d cluster create "$CLUSTER_NAME" \
      --port 6443:6443@server:0 \
      --wait
  fi
  mkdir -p "$(dirname "$KUBECONFIG_OUT")"
  k3d kubeconfig get "$CLUSTER_NAME" > "$KUBECONFIG_OUT"
  chmod 600 "$KUBECONFIG_OUT"
}

up_kind() {
  log "Using kind backend"
  need kind
  need docker
  if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
    log "cluster '$CLUSTER_NAME' already exists; reusing"
  else
    log "creating kind cluster '$CLUSTER_NAME'"
    kind create cluster --name "$CLUSTER_NAME" --wait 60s
  fi
  mkdir -p "$(dirname "$KUBECONFIG_OUT")"
  kind get kubeconfig --name "$CLUSTER_NAME" > "$KUBECONFIG_OUT"
  chmod 600 "$KUBECONFIG_OUT"
}

up_k3s() {
  log "Using k3s backend"
  need k3s
  if systemctl is-active --quiet k3s 2>/dev/null; then
    log "k3s service already running; reusing"
  else
    warn "k3s needs root to install as a system service."
    warn "If you don't want to install it, use k3d or kind instead."
    if [ "$(id -u)" -ne 0 ]; then
      die "k3s install needs root; rerun with sudo or install k3d/kind"
    fi
    log "installing k3s via $K3S_INSTALL_URL"
    curl -sfL "$K3S_INSTALL_URL" | sh -
  fi
  # k3s writes its kubeconfig to /etc/rancher/k3s/k3s.yaml; export a copy
  # under the user's kube dir so k7s can find it without root.
  if [ -f /etc/rancher/k3s/k3s.yaml ]; then
    mkdir -p "$(dirname "$KUBECONFIG_OUT")"
    sed 's/127\.0\.0\.1/127.0.0.1/g' /etc/rancher/k3s/k3s.yaml > "$KUBECONFIG_OUT"
    chmod 600 "$KUBECONFIG_OUT"
  fi
}

down_k3d() {
  need k3d
  if k3d cluster get "$CLUSTER_NAME" >/dev/null 2>&1; then
    log "deleting k3d cluster '$CLUSTER_NAME'"
    k3d cluster delete "$CLUSTER_NAME"
  else
    log "k3d cluster '$CLUSTER_NAME' not present"
  fi
  rm -f "$KUBECONFIG_OUT"
}

down_kind() {
  need kind
  if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
    log "deleting kind cluster '$CLUSTER_NAME'"
    kind delete cluster --name "$CLUSTER_NAME"
  else
    log "kind cluster '$CLUSTER_NAME' not present"
  fi
  rm -f "$KUBECONFIG_OUT"
}

down_k3s() {
  if [ "$(id -u)" -ne 0 ]; then
    die "k3s teardown needs root; rerun with sudo"
  fi
  if systemctl is-active --quiet k3s 2>/dev/null; then
    log "stopping and disabling k3s service"
    systemctl disable --now k3s
    rm -f "$KUBECONFIG_OUT"
  else
    log "k3s service not running"
  fi
}

# -----------------------------------------------------------------
# Dispatch
# -----------------------------------------------------------------

action="${1:-up}"
detect_backend
[ -z "$backend" ] && die "no backend found: install one of k3d, kind (with docker), or k3s"

case "$action" in
  up)
    case "$backend" in
      k3d)  up_k3d  ;;
      kind) up_kind ;;
      k3s)  up_k3s  ;;
    esac
    log "cluster ready. Kubeconfig: $KUBECONFIG_OUT"
    log "next: launch k7s (pnpm tauri:dev) and import the kubeconfig above."
    ;;
  down)
    case "$backend" in
      k3d)  down_k3d  ;;
      kind) down_kind ;;
      k3s)  down_k3s  ;;
    esac
    log "cluster torn down"
    ;;
  status)
    case "$backend" in
      k3d)  k3d cluster list 2>/dev/null || true ;;
      kind) kind get clusters 2>/dev/null || true ;;
      k3s)  systemctl is-active k3s 2>/dev/null || true ;;
    esac
    ;;
  kc)
    echo "$KUBECONFIG_OUT"
    ;;
  *)
    die "unknown action: $action (use up | down | status | kc)"
    ;;
esac
