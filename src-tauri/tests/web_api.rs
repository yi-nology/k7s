//! Integration tests for the web API.
//!
//! Uses `tower::ServiceExt::oneshot` to drive the axum router in-process
//! without starting a real TCP server.
//!
//! Run with:
//!   cargo test --features web --test web_api

#![cfg(feature = "web")]

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt; // for .oneshot()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Create a WebState with a temp directory.
fn make_state() -> k7s_lib::web::state::WebState {
    let dir = std::env::temp_dir().join(format!("k7s-test-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    k7s_lib::web::state::WebState::new(dir, "127.0.0.1:0".parse().unwrap())
}

/// Get the auth token from state.
fn auth_token(state: &k7s_lib::web::state::WebState) -> &str {
    &state.web_token
}

/// Extract response body as string.
async fn body_string(response: axum::response::Response) -> String {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Extract response body as JSON value.
async fn body_json(response: axum::response::Response) -> serde_json::Value {
    let s = body_string(response).await;
    serde_json::from_str(&s).unwrap_or(serde_json::Value::Null)
}

// ---------------------------------------------------------------------------
// Health endpoints
// ---------------------------------------------------------------------------

#[tokio::test]
async fn health_endpoint_returns_ok() {
    let state = make_state();
    let app = k7s_lib::web::server::api_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = body_string(response).await;
    assert_eq!(body, "ok");
}

#[tokio::test]
async fn api_health_endpoint_returns_ok() {
    let state = make_state();
    let app = k7s_lib::web::server::api_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = body_string(response).await;
    assert_eq!(body, "ok");
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

#[tokio::test]
async fn protected_endpoint_without_token_returns_401() {
    let state = make_state();
    let app = k7s_lib::web::server::api_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/invoke/list_contexts")
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn protected_endpoint_with_wrong_token_returns_401() {
    let state = make_state();
    let app = k7s_lib::web::server::api_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/invoke/list_contexts")
                .method("POST")
                .header("content-type", "application/json")
                .header(header::AUTHORIZATION, "Bearer wrong-token")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn protected_endpoint_with_valid_token_returns_ok() {
    let state = make_state();
    let token = auth_token(&state).to_string();
    let app = k7s_lib::web::server::api_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/invoke/list_contexts")
                .method("POST")
                .header("content-type", "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

// ---------------------------------------------------------------------------
// Public endpoints bypass auth
// ---------------------------------------------------------------------------

#[tokio::test]
async fn health_endpoint_bypasses_auth() {
    let state = make_state();
    let app = k7s_lib::web::server::api_router(state);

    // /health should work without any auth header
    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn status_endpoint_bypasses_auth() {
    let state = make_state();
    let app = k7s_lib::web::server::api_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/status")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

// ---------------------------------------------------------------------------
// Status endpoint
// ---------------------------------------------------------------------------

#[tokio::test]
async fn status_returns_disconnected_when_no_cluster() {
    let state = make_state();
    let app = k7s_lib::web::server::api_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/status")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = body_json(response).await;
    // Response is wrapped in {ok, data} envelope
    assert_eq!(json.get("ok"), Some(&serde_json::Value::Bool(true)));
    let data = json.get("data").expect("response should have data field");
    // Should indicate disconnected state (no cluster in test env)
    assert_eq!(
        data.get("connected").unwrap(),
        &serde_json::Value::Bool(false)
    );
}

// ---------------------------------------------------------------------------
// Prefs round-trip
// ---------------------------------------------------------------------------

#[tokio::test]
async fn prefs_round_trip() {
    let state = make_state();
    let token = auth_token(&state).to_string();
    let app = k7s_lib::web::server::api_router(state);

    // Save prefs
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/invoke/save_prefs")
                .method("POST")
                .header("content-type", "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from(r#"{"prefs":{"theme":"dark","language":"zh"}}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let json = body_json(response).await;
    assert_eq!(json.get("ok").unwrap(), &serde_json::Value::Bool(true));

    // Load prefs
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/invoke/load_prefs")
                .method("POST")
                .header("content-type", "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let json = body_json(response).await;
    assert_eq!(json.get("ok").unwrap(), &serde_json::Value::Bool(true));
    // The prefs data should be present
    assert!(json.get("data").is_some());
}

// ---------------------------------------------------------------------------
// Not-implemented catch-all
// ---------------------------------------------------------------------------

#[tokio::test]
async fn unimplemented_endpoint_returns_ok_false() {
    let state = make_state();
    let token = auth_token(&state).to_string();
    let app = k7s_lib::web::server::api_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/invoke/nonexistent_command")
                .method("POST")
                .header("content-type", "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();

    // The catch-all handler returns 200 with { ok: false, error: "..." }
    assert_eq!(response.status(), StatusCode::OK);
    let json = body_json(response).await;
    assert_eq!(json.get("ok").unwrap(), &serde_json::Value::Bool(false));
    assert!(json.get("error").is_some());
}
