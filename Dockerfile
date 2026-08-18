# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the k7s-web single-binary server.
#
#   - Stage 1 holds the pre-built React front-end (dist/).
#     Build the frontend first with: pnpm build
#   - Stage 2 builds the Rust binary with --features web so the axum
#     router and the /mcp Streamable HTTP endpoint are linked in.
#   - Stage 3 is the runtime: debian:bookworm-slim with only runtime
#     libraries (GTK3, WebKit, etc.). The image runs as a non-root user.
#
# Build:
#   pnpm build  # Build frontend first
#   docker build -t ghcr.io/zy84338719/k7s:latest .
#
# Run:
#   docker run --rm -p 8080:8080 \
#     -v $HOME/.kube/config:/home/k7s/.kube/config:ro \
#     -e KUBECONFIG=/home/k7s/.kube/config \
#     ghcr.io/zy84338719/k7s:latest
#
# Or use docker compose.

# ─────────────────────────────────────────────────────────────────
# Stage 1 — front-end (pre-built in CI or local build)
# ─────────────────────────────────────────────────────────────────
# The frontend is pre-built outside Docker to avoid esbuild
# cross-platform issues. Use a minimal alpine image just to
# hold the dist/ files.
FROM alpine:3.19 AS frontend
COPY dist /dist

# ─────────────────────────────────────────────────────────────────
# Stage 2 — Rust binary
# ─────────────────────────────────────────────────────────────────
# `rust:1-bookworm` tracks the latest stable 1.x, matching CI's
# `dtolnay/rust-toolchain@stable`. (Previously `rust:1.97`, which is a
# future/non-existent tag as of 2026-08.) Satisfies rust-version = 1.77.2.
FROM rust:1-bookworm AS backend

# System deps. Bookworm's base image already has gcc/make/cmake,
# but we need the Tauri webview toolchain because tauri 2's default
# `wry` feature pulls webkit2gtk into the link graph even when
# k7s-web doesn't use it at runtime (k7s-web is a server binary,
# no UI). Without these apt packages, the build dies with:
#
#   The system library `gdk-3.0` required by crate `gdk-sys`
#   was not found.
#   Package gdk-3.0 was not found in the pkg-config search path.
#
# Keep this list in lock-step with the GitHub Actions release
# workflow's 'install Linux system deps' step.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      pkg-config libssl-dev ca-certificates \
      build-essential file \
      libwebkit2gtk-4.1-dev \
      libsoup-3.0-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      libxdo-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Cache the dependency graph first. Copying only Cargo.{toml,lock}
# lets Docker cache the registry + sccache layer even when src/* changes.
COPY Cargo.toml Cargo.lock ./
# Stub the source so `cargo fetch` can resolve the [lib] / [[bin]] targets
# declared in Cargo.toml without us having to copy src/ yet.
RUN mkdir -p src \
 && echo "fn main() {}" > src/main.rs \
 && echo "" > src/lib.rs \
 && cargo fetch

# Now the real source. Copy dist/ for rust-embed to embed frontend assets.
# The #[folder = "../dist"] in the code expects dist/ at the parent of the
# crate root, so we create a symlink.
COPY tauri.conf.json ./
COPY src ./src
COPY build.rs ./
COPY dist ./dist
RUN mkdir -p ../dist && cp -r dist/* ../dist/

# Release build with the `web` feature. Strip symbols to shave a few MB.
RUN cargo build --release \
      --features web --bin k7s-web \
 && strip target/release/k7s-web

# ─────────────────────────────────────────────────────────────────
# Stage 3 — runtime
# ─────────────────────────────────────────────────────────────────
# Use debian:bookworm-slim instead of distroless because k7s-web
# requires GTK3 libraries (libgdk-3.0, libgtk-3.0) at runtime.
# distroless only carries libc + ca-certificates, which is too minimal.
FROM debian:bookworm-slim AS runtime

# Install only the runtime libraries needed by k7s-web.
# No -dev packages, no compilers — just the shared objects.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      libgtk-3-0 \
      libwebkit2gtk-4.1-0 \
      libsoup-3.0-0 \
      libayatana-appindicator3-1 \
      librsvg2-2 \
      libssl3 \
      libxdo3 \
 && rm -rf /var/lib/apt/lists/*

# Create a non-root user for security.
RUN groupadd -r k7s && useradd -r -g k7s -d /home/k7s -s /sbin/nologin k7s \
 && mkdir -p /home/k7s /data && chown -R k7s:k7s /home/k7s /data

USER k7s:k7s
WORKDIR /app

# Copy the binary and the built front-end. The binary's --static flag
# points at /app/dist (see CMD below).
COPY --from=backend --chown=k7s:k7s /src/src-tauri/target/release/k7s-web /app/k7s-web
COPY --from=frontend --chown=k7s:k7s /dist /app/dist

# Where k7s-web persists per-user prefs (XDG_CONFIG_HOME/k7s).
ENV XDG_CONFIG_HOME=/data
ENV KUBECONFIG=/home/k7s/.kube/config
ENV RUST_LOG=info

# /data: persistent prefs.json
# /home/k7s/.kube: the host's kubeconfig (mount via -v or compose)
VOLUME ["/data"]
EXPOSE 8080

# Server mode: serve both the API and the static React app on one port.
# --no-tray disables the system tray icon (no display in container).
# --no-open disables auto-opening the browser.
#
# SECURITY: k7s-web has NO built-in authentication. Binding 0.0.0.0 inside the
# container is fine because the host port mapping (docker-compose.yml) defaults
# to 127.0.0.1, so the control plane is loopback-only unless you opt in. If you
# expose it on the network, put it behind an authenticating reverse proxy.
ENTRYPOINT ["/app/k7s-web"]
CMD ["--addr", "0.0.0.0:8080", "--static", "/app/dist", "--no-tray", "--no-open"]
