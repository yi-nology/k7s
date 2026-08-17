# k7s-core

Transport-agnostic Kubernetes business logic extracted from the k7s project.

This crate contains the core logic for managing Kubernetes resources, AI integration, and event handling without being tied to any specific UI framework (Tauri, web, etc.).

## Features

- `tauri` - Enable Tauri-specific event sink support
- `mcp` - Enable MCP (Model Context Protocol) server support

## Usage

Add to your `Cargo.toml`:

```toml
[dependencies]
k7s-core = { path = "../crates/k7s-core" }
```

For Tauri integration:

```toml
[dependencies]
k7s-core = { path = "../crates/k7s-core", features = ["tauri"] }
```
