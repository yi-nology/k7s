//! axum server for the web shell.
//!
//! One binary, two modes, picked at startup:
//!
//! - **`--static <DIR>`** (the "server" mode): serves the built React app
//!   from `<DIR>` *and* the API on the same port. Bind to `0.0.0.0:8080`,
//!   hand the binary a `./dist` directory, and a single process is your
//!   cluster UI. No node, no vite, no reverse proxy required.
//!
//! - **no `--static`** (the "dev API" mode): serves only the API. Pair it
//!   with `npm run dev` (vite dev server, port 1420) which has its own
//!   `proxy` entry forwarding `/api/*` here. This is the workflow
//!   `dev/web.mjs` automates.
//!
//! Routes use the `/api/*` prefix unconditionally. That way the front-end's
//! `transport.ts` writes the same path in dev and prod — only the routing
//! (Vite proxy vs. nothing) differs.
//!
//! Every interesting operation goes through one of three paths:
//! - `POST /api/invoke/{cmd}` for one-shot commands.
//! - `GET /api/events` for the SSE stream of live data.
//! - `GET /health` for the dev script's readiness probe.
//! - `POST/GET/DELETE /mcp` for the Streamable HTTP MCP transport — the
//!   same tools the stdio `k7s-mcp` binary exposes, but reachable by
//!   network so AI clients on a different host can connect.

use axum::{
    routing::{get, post},
    Router,
};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use super::handlers;
use super::sse::events_handler;
use super::state::WebState;
use crate::mcp::K7sMcpServer;

/// Build the API router (no static files). Exposed so tests can drive it
/// with `tower::ServiceExt::oneshot` without needing a built `dist/`.
pub fn api_router(state: WebState) -> Router {
    // The MCP service factory: a *fresh* `K7sMcpServer` per session, so
    // each Streamable HTTP client gets its own `ClientManager` (and its
    // own connection state, port-forwards, shells). The factory closure
    // must be cheap — see the safety note on `StreamableHttpService` in
    // the rmcp docs.
    let mcp_service: StreamableHttpService<K7sMcpServer, LocalSessionManager> =
        StreamableHttpService::new(
            || {
                // Same wiring the stdio `k7s-mcp` binary uses, just inside
                // an HTTP request. The server carries its own
                // `Arc<CoreState>` (and thus its own `Arc<ClientManager>`)
                // — port-forwards and shells started by one Streamable
                // HTTP client are visible only to that client.
                //
                // The data dir is a per-session scratch; nothing writes to
                // it today (the MCP server has no prefs UI), but a future
                // per-session cache would land here.
                let data_dir =
                    std::env::temp_dir().join(format!("k7s-mcp-session-{}", std::process::id()));
                Ok(K7sMcpServer::new(data_dir))
            },
            Arc::new(LocalSessionManager::default()),
            // Stateful mode: the first `initialize` response carries an
            // `Mcp-Session-Id` header; subsequent requests echo it back
            // and the factory-built server (with its `Arc<CoreState>`)
            // stays alive for the whole session. Without stateful mode
            // every request is a fresh server — fine for read-only tools
            // but it makes `connect → list_resources` impossible to chain
            // in a single client turn.
            //
            // SSE keep-alive keeps idle connections from being torn down
            // by intermediate proxies while a long-running tool (e.g.
            // a streaming log tail) is mid-flight.
            StreamableHttpServerConfig {
                sse_keep_alive: Some(std::time::Duration::from_secs(15)),
                stateful_mode: true,
            },
        );

    Router::new()
        .route("/api/invoke/list_contexts", post(handlers::list_contexts))
        .route(
            "/api/invoke/default_kubeconfig_path",
            post(handlers::default_kubeconfig_path),
        )
        .route("/api/invoke/load_prefs", post(handlers::load_prefs))
        .route("/api/invoke/save_prefs", post(handlers::save_prefs))
        .route("/api/invoke/connect", post(handlers::connect))
        .route("/api/invoke/get_yaml", post(handlers::get_yaml))
        .route("/api/invoke/get_events", post(handlers::get_events))
        .route("/api/invoke/get_properties", post(handlers::get_properties))
        .route(
            "/api/invoke/get_secret_data",
            post(handlers::get_secret_data),
        )
        // Browser equivalent of the Tauri file-picker dialog: the user
        // picks a kubeconfig file in the browser, the front-end reads its
        // bytes and POSTs the contents here. See HttpProvider.importKubeconfig.
        .route(
            "/api/invoke/import_kubeconfig_content",
            post(handlers::import_kubeconfig_content),
        )
        // Mutation commands — same business logic as the Tauri shell, just
        // reachable over HTTP. Added in batches as the Tauri commands grew
        // their own contracts; the catch-all below still 501s anything we
        // haven't bridged.
        .route("/api/invoke/apply_yaml", post(handlers::apply_yaml))
        .route("/api/invoke/dry_run_yaml", post(handlers::dry_run_yaml))
        .route(
            "/api/invoke/dry_run_yaml_bundle",
            post(handlers::dry_run_yaml_bundle),
        )
        .route(
            "/api/invoke/delete_resource",
            post(handlers::delete_resource),
        )
        .route("/api/invoke/scale_resource", post(handlers::scale_resource))
        .route("/api/invoke/set_cordon", post(handlers::set_cordon))
        .route("/api/invoke/restart_pod", post(handlers::restart_pod))
        .route(
            "/api/invoke/restart_rollout",
            post(handlers::restart_rollout),
        )
        .route("/api/invoke/list_revisions", post(handlers::list_revisions))
        .route("/api/invoke/undo_rollout", post(handlers::undo_rollout))
        .route("/api/invoke/drain_node", post(handlers::drain_node))
        // Log streaming — the headline feature the previous 501 broke. Lines
        // flow through the same `EventSink` → SSE path the watchers use.
        .route(
            "/api/invoke/start_log_stream",
            post(handlers::start_log_stream),
        )
        .route(
            "/api/invoke/stop_log_stream",
            post(handlers::stop_log_stream),
        )
        .route("/api/invoke/export_logs", post(handlers::export_logs))
        // Interactive shells — exec over SSE, input/resize/stop as POSTs.
        // Same wire names as the Tauri commands so the front-end can swap
        // providers unchanged. `shell-out:{id}` / `shell-closed:{id}` events
        // come through the existing `/api/events` SSE stream.
        .route("/api/invoke/start_shell", post(handlers::start_shell))
        .route("/api/invoke/shell_input", post(handlers::shell_input))
        .route("/api/invoke/shell_resize", post(handlers::shell_resize))
        .route("/api/invoke/stop_shell", post(handlers::stop_shell))
        .route(
            "/api/invoke/start_node_shell",
            post(handlers::start_node_shell),
        )
        .route(
            "/api/invoke/stop_node_shell",
            post(handlers::stop_node_shell),
        )
        // EndpointSlices — for the topology graph.
        .route("/api/invoke/list_endpoints", post(handlers::list_endpoints))
        .route(
            "/api/invoke/list_endpoints_for_service",
            post(handlers::list_endpoints_for_service),
        )
        .route(
            "/api/invoke/list_endpoint_addresses",
            post(handlers::list_endpoint_addresses),
        )
        // Stubs for everything else.
        .route("/api/invoke/:cmd", post(handlers::not_implemented))
        // Connection banner polling. `GET` (no body) so a misbehaving client
        // can't accidentally trigger a state change by retrying.
        .route("/api/status", get(handlers::status))
        .route("/api/events", get(events_handler))
        .route("/api/health", get(|| async { "ok" }))
        .route("/health", get(|| async { "ok" }))
        .with_state(state)
        // The Streamable HTTP MCP transport. Same tools the stdio
        // `k7s-mcp` binary exposes, reachable by URL — point any modern
        // MCP client at `http://<host>:<port>/mcp` and you get the same
        // 29 tools. See `README.md` § "MCP server → Wire it into …" for
        // client configs. Mounted as a service (not a route) because the
        // transport handles GET / POST / DELETE internally per the MCP
        // Streamable HTTP spec.
        .merge(Router::new().nest_service("/mcp", mcp_service.clone()))
}

/// Build the full router. In server mode, layer the static-file service on
/// top: any path the API doesn't match falls through to `static_dir`, with
/// `index.html` as the catch-all so the front-end's client-side router can
/// take over.
pub fn router(state: WebState, static_dir: Option<PathBuf>) -> Router {
    let cors = CorsLayer::new()
        // Dev: Vite proxies through 1420 → 7180, so the browser sees one
        // origin. Prod: same origin (the server serves both). `Any` is
        // safe because the server only listens on localhost or a private
        // network; tighten in a hostile environment.
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let api = api_router(state);
    let mut app = api.layer(TraceLayer::new_for_http()).layer(cors);

    if let Some(dir) = static_dir {
        // `ServeDir` looks up files inside `dir` and falls through to the
        // `not_found` service for misses — we set that to `index.html` so
        // the front-end's router can claim the URL. This makes the server
        // mode feel exactly like a real SPA host.
        let serve_dir =
            ServeDir::new(&dir).not_found_service(ServeFile::new(dir.join("index.html")));
        // Merge: the API routes are tried first (their paths are
        // more specific), and any unmatched path falls back to `serve_dir`.
        app = app.fallback_service(serve_dir);
    }

    app
}

/// Bind to `addr` and serve until the process is asked to stop. The
/// `axum::serve` future resolves only on graceful shutdown; for now we let
/// it run until SIGINT.
pub async fn serve(
    addr: SocketAddr,
    state: WebState,
    static_dir: Option<PathBuf>,
) -> std::io::Result<()> {
    let mode = if static_dir.is_some() {
        "server"
    } else {
        "dev-api"
    };
    tracing::info!("k7s-web ({mode}) listening on http://{addr} (MCP: /mcp)");
    let app = router(state, static_dir);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await
}
