//! Macros to reduce boilerplate in Tauri commands.

/// Macro for commands that need CoreState access.
/// Reduces repetitive `state: State<'_, Arc<CoreState>>` patterns.
#[macro_export]
macro_rules! core_command {
    ($name:ident, $state:ident, $body:expr) => {
        #[tauri::command]
        pub async fn $name($state: $crate::tauri::State<'_, std::sync::Arc<$crate::core::CoreState>>) -> $crate::error::AppResult<_> {
            $body
        }
    };
}

/// Macro for commands that need both CoreState and AiRuntime access.
#[macro_export]
macro_rules! ai_command {
    ($name:ident, $state:ident, $runtime:ident, $body:expr) => {
        #[tauri::command]
        pub async fn $name(
            $state: $crate::tauri::State<'_, std::sync::Arc<$crate::core::CoreState>>,
            $runtime: $crate::tauri::State<'_, std::sync::Arc<$crate::commands::ai::AiRuntime>>,
        ) -> $crate::error::AppResult<_> {
            $body
        }
    };
}

/// Macro for common error handling patterns.
#[macro_export]
macro_rules! try_or_err {
    ($expr:expr, $msg:expr) => {
        $expr.map_err(|e| $crate::error::AppError::Other(format!("{}: {}", $msg, e)))?
    };
    ($expr:expr) => {
        $expr.map_err(|e| $crate::error::AppError::Other(e.to_string()))?
    };
}
