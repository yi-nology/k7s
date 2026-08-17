//! Macros to reduce boilerplate in MCP tool implementations.

/// Macro for MCP tools that need manager access and return JSON results.
#[macro_export]
macro_rules! mcp_json_tool {
    ($name:ident, $params:ty, $body:expr) => {
        async fn $name(
            &self,
            Parameters(p): Parameters<$params>,
        ) -> Result<CallToolResult, McpError> {
            let result = $body(&self.manager(), p).await.map_err(tool_error)?;
            json_result(&result)
        }
    };
}

/// Macro for MCP tools that need manager access and return text results.
#[macro_export]
macro_rules! mcp_text_tool {
    ($name:ident, $params:ty, $body:expr) => {
        async fn $name(
            &self,
            Parameters(p): Parameters<$params>,
        ) -> Result<CallToolResult, McpError> {
            let result = $body(&self.manager(), p).await.map_err(tool_error)?;
            Ok(CallToolResult::success(vec![ContentBlock::text(result)]))
        }
    };
}

/// Macro for common error handling in MCP tools.
#[macro_export]
macro_rules! tool_try {
    ($expr:expr) => {
        $expr.map_err(tool_error)?
    };
    ($expr:expr, $msg:expr) => {
        $expr.map_err(|e| tool_error(format!("{}: {}", $msg, e)))?
    };
}
