# k7s-deps

Shared dependencies for k7s project.

## Purpose

This crate re-exports common dependencies used across k7s platform shells (desktop, iOS, Android) to ensure version consistency and reduce duplication.

## Usage

Add to your `Cargo.toml`:

```toml
[dependencies]
k7s-deps = { git = "https://github.com/yi-nology/k7s-deps.git" }
```

Then use the re-exported dependencies:

```rust
use k7s_deps::reqwest::Client;
use k7s_deps::serde::{Deserialize, Serialize};
use k7s_deps::tokio::sync::Mutex;
```

## Dependencies

- HTTP: reqwest
- Serialization: serde, serde_json, serde_yaml
- Async: tokio, futures, tokio-stream, async-stream, async-trait
- Kubernetes: kube, k8s-openapi
- Error handling: thiserror, anyhow
- Logging: tracing, tracing-subscriber
- Time: chrono, jiff
- Utilities: uuid, keyring, urlencoding, regex, rand, dirs, dunce, http, base64, flate2, rustls
