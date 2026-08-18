//! Macros to reduce boilerplate in Tauri commands.

/// Macro for simple commands that only need CoreState access.
/// Example: core_command!(list_contexts, state, { state.manager.list_contexts().await })
#[macro_export]
macro_rules! core_command {
    ($name:ident, $state:ident, $body:expr) => {
        #[tauri::command]
        pub async fn $name($state: $crate::tauri::State<'_, std::sync::Arc<$crate::core::CoreState>>) -> $crate::error::AppResult<_> {
            $body
        }
    };
}

/// Macro for commands with additional parameters and CoreState access.
/// Example: core_command_with!(connect, state, context: String, { state.manager.connect(&context).await })
#[macro_export]
macro_rules! core_command_with {
    ($name:ident, $state:ident, $($param:ident : $ptype:ty),+ , $body:expr) => {
        #[tauri::command]
        pub async fn $name(
            $($param : $ptype,)+
            $state: $crate::tauri::State<'_, std::sync::Arc<$crate::core::CoreState>>,
        ) -> $crate::error::AppResult<_> {
            $body
        }
    };
}

/// Macro for commands that need both CoreState and AiRuntime access.
/// Example: ai_command!(ai_chat, state, runtime, { ... })
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

/// Macro for AI commands with additional parameters.
/// Example: ai_command_with!(ai_chat, state, runtime, run_id: String, { ... })
#[macro_export]
macro_rules! ai_command_with {
    ($name:ident, $state:ident, $runtime:ident, $($param:ident : $ptype:ty),+ , $body:expr) => {
        #[tauri::command]
        pub async fn $name(
            $($param : $ptype,)+
            $state: $crate::tauri::State<'_, std::sync::Arc<$crate::core::CoreState>>,
            $runtime: $crate::tauri::State<'_, std::sync::Arc<$crate::commands::ai::AiRuntime>>,
        ) -> $crate::error::AppResult<_> {
            $body
        }
    };
}

/// Macro for common error handling patterns.
/// Example: try_or_err!(result, "operation failed")
#[macro_export]
macro_rules! try_or_err {
    ($expr:expr, $msg:expr) => {
        $expr.map_err(|e| $crate::error::AppError::Other(format!("{}: {}", $msg, e)))?
    };
    ($expr:expr) => {
        $expr.map_err(|e| $crate::error::AppError::Other(e.to_string()))?
    };
}

/// Macro for common error handling with context.
/// Example: try_or_err_with!(result, || "no config dir")
#[macro_export]
macro_rules! try_or_err_with {
    ($expr:expr, $msg_fn:expr) => {
        $expr.map_err(|e| $crate::error::AppError::Other(format!("{}: {}", $msg_fn(), e)))?
    };
}
