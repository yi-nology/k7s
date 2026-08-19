//! Build script for the `web` feature's compile-time frontend embed.
//!
//! `src/web/server.rs` embeds the built React app via rust-embed's
//! `#[folder = "../dist"]` — a path OUTSIDE this crate, provided by the
//! k7/ workspace build flow (`cp -r k7s-frontend/dist dist`). When
//! k7s-server is consumed as a *git dependency* (k7s-desktop's
//! `--features web`, any downstream crate), the cargo git checkout has no
//! sibling `dist/`, the derive fails with "folder does not exist", and the
//! whole build breaks — see the FrontendAssets compile errors this caused
//! for k7s-desktop.
//!
//! Fix: before rustc runs, make sure the folder exists. Workspace builds
//! already have the real `../dist` (untouched); git consumers get a
//! placeholder page instead of a hard compile error. The placeholder tells
//! the user to pass `--static <dist-dir>` — which is the correct way to
//! serve a real frontend from such a build anyway.

fn main() {
    // Only the web feature links rust-embed; nothing to do otherwise.
    if std::env::var("CARGO_FEATURE_WEB").is_err() {
        return;
    }
    let dist = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist");
    if !dist.join("index.html").exists() {
        std::fs::create_dir_all(&dist).expect("create placeholder dist dir");
        std::fs::write(dist.join("index.html"), PLACEHOLDER_INDEX).expect("write placeholder");
        println!(
            "cargo:warning=k7s-server: no ../dist found — wrote a placeholder index.html. \
             Build with the real frontend bundle (k7/ workspace: cp -r k7s-frontend/dist dist) \
             or serve one at runtime with --static <dist-dir>."
        );
    }
    // Re-embed when the bundle changes (workspace builds). The placeholder
    // is written at most once, so this cannot loop.
    println!("cargo:rerun-if-changed=../dist");
}

const PLACEHOLDER_INDEX: &str = r#"<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>k7s-web</title></head>
<body style="font-family: system-ui; background:#111; color:#eee; display:flex; min-height:100vh; align-items:center; justify-content:center;">
  <div style="max-width:560px; padding:32px; border:1px solid #333; border-radius:12px;">
    <h1>k7s-web</h1>
    <p>此构建未内嵌前端资源包(This build has no embedded frontend bundle)。</p>
    <p>请使用 <code>--static &lt;dist 目录&gt;</code> 启动以加载前端,或在工作区构建时拷入真实的
    <code>dist/</code>(见仓库 README)。</p>
  </div>
</body>
</html>
"#;
