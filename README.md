# k7s-commands

Shared Tauri command files for the k7s project, included via `include!()` by the platform crates (`k7s-desktop`, `k7s-android`, `k7s-ios`).

## Why a shared directory?

The three platform shells (desktop, Android, iOS) register nearly identical `#[tauri::command]` functions. Rather than maintaining three copies of each file, the shared commands live here and are pulled into each platform crate's module tree via `include!()`.

Platform-specific differences (feature gating, `cfg` attributes) are handled inline with `#[cfg(target_os = "...")]`.

## Files

| File | Platforms | Description |
|---|---|---|
| `shell.rs` | desktop, android, ios | Interactive shell sessions in pods and node debug shells |
| `forward.rs` | desktop, android, ios | Pod and Service port-forwarding |
| `observability.rs` | desktop, android, ios | Metrics, Grafana (cfg-gated on iOS), AlertManager, Loki, saved queries |
| `ai_deep.rs` | desktop, android | Evolution, sandbox, knowledge sync |
| `ai_extra.rs` | desktop, android | Embedded models, browser tools, sessions |
| `cron.rs` | desktop, android | AI cron scheduler |
| `memory.rs` | desktop, android | Four-tier cluster memory / knowledge base |
| `skills.rs` | desktop, android | Skill market |
| `security.rs` | desktop, android | RBAC audit, permission matrix |
| `sbom.rs` | desktop, android (cfg-gated) | SBOM generation, history, export |
| `scanner.rs` | desktop, android (cfg-gated) | Scanner engine status |

## Usage

In a platform crate's `commands/mod.rs`:

```rust
pub mod shell {
    include!("../../../k7s-commands/shell.rs");
}
```

For platform-gated modules:

```rust
#[cfg(not(target_os = "android"))]
pub mod sbom {
    include!("../../../k7s-commands/sbom.rs");
}
```

## Important notes

- Files use `//!` → `//` for top-level doc comments (required by `include!()` inside `pub mod {}` blocks)
- All imports use fully-qualified `k7s_deps::foo::bar` paths for cross-platform compatibility
- `crate::` paths work because the code is included into the platform crate's module tree
