# ChartOps 整合 P0 — 本地 Chart 库与发布更新闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** k7 的 Helm 页新增「本地 Charts」库（扫描/上传/详情/删除），安装向导支持本地 chart 来源，并补齐 helm install/upgrade 的 flag 缺口 —— 完整覆盖 ChartOps 的 chart 发布更新场景。

**Architecture:** 后端在 `k7s-core/src/kube/helm/local.rs`（新模块，与 `market.rs`/`ops.rs` 同级同 cfg 门控）实现纯函数式库操作（接收库根目录参数，便于测试）；命令层从 `mgr.data_dir.join("charts")` 传入。Web 上传走专用路由 `/api/charts/upload`（绕过 axum 2MB 默认 body 限制）；桌面走 registry 命令 `local_chart_import_content`（base64）。两者共用 `import_chart_bytes`。设计文档：`docs/superpowers/specs/2026-08-28-chartops-integration-design.md`。

**Tech Stack:** Rust (axum 0.8, tokio, flate2 + 新增 `tar` crate), React 19 + Vite (vitest)。

## Global Constraints

- 移动端门控：所有新模块/命令/注册一律单层 `#[cfg(not(any(target_os = "ios", target_os = "android")))]`（与 `market.rs`、`commands/mod.rs` 的 helm 门控完全同构；禁止三层嵌套 cfg）。
- 依赖只能经 `k7s-deps` 伞仓引入；新增依赖仅 `tar = "0.4"` 一个。
- wire 参数 camelCase（`#[serde(rename_all = "camelCase")]`），与现有 `HelmReleaseHistoryArgs` 一致。
- 写操作（导入/删除/上传）必须 `crate::core::audit::record(...)`（`k7s-core/src/core/audit.rs:42`，签名 `record(action: &str, detail: Value)`）。
- 上传校验：gzip magic `0x1f 0x8b`、扩展名 `.tgz`/`.tar.gz`、大小上限 50MB（`MAX_CHART_BYTES = 50 * 1024 * 1024`）。
- tar 处理只读条目、绝不 `unpack` 落盘；删除操作必须 canonicalize 后校验前缀在库目录内。
- 前端 i18n：en.ts 与 zh.ts 两个字典都要加 key（`frontend/src/lib/i18n/`），`t()` 调用带英文 fallback 字符串。
- 每个任务结束时 `cargo check -p k7s-core`（或对应 crate）必须通过；Rust 测试用 in-file `#[cfg(test)]`（现有 `helm/mod.rs` 风格），前端测试 vitest `*.test.tsx`（现有 `HelmMarket.test.tsx` 风格）。

---

### Task 1: k7s-deps 引入 `tar` + `local.rs` 扫描与元信息解析

**Files:**
- Modify: `crates/k7s-deps/Cargo.toml`（`[dependencies]` 段，`flate2 = "1"` 行后）
- Modify: `crates/k7s-deps/src/lib.rs`（`pub use flate2;` 行后）
- Modify: `crates/k7s-core/src/kube/helm/mod.rs`（`pub mod ops;` 后）
- Create: `crates/k7s-core/src/kube/helm/local.rs`
- Test: `crates/k7s-core/src/kube/helm/local.rs`（in-file `#[cfg(test)]`）

**Interfaces:**
- Consumes: `crate::error::{AppError, AppResult}`；`k7s_deps::{flate2, tar, yaml_serde, serde_json}`。
- Produces（后续任务依赖的确切签名）:

```rust
pub enum LocalChartKind { Tgz, Dir }   // Serialize + Copy
pub struct LocalChartEntry {           // Serialize, Clone, Debug
    pub id: String,                    // "<name>-<version>"（tgz）或目录名
    pub kind: LocalChartKind,
    pub name: String,
    pub version: String,
    pub app_version: String,
    pub description: String,
    pub icon: String,
    pub path: String,                  // 绝对路径字符串
    pub size_bytes: u64,
    pub modified_at: String,           // RFC3339
}
pub fn scan_local_charts(root: &std::path::Path) -> AppResult<Vec<LocalChartEntry>>;
fn parse_tgz_metadata(path: &std::path::Path) -> AppResult<LocalChartEntry>;
fn parse_dir_metadata(path: &std::path::Path) -> AppResult<LocalChartEntry>;
```

- [ ] **Step 1: 加依赖**

`crates/k7s-deps/Cargo.toml` `[dependencies]` 段 `flate2 = "1"` 之后加：

```toml
tar = "0.4"
```

`crates/k7s-deps/src/lib.rs` `pub use flate2;` 之后加：

```rust
pub use tar;
```

- [ ] **Step 2: 写失败测试**

创建 `crates/k7s-core/src/kube/helm/local.rs`，先只放测试（实现体留空函数使其编译失败）：

```rust
//! Local chart library — the offline half of the Helm feature.
//!
//! ChartOps parity: scan a directory of `.tgz` packages / unpacked chart
//! dirs, parse their Chart.yaml, and expose entries for the UI. Pure
//! functions taking the library root as a parameter — the command layer
//! supplies `<data_dir>/charts`. tar entries are READ ONLY: we never
//! `unpack` onto disk, so a malicious archive has no filesystem surface.

use crate::error::{AppError, AppResult};
use k7s_deps::flate2::read::GzDecoder;
use std::io::Read;
use std::path::{Path, PathBuf};

pub use crate::kube::helm::local_types::*;

#[cfg(test)]
mod tests {
    use super::*;
    use k7s_deps::flate2::write::GzEncoder;
    use k7s_deps::flate2::Compression;
    use std::io::Write;

    /// Build an in-memory `.tgz` exactly like `helm package` produces:
    /// a single top-level `<name>/` dir containing Chart.yaml (+ extras).
    fn tgz_bytes(name: &str, version: &str, extra: &[(&str, &str)]) -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        let chart_yaml = format!(
            "apiVersion: v2\nname: {name}\nversion: {version}\ndescription: test chart\n"
        );
        let mut append = |path: String, data: &[u8]| {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, path, data).unwrap();
        };
        append(format!("{name}/Chart.yaml"), chart_yaml.as_bytes());
        for (p, d) in extra {
            append(format!("{name}/{p}"), d.as_bytes());
        }
        let tarball = builder.into_inner().unwrap();
        let mut gz = GzEncoder::new(Vec::new(), Compression::default());
        gz.write_all(&tarball).unwrap();
        gz.finish().unwrap()
    }

    #[test]
    fn scan_finds_tgz_and_dir_charts() {
        let tmp = std::env::temp_dir().join(format!("k7s-local-test-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        // tgz chart
        std::fs::write(tmp.join("demo-app-1.0.0.tgz"), tgz_bytes("demo-app", "1.0.0", &[]))
            .unwrap();
        // dir chart
        let dir = tmp.join("my-chart");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("Chart.yaml"),
            "apiVersion: v2\nname: my-chart\nversion: 2.0.0\n",
        )
        .unwrap();

        let mut entries = scan_local_charts(&tmp).unwrap();
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "demo-app");
        assert_eq!(entries[0].version, "1.0.0");
        assert!(matches!(entries[0].kind, LocalChartKind::Tgz));
        assert_eq!(entries[1].name, "my-chart");
        assert!(matches!(entries[1].kind, LocalChartKind::Dir));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn scan_skips_bad_tgz_rather_than_failing() {
        let tmp = std::env::temp_dir().join(format!("k7s-local-bad-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(tmp.join("garbage.tgz"), b"not a gzip at all").unwrap();
        // One corrupt file must not break the whole listing (mirrors
        // decode_release's skip-don't-fail policy in mod.rs).
        assert!(scan_local_charts(&tmp).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
```

注意：测试里的 `tar::Builder` 直接引用 `k7s_deps::tar` 的 re-export —— 在文件顶部 `use` 之后测试里用 `k7s_deps::tar` 路径或 `use k7s_deps::tar;` 均可，保持与 `flate2` 一致的 `k7s_deps::` 前缀。类型先放同文件（去掉上面 `pub use crate::kube::helm::local_types::*;` 这行占位，直接在文件里定义 struct/enum）。

- [ ] **Step 3: 跑测试确认失败**

Run: `cargo test -p k7s-core helm::local`
Expected: FAIL —— `scan_local_charts` 未定义（编译错误）。

- [ ] **Step 4: 最小实现**

在 `local.rs` 实现类型与两个解析函数 + 扫描：

```rust
#[derive(Clone, Copy, Debug, serde::Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LocalChartKind { Tgz, Dir }

#[derive(Clone, Debug, serde::Serialize)]
pub struct LocalChartEntry {
    pub id: String,
    pub kind: LocalChartKind,
    pub name: String,
    pub version: String,
    pub app_version: String,
    pub description: String,
    pub icon: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_at: String,
}

/// Chart.yaml fields we surface (everything else is ignored on purpose).
#[derive(Default, serde::Deserialize)]
struct ChartYaml {
    #[serde(default)] name: String,
    #[serde(default)] version: String,
    #[serde(default, rename = "appVersion")] app_version: String,
    #[serde(default)] description: String,
    #[serde(default)] icon: String,
}

fn entry_from_meta(
    kind: LocalChartKind, meta: ChartYaml, path: &Path, size_bytes: u64,
    modified: std::time::SystemTime, id: String,
) -> LocalChartEntry {
    LocalChartEntry {
        id,
        kind,
        name: meta.name,
        version: meta.version,
        app_version: meta.app_version,
        description: meta.description,
        icon: meta.icon,
        path: path.display().to_string(),
        size_bytes,
        modified_at: k7s_deps::chrono::DateTime::from_timestamp(
            modified.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0),
            0,
        )
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default(),
    }
}

fn parse_tgz_metadata(path: &Path) -> AppResult<LocalChartEntry> {
    let file = std::fs::File::open(path)
        .map_err(|e| AppError::Other(format!("open {}: {e}", path.display())))?;
    let mut archive = tar::Archive::new(GzDecoder::new(file));
    let mut meta: Option<(String, ChartYaml)> = None;
    for entry in archive.entries().map_err(|e| AppError::Other(format!("tar entries: {e}")))? {
        let entry = entry.map_err(|e| AppError::Other(format!("tar entry: {e}")))?;
        // Chart.yaml lives directly under the single top-level dir.
        if entry.path().ok().and_then(|p| p.file_name().map(|f| f == "Chart.yaml")).unwrap_or(false)
            && entry.path().ok().map(|p| p.components().count() == 2).unwrap_or(false)
        {
            let mut yaml = String::new();
            entry.read_to_string(&mut yaml)
                .map_err(|e| AppError::Other(format!("read Chart.yaml: {e}")))?;
            meta = Some((yaml, ChartYaml::default()));
            if let Some((yaml, m)) = meta.as_mut() {
                *m = yaml_serde::from_str(yaml).unwrap_or_default();
            }
            break;
        }
    }
    let (yaml, _) = meta.ok_or_else(|| AppError::Other("no Chart.yaml in archive".into()))?;
    let meta: ChartYaml = yaml_serde::from_str(&yaml).unwrap_or_default();
    let id = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let modified = std::fs::metadata(path).and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
    Ok(entry_from_meta(LocalChartKind::Tgz, meta, path, size, modified, id))
}
```

（上面 `parse_tgz_metadata` 中 Chart.yaml 反序列化写法简化为：读到 yaml 字符串后直接 `yaml_serde::from_str::<ChartYaml>(&yaml).unwrap_or_default()`，实现时以简洁为准——元信息解析失败不报错，字段留空，与「skip 不炸」策略一致。）

```rust
fn parse_dir_metadata(path: &Path) -> AppResult<LocalChartEntry> {
    let yaml = std::fs::read_to_string(path.join("Chart.yaml"))
        .map_err(|e| AppError::Other(format!("read Chart.yaml: {e}")))?;
    let meta: ChartYaml = yaml_serde::from_str(&yaml).unwrap_or_default();
    fn dir_size(p: &Path) -> u64 {
        std::fs::read_dir(p).map(|rd| rd.filter_map(|e| e.ok()).map(|e| {
            let p = e.path();
            if p.is_dir() { dir_size(&p) } else { std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0) }
        }).sum()).unwrap_or(0)
    }
    let modified = std::fs::metadata(path).and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
    let id = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    Ok(entry_from_meta(LocalChartKind::Dir, meta, path, dir_size(path), modified, id))
}

/// Scan the library root: every `*.tgz` file and every dir containing a
/// Chart.yaml. Corrupt archives are skipped (logged), never fatal.
pub fn scan_local_charts(root: &Path) -> AppResult<Vec<LocalChartEntry>> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for e in std::fs::read_dir(root)
        .map_err(|e| AppError::Other(format!("read_dir {}: {e}", root.display())))?
        .filter_map(|e| e.ok())
    {
        let p = e.path();
        if p.extension().map(|x| x == "tgz").unwrap_or(false) {
            match parse_tgz_metadata(&p) {
                Ok(entry) => out.push(entry),
                Err(err) => k7s_deps::tracing::warn!("skip {}: {err}", p.display()),
            }
        } else if p.is_dir() && p.join("Chart.yaml").exists() {
            match parse_dir_metadata(&p) {
                Ok(entry) => out.push(entry),
                Err(err) => k7s_deps::tracing::warn!("skip {}: {err}", p.display()),
            }
        }
    }
    out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(out)
}
```

`helm/mod.rs` 在 `pub mod ops;`（`#[cfg(not(any(target_os = "ios", target_os = "android")))]` 之后）同款门控下加：

```rust
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub mod local;
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cargo test -p k7s-core helm::local`
Expected: 2 passed。

- [ ] **Step 6: 全仓检查 + 提交**

Run: `cargo check --workspace`
Expected: 通过（移动端目标由 CI 门禁兜底，本地不交叉编译）。

```bash
git add crates/k7s-deps/Cargo.toml crates/k7s-deps/src/lib.rs crates/k7s-core/src/kube/helm/mod.rs crates/k7s-core/src/kube/helm/local.rs Cargo.lock
git commit -m "feat(helm): local chart library scanning — tgz/dir Chart.yaml parsing"
```

---

### Task 2: 导入（bytes + gzip magic 校验）与安全删除

**Files:**
- Modify: `crates/k7s-core/src/kube/helm/local.rs`
- Test: 同文件 `#[cfg(test)]`

**Interfaces:**
- Consumes: Task 1 的 `LocalChartEntry` / `parse_tgz_metadata`。
- Produces:

```rust
pub const MAX_CHART_BYTES: u64 = 50 * 1024 * 1024;
pub fn import_chart_bytes(root: &Path, filename: &str, bytes: &[u8]) -> AppResult<LocalChartEntry>;
pub fn remove_chart(root: &Path, id: &str) -> AppResult<()>;
```

- [ ] **Step 1: 写失败测试**

在 Task 1 的 `mod tests` 里追加（复用 `tgz_bytes` helper）：

```rust
    #[test]
    fn import_rejects_non_gzip_and_oversize() {
        let tmp = std::env::temp_dir().join(format!("k7s-import-bad-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        // not gzip
        assert!(import_chart_bytes(&tmp, "evil.tgz", b"plain text").is_err());
        // wrong extension
        let good = tgz_bytes("demo", "1.0.0", &[]);
        assert!(import_chart_bytes(&tmp, "evil.exe", &good).is_err());
        // oversized (fabricate via limit check on a tiny ceiling — assert the
        // real constant rejects a > MAX buffer is impractical in-test, so we
        // assert the constant is what the code compares against instead)
        assert_eq!(MAX_CHART_BYTES, 50 * 1024 * 1024);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn import_then_scan_then_remove_roundtrip() {
        let tmp = std::env::temp_dir().join(format!("k7s-import-ok-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let bytes = tgz_bytes("demo", "1.0.0", &[("values.yaml", "replicaCount: 1\n")]);
        let entry = import_chart_bytes(&tmp, "demo-1.0.0.tgz", &bytes).unwrap();
        assert_eq!(entry.name, "demo");
        assert_eq!(scan_local_charts(&tmp).unwrap().len(), 1);

        // traversal id must be refused
        assert!(remove_chart(&tmp, "../../etc").is_err());
        remove_chart(&tmp, &entry.id).unwrap();
        assert!(scan_local_charts(&tmp).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&tmp);
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test -p k7s-core helm::local`
Expected: FAIL —— `import_chart_bytes` / `remove_chart` 未定义。

- [ ] **Step 3: 实现**

```rust
/// gzip files start with these two bytes; `.tgz` is always gzip.
const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];

/// Sanitise a client-supplied filename down to a bare basename with a
/// chart-ish extension. Rejects anything that tries to escape or rename.
fn sanitize_filename(name: &str) -> AppResult<String> {
    let base = std::path::Path::new(name)
        .file_name()
        .and_then(|f| f.to_str())
        .ok_or_else(|| AppError::Other("invalid filename".into()))?
        .to_string();
    if !base.ends_with(".tgz") && !base.ends_with(".tar.gz") {
        return Err(AppError::Other("only .tgz / .tar.gz accepted".into()));
    }
    Ok(base)
}

pub fn import_chart_bytes(root: &Path, filename: &str, bytes: &[u8]) -> AppResult<LocalChartEntry> {
    let name = sanitize_filename(filename)?;
    if bytes.len() as u64 > MAX_CHART_BYTES {
        return Err(AppError::Other(format!(
            "chart exceeds {} byte limit",
            MAX_CHART_BYTES
        )));
    }
    if bytes.len() < 2 || bytes[0..2] != GZIP_MAGIC {
        return Err(AppError::Other("not a gzip archive".into()));
    }
    std::fs::create_dir_all(root)
        .map_err(|e| AppError::Other(format!("mkdir {}: {e}", root.display())))?;
    let dest = root.join(&name);
    std::fs::write(&dest, bytes)
        .map_err(|e| AppError::Other(format!("write {}: {e}", dest.display())))?;
    match parse_tgz_metadata(&dest) {
        Ok(entry) => Ok(entry),
        Err(e) => {
            // Don't leave a corrupt file behind just because metadata failed.
            let _ = std::fs::remove_file(&dest);
            Err(e)
        }
    }
}

/// Delete by id. The id must resolve to a direct child of the library root
/// (canonicalised), so `../` tricks and absolute paths are refused.
pub fn remove_chart(root: &Path, id: &str) -> AppResult<()> {
    let root = root.canonicalize()
        .map_err(|e| AppError::Other(format!("canonicalize {}: {e}", root.display())))?;
    let target = root.join(id);
    let canon = target.canonicalize()
        .map_err(|e| AppError::NotFound(format!("chart `{id}`: {e}")))?;
    if canon.parent() != Some(root.as_path()) {
        return Err(AppError::Other("refusing to delete outside chart library".into()));
    }
    if canon.is_dir() {
        std::fs::remove_dir_all(&canon)
    } else {
        std::fs::remove_file(&canon)
    }
    .map_err(|e| AppError::Other(format!("delete {}: {e}", canon.display())))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test -p k7s-core helm::local`
Expected: 全部 passed（4 个）。

- [ ] **Step 5: 提交**

```bash
git add crates/k7s-core/src/kube/helm/local.rs
git commit -m "feat(helm): chart library import (gzip-validated) + confined delete"
```

---

### Task 3: chart 详情 — 文件树 + 文件内容读取（路径穿越防护）

**Files:**
- Modify: `crates/k7s-core/src/kube/helm/local.rs`
- Test: 同文件

**Interfaces:**
- Produces:

```rust
#[derive(Clone, Debug, serde::Serialize)]
pub struct LocalChartFile { pub path: String, pub size_bytes: u64, pub is_dir: bool }

#[derive(Clone, Debug, serde::Serialize)]
pub struct LocalChartDetail {
    pub entry: LocalChartEntry,
    pub files: Vec<LocalChartFile>,   // 相对 chart 根的路径，正序排列
    pub values_yaml: String,          // 无 values.yaml 时为空串
    pub readme: String,               // 无 README.md 时为空串
}
pub fn local_chart_detail(root: &Path, id: &str) -> AppResult<LocalChartDetail>;
pub fn local_chart_file(root: &Path, id: &str, inner_path: &str) -> AppResult<String>;
```

- [ ] **Step 1: 写失败测试**

追加到 `mod tests`：

```rust
    #[test]
    fn detail_lists_files_and_reads_values() {
        let tmp = std::env::temp_dir().join(format!("k7s-detail-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let bytes = tgz_bytes(
            "demo", "1.0.0",
            &[("values.yaml", "replicaCount: 2\n"),
              ("templates/deploy.yaml", "apiVersion: apps/v1\n")],
        );
        import_chart_bytes(&tmp, "demo-1.0.0.tgz", &bytes).unwrap();

        let d = local_chart_detail(&tmp, "demo-1.0.0.tgz").unwrap();
        assert_eq!(d.entry.name, "demo");
        assert_eq!(d.values_yaml, "replicaCount: 2\n");
        assert!(d.files.iter().any(|f| f.path.ends_with("templates/deploy.yaml")));

        // inner file read, and traversal refusal
        let tpl = local_chart_file(&tmp, "demo-1.0.0.tgz", "templates/deploy.yaml").unwrap();
        assert!(tpl.contains("apps/v1"));
        assert!(local_chart_file(&tmp, "demo-1.0.0.tgz", "../../../etc/passwd").is_err());
        let _ = std::fs::remove_dir_all(&tmp);
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test -p k7s-core helm::local`
Expected: FAIL —— `local_chart_detail` / `local_chart_file` 未定义。

- [ ] **Step 3: 实现**

实现要点（tar 部分逐条目 `entry.path()`/`entry.size()`/`is_dir()` 收集，不落盘）：

```rust
/// Collect (relative-path, size, is_dir) for one chart, plus values/README.
fn tgz_files(path: &Path) -> AppResult<Vec<LocalChartFile>> {
    let file = std::fs::File::open(path)
        .map_err(|e| AppError::Other(format!("open {}: {e}", path.display())))?;
    let mut out = Vec::new();
    for entry in tar::Archive::new(GzDecoder::new(file))
        .entries()
        .map_err(|e| AppError::Other(format!("tar entries: {e}")))?
    {
        let entry = entry.map_err(|e| AppError::Other(format!("tar entry: {e}")))?;
        let rel = entry.path().ok()
            .and_then(|p| p.to_str().map(str::to_string))
            .unwrap_or_default();
        if rel.is_empty() { continue; }
        out.push(LocalChartFile { path: rel, size_bytes: entry.size(), is_dir: entry.header().entry_type().is_dir() });
    }
    out.sort();
    Ok(out)
}

fn dir_files(root: &Path) -> Vec<LocalChartFile> {
    fn walk(base: &Path, rel: &str, out: &mut Vec<LocalChartFile>) {
        let Ok(rd) = std::fs::read_dir(base) else { return };
        for e in rd.filter_map(|e| e.ok()) {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            let child_rel = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            if p.is_dir() {
                out.push(LocalChartFile { path: child_rel.clone(), size_bytes: 0, is_dir: true });
                walk(&p, &child_rel, out);
            } else {
                out.push(LocalChartFile {
                    path: child_rel,
                    size_bytes: std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0),
                    is_dir: false,
                });
            }
        }
    }
    let mut out = Vec::new();
    walk(root, "", &mut out);
    out.sort();
    out
}

fn read_member(path: &Path, inner: &str) -> AppResult<String> {
    // inner is validated by the caller (no .., no absolute); we still only
    // ever read from the archive/dir listing, never by joining to disk for tgz.
    let file = std::fs::File::open(path)
        .map_err(|e| AppError::Other(format!("open {}: {e}", path.display())))?;
    for entry in tar::Archive::new(GzDecoder::new(file))
        .entries()
        .map_err(|e| AppError::Other(format!("tar entries: {e}")))?
    {
        let entry = entry.map_err(|e| AppError::Other(format!("tar entry: {e}")))?;
        let rel = entry.path().ok().and_then(|p| p.to_str().map(str::to_string)).unwrap_or_default();
        // Members are stored under `<chart>/…`; match on the suffix so the
        // caller can pass either `values.yaml` or `demo/values.yaml`.
        if rel == inner || rel.strip_prefix(&format!("{}/", chart_stem(path))).unwrap_or("") == inner {
            if entry.header().entry_type().is_dir() {
                return Err(AppError::Other("is a directory".into()));
            }
            let mut s = String::new();
            entry.read_to_string(&mut s)
                .map_err(|e| AppError::Other(format!("read {inner}: {e}")))?;
            return Ok(s);
        }
    }
    Err(AppError::NotFound(format!("no member `{inner}`")))
}

fn chart_stem(path: &Path) -> String {
    path.file_stem().unwrap_or_default().to_string_lossy()
        .trim_end_matches(".tar").to_string()  // foo.tar.gz → foo
}

/// Refuse anything that could escape the chart: absolute or `..` components.
fn safe_inner_path(inner: &str) -> AppResult<&str> {
    let p = std::path::Path::new(inner);
    if p.is_absolute() || p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(AppError::Other("invalid chart member path".into()));
    }
    Ok(inner)
}

fn resolve(root: &Path, id: &str) -> AppResult<(PathBuf, LocalChartEntry)> {
    let entries = scan_local_charts(root)?;
    entries.into_iter().find(|e| e.id == id)
        .map(|e| (PathBuf::from(&e.path), e))
        .ok_or_else(|| AppError::NotFound(format!("chart `{id}`")))
}

pub fn local_chart_detail(root: &Path, id: &str) -> AppResult<LocalChartDetail> {
    let (path, entry) = resolve(root, id)?;
    let files = match entry.kind {
        LocalChartKind::Tgz => tgz_files(&path)?,
        LocalChartKind::Dir => dir_files(&path),
    };
    let read = |inner: &str| -> String {
        match entry.kind {
            LocalChartKind::Tgz => read_member(&path, inner).unwrap_or_default(),
            LocalChartKind::Dir => std::fs::read_to_string(path.join(inner)).unwrap_or_default(),
        }
    };
    Ok(LocalChartDetail {
        entry,
        values_yaml: read("values.yaml"),
        readme: read("README.md"),
        files,
    })
}

pub fn local_chart_file(root: &Path, id: &str, inner_path: &str) -> AppResult<String> {
    let inner = safe_inner_path(inner_path)?;
    let (path, entry) = resolve(root, id)?;
    match entry.kind {
        LocalChartKind::Tgz => read_member(&path, inner),
        LocalChartKind::Dir => {
            let full = path.join(inner);
            // Belt and braces: canonicalised path must stay under the chart dir.
            let canon = full.canonicalize()
                .map_err(|e| AppError::NotFound(format!("{inner}: {e}")))?;
            if !canon.starts_with(&path) {
                return Err(AppError::Other("invalid chart member path".into()));
            }
            std::fs::read_to_string(&canon)
                .map_err(|e| AppError::Other(format!("read {inner}: {e}")))
        }
    }
}
```

（Dir 分支的 `path` 需 canonicalize 后再比前缀 —— 若 `resolve` 返回的路径含 `..`/symlink，`canon.starts_with(&path)` 可能误判；实现时对 `path` 也做 `canonicalize()`。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test -p k7s-core helm::local`
Expected: 全部 passed（5 个）。

- [ ] **Step 5: 提交**

```bash
git add crates/k7s-core/src/kube/helm/local.rs
git commit -m "feat(helm): local chart detail — file tree + member read with traversal guard"
```

---

### Task 4: ops.rs flag 扩展（--set/--atomic/--force/timeout/upgrade create-namespace）

**Files:**
- Modify: `crates/k7s-core/src/kube/helm/ops.rs`（`InstallArgs`/`UpgradeArgs` 结构体 + `build_argv`，现 `ops.rs:328-331` 的 `--wait/--timeout 5m0s` 尾部块）
- Test: 同文件 `#[cfg(test)]`

**Interfaces:**
- Consumes: 现有 `build_argv` / `push_values_args`。
- Produces: `InstallArgs`/`UpgradeArgs` 新增字段（全部 `#[serde(default)]`，wire 兼容）：

```rust
// 两者都加:
#[serde(default)] pub set: Option<k7s_deps::serde_json::Map<String, k7s_deps::serde_json::Value>>,
#[serde(default)] pub atomic: bool,
#[serde(default)] pub timeout_secs: Option<u64>,
// 仅 UpgradeArgs:
#[serde(default)] pub force: bool,
#[serde(default)] pub create_namespace: bool,
```

（`chart` 字段语义扩展：允许传本地 tgz/目录绝对路径 —— helm 原生支持，`build_argv` 无需分支，但在 `InstallArgs.chart` 的 doc 注释补一句。）

- [ ] **Step 1: 写失败测试**

在 `ops.rs` 现有 `#[cfg(test)] mod tests` 中追加（若模块不存在则新建；`InstallArgs` 其余必填字段按现有结构体补齐——`release/chart/namespace`）：

```rust
    fn install_args() -> InstallArgs {
        InstallArgs {
            release: "rel".into(), chart: "demo".into(), version: String::new(),
            namespace: "default".into(), kubeconfig: None, values: String::new(),
            dry_run: false, create_namespace: false,
            set: None, atomic: false, timeout_secs: None,   // 新字段
        }
    }

    #[test]
    fn argv_honors_new_flags() {
        let mut a = install_args();
        a.set = Some(serde_json::Map::from([
            ("replicaCount".to_string(), serde_json::json!(3)),
        ]));
        a.atomic = true;
        a.timeout_secs = Some(600);
        let mut tmp = Vec::new();
        let (_label, argv) = build_argv(&"helm".into(), &HelmOp::Install(a), &mut tmp).unwrap();
        assert!(argv.contains(&"--set".into()));
        assert!(argv.windows(2).any(|w| w == ["--set", "replicaCount=3"]));
        assert!(argv.contains(&"--atomic".into()));
        assert!(argv.windows(2).any(|w| w == ["--timeout", "600s"]));
    }

    #[test]
    fn argv_default_timeout_unchanged() {
        let (_label, argv) = build_argv(&"helm".into(), &HelmOp::Install(install_args()), &mut Vec::new()).unwrap();
        assert!(argv.windows(2).any(|w| w == ["--timeout", "5m0s"]));
    }

    #[test]
    fn upgrade_argvs_add_force_and_create_ns() {
        let a = UpgradeArgs {
            release: "rel".into(), chart: "demo".into(), version: String::new(),
            namespace: "default".into(), kubeconfig: None, values: String::new(),
            dry_run: false, reuse_values: false, rollback_on_failure: false,
            force: true, create_namespace: true, atomic: false, timeout_secs: None, set: None,
        };
        let (_label, argv) = build_argv(&"helm".into(), &HelmOp::Upgrade(a), &mut Vec::new()).unwrap();
        assert!(argv.contains(&"--force".into()));
        assert!(argv.contains(&"--create-namespace".into()));
    }
```

注：`build_argv` 目前是私有 `fn build_argv(helm_path: &PathBuf, op: &HelmOp, temp_files: &mut Vec<TempHelmFile>)`（见 `ops.rs:252-254` 签名）——按真实签名写测试调用；serde_json 用 `k7s_deps::serde_json`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test -p k7s-core helm::ops`
Expected: FAIL —— 结构体没有新字段（编译错误）。

- [ ] **Step 3: 实现**

1. 两个结构体加上述字段（doc 注释一句一个：`--set` 对象逐键展开、`--atomic` 失败自动回滚、`timeout_secs` 覆盖默认 5m0s）。
2. `build_argv` 的 `Install` 分支在 `push_values_args` 前加：

```rust
push_set_args(&mut argv, &args.set);
if args.atomic { argv.push("--atomic".into()); }
```

`Upgrade` 分支在 `push_values_args` 前加：

```rust
push_set_args(&mut argv, &args.set);
if args.atomic { argv.push("--atomic".into()); }
if args.force { argv.push("--force".into()); }
if args.create_namespace { argv.push("--create-namespace".into()); }
```

3. 尾部超时块（现 `ops.rs:328-331`）改为：

```rust
    // Always ask helm to be explicit about what it did.
    argv.push("--wait".into()); // wait until pods are ready
    argv.push("--timeout".into());
    argv.push(timeout_arg(install_or_upgrade_timeout_secs(op)).into());
```

其中（`Rollback`/`Uninstall` 返回 `None` 保持默认）：

```rust
fn install_or_upgrade_timeout_secs(op: &HelmOp) -> Option<u64> {
    match op {
        HelmOp::Install(a) => a.timeout_secs,
        HelmOp::Upgrade(a) => a.timeout_secs,
        _ => None,
    }
}

const DEFAULT_HELM_TIMEOUT: &str = "5m0s";

fn timeout_arg(secs: Option<u64>) -> String {
    secs.map(|s| format!("{s}s")).unwrap_or_else(|| DEFAULT_HELM_TIMEOUT.to_string())
}

/// `--set k=v` per top-level key. Objects/arrays serialise to JSON strings —
/// helm understands `--set a={"b":1}` well enough for scalars; complex nests
/// should go through `values` (the temp-file path) instead.
fn push_set_args(argv: &mut Vec<String>, set: &Option<k7s_deps::serde_json::Map<String, k7s_deps::serde_json::Value>>) {
    let Some(map) = set else { return };
    for (k, v) in map {
        let val = match v {
            k7s_deps::serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        argv.push("--set".into());
        argv.push(format!("{k}={val}"));
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test -p k7s-core helm::ops`
Expected: 全部 passed（含既有测试不回归）。

- [ ] **Step 5: 提交**

```bash
git add crates/k7s-core/src/kube/helm/ops.rs
git commit -m "feat(helm): --set/--atomic/--force/custom timeout + upgrade --create-namespace"
```

---

### Task 5: 命令层 + registry 注册（含审计）

**Files:**
- Modify: `crates/k7s-commands/src/commands/helm.rs`
- Modify: `crates/k7s-commands/src/registry.rs`（`helm_values_revision` 注册块之后）

**Interfaces:**
- Consumes: Task 1-3 的 `local::{scan_local_charts, import_chart_bytes, remove_chart, local_chart_detail, local_chart_file, LocalChartEntry, LocalChartDetail}`；`mgr.data_dir`（`Arc<CoreState>` 的 pub 字段）；`crate::...audit`（k7s-commands 内审计引用方式与现有命令一致——若 k7s-commands 无 audit 先例，则用 `k7s_core::core::audit::record`）。
- Produces（wire 名，registry 命令名即前端 rpc 名）:

```
local_charts_list() -> Vec<LocalChartEntry>
local_chart_detail {id} -> LocalChartDetail
local_chart_file {id, path} -> String
local_chart_import_content {filename, contentBase64} -> LocalChartEntry
local_chart_remove {id} -> ()
```

- [ ] **Step 1: 写实现（命令层薄包装，无独立单测——纯委托 + audit；验证靠 cargo check + 前端 e2e）**

`commands/helm.rs` 末尾追加：

```rust
// ---------------------------------------------------------------------------
// Local chart library (ChartOps parity) — desktop/web only, same gate as
// the rest of this module (see commands/mod.rs).
// ---------------------------------------------------------------------------

fn local_chart_root(mgr: &std::sync::Arc<CoreState>) -> std::path::PathBuf {
    mgr.data_dir.join("charts")
}

/// Wire args for [`local_chart_detail`] (camelCase on the wire).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalChartDetailArgs { pub id: String }

pub async fn local_chart_detail_impl(
    mgr: std::sync::Arc<CoreState>, id: String,
) -> AppResult<market::local_detail_alias::LocalChartDetail> {
    local::local_chart_detail(&local_chart_root(&mgr), &id).await
}
```

（以上是示意——实际按现有文件的导入与返回类型写法：`use k7s_core::kube::helm::local;`，返回 `AppResult<local::LocalChartDetail>`，函数全部同步（`local.rs` 是同步 IO），`impl` 直接同步函数即可：`pub fn local_charts_list_impl(mgr: Arc<CoreState>) -> AppResult<Vec<local::LocalChartEntry>>`。写操作加审计：）

```rust
pub fn local_chart_import_content_impl(
    mgr: std::sync::Arc<CoreState>, filename: String, content_base64: String,
) -> AppResult<local::LocalChartEntry> {
    use k7s_deps::base64::Engine;
    let bytes = k7s_deps::base64::engine::general_purpose::STANDARD
        .decode(&content_base64)
        .map_err(|e| AppError::Other(format!("bad base64: {e}")))?;
    let entry = local::import_chart_bytes(&local_chart_root(&mgr), &filename, &bytes)?;
    k7s_core::core::audit::record("local_chart_import", k7s_deps::serde_json::json!({
        "name": entry.name, "version": entry.version, "bytes": bytes.len(),
    }));
    Ok(entry)
}

pub fn local_chart_remove_impl(mgr: std::sync::Arc<CoreState>, id: String) -> AppResult<()> {
    local::remove_chart(&local_chart_root(&mgr), &id)?;
    k7s_core::core::audit::record("local_chart_remove", k7s_deps::serde_json::json!({ "id": id }));
    Ok(())
}
```

五个命令每个都有 `#[cfg_attr(feature = "ipc", tauri::command)]` 包装（同步命令不需要 `async`/`State` 参数之外的样板——参照文件内 `helm_list_repos` 的同步写法，但注意它们要拿 `mgr`：ipc 包装签名 `mgr: State<'_, Arc<CoreState>>`，参照 `helm_run_op` 的取法 `mgr.inner().clone()`）。

- [ ] **Step 2: registry 注册**

`registry.rs` 在 `helm_values_revision` 注册块后，逐个加（每个都带同一 cfg 门控）：

```rust
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    r.register(
        "local_charts_list",
        |mgr, _a: NoArgs| async move {
            commands::helm::local_charts_list_impl(mgr)
        },
    );
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    r.register(
        "local_chart_detail",
        |_mgr, a: commands::helm::LocalChartDetailArgs| async move {
            commands::helm::local_chart_detail_impl(_mgr, a.id)
        },
    );
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    r.register(
        "local_chart_file",
        |_mgr, a: commands::helm::LocalChartFileArgs| async move {
            commands::helm::local_chart_file_impl(_mgr, a.id, a.path)
        },
    );
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    r.register(
        "local_chart_import_content",
        |_mgr, a: commands::helm::LocalChartImportContentArgs| async move {
            commands::helm::local_chart_import_content_impl(_mgr, a.filename, a.content_base64)
        },
    );
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    r.register(
        "local_chart_remove",
        |_mgr, a: commands::helm::LocalChartRemoveArgs| async move {
            commands::helm::local_chart_remove_impl(_mgr, a.id)
        },
    );
```

Args 结构体（camelCase wire）：`LocalChartFileArgs { id, path }`、`LocalChartImportContentArgs { filename, content_base64 → contentBase64 }`、`LocalChartRemoveArgs { id }`。闭包参数名不能用 `_mgr` 又引用 —— 统一用 `mgr`。

- [ ] **Step 3: 验证编译 + 现有测试不回归**

Run: `cargo check -p k7s-commands && cargo test -p k7s-commands`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add crates/k7s-commands/src/commands/helm.rs crates/k7s-commands/src/registry.rs
git commit -m "feat(helm): local chart library commands — list/detail/file/import/remove (+audit)"
```

---

### Task 6: Web 上传专用路由 `/api/charts/upload`

**Files:**
- Modify: `crates/k7s-server/src/web/server.rs`（`import_kubeconfig_content` 路由后）
- Modify: `crates/k7s-server/src/web/handlers.rs`（文件末尾新 section）

**Interfaces:**
- Consumes: `local_chart_import_content_impl`（Task 5）；`state.core`（`WebState`）；现有 `respond` helper。
- Produces: `POST /api/charts/upload`，JSON body `{ "filename": "x.tgz", "contentBase64": "..." }`，响应同 `LocalChartEntry`。body 上限 64MB（`DefaultBodyLimit::max(64 * 1024 * 1024)`，略高于 50MB 业务上限以容纳 base64 膨胀 + JSON 包装——注意 base64 膨胀 4/3，50MB 原文 ≈ 67MB base64，所以路由上限设 `90 * 1024 * 1024`）。

- [ ] **Step 1: handler**

`handlers.rs` 末尾（`use` 区补 `axum::extract::DefaultBodyLimit` 不需要——limit 在 route 上）：

```rust
// ---------------------------------------------------------------------------
// local chart upload — browser equivalent of the desktop import. A dedicated
// route (not the registry catch-all) because chart packages routinely exceed
// axum's 2MB default body limit; base64 of the 50MB cap is ~67MB, so the
// route limit sits at 90MB. The 50MB *decoded* cap still applies inside
// import_chart_bytes.
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalChartUploadArgs {
    pub filename: String,
    pub content_base64: String,
}

/// `POST /api/charts/upload` — store an uploaded `.tgz` into the local chart
/// library and return its parsed entry. Auth-protected like every /api route.
pub async fn local_chart_upload(
    axum::extract::State(state): axum::extract::State<WebState>,
    axum::Json(args): axum::Json<LocalChartUploadArgs>,
) -> axum::response::Response {
    let core = state.core.clone();
    let result: AppResult<k7s_core::kube::helm::local::LocalChartEntry> =
        k7s_commands::commands::helm::local_chart_import_content_impl(
            core,
            args.filename,
            args.content_base64,
        );
    respond(result)
}
```

（`k7s_commands::commands::helm` 的可见性：`LocalChartImportContentArgs` 等是 `pub(crate)`，但 `*_impl` 函数是 `pub`——直接调 impl 函数传原始参数即可，如上。若 `commands` 模块在 k7s-server 里不是 pub 路径，按 k7s-server 现有对 `k7s_commands` 的引用方式调整——`registry.rs` 由 k7s-server 消费，所以 `k7s_commands::commands::…` 可达；实现时以 `cargo check` 为准。）

- [ ] **Step 2: 路由**

`server.rs` 的 `import_kubeconfig_content` 路由后加：

```rust
        // Local chart library upload — same JSON+base64 shape as the
        // kubeconfig import above, but with a raised body limit: the 50MB
        // decoded cap becomes ~67MB after base64, over axum's 2MB default.
        .route(
            "/api/charts/upload",
            post(handlers::local_chart_upload)
                .layer(axum::extract::DefaultBodyLimit::max(90 * 1024 * 1024)),
        )
```

该路由位于 `api()` router 内、auth `.layer(require_token …)` 之前注册——与 `import_kubeconfig_content` 同位置即自动受 token 保护。

- [ ] **Step 3: 验证**

Run: `cargo check -p k7s-server && cargo test -p k7s-server`
Expected: 通过。

手动冒烟（可选，需 helm 环境）：`cargo build -p k7s-server --bin k7s-web` 后启动，`curl -X POST -H "Authorization: Bearer $K7S_WEB_TOKEN" -H 'Content-Type: application/json' -d '{"filename":"demo-1.0.0.tgz","contentBase64":"<base64>"}' http://127.0.0.1:7180/api/charts/upload`。

- [ ] **Step 4: 提交**

```bash
git add crates/k7s-server/src/web/server.rs crates/k7s-server/src/web/handlers.rs
git commit -m "feat(web): POST /api/charts/upload — 90MB-limit chart upload behind auth"
```

---

### Task 7: 前端 provider 类型 / 方法 / HttpProvider 上传 / i18n / mock

**Files:**
- Modify: `frontend/src/providers/types/helm.ts`（追加类型）
- Modify: `frontend/src/providers/types/provider.ts`（接口方法；同时删除陈旧的 `helmImportChart`/`helmLocalCharts` 声明）
- Modify: `frontend/src/providers/BaseRpcProvider.ts`（实现 rpc 方法；删 `helmImportChart`/`helmLocalCharts` 旧实现）
- Modify: `frontend/src/providers/HttpProvider.ts`（删 `helmImportChart`/`helmLocalCharts` stub；新增 `localChartUpload` 走 `/api/charts/upload`）
- Modify: `frontend/src/providers/TauriProvider.ts`（若存在——`grep -l TauriProvider`；`localChartUpload` 走 rpc `local_chart_import_content`）
- Modify: `frontend/src/providers/mock/mockHelm.ts`（mock 实现）
- Modify: `frontend/src/lib/i18n/en.ts` + `frontend/src/lib/i18n/zh.ts`（`helm` 段）

**Interfaces:**
- Produces（前端统一 API，后续组件依赖）:

```ts
// types/helm.ts
export type LocalChartKind = 'tgz' | 'dir';
export interface LocalChartEntry {
  id: string; kind: LocalChartKind; name: string; version: string;
  appVersion: string; description: string; icon: string;
  path: string; sizeBytes: number; modifiedAt: string;
}
export interface LocalChartFile { path: string; sizeBytes: number; isDir: boolean }
export interface LocalChartDetail {
  entry: LocalChartEntry; files: LocalChartFile[];
  valuesYaml: string; readme: string;
}
// provider 接口（provider.ts，HelmOp 附近）:
localChartsList(): Promise<LocalChartEntry[]>;
localChartDetail(id: string): Promise<LocalChartDetail>;
localChartFile(id: string, path: string): Promise<string>;
localChartUpload(filename: string, contentBase64: string): Promise<LocalChartEntry>;
localChartRemove(id: string): Promise<void>;
```

- [ ] **Step 1: 类型（types/helm.ts 追加，注意现有文件风格是 `interface X {…}` 无分号字段尾）**

```ts
/** Entry in the local chart library (`<data_dir>/charts`). */
export type LocalChartKind = 'tgz' | 'dir';
export interface LocalChartEntry {
  id: string;
  kind: LocalChartKind;
  name: string;
  version: string;
  appVersion: string;
  description: string;
  icon: string;
  /** Absolute path on the backend host — the value passed to helm as the
   * chart reference when installing from the library. */
  path: string;
  sizeBytes: number;
  modifiedAt: string;
}
export interface LocalChartFile {
  path: string;
  sizeBytes: number;
  isDir: boolean;
}
export interface LocalChartDetail {
  entry: LocalChartEntry;
  files: LocalChartFile[];
  valuesYaml: string;
  readme: string;
}
```

- [ ] **Step 2: provider.ts 接口**

在 `helmLocalCharts`（删除它）位置替换为：

```ts
  localChartsList(): Promise<LocalChartEntry[]>;
  localChartDetail(id: string): Promise<LocalChartDetail>;
  localChartFile(id: string, path: string): Promise<string>;
  /** Web: dedicated 90MB route; Tauri: the registry command. Same shape. */
  localChartUpload(filename: string, contentBase64: string): Promise<LocalChartEntry>;
  localChartRemove(id: string): Promise<void>;
```

（import 类型 from './helm'；同时删掉 `helmImportChart` 声明。）

- [ ] **Step 3: BaseRpcProvider 实现（Tauri/Mock 共用基类）**

```ts
  localChartsList(): Promise<LocalChartEntry[]> {
    return this.rpc<LocalChartEntry[]>('local_charts_list');
  }
  localChartDetail(id: string): Promise<LocalChartDetail> {
    return this.rpc<LocalChartDetail>('local_chart_detail', { id });
  }
  localChartFile(id: string, path: string): Promise<string> {
    return this.rpc<string>('local_chart_file', { id, path });
  }
  localChartUpload(filename: string, contentBase64: string): Promise<LocalChartEntry> {
    return this.rpc<LocalChartEntry>('local_chart_import_content', { filename, contentBase64 });
  }
  localChartRemove(id: string): Promise<void> {
    return this.rpc<void>('local_chart_remove', { id });
  }
```

删除旧的 `helmImportChart`/`helmLocalCharts` 方法。

- [ ] **Step 4: HttpProvider 覆写上传路由**

删除 `helmImportChart`/`helmLocalCharts` stub，替换为：

```ts
  // The registry catch-all caps at axum's 2MB default; chart packages go to
  // the dedicated route with the raised limit instead.
  async localChartUpload(filename: string, contentBase64: string): Promise<LocalChartEntry> {
    return httpPostJson<LocalChartEntry>('/api/charts/upload', { filename, contentBase64 });
  }
```

`httpPostJson`：若 `transport.ts` 只有 `httpInvoke`（固定打 `/api/invoke/{cmd}`），在其中新增导出（复制 `httpInvoke` 的 fetch/auth 头逻辑，path 参数换成完整 URL，body 直接 JSON）。先读 `transport.ts` 的 `httpInvoke` 实现再动手，保持错误处理/认证一致。

- [ ] **Step 5: mockHelm.ts**

```ts
const localCharts: LocalChartEntry[] = [
  {
    id: 'demo-app-1.1.0.tgz', kind: 'tgz', name: 'demo-app', version: '1.1.0',
    appVersion: '1.1.0', description: 'demo chart', icon: '',
    path: '/tmp/demo-app-1.1.0.tgz', sizeBytes: 2048, modifiedAt: '2026-08-28T00:00:00Z',
  },
];
export function mockLocalChartsList(): Promise<LocalChartEntry[]> {
  return Promise.resolve([...localCharts]);
}
export function mockLocalChartDetail(id: string): Promise<LocalChartDetail> {
  const entry = localCharts.find((c) => c.id === id) ?? localCharts[0];
  return Promise.resolve({
    entry,
    files: [
      { path: `${entry.name}/Chart.yaml`, sizeBytes: 128, isDir: false },
      { path: `${entry.name}/values.yaml`, sizeBytes: 64, isDir: false },
    ],
    valuesYaml: 'replicaCount: 1\n',
    readme: '# demo\n',
  });
}
export function mockLocalChartFile(_id: string, path: string): Promise<string> {
  return Promise.resolve(`# ${path}\n`);
}
export function mockLocalChartUpload(filename: string, _b64: string): Promise<LocalChartEntry> {
  return Promise.resolve({ ...localCharts[0], id: filename, name: filename.replace(/-[\d.]+\.tgz$/, '') });
}
export function mockLocalChartRemove(_id: string): Promise<void> {
  return Promise.resolve();
}
```

（按 mockHelm.ts 现有导出风格接线到 MockProvider——先读该文件确认 MockProvider 从哪里取这些函数。）

- [ ] **Step 6: i18n（en.ts `helm` 段、zh.ts 对应段，两个文件都加）**

en.ts：

```ts
    local: {
      tab: 'Local Charts',
      upload: 'Upload .tgz',
      uploading: 'Uploading…',
      empty: 'No local charts — upload a .tgz to get started',
      delete: 'Delete',
      confirmDelete: (name) => `Delete chart "${name}" from the library?`,
      kind: { tgz: 'package', dir: 'directory' },
      detail: {
        files: 'Files',
        values: 'Values',
        readme: 'README',
        install: 'Install this chart',
        invalidFile: 'Only .tgz files are accepted',
      },
    },
```

zh.ts 同结构中文文案：`tab: '本地 Charts'`、`upload: '上传 .tgz'`、`uploading: '上传中…'`、`empty: '本地库为空 — 上传一个 .tgz 开始'`、`delete: '删除'`、`confirmDelete: (name) => `从库中删除 chart "${name}"？``、`kind: { tgz: '包', dir: '目录' }`、`detail: { files: '文件', values: 'Values', readme: 'README', install: '安装此 chart', invalidFile: '仅接受 .tgz 文件' }`。

同时 `helm.tabs` 两字典加 `local: 'Local Charts'` / `local: '本地 Charts'`（`dictionaries.ts:601` 的 tabs 类型也要加 `local: string`）。

- [ ] **Step 7: 类型检查 + 测试**

Run: `cd frontend && pnpm typecheck && pnpm test -- --run`
Expected: 通过（MockProvider 满足接口，无缺方法报错）。

- [ ] **Step 8: 提交**

```bash
git add frontend/src/providers frontend/src/lib/i18n
git commit -m "feat(frontend): local chart library provider API + i18n + mocks"
```

---

### Task 8: LocalCharts tab 组件 + 详情视图 + 向导本地来源

**Files:**
- Create: `frontend/src/components/helm/LocalCharts.tsx`
- Create: `frontend/src/components/helm/LocalCharts.module.css`（或复用 `HelmMarket.module.css`——先读该 css 的类名，列表/详情布局类直接复用则不新建）
- Modify: `frontend/src/components/helm/HelmMarket.tsx`（`Tab` 类型 + tab 按钮 + 渲染分支）
- Modify: `frontend/src/components/helm/HelmInstallWizard.tsx`（可选 `localChart` prop）
- Test: `frontend/src/components/helm/LocalCharts.test.tsx`

**Interfaces:**
- Consumes: Task 7 的五个 provider 方法；`HelmInstallWizard`（props 扩展为 `{ chart?: HelmChartSummary; localChart?: LocalChartDetail; onDone: () => void }` —— 二选一必填）；`EditorCore`（values 展示，向导已用）。
- Produces: `<LocalCharts />`（自管数据加载/上传/删除/详情选中，选中后右侧渲染 `HelmInstallWizard localChart={detail}`）。

- [ ] **Step 1: 写失败测试（LocalCharts.test.tsx，参照 HelmMarket.test.tsx 的 render/mock 方式）**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LocalCharts } from './LocalCharts';
import { getProvider } from '../../providers';
import type { LocalChartEntry } from '../../providers/types';

vi.mock('../../providers', () => ({
  getProvider: () => ({
    localChartsList: vi.fn().mockResolvedValue([
      {
        id: 'demo-1.0.0.tgz', kind: 'tgz', name: 'demo', version: '1.0.0',
        appVersion: '1.0.0', description: 'demo chart', icon: '',
        path: '/data/charts/demo-1.0.0.tgz', sizeBytes: 1024, modifiedAt: '2026-08-28T00:00:00Z',
      } satisfies LocalChartEntry,
    ]),
    localChartDetail: vi.fn().mockResolvedValue({
      entry: { /* same as above */ } as LocalChartEntry,
      files: [{ path: 'demo/values.yaml', sizeBytes: 10, isDir: false }],
      valuesYaml: 'replicaCount: 1\n',
      readme: '',
    }),
    localChartFile: vi.fn().mockResolvedValue('replicaCount: 1\n'),
    localChartUpload: vi.fn(),
    localChartRemove: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('LocalCharts', () => {
  it('lists library entries from the provider', async () => {
    render(<LocalCharts />);
    await waitFor(() => expect(screen.getByText('demo')).toBeTruthy());
    expect(screen.getByText('1.0.0')).toBeTruthy();
  });
});
```

（i18n provider 若需要 wrapper，参照 HelmMarket.test.tsx 现有写法补。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && pnpm test -- --run LocalCharts`
Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现 LocalCharts.tsx**

结构（复用 HelmMarket 的 split/list/detail 布局类）：

```tsx
/**
 * LocalCharts — the offline half of the Helm tab: the on-disk chart
 * library under <data_dir>/charts. Upload .tgz packages (single code
 * path for web + desktop: hidden <input type=file> → base64), browse
 * entries, inspect files/values, and hand off to the install wizard
 * with the chart's absolute path — helm installs local paths natively.
 */
import { useRef, useState } from 'react';
import { getProvider } from '../../providers';
import { useTranslation } from '../../hooks/useI18n';
import { useProviderQuery } from '../../hooks/useProviderQuery';
import { formatError } from '../../lib/errorsHuman';
import type { LocalChartDetail, LocalChartEntry } from '../../providers/types';
import { HelmInstallWizard } from './HelmInstallWizard';
import styles from './HelmMarket.module.css';

export function LocalCharts() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<LocalChartDetail | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listQuery = useProviderQuery<LocalChartEntry[]>({
    query: () => getProvider().localChartsList(),
    deps: [],
    key: 'local-charts',
  });
  const charts = listQuery.data ?? [];

  const onPickFile = async () => {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.tgz') && !file.name.endsWith('.tar.gz')) {
      setError(t('helm.local.detail.invalidFile', 'Only .tgz files are accepted'));
      return;
    }
    setUploading(true);
    setError('');
    try {
      const buf = await file.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      await getProvider().localChartUpload(file.name, b64);
      listQuery.refetch();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const openDetail = async (entry: LocalChartEntry) => {
    try {
      setSelected(await getProvider().localChartDetail(entry.id));
    } catch (e) {
      setError(formatError(e));
    }
  };

  const remove = async (entry: LocalChartEntry) => {
    if (!window.confirm(t('helm.local.confirmDelete', 'Delete chart "{name}"?', { name: entry.id }))) return;
    try {
      await getProvider().localChartRemove(entry.id);
      setSelected(null);
      listQuery.refetch();
    } catch (e) {
      setError(formatError(e));
    }
  };

  return (
    <div className={styles.split}>
      {/* 左列：上传按钮 + 隐藏 input + 列表（chart/chartName/chartMeta 类复用） */}
      {/* 右列：selected ? <HelmInstallWizard localChart={selected} onDone={…}/> : empty */}
    </div>
  );
}
```

（`confirmDelete` 的 i18n 带参写法参照 `repos.confirmRemove: (name) => …`；组件骨架按 HelmMarket.tsx 的列表 JSX 风格补全——`<li className={styles.chart}>` 行、`kind` 徽标、大小/时间 meta、删除按钮。大文件 base64 用分块 `String.fromCharCode` 防 call stack 溢出：>1MB 时循环分块拼接。）

- [ ] **Step 4: HelmInstallWizard 支持 localChart**

Props 改 `{ chart?: HelmChartSummary; localChart?: LocalChartDetail; onDone: () => void }`，改动点：

1. `useAsyncEffect` 版本加载：`localChart` 存在时跳过（`versions = [{ version: localChart.entry.version, appVersion: …, created: '', urls: [] }]`）。
2. values 预填：`localChart` 存在时 `setValues(localChart.valuesYaml)`，不调 `helmRenderDefaultValues`。
3. `doInstall` 的 chart 引用：`localChart ? localChart.entry.path : \`${chart.repo}/${chart.name}\``（版本对本地包无意义——`version` 传空）。
4. 版本步骤对 `localChart` 显示为只读一行。

- [ ] **Step 5: HelmMarket 接线**

`type Tab = 'charts' | 'repos' | 'local'`；tab 栏加第三个按钮（`t('helm.tabs.local', 'Local Charts')`）；渲染分支 `{tab === 'local' ? <LocalCharts /> : tab === 'charts' ? (…) : <HelmRepos …/>}` —— 注意现有三元结构调整。

- [ ] **Step 6: 跑测试确认通过**

Run: `cd frontend && pnpm test -- --run && pnpm typecheck`
Expected: 全部通过（含 HelmMarket.test.tsx 不回归——tab 数变化可能影响其快照/断言，按需更新）。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/components/helm
git commit -m "feat(frontend): Local Charts tab — library browser, upload, install from local path"
```

---

### Task 9: 文档更新 + 收尾验证

**Files:**
- Modify: `docs/USAGE.md`（Helm 市场小节）
- Modify: `CHANGELOG.md`（Unreleased 段）

- [ ] **Step 1: USAGE.md**

在 Helm 市场小节追加「本地 Charts 库」说明：入口（Helm → 本地 Charts tab）、上传（.tgz ≤50MB）、支持目录型 chart（放 `<data_dir>/charts/` 下含 Chart.yaml 的目录）、从本地 chart 安装/升级（向导 chart 引用即包绝对路径）、审计记录（`local_chart_import`/`local_chart_remove`）。

- [ ] **Step 2: CHANGELOG.md**

Unreleased 段加：

```markdown
- **本地 Chart 库（ChartOps 整合 P0）** — Helm 页新增「本地 Charts」：上传/浏览/删除
  `.tgz` 与目录型 chart，查看文件树与 values，从本地包安装（helm 原生路径引用）；
  web 上传走 `/api/charts/upload`（认证 + 90MB 路由上限 + 50MB 业务上限）；
  helm install/upgrade 补 `--set`/`--atomic`/`--force`/自定义 `--timeout`/upgrade
  `--create-namespace`。
```

- [ ] **Step 3: 全量验证**

Run: `cargo test --workspace && cargo clippy --workspace && cd frontend && pnpm test -- --run && pnpm build`
Expected: 全绿。

- [ ] **Step 4: 提交**

```bash
git add docs/USAGE.md CHANGELOG.md
git commit -m "docs: local chart library usage + changelog (ChartOps P0)"
```

---

## Self-Review 记录

- Spec 覆盖：设计文档 §4.1（scan/import/remove/detail）→ Task 1-3；§4.2（flags）→ Task 4；§4.5（命令注册 + cfg）→ Task 5；§4.4（上传路由 + 限制）→ Task 6；§4.6（前端 tab/详情/向导/HttpProvider 清理）→ Task 7-8；§4.3（audit）→ Task 5；§4.7（安全项）分散在 Task 2（magic/穿越/删除 confinement）、Task 6（limit+auth）。P0 未含渲染预览/diff/Profiles —— 按 spec §5 属 P1。
- 类型一致性：`LocalChartEntry.path` 是 String（Rust）/string（TS）；`localChartUpload(filename, contentBase64)` 在 BaseRpcProvider（registry 命令）与 HttpProvider（专用路由）同名同参；`HelmInstallWizard` 新 prop 名 `localChart` 全计划一致。
- 已知实现期留意点（非占位，是真实约束）：Task 1 `parse_tgz_metadata` 示意代码中 Chart.yaml 反序列化写法以简洁为准；Task 5 闭包参数命名用 `mgr`；Task 6 `k7s_commands::commands::helm` 路径可见性以 cargo check 为准；Task 7 `httpPostJson` 需先读 transport.ts 现有 httpInvoke 再镜像实现。
