//! Tauri commands invoked by the frontend. These are the only entry points from
//! the webview into Kubernetes. Live data (tables, metrics, status, logs) is
//! pushed back via events (see kube::events); these commands cover the one-shot
//! request/response operations plus starting/stopping log streams.

pub mod ai;
// Shared across desktop/android/ios — single source of truth.
pub mod ai_deep {
    include!("../../../k7s-commands/ai_deep.rs");
}
pub mod ai_extra {
    include!("../../../k7s-commands/ai_extra.rs");
}
pub mod core;
pub mod cron {
    include!("../../../k7s-commands/cron.rs");
}
pub mod forward {
    include!("../../../k7s-commands/forward.rs");
}
pub mod helm;
pub mod memory {
    include!("../../../k7s-commands/memory.rs");
}
pub mod observability {
    include!("../../../k7s-commands/observability.rs");
}
#[cfg(not(target_os = "android"))]
pub mod sbom {
    include!("../../../k7s-commands/sbom.rs");
}
#[cfg(not(target_os = "android"))]
pub mod scanner {
    include!("../../../k7s-commands/scanner.rs");
}
pub mod security {
    include!("../../../k7s-commands/security.rs");
}
pub mod shell {
    include!("../../../k7s-commands/shell.rs");
}
pub mod skills {
    include!("../../../k7s-commands/skills.rs");
}
pub mod storage;

// Re-export all commands so `commands::func` paths in lib.rs still work.
pub use ai::*;
pub use ai_deep::*;
pub use ai_extra::*;
pub use core::*;
pub use cron::*;
pub use forward::*;
pub use helm::*;
pub use memory::*;
pub use observability::*;
#[cfg(not(target_os = "android"))]
pub use sbom::*;
#[cfg(not(target_os = "android"))]
pub use scanner::*;
pub use security::*;
pub use shell::*;
pub use skills::*;
pub use storage::*;
