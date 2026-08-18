# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the k7s-web single-binary server.
#
# Builds the k7s-web binary from k7s-server with --features web.
# Expects the build context to contain:
#   - k7s-server/  (this crate)
#   - k7s-core/    (path dependency)
#   - k7s-deps/    (path dependency)
#   - dist/        (pre-built frontend)
#
# Build (from the parent directory containing all repos):
#   docker build -t ghcr.io/yi-nology/k7s:latest \
#     -f k7s-server/Dockerfile .
#
# Or use CI which arranges the directory structure.

# ─────────────────────────────────────────────────────────────────
# Stage 1 — front-end (pre-built in CI or local build)
# ─────────────────────────────────────────────────────────────────
FROM alpine:3.19 AS frontend
COPY dist /dist

# ─────────────────────────────────────────────────────────────────
# Stage 2 — Rust binary
# ─────────────────────────────────────────────────────────────────
FROM rust:1-bookworm AS backend

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

# Copy dependency manifests first for layer caching.
COPY k7s-server/Cargo.toml k7s-server/Cargo.lock ./k7s-server/
COPY k7s-core/Cargo.toml k7s-core/Cargo.lock ./k7s-core/
COPY k7s-deps/Cargo.toml k7s-deps/Cargo.lock ./k7s-deps/

# Stub sources so cargo fetch can resolve the dependency graph.
RUN mkdir -p k7s-server/src k7s-core/src k7s-deps/src \
 && echo "fn main() {}" > k7s-server/src/main.rs \
 && echo "pub fn dummy() {}" > k7s-server/src/lib.rs \
 && echo "pub fn dummy() {}" > k7s-core/src/lib.rs \
 && echo "pub fn dummy() {}" > k7s-deps/src/lib.rs \
 && cd k7s-server && cargo fetch

# Copy real source.
COPY k7s-server/src ./k7s-server/src
COPY k7s-core/src ./k7s-core/src
COPY k7s-deps/src ./k7s-deps/src
COPY dist ./k7s-server/dist

# Release build with the `web` feature.
RUN cd k7s-server \
 && cargo build --release \
      --features web --bin k7s-web \
 && strip target/release/k7s-web

# ─────────────────────────────────────────────────────────────────
# Stage 3 — runtime
# ─────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

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

RUN groupadd -r k7s && useradd -r -g k7s -d /home/k7s -s /sbin/nologin k7s \
 && mkdir -p /home/k7s /data && chown -R k7s:k7s /home/k7s /data

USER k7s:k7s
WORKDIR /app

COPY --from=backend --chown=k7s:k7s /src/k7s-server/target/release/k7s-web /app/k7s-web
COPY --from=frontend --chown=k7s:k7s /dist /app/dist

ENV XDG_CONFIG_HOME=/data
ENV KUBECONFIG=/home/k7s/.kube/config
ENV RUST_LOG=info

VOLUME ["/data"]
EXPOSE 8080

ENTRYPOINT ["/app/k7s-web"]
CMD ["--addr", "0.0.0.0:8080", "--static", "/app/dist", "--no-tray", "--no-open"]
