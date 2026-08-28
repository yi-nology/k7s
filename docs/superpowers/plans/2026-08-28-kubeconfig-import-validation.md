# kubeconfig 导入解析/验证阶段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** kubeconfig 导入分「解析 → 验证」两阶段，结构化 issues 穿透 wire，页面逐条展示错误/警告。

**Architecture:** k7s-core 新增共享验证模块 `kubeconfig_check`（两条 shell 共用）；web handler 失败走扩展错误信封 `InvokeErrorWithIssues`，成功带 warning 走 `ImportKubeconfigResult.issues`；桌面 `import_kubeconfig` 返回值升级为同一结构；前端 transport 抛 `KubeconfigImportError`，OnboardingWizard inline 展示、ClusterSwitcher 走全局 toast。

**Tech Stack:** Rust (axum/kube 0.99/thiserror)、React + TypeScript、vitest。

**Spec:** `docs/superpowers/specs/2026-08-28-kubeconfig-import-validation-design.md`

## Global Constraints

- 工作分支：`feat/kubeconfig-import-validation`（本地提交，不推送）。
- wire 字段一律 camelCase（`issues`、`severity`、`current-context` 由 serde rename 处理）。
- 验证模块全平台无条件编译（iOS/Android cfg 门不加）。
- k7s-deps 没有 re-export `url` crate —— server URL 用 http/https 前缀检查。
- kube 0.99 结构：`Kubeconfig { clusters, auth_infos(serde rename "users"), contexts, current_context: Option<String> }`；`Cluster.server: Option<String>`；`AuthInfo.password/token: Option<SecretString>`。
- 错误/警告 message 后端英文直出；前端标签走 i18n（en.ts + zh.ts + dictionaries.ts 类型三处同步）。
- 测试命令：Rust `cargo test -p <crate>`（workspace 根跑），前端 `pnpm vitest run <file>` + `pnpm build`（tsc 校验）。

---

### Task 1: k7s-core `kubeconfig_check` 验证模块

**Files:**
- Create: `crates/k7s-core/src/kube/kubeconfig_check.rs`
- Modify: `crates/k7s-core/src/kube/mod.rs`（`pub mod dto;` 后加 `pub mod kubeconfig_check;`）
- Modify: `crates/k7s-core/src/kube/client.rs`（抽 `read_kubeconfig` + `contexts_from_kubeconfig`）

**Interfaces:**
- Produces: `IssueSeverity { Error, Warning }`、`KubeconfigIssue { severity, code, message, context: Option<String> }`（均 `Serialize` + camelCase）、`ImportKubeconfigResult { contexts: Vec<ContextInfo>, path: String, issues: Vec<KubeconfigIssue> }`、`validate_kubeconfig(&Kubeconfig) -> Vec<KubeconfigIssue>`、`has_errors(&[KubeconfigIssue]) -> bool`、`summarize_issues(&[KubeconfigIssue]) -> String`、`client::read_kubeconfig(&str) -> AppResult<Kubeconfig>`、`client::contexts_from_kubeconfig(&Kubeconfig) -> Vec<ContextInfo>`。Task 2/3/4 依赖这些确切签名。

- [ ] **Step 1: 写失败测试** — `kubeconfig_check.rs` 先写文件骨架 + `#[cfg(test)] mod tests`（完整测试见 Step 3 代码块，全部引用尚不存在的 `validate_kubeconfig` 等符号）。

- [ ] **Step 2: 确认测试编译失败** — Run: `cargo test -p k7s-core kubeconfig_check` → Expected: 编译错误（符号不存在）。

- [ ] **Step 3: 实现模块** — `kubeconfig_check.rs` 主体：

```rust
//! kubeconfig structural validation (`validate_kubeconfig`).
//!
//! Import used to stop at YAML parsing: a file with dangling cluster/user
//! references or a missing `server` parsed fine and only blew up at connect
//! time. This module runs after parsing and classifies problems into
//! blocking `Error`s and advisory `Warning`s so both shells (web upload and
//! desktop file dialog) can tell the user exactly what is wrong, per context.

use std::collections::HashSet;

use k7s_deps::kube::config::Kubeconfig;
use k7s_deps::serde::Serialize;

use crate::kube::client::ContextInfo;

/// How severe an issue is: `Error` blocks the import, `Warning` lets it
/// through but is surfaced to the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IssueSeverity {
    Error,
    Warning,
}

/// One problem found while validating a parsed kubeconfig.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubeconfigIssue {
    pub severity: IssueSeverity,
    /// Stable machine code ("missingClusterRef", …). The UI renders
    /// `message`, but tests and future i18n key off this.
    pub code: String,
    pub message: String,
    /// The context the issue belongs to; `None` for file-level problems.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
}

/// Successful import result shared by both shells. `issues` carries advisory
/// warnings only — error-level issues never get this far.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportKubeconfigResult {
    pub contexts: Vec<ContextInfo>,
    pub path: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub issues: Vec<KubeconfigIssue>,
}

fn issue(severity: IssueSeverity, code: &str, message: String, context: Option<&str>) -> KubeconfigIssue {
    KubeconfigIssue {
        severity,
        code: code.to_string(),
        message,
        context: context.map(str::to_string),
    }
}

/// True when any issue is blocking (the import must not proceed).
pub fn has_errors(issues: &[KubeconfigIssue]) -> bool {
    issues.iter().any(|i| i.severity == IssueSeverity::Error)
}

/// Multi-line human summary for error channels that carry no structure
/// (the Tauri command rejects with a plain string).
pub fn summarize_issues(issues: &[KubeconfigIssue]) -> String {
    let mut out = format!("kubeconfig validation failed ({} issue(s)):", issues.len());
    for i in issues {
        let sev = match i.severity {
            IssueSeverity::Error => "error",
            IssueSeverity::Warning => "warning",
        };
        let ctx = i
            .context
            .as_deref()
            .map(|c| format!("context '{c}': "))
            .unwrap_or_default();
        out.push_str(&format!("\n- [{sev}] {ctx}{}", i.message));
    }
    out
}

/// Validate a parsed kubeconfig: per-context reference/URL/credential checks
/// plus file-level sanity. One broken context never masks the others — every
/// problem found is reported.
pub fn validate_kubeconfig(kc: &Kubeconfig) -> Vec<KubeconfigIssue> {
    let mut issues = Vec::new();

    if kc.contexts.is_empty() {
        issues.push(issue(
            IssueSeverity::Error,
            "noContexts",
            "the file defines no contexts".to_string(),
            None,
        ));
    }

    let clusters: HashSet<&str> = kc.clusters.iter().map(|c| c.name.as_str()).collect();
    let users: HashSet<&str> = kc.auth_infos.iter().map(|u| u.name.as_str()).collect();

    for ctx in &kc.contexts {
        let name = ctx.name.as_str();
        let Some(body) = &ctx.context else {
            issues.push(issue(
                IssueSeverity::Error,
                "missingContextBody",
                format!("context '{name}' has no context section"),
                Some(name),
            ));
            continue;
        };
        if !clusters.contains(body.cluster.as_str()) {
            issues.push(issue(
                IssueSeverity::Error,
                "missingClusterRef",
                format!("cluster '{}' not found in clusters", body.cluster),
                Some(name),
            ));
        }
        if !users.contains(body.user.as_str()) {
            issues.push(issue(
                IssueSeverity::Error,
                "missingUserRef",
                format!("user '{}' not found in users", body.user),
                Some(name),
            ));
        }

        if let Some(cluster) = kc.clusters.iter().find(|c| c.name == body.cluster) {
            match cluster.cluster.as_ref().and_then(|c| c.server.as_deref()) {
                None => issues.push(issue(
                    IssueSeverity::Error,
                    "missingServer",
                    format!("cluster '{}' has no server address", body.cluster),
                    Some(name),
                )),
                Some(server) => {
                    let lower = server.to_ascii_lowercase();
                    if !(lower.starts_with("https://") || lower.starts_with("http://"))
                        || server.trim().len() <= lower.split("://").next().map_or(0, |s| s.len() + 3)
                    {
                        issues.push(issue(
                            IssueSeverity::Error,
                            "badServerUrl",
                            format!("cluster '{0}' server '{server}' is not a valid http(s) URL", body.cluster),
                            Some(name),
                        ));
                    } else if lower.starts_with("https://") {
                        let c = cluster.cluster.as_ref().expect("matched above");
                        let has_ca =
                            c.certificate_authority.is_some() || c.certificate_authority_data.is_some();
                        if !has_ca && !c.insecure_skip_tls_verify.unwrap_or(false) {
                            issues.push(issue(
                                IssueSeverity::Warning,
                                "noCaBundle",
                                format!("cluster '{0}' uses https without a CA bundle — the server certificate cannot be verified (set certificate-authority-data or insecure-skip-tls-verify)", body.cluster),
                                Some(name),
                            ));
                        }
                    }
                }
            }
        }

        let has_credentials = kc.auth_infos.iter().find(|u| u.name == body.user).is_some_and(|u| {
            u.auth_info.as_ref().is_some_and(|a| {
                a.token.is_some()
                    || a.token_file.is_some()
                    || a.client_certificate.is_some()
                    || a.client_certificate_data.is_some()
                    || a.username.is_some()
                    || a.password.is_some()
                    || a.auth_provider.is_some()
                    || a.exec.is_some()
            })
        });
        if !has_credentials {
            issues.push(issue(
                IssueSeverity::Warning,
                "noCredentials",
                format!("user '{}' defines no credentials (token, client cert, basic auth, exec, or auth-provider)", body.user),
                Some(name),
            ));
        }
    }

    if let Some(current) = &kc.current_context {
        if !kc.contexts.iter().any(|c| &c.name == current) {
            issues.push(issue(
                IssueSeverity::Warning,
                "danglingCurrentContext",
                format!("current-context '{current}' does not match any context"),
                None,
            ));
        }
    }

    issues
}
```

测试（同文件 `#[cfg(test)] mod tests`）：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn config(yaml: &str) -> Kubeconfig {
        Kubeconfig::from_yaml(yaml).expect("test yaml parses")
    }

    fn codes(issues: &[KubeconfigIssue]) -> Vec<&str> {
        issues.iter().map(|i| i.code.as_str()).collect()
    }

    #[test]
    fn good_file_has_no_issues() {
        let kc = config(
            r#"
apiVersion: v1
kind: Config
current-context: prod
clusters:
  - name: prod
    cluster:
      server: https://k8s.example.com:6443
      certificate-authority-data: Zm9v
contexts:
  - name: prod
    context: { cluster: prod, user: prod-user }
users:
  - name: prod-user
    user: { token: s3cret }
"#,
        );
        assert!(validate_kubeconfig(&kc).is_empty());
    }

    #[test]
    fn empty_contexts_is_an_error() {
        let kc = config("apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\n");
        let issues = validate_kubeconfig(&kc);
        assert!(has_errors(&issues));
        assert!(codes(&issues).contains(&"noContexts"));
    }

    #[test]
    fn dangling_cluster_and_user_refs_are_errors() {
        let kc = config(
            r#"
clusters: []
contexts:
  - name: c1
    context: { cluster: nope, user: also-nope }
users: []
"#,
        );
        let issues = validate_kubeconfig(&kc);
        assert!(has_errors(&issues));
        let c = codes(&issues);
        assert!(c.contains(&"missingClusterRef") && c.contains(&"missingUserRef"));
        assert_eq!(issues[0].context.as_deref(), Some("c1"));
    }

    #[test]
    fn missing_server_is_an_error() {
        let kc = config(
            r#"
clusters:
  - name: c
    cluster: {}
contexts:
  - name: c1
    context: { cluster: c, user: u }
users:
  - name: u
    user: { token: t }
"#,
        );
        let issues = validate_kubeconfig(&kc);
        assert!(codes(&issues).contains(&"missingServer"));
    }

    #[test]
    fn bad_server_url_is_an_error() {
        let kc = config(
            r#"
clusters:
  - name: c
    cluster: { server: "not-a-url" }
contexts:
  - name: c1
    context: { cluster: c, user: u }
users:
  - name: u
    user: { token: t }
"#,
        );
        let issues = validate_kubeconfig(&kc);
        assert!(codes(&issues).contains(&"badServerUrl"));
    }

    #[test]
    fn https_without_ca_warns_but_does_not_block() {
        let kc = config(
            r#"
clusters:
  - name: c
    cluster: { server: https://k8s.example.com }
contexts:
  - name: c1
    context: { cluster: c, user: u }
users:
  - name: u
    user: { token: t }
"#,
        );
        let issues = validate_kubeconfig(&kc);
        assert!(!has_errors(&issues));
        assert!(codes(&issues).contains(&"noCaBundle"));
    }

    #[test]
    fn insecure_skip_tls_verify_suppresses_ca_warning() {
        let kc = config(
            r#"
clusters:
  - name: c
    cluster: { server: https://k8s.example.com, insecure-skip-tls-verify: true }
contexts:
  - name: c1
    context: { cluster: c, user: u }
users:
  - name: u
    user: { token: t }
"#,
        );
        assert!(validate_kubeconfig(&kc).is_empty());
    }

    #[test]
    fn user_without_credentials_warns() {
        let kc = config(
            r#"
clusters:
  - name: c
    cluster: { server: https://k8s.example.com }
contexts:
  - name: c1
    context: { cluster: c, user: u }
users:
  - name: u
    user: {}
"#,
        );
        let issues = validate_kubeconfig(&kc);
        assert!(!has_errors(&issues));
        assert!(codes(&issues).contains(&"noCredentials"));
    }

    #[test]
    fn exec_plugin_counts_as_credentials() {
        let kc = config(
            r#"
clusters:
  - name: c
    cluster: { server: https://k8s.example.com }
contexts:
  - name: c1
    context: { cluster: c, user: u }
users:
  - name: u
    user:
      exec:
        apiVersion: client.authentication.k8s.io/v1
        command: my-auth-plugin
        interactiveMode: Never
"#,
        );
        assert!(validate_kubeconfig(&kc).is_empty());
    }

    #[test]
    fn dangling_current_context_warns() {
        let kc = config(
            r#"
current-context: missing
clusters:
  - name: c
    cluster: { server: https://k8s.example.com }
contexts:
  - name: c1
    context: { cluster: c, user: u }
users:
  - name: u
    user: { token: t }
"#,
        );
        let issues = validate_kubeconfig(&kc);
        assert!(!has_errors(&issues));
        assert!(codes(&issues).contains(&"danglingCurrentContext"));
    }

    #[test]
    fn summarize_lists_every_issue() {
        let kc = config(
            r#"
clusters: []
contexts:
  - name: c1
    context: { cluster: nope, user: nobody }
users: []
"#,
        );
        let issues = validate_kubeconfig(&kc);
        let summary = summarize_issues(&issues);
        assert!(summary.starts_with("kubeconfig validation failed (2 issue(s)):"));
        assert!(summary.contains("[error] context 'c1': cluster 'nope' not found"));
        assert!(summary.contains("[warning] context 'c1': user 'nobody'"));
    }
}
```

- [ ] **Step 4: client.rs 抽共享函数** — `contexts_from_file` 重构为两个新函数 + 保留原签名（`crates/k7s-core/src/kube/client.rs`，替换 76–95 行）：

```rust
/// Read a kubeconfig file from disk (the import paths' shared entry).
pub fn read_kubeconfig(path: &str) -> AppResult<Kubeconfig> {
    Ok(Kubeconfig::read_from(path)?)
}

/// Map a parsed kubeconfig into switcher entries. Entries report
/// `current: false` — the notion of a "current" context belongs to the
/// default kubeconfig, not to an imported file.
pub fn contexts_from_kubeconfig(kubeconfig: &Kubeconfig) -> Vec<ContextInfo> {
    kubeconfig
        .contexts
        .iter()
        .map(|ctx| {
            let cluster = ctx
                .context
                .as_ref()
                .map(|c| c.cluster.clone())
                .unwrap_or_default();
            ContextInfo {
                name: ctx.name.clone(),
                cluster,
                current: false,
            }
        })
        .collect()
}

/// Read a kubeconfig file at an arbitrary path and list its contexts.
///
/// Used by the "Import kubeconfig" action.
pub fn contexts_from_file(path: &str) -> AppResult<Vec<ContextInfo>> {
    let kubeconfig = read_kubeconfig(path)?;
    Ok(contexts_from_kubeconfig(&kubeconfig))
}
```

- [ ] **Step 5: mod.rs 挂载** — `crates/k7s-core/src/kube/mod.rs` 在 `pub mod dto;` 之后加一行 `pub mod kubeconfig_check;`。

- [ ] **Step 6: 测试通过** — Run: `cargo test -p k7s-core kubeconfig_check && cargo test -p k7s-core client` → Expected: 全部 PASS（含 client.rs 既有 231/246/253 行的测试）。

- [ ] **Step 7: Commit** — `git add -A crates/k7s-core && git commit -m "feat(core): kubeconfig structural validation (validate_kubeconfig)"`

### Task 2: web handler 接入验证 + `InvokeErrorWithIssues`

**Files:**
- Modify: `crates/k7s-server/src/web/types.rs`（删 `ImportResultWire` 145–148 行，加 `InvokeErrorWithIssues`）
- Modify: `crates/k7s-server/src/web/handlers.rs:98-153`（`import_kubeconfig_content`）
- Test: `crates/k7s-server/tests/web_api.rs`（504 行附近追加）

**Interfaces:**
- Consumes: Task 1 全部符号。
- Produces: wire 成功形如 `{ ok:true, data:{ contexts, path, issues? } }`；验证失败形如 `{ ok:false, error:"kubeconfig validation failed (...)", issues:[...] }`。

- [ ] **Step 1: 写失败测试** — `web_api.rs` 追加（沿用文件内 `make_state`/`auth_token`/`body_json` 辅助）：

```rust
#[tokio::test]
async fn import_kubeconfig_reports_validation_issues() {
    let state = make_state();
    let token = auth_token(&state).to_string();
    let app = k7s_server::web::server::api_router(state);

    let body = k7s_deps::serde_json::json!({
        "filename": "broken.yaml",
        "contents": k7s_deps::serde_json::to_string(&k7s_deps::serde_json::json!({
            "apiVersion": "v1",
            "kind": "Config",
            "clusters": [],
            "contexts": [{"name": "c1", "context": {"cluster": "nope", "user": "nobody"}}],
            "users": []
        })).unwrap()
    });

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/invoke/import_kubeconfig_content")
                .method("POST")
                .header("content-type", "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = body_json(response).await;
    assert_eq!(json.get("ok"), Some(&k7s_deps::serde_json::Value::Bool(false)));
    let error = json.get("error").and_then(|v| v.as_str()).expect("error string");
    assert!(error.contains("kubeconfig validation failed"), "got: {error}");
    let issues = json.get("issues").and_then(|v| v.as_array()).expect("issues array");
    assert!(!issues.is_empty());
    assert!(
        issues.iter().any(|i| i.get("code").and_then(|c| c.as_str()) == Some("missingClusterRef")),
        "issues should carry stable codes: {issues:?}"
    );
}

#[tokio::test]
async fn import_kubeconfig_succeeds_with_warnings() {
    let state = make_state();
    let token = auth_token(&state).to_string();
    let app = k7s_server::web::server::api_router(state);

    let body = k7s_deps::serde_json::json!({
        "filename": "warn.yaml",
        "contents": k7s_deps::serde_json::to_string(&k7s_deps::serde_json::json!({
            "apiVersion": "v1",
            "kind": "Config",
            "clusters": [{"name": "c", "cluster": {"server": "https://127.0.0.1:6443"}}],
            "contexts": [{"name": "c1", "context": {"cluster": "c", "user": "u"}}],
            "users": [{"name": "u", "user": {}}]
        })).unwrap()
    });

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/invoke/import_kubeconfig_content")
                .method("POST")
                .header("content-type", "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = body_json(response).await;
    assert_eq!(json.get("ok"), Some(&k7s_deps::serde_json::Value::Bool(true)));
    let data = json.get("data").expect("data");
    let issues = data.get("issues").and_then(|v| v.as_array()).expect("issues on success");
    assert!(issues.iter().any(|i| i.get("code").and_then(|c| c.as_str()) == Some("noCredentials")));
    assert!(!data.get("contexts").expect("contexts").as_array().expect("arr").is_empty());
}
```

- [ ] **Step 2: 确认失败** — Run: `cargo test -p k7s-server import_kubeconfig` → 新测试 FAIL（当前坏引用导入返回 ok:true、无 issues）。

- [ ] **Step 3: 实现** — types.rs：删除 `ImportResultWire`，追加：

```rust
/// Failure envelope for commands that carry structured diagnostics. Only
/// `import_kubeconfig_content` uses it today: `error` is the human-readable
/// summary, `issues` the per-context details the UI lists verbatim.
#[derive(Serialize)]
pub struct InvokeErrorWithIssues {
    pub ok: bool,
    pub error: String,
    pub issues: Vec<KubeconfigIssue>,
}

impl IntoResponse for InvokeErrorWithIssues {
    fn into_response(self) -> axum::response::Response {
        // Same 200-with-{ok:false} contract as `InvokeError` — see the
        // comment there for why errors are not 4xx.
        (StatusCode::OK, Json(self)).into_response()
    }
}
```

types.rs 头部 use 加 `use k7s_core::kube::kubeconfig_check::KubeconfigIssue;`。

handlers.rs 重写 `import_kubeconfig_content`（102–153 行）：

```rust
    let core = state.core.clone();
    // Phase 1: parse. The serde_yaml error already carries line/column —
    // surface it verbatim so the UI can show exactly where the YAML breaks.
    let kc = match Kubeconfig::from_yaml(&args.contents) {
        Ok(kc) => kc,
        Err(e) => {
            return respond(Err(AppError::Kubeconfig(format!(
                "couldn't parse {}: {e}",
                args.filename
            ))))
        }
    };

    // Phase 2: validate. Error-level issues block the import and go back as
    // a structured failure the UI can itemize; warnings ride along with the
    // success payload.
    let issues = validate_kubeconfig(&kc);
    if has_errors(&issues) {
        return InvokeErrorWithIssues {
            ok: false,
            error: summarize_issues(&issues),
            issues,
        }
        .into_response();
    }

    let imported = contexts_from_kubeconfig(&kc);

    // Register each context so a later `connect` builds from this file.
    // We stash the parsed `Kubeconfig` (rather than the file path) because
    // the web shell has no real file on disk — the bytes came from the
    // user's `<input type="file">` and are gone the moment they pick again.
    for ctx in &imported {
        core.manager
            .add_import(
                ctx.name.clone(),
                ImportedContext {
                    path: args.filename.clone(),
                    cluster: ctx.cluster.clone(),
                    kubeconfig: Some(kc.clone()),
                },
            )
            .await;
    }

    let merged = shell_common::merged_contexts(&core.manager).await;
    respond(Ok(ImportKubeconfigResult {
        contexts: merged,
        path: args.filename,
        issues: issues, // warnings only — errors returned above
    }))
```

handlers.rs use 更新：`use k7s_core::kube::{ client::{self}, kubeconfig_check::{has_errors, summarize_issues, validate_kubeconfig, ImportKubeconfigResult}, manager::ImportedContext };`（`client` 若仅剩此用途保留；`ContextInfo` import 删除）。

- [ ] **Step 4: 测试通过** — Run: `cargo test -p k7s-server import_kubeconfig` → 全部 PASS（含既有 `import_kubeconfig_parses_valid_yaml`：其空 user 产生 warning 但 ok 仍为 true）。
- [ ] **Step 5: Commit** — `git add -A crates/k7s-server && git commit -m "feat(web): kubeconfig import validation phase with structured issues"``

### Task 3: 桌面 `import_kubeconfig` 接入同一验证

**Files:**
- Modify: `crates/k7s-commands/src/commands/core.rs:128-169`（`import_kubeconfig_impl` + `import_kubeconfig`）
- Modify: `frontend/src/providers/tauri/TauriProvider.ts:91-108`（适配新返回类型）

**Interfaces:**
- Consumes: Task 1 符号。wire 返回与 Task 2 相同的 `{ contexts, path, issues? }`。
- Produces: `import_kubeconfig_impl(Arc<CoreState>, String) -> AppResult<ImportKubeconfigResult>`。

- [ ] **Step 1: 实现**（验证逻辑在 Task 1 已有单测；此处是薄胶水，功能行为由 Task 2 的集成测试同构覆盖）：

```rust
/// Wire arguments for [`import_kubeconfig`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportKubeconfigArgs {
    pub path: String,
}

pub async fn import_kubeconfig_impl(
    mgr: std::sync::Arc<CoreState>,
    path: String,
) -> AppResult<ImportKubeconfigResult> {
    let manager: Arc<ClientManager> = mgr.manager.clone();

    // Phase 1: parse — `KubeconfigError` already names the file and problem.
    let kubeconfig = client::read_kubeconfig(&path)?;

    // Phase 2: validate — error-level issues reject the import with a
    // per-context summary (Tauri errors are plain strings, so the structure
    // lives in the message text); warnings ride along on success.
    let issues = validate_kubeconfig(&kubeconfig);
    if has_errors(&issues) {
        return Err(AppError::Kubeconfig(summarize_issues(&issues)));
    }

    let imported = client::contexts_from_kubeconfig(&kubeconfig);
    for ctx in &imported {
        manager
            .add_import(
                ctx.name.clone(),
                ImportedContext {
                    path: path.clone(),
                    cluster: ctx.cluster.clone(),
                    kubeconfig: None,
                },
            )
            .await;
    }

    let contexts = shell_common::merged_contexts(&manager).await;
    Ok(ImportKubeconfigResult { contexts, path, issues })
}

#[cfg(feature = "ipc")]
#[tauri::command]
pub async fn import_kubeconfig(
    path: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<ImportKubeconfigResult> {
    import_kubeconfig_impl(mgr.inner().clone(), path).await
}
```

core.rs use 增加：`use k7s_core::kube::kubeconfig_check::{has_errors, summarize_issues, validate_kubeconfig, ImportKubeconfigResult};`（`ContextInfo` import 若无其他使用则移除；`restore_imports`/`list_contexts` 若仍用则保留）。

- [ ] **Step 2: TauriProvider 适配** — `frontend/src/providers/tauri/TauriProvider.ts:104-107` 替换为：

```ts
    // The command returns the merged switcher list plus the file path and
    // (optional) validation warnings — the same shape the web upload gets.
    const result = await invoke<ImportResult>('import_kubeconfig', { path: selected });
    return result;
```

（`ContextInfo` import 若无其他使用同步移除。）

- [ ] **Step 3: 测试** — Run: `cargo test -p k7s-commands`（reconciliation 测试保证命令面不漂移）→ PASS；Run: `pnpm build` → tsc 无错误。
- [ ] **Step 4: Commit** — `git add -A crates/k7s-commands frontend/src/providers/tauri && git commit -m "feat(commands): desktop kubeconfig import runs the shared validation"`

### Task 4: 前端 transport 结构化错误 + 类型

**Files:**
- Modify: `frontend/src/providers/types/cluster.ts:39-45`
- Modify: `frontend/src/providers/transport.ts:64-69, 119-124`
- Modify: `frontend/src/providers/index.ts`（re-export `KubeconfigImportError`）

**Interfaces:**
- Produces: `KubeconfigIssue { severity: 'error'|'warning'; code: string; message: string; context?: string }`、`ImportResult.issues?: KubeconfigIssue[]`、`class KubeconfigImportError extends Error { issues?: KubeconfigIssue[] }`。Task 5/6 依赖。

- [ ] **Step 1: 类型** — `cluster.ts` 在 `ContextInfo` 后追加、`ImportResult` 扩展：

```ts
/** One problem the back-end found while parsing/validating an imported
 *  kubeconfig. `severity: 'error'` never appears in a success payload. */
export interface KubeconfigIssue {
  severity: 'error' | 'warning';
  /** Stable machine code ("missingClusterRef", …). */
  code: string;
  message: string;
  /** The context the issue belongs to; absent for file-level problems. */
  context?: string;
}

/** Result of a successful kubeconfig import. */
export interface ImportResult {
  /** The merged switcher list: default kubeconfig contexts + all imported ones. */
  contexts: ContextInfo[];
  /** The file that was imported, persisted so it survives a relaunch (B17). */
  path: string;
  /** Advisory validation warnings — the import succeeded despite them. */
  issues?: KubeconfigIssue[];
}
```

- [ ] **Step 2: transport** — `transport.ts` 头部加 `import type { KubeconfigIssue } from './types/cluster';`；`WireResponse` 加 `issues?: KubeconfigIssue[];`；文件内（`httpInvoke` 前）定义：

```ts
/**
 * A rejected `import_kubeconfig_content` whose failure carries structured
 * validation issues. `issues` is absent for plain parse failures — callers
 * branch on it to decide between "couldn't parse" and "validation failed"
 * UI, and fall back to `message` when it's missing (old back-ends).
 */
export class KubeconfigImportError extends Error {
  issues?: KubeconfigIssue[];
  constructor(message: string, issues?: KubeconfigIssue[]) {
    super(message);
    this.name = 'KubeconfigImportError';
    this.issues = issues;
  }
}
```

`httpInvoke` 的 `if (!body.ok)` 块替换为：

```ts
  if (!body.ok) {
    const message = body.error ?? `${cmd} failed (no error message)`;
    // Structured diagnostics ride along when the command provides them.
    throw body.issues
      ? new KubeconfigImportError(message, body.issues)
      : new Error(message);
  }
```

- [ ] **Step 3: re-export** — `frontend/src/providers/index.ts` 加 `export { KubeconfigImportError } from './transport';`
- [ ] **Step 4: 验证** — Run: `pnpm build` → tsc 通过；Run: `pnpm vitest run` → 既有测试全绿。
- [ ] **Step 5: Commit** — `git add frontend/src/providers && git commit -m "feat(web-ui): carry structured kubeconfig issues through the transport"`

### Task 5: OnboardingWizard inline 错误展示 + 测试

**Files:**
- Modify: `frontend/src/components/onboarding/OnboardingWizard.tsx`
- Modify: `frontend/src/components/onboarding/OnboardingWizard.module.css`
- Modify: `frontend/src/lib/i18n/dictionaries.ts`（`onboarding.import` 类型）、`en.ts`、`zh.ts`
- Test: `frontend/src/components/onboarding/OnboardingWizard.test.tsx`

**Interfaces:**
- Consumes: Task 4 的 `KubeconfigImportError`/`KubeconfigIssue`；i18n key `onboarding.import.parseFailed / validationFailed / importedWithWarnings`（本任务一并加进三处字典）。

- [ ] **Step 1: i18n** — dictionaries.ts `onboarding.import` 类型追加三行 `parseFailed: string; validationFailed: string; importedWithWarnings: string;`；en.ts：`parseFailed: "Couldn't parse the file"`, `validationFailed: "Validation failed"`, `importedWithWarnings: 'Imported, with warnings'`；zh.ts：`parseFailed: '文件解析失败'`, `validationFailed: '校验失败'`, `importedWithWarnings: '导入成功,但有以下警告'`。

- [ ] **Step 2: 写失败测试** — OnboardingWizard.test.tsx 追加（import 区加 `import { KubeconfigImportError } from '../../providers/transport';`）：

```tsx
  it('shows inline validation issues when the import is rejected with structure', async () => {
    importKubeconfig.mockRejectedValue(
      new KubeconfigImportError(
        "kubeconfig validation failed (1 issue(s)):\n- [error] context 'c1': cluster 'nope' not found in clusters",
        [
          {
            severity: 'error',
            code: 'missingClusterRef',
            message: "cluster 'nope' not found in clusters",
            context: 'c1',
          },
        ]
      )
    );
    view = render(<OnboardingWizard />);
    view.click(view.getByText('Choose file…'));
    await flush();

    expect(view.queryByText('Validation failed')).not.toBeNull();
    expect(view.container.textContent).toContain("cluster 'nope' not found in clusters");
    // Still on step 1 — the user can pick another file without closing.
    expect(view.queryByText('Choose file…')).not.toBeNull();
  });

  it('labels plain parse failures distinctly', async () => {
    importKubeconfig.mockRejectedValue(new Error("couldn't parse bad.yaml: bad indentation"));
    view = render(<OnboardingWizard />);
    view.click(view.getByText('Choose file…'));
    await flush();

    expect(view.queryByText("Couldn't parse the file")).not.toBeNull();
    expect(view.container.textContent).toContain('bad indentation');
  });

  it('advances with a warning banner when the import succeeds with warnings', async () => {
    importKubeconfig.mockResolvedValue({
      contexts: [],
      path: '/tmp/kubeconfig',
      issues: [
        { severity: 'warning', code: 'noCredentials', message: "user 'u' defines no credentials", context: 'c1' },
      ],
    });
    view = render(<OnboardingWizard />);
    view.click(view.getByText('Choose file…'));
    await flush();

    expect(view.queryByText(/Imported, with warnings/)).not.toBeNull();
    expect(view.container.textContent).toContain("user 'u' defines no credentials");
    expect(view.queryByText('Next')).not.toBeNull();
  });
```

- [ ] **Step 3: 确认失败** — Run: `pnpm vitest run src/components/onboarding/OnboardingWizard.test.tsx` → 3 个新用例 FAIL。
- [ ] **Step 4: 实现** — OnboardingWizard.tsx：

  - import 增加：`import { KubeconfigImportError, getProvider } from '../../providers';`（替换原 getProvider import）、`import type { KubeconfigIssue } from '../../providers/types';`
  - state：`const [importError, setImportError] = useState<Error | null>(null);` 与 `const [warnings, setWarnings] = useState<KubeconfigIssue[]>([]);`
  - `pick()` 开头 `setImportError(null); setWarnings([]);`；成功路径在 `setStep(1)` 前 `setWarnings(result.issues ?? [])`；catch 变为：

```ts
    } catch (e) {
      // Real API errors (not a cancelled picker). Rendered inline below —
      // parse failures show their message, validation failures itemize.
      console.error('[onboarding] import failed:', e);
      setImportError(e instanceof Error ? e : new Error(String(e)));
    }
```

  - step 0 渲染块（`<button>` 之后）：

```tsx
            {importError && (
              <div className={styles.importError} role="alert">
                <p className={styles.issueTitle}>
                  {importError instanceof KubeconfigImportError && importError.issues?.length
                    ? t('onboarding.import.validationFailed', 'Validation failed')
                    : t('onboarding.import.parseFailed', "Couldn't parse the file")}
                </p>
                {importError instanceof KubeconfigImportError && importError.issues?.length ? (
                  <ul className={styles.issueList}>
                    {importError.issues.map((iss, i) => (
                      <li
                        key={i}
                        className={iss.severity === 'error' ? styles.issueError : styles.issueWarning}
                      >
                        {iss.context ? <b>{iss.context}: </b> : null}
                        {iss.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.issueMessage}>{importError.message}</p>
                )}
              </div>
            )}
```

  - step 1 渲染块开头（`<p className={styles.hint}>` 之前）：

```tsx
            {warnings.length > 0 && (
              <div className={styles.importWarnings} role="status">
                <p className={styles.issueTitle}>
                  {t('onboarding.import.importedWithWarnings', 'Imported, with warnings')}
                </p>
                <ul className={styles.issueList}>
                  {warnings.map((iss, i) => (
                    <li key={i} className={styles.issueWarning}>
                      {iss.context ? <b>{iss.context}: </b> : null}
                      {iss.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
```

  - OnboardingWizard.module.css 追加（沿用文件内现有 var 令牌）：

```css
.importError,
.importWarnings {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
}

.importError {
  border: 1px solid var(--status-err);
  background: color-mix(in srgb, var(--status-err) 10%, transparent);
}

.importWarnings {
  border: 1px solid var(--status-warn);
  background: color-mix(in srgb, var(--status-warn) 10%, transparent);
}

.issueTitle {
  font-weight: 600;
  margin: 0 0 6px;
}

.issueList {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 4px;
}

.issueError {
  color: var(--status-err);
}

.issueWarning {
  color: var(--status-warn);
}

.issueMessage {
  margin: 0;
  word-break: break-word;
}
```

  （若文件中变量名不同——以现有 CSS 变量为准替换 `--status-err/--status-warn`。）

- [ ] **Step 5: 测试通过** — Run: `pnpm vitest run src/components/onboarding/OnboardingWizard.test.tsx` → 全绿。
- [ ] **Step 6: Commit** — `git add frontend/src/components/onboarding frontend/src/lib/i18n && git commit -m "feat(onboarding): itemize kubeconfig import errors and warnings inline"`

### Task 6: ClusterSwitcher toast + i18n + 测试

**Files:**
- Modify: `frontend/src/components/sidebar/ClusterSwitcher.tsx:55-72`
- Modify: `frontend/src/lib/i18n/dictionaries.ts`（`chrome.sidebar` 类型）、`en.ts`、`zh.ts`
- Test: `frontend/src/components/sidebar/ClusterSwitcher.test.tsx`

**Interfaces:**
- Consumes: Task 4 `KubeconfigImportError`；`getErrorReporter()/getSuccessReporter()`（`providers/errorHandler`）；i18n key `chrome.sidebar.importFailed`。

- [ ] **Step 1: i18n** — dictionaries.ts `chrome.sidebar` 类型加 `importFailed: string;`；en.ts `importFailed: 'Import kubeconfig failed'`；zh.ts `importFailed: '导入 kubeconfig 失败'`。
- [ ] **Step 2: 写失败测试** — ClusterSwitcher.test.tsx 追加（import 区加 `import { KubeconfigImportError } from '../../providers/transport';` 与 `import { setErrorReporter } from '../../providers/errorHandler';`；mock 区把 `importKubeconfigViaInput` 提为 `const importViaInput = vi.hoisted(() => vi.fn());` 并让 mock 返回它）：

```tsx
  describe('import errors', () => {
    it('reports structured validation issues through the error reporter', async () => {
      const reported: Array<[string, string]> = [];
      setErrorReporter((title, message) => reported.push([title, message]));
      const { importKubeconfigViaInput } = await import('../../providers');
      vi.mocked(importKubeconfigViaInput).mockRejectedValue(
        new KubeconfigImportError('kubeconfig validation failed (1 issue(s)):', [
          { severity: 'error', code: 'missingClusterRef', message: "cluster 'nope' not found", context: 'c1' },
        ])
      );

      view = render(<ClusterSwitcher />);
      view.click(view.getByText(/Import kubeconfig/i));
      await act(async () => {
        await Promise.resolve();
      });

      expect(reported).toHaveLength(1);
      expect(reported[0][1]).toContain("cluster 'nope' not found");
    });

    it('reports success with warnings through the success reporter', async () => {
      // …对称用例：mockResolvedValue({ contexts: [...], path: 'f', issues: [warning] })，
      // setErrorReporter / setSuccessReporter 均记录，断言 success reporter 收到警告文案。
    });
  });
```

（第二个用例按同模式写全，断言 `setSuccessReporter` 收到 `issues` 里的 message。测试文件需要 `import { act } from 'react';` 与文件头 `afterEach` 里 `vi.mocked(importKubeconfigViaInput).mockReset()` 复位。）

- [ ] **Step 3: 确认失败** — Run: `pnpm vitest run src/components/sidebar/ClusterSwitcher.test.tsx` → 新用例 FAIL（现在只 console.error，reporter 不被调用）。
- [ ] **Step 4: 实现** — ClusterSwitcher.tsx：import `getErrorReporter, getSuccessReporter`（`../../providers/errorHandler`）与 `KubeconfigImportError`（`../../providers`）；`onImport` 的 promise 链替换为：

```tsx
    const promise = importKubeconfigViaInput(input).then((result: ImportResult | null) => {
      if (!result) return;
      setContexts(result.contexts);
      // Remember the file so its contexts come back on the next launch (B17).
      addImportedFile(result.path);
      // Advisory warnings — the import succeeded, but the user should know
      // what the validator flagged (e.g. https without a CA bundle).
      if (result.issues?.length) {
        getSuccessReporter()(
          t('chrome.sidebar.importKubeconfig'),
          t('onboarding.import.importedWithWarnings', 'Imported, with warnings') +
            ' — ' +
            result.issues.map((i) => i.message).join(' · ')
        );
      }
    });
    // The click() that opens the OS picker is part of the same user
    // gesture as the button click — no `await` before it.
    input.click();
    // Rejections are real API failures. The toast reporter is the visible
    // channel (the menu just closed); console stays for diagnosis.
    void promise.catch((e: unknown) => {
      console.error('[import] failed:', e);
      const detail =
        e instanceof KubeconfigImportError && e.issues?.length
          ? e.issues.map((i) => i.message).join(' · ')
          : e instanceof Error
            ? e.message
            : String(e);
      getErrorReporter()(t('chrome.sidebar.importFailed', 'Import kubeconfig failed'), detail);
    });
```

- [ ] **Step 5: 测试通过** — Run: `pnpm vitest run src/components/sidebar/ClusterSwitcher.test.tsx` → 全绿（注意恢复全局 reporter：App.tsx 启动时重设，测试文件 afterEach 里 `setErrorReporter` 回 no-op 即可，或依赖 useErrorToast 的重新挂载）。
- [ ] **Step 6: Commit** — `git add frontend/src/components/sidebar frontend/src/lib/i18n && git commit -m "feat(sidebar): kubeconfig import failures surface in the error toast"`

### Task 7: 全量验证

- [ ] **Step 1:** Run: `cargo test -p k7s-core -p k7s-server -p k7s-commands` → 全绿（web_api 既有 `import_kubeconfig_parses_valid_yaml`/`rejects_invalid_yaml` 必须仍 PASS）。
- [ ] **Step 2:** Run: `pnpm build && pnpm vitest run` → tsc + 全部前端测试绿。
- [ ] **Step 3:** Run: `cargo clippy -p k7s-core -p k7s-server -p k7s-commands 2>&1 | tail -20` → 无新 warning。
- [ ] **Step 4:** 手动冒烟（可选）：`cargo run -p k7s-desktop` 或 web shell 导入一个坏 kubeconfig，确认页面逐条显示。
- [ ] **Step 5:** 汇总变更清单，向用户报告（不推送——推送/PR 由用户确认）。

## Self-Review 记录

- Spec 覆盖：§4.1→Task 1；§4.2/4.3→Task 2；§4.4→Task 3；§4.5→Task 4/5/6；§5→Task 1 `summarize_issues` + Task 4 回退逻辑；§6→各任务测试步。
- 类型一致性：`ImportKubeconfigResult`/`KubeconfigIssue`/`has_errors`/`summarize_issues`/`validate_kubeconfig` 在 Task 1 定义、Task 2/3 消费；`KubeconfigImportError`/`KubeconfigIssue`(TS) 在 Task 4 定义、Task 5/6 消费；i18n key `onboarding.import.importedWithWarnings` 在 Task 5 注册、Task 6 复用（Task 5 先落地）。
- 无占位符；唯一例外是 Task 6 Step 2 的第二个用例以「对称用例」描述 —— 执行时按同模式补全代码，属重复性展开。
