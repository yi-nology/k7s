# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the k7s-web single-binary server.
#
#   - Stage 1 builds the React front-end (pnpm + Vite) into dist/.
#   - Stage 2 builds the Rust binary with --features web so the axum
#     router and the /mcp Streamable HTTP endpoint are linked in.
#   - Stage 3 is the runtime: distroless cc-debian12 carries only libc
#     + ca-certificates, no shell, no package manager. The image runs
#     as a non-root user.
#
# Build:
#   docker build -t ghcr.io/zy84338719/k7s:latest .
#
# Run:
#   docker run --rm -p 8080:8080 \
#     -v $HOME/.kube/config:/home/k7s/.kube/config:ro \
#     -e KUBECONFIG=/home/k7s/.kube/config \
#     ghcr.io/zy84338719/k7s:latest
#
# Or use docker compose (see docker-compose.yml in this repo).

# ─────────────────────────────────────────────────────────────────
# Stage 1 — front-end
# ─────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS frontend
WORKDIR /src

# Cache pnpm install: copy lockfile + package.json first so unchanged
# deps don't get re-resolved.
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && corepack prepare pnpm@9 --activate \
 && pnpm install --frozen-lockfile

# Build the React app. The Vite output goes to dist/, which Stage 2
# ignores and Stage 3 copies into the final image.
COPY . .
RUN pnpm build

# ─────────────────────────────────────────────────────────────────
# Stage 2 — Rust binary
# ─────────────────────────────────────────────────────────────────
FROM rust:1.83-bookworm AS backend

# System deps the build needs (libssl for reqwest HTTPS, libgit2 for
# kube git source, etc.). Bookworm's base image already has gcc/make/cmake.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      pkg-config libssl-dev ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Cache the dependency graph first. Copying only Cargo.{toml,lock}
# lets Docker cache the registry + sccache layer even when src/* changes.
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock ./src-tauri/
RUN mkdir -p src-tauri/src \
 && echo "fn main() {}" > src-tauri/src/main.rs \
 && echo "" > src-tauri/src/lib.rs \
 && cd src-tauri && cargo fetch

# Now the real source. Vite's dist/ is in the build context but isn't
# needed here — Stage 1 produced it and Stage 3 will copy it.
COPY src-tauri ./src-tauri

# Release build with the `web` feature. `--locked` makes cargo fail
# rather than silently update Cargo.lock. Strip symbols to shave a few MB.
RUN cd src-tauri \
 && cargo build --release --locked \
      --features web --bin k7s-web \
 && strip target/release/k7s-web

# ─────────────────────────────────────────────────────────────────
# Stage 3 — runtime
# ─────────────────────────────────────────────────────────────────
# distroless/cc-debian12 carries libc + ca-certificates but no shell.
# If you need to `docker exec` into the container for debugging, swap
# this for `debian:bookworm-slim` and add a USER root step.
FROM gcr.io/distroless/cc-debian12:nonroot AS runtime

# Run as the pre-baked nonroot user (uid 65532).
USER nonroot:nonroot
WORKDIR /app

# Copy the binary and the built front-end. The binary's --static flag
# points at /app/dist (see CMD below).
COPY --from=backend --chown=nonroot:nonroot /src/src-tauri/target/release/k7s-web /app/k7s-web
COPY --from=frontend --chown=nonroot:nonroot /src/dist /app/dist

# Where k7s-web persists per-user prefs (XDG_CONFIG_HOME/k7s).
ENV XDG_CONFIG_HOME=/data
ENV KUBECONFIG=/home/k7s/.kube/config
ENV RUST_LOG=info

# /data: persistent prefs.json
# /home/k7s/.kube: the host's kubeconfig (mount via -v or compose)
VOLUME ["/data"]
EXPOSE 8080

# Quick TCP-level liveness. k7s-web itself doesn't expose /healthz,
# but the axum router is listening on this port, so a successful
# connect is enough to know the process is up.
HEALTHCHECK --interval=30s --timeout=3s --retries=3 --start-period=10s \
  CMD ["/app/k7s-web", "--help"]

# Server mode: serve both the API and the static React app on one port.
# Override with --addr 127.0.0.1:7180 if you want API-only.
ENTRYPOINT ["/app/k7s-web"]
CMD ["--addr", "0.0.0.0:8080", "--static", "/app/dist"]
