# k7s-server

k7s 的 HTTP 服务器 + MCP 服务器，从 `k7s-desktop` 抽取而来。

## 依赖关系

```
k7s-deps (共享依赖)
  └─ k7s-core (业务逻辑)
       └─ k7s-server (本项目: web + MCP server)
            ├─ k7s (Docker 构建)
            └─ k7s-desktop (Tauri 桌面)
```

## 包含内容

- `src/web/` — Axum HTTP 服务器 (SSE, auth, handlers)
- `src/mcp/` — MCP 服务器 (stdio + Streamable HTTP)
- `src/bin/k7s-web.rs` — Web 服务器入口
- `src/bin/k7s-mcp.rs` — MCP 服务器入口

## 构建

```bash
# Web 服务器二进制 (带嵌入式前端)
cargo build --release --features web --bin k7s-web

# MCP 服务器二进制
cargo build --release --features mcp --bin k7s-mcp
```

## Docker 构建

```bash
# 从父目录 (包含 k7s-server, k7s-core, k7s-deps, dist/)
docker build -t ghcr.io/yi-nology/k7s:latest -f k7s-server/Dockerfile .
```
