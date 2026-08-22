# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the k7s-web single-binary server.
#
# Produces a musl-linked static binary (no glibc dependency).
# The runtime image is alpine-based (~12 MB total).
#
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
# Multi-arch build:
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     -t ghcr.io/yi-nology/k7s:latest \
#     -f k7s-server/Dockerfile .
#
# Or use CI which arranges the directory structure.

# ─────────────────────────────────────────────────────────────────
# Stage 1 — front-end (pre-built in CI or local build)
# ─────────────────────────────────────────────────────────────────
FROM alpine:3.21 AS frontend
COPY dist /dist

# ─────────────────────────────────────────────────────────────────
# Stage 2 — Rust binary (musl static, multi-arch)
# ─────────────────────────────────────────────────────────────────
FROM rust:1-bookworm AS backend

ARG TARGETARCH

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      musl-tools \
      pkg-config libssl-dev ca-certificates \
      build-essential file \
 && rm -rf /var/lib/apt/lists/*

# Install the correct musl target for the build platform.
RUN case "${TARGETARCH}" in \
      amd64) rustup target add x86_64-unknown-linux-musl ;; \
      arm64) rustup target add aarch64-unknown-linux-musl ;; \
      *) echo "unsupported arch: ${TARGETARCH}" && exit 1 ;; \
    esac

WORKDIR /src

# Copy dependency manifests first for layer caching.
COPY k7s-server/Cargo.toml k7s-server/Cargo.lock ./k7s-server/
COPY k7s-core/Cargo.toml k7s-core/Cargo.lock ./k7s-core/
COPY k7s-deps/Cargo.toml k7s-deps/Cargo.lock ./k7s-deps/

# Stub sources so cargo fetch can resolve the dependency graph.
# Note: k7s-server has no src/main.rs (bins are in src/bin/), but cargo fetch
# needs at least one source file to resolve the dependency graph.
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
# rust-embed #[folder = "../dist"]] is relative to Cargo.toml (k7s-server/),
# so it looks for /src/dist/ — copy the frontend there.
COPY dist ./dist

# Determine the correct Rust target triple for the build platform.
# Build a static musl binary — no glibc dependency at runtime.
RUN ARCH_TRIPLE=$(case "${TARGETARCH}" in \
          amd64) echo "x86_64-unknown-linux-musl" ;; \
          arm64) echo "aarch64-unknown-linux-musl" ;; \
        esac) \
 && cd k7s-server \
 && cargo build --release \
      --features web --bin k7s-web \
      --target "${ARCH_TRIPLE}" \
 && cp "target/${ARCH_TRIPLE}/release/k7s-web" /k7s-web

# ─────────────────────────────────────────────────────────────────
# Stage 3 — runtime (minimal, no glibc)
# ─────────────────────────────────────────────────────────────────
FROM alpine:3.21 AS runtime

RUN addgroup -S k7s && adduser -S -G k7s -h /home/k7s k7s \
 && mkdir -p /home/k7s /data && chown -R k7s:k7s /home/k7s /data

USER k7s:k7s
WORKDIR /app

COPY --from=backend --chown=k7s:k7s /k7s-web /app/k7s-web
COPY --from=frontend --chown=k7s:k7s /dist /app/dist

ENV XDG_CONFIG_HOME=/data
ENV KUBECONFIG=/home/k7s/.kube/config
ENV RUST_LOG=info

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1

ENTRYPOINT ["/app/k7s-web"]
CMD ["--addr", "0.0.0.0:8080", "--static", "/app/dist", "--no-tray", "--no-open"]
