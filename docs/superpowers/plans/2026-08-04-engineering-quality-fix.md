# k7s 工程质量修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 k7s 项目中的所有工程质量问题，包括 CI、安全、代码质量、测试和文档。

**Architecture:** 按 Phase 1-5 顺序执行，每个 Phase 独立验证。Phase 1-2 是基础设施，Phase 3 是核心重构，Phase 4-5 是质量保证。

**Tech Stack:** pnpm, ESLint, Prettier, rustfmt, clippy, Vitest, GitHub Actions

## Global Constraints

- 使用 pnpm 10.33.0 作为包管理器
- Rust edition 2021, MSRV 1.77.2
- TypeScript strict mode
- 所有测试必须通过才能提交

---

## Phase 1: 基础设施

### Task 1.1: 统一包管理器

**Files:**
- DELETE: `package-lock.json`
- MODIFY: `Dockerfile:32`
- MODIFY: `src-tauri/tauri.conf.json:8-9`

- [ ] **Step 1: 删除 package-lock.json**

```bash
rm /Users/zhangyi/my_project/k7s/package-lock.json
```

- [ ] **Step 2: 更新 Dockerfile pnpm 版本**

```dockerfile
# Dockerfile:32
# 修改前:
RUN corepack prepare pnpm@9 --activate

# 修改后:
RUN corepack prepare pnpm@10.33.0 --activate
```

- [ ] **Step 3: 更新 tauri.conf.json 使用 pnpm**

```json
// src-tauri/tauri.conf.json:8-9
// 修改前:
"beforeDevCommand": "npm run dev",
"beforeBuildCommand": "npm run build",

// 修改后:
"beforeDevCommand": "pnpm dev",
"beforeBuildCommand": "pnpm build",
```

- [ ] **Step 4: 验证**

```bash
cd /Users/zhangyi/my_project/k7s
pnpm install --frozen-lockfile
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: unify package manager to pnpm, remove package-lock.json"
```

---

### Task 1.2: 配置 ESLint

**Files:**
- CREATE: `.eslintrc.cjs`
- MODIFY: `package.json`

- [ ] **Step 1: 创建 .eslintrc.cjs**

```javascript
// /Users/zhangyi/my_project/k7s/.eslintrc.cjs
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
};
```

- [ ] **Step 2: 安装依赖**

```bash
cd /Users/zhangyi/my_project/k7s
pnpm add -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint-plugin-react-hooks eslint-plugin-react-refresh
```

- [ ] **Step 3: 添加 scripts 到 package.json**

```json
// package.json scripts
{
  "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
  "lint:fix": "eslint . --ext ts,tsx --fix"
}
```

- [ ] **Step 4: 运行 lint 验证**

```bash
pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: add ESLint configuration"
```

---

### Task 1.3: 配置 Prettier

**Files:**
- CREATE: `.prettierrc`
- MODIFY: `package.json`

- [ ] **Step 1: 创建 .prettierrc**

```json
// /Users/zhangyi/my_project/k7s/.prettierrc
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "es5",
  "tabWidth": 2,
  "printWidth": 100
}
```

- [ ] **Step 2: 安装依赖**

```bash
cd /Users/zhangyi/my_project/k7s
pnpm add -D prettier
```

- [ ] **Step 3: 添加 scripts 到 package.json**

```json
// package.json scripts
{
  "format": "prettier --write \"src/**/*.{ts,tsx,css,json}\"",
  "format:check": "prettier --check \"src/**/*.{ts,tsx,css,json}\""
}
```

- [ ] **Step 4: 运行 format 验证**

```bash
pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: add Prettier configuration"
```

---

### Task 1.4: 配置 rustfmt + clippy

**Files:**
- CREATE: `src-tauri/rustfmt.toml`

- [ ] **Step 1: 创建 rustfmt.toml**

```toml
# /Users/zhangyi/my_project/k7s/src-tauri/rustfmt.toml
edition = "2021"
max_width = 100
tab_spaces = 4
```

- [ ] **Step 2: 验证 rustfmt**

```bash
cd /Users/zhangyi/my_project/k7s/src-tauri
cargo fmt --check
```

- [ ] **Step 3: 验证 clippy**

```bash
cd /Users/zhangyi/my_project/k7s/src-tauri
cargo clippy -- -D warnings
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: add rustfmt configuration"
```

---

### Task 1.5: 配置基础 CSP

**Files:**
- MODIFY: `src-tauri/tauri.conf.json:28`

- [ ] **Step 1: 更新 CSP 配置**

```json
// src-tauri/tauri.conf.json:28
// 修改前:
"csp": null

// 修改后:
"csp": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: https://asset.localhost; connect-src ipc: http://ipc.localhost"
```

- [ ] **Step 2: 验证 Tauri 构建**

```bash
cd /Users/zhangyi/my_project/k7s
pnpm tauri build --debug
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "security: enable basic CSP for Tauri"
```

---

## Phase 2: CI 重构

### Task 2.1: 重构 GitHub Actions

**Files:**
- MODIFY: `.github/workflows/release.yml`

- [ ] **Step 1: 创建新的 CI job 结构**

```yaml
# .github/workflows/release.yml
name: CI & Release

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
    branches: [main]

jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 26
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test -- --run

  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy, rustfmt
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - run: cargo check
      - run: cargo clippy -- -D warnings
      - run: cargo fmt --check
      - run: cargo test

  release:
    needs: [frontend, backend]
    if: startsWith(github.ref, 'refs/tags/v')
    strategy:
      matrix:
        include:
          - platform: macos-latest
            args: '--target aarch64-apple-darwin'
          - platform: macos-latest
            args: '--target x86_64-apple-darwin'
          - platform: ubuntu-22.04
            args: ''
          - platform: windows-latest
            args: ''
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 26
          cache: 'pnpm'
      - name: install dependencies (ubuntu only)
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
      - run: pnpm install --frozen-lockfile
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: v__VERSION__
          releaseName: 'v__VERSION__'
          releaseBody: 'See the assets to download and install this version.'
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}

  docker:
    needs: release
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:latest
            ghcr.io/${{ github.repository }}:${{ github.ref_name }}
```

- [ ] **Step 2: 验证 YAML 语法**

```bash
cd /Users/zhangyi/my_project/k7s
yamllint .github/workflows/release.yml
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "ci: restructure workflow with separate frontend/backend jobs"
```

---

### Task 2.2: 创建本地 CI 脚本

**Files:**
- CREATE: `scripts/pre-commit.sh`

- [ ] **Step 1: 创建 pre-commit.sh**

```bash
#!/bin/bash
# /Users/zhangyi/my_project/k7s/scripts/pre-commit.sh

set -e

echo "Running pre-commit checks..."

# Frontend checks
echo "1/4 Frontend lint..."
pnpm lint

echo "2/4 Frontend typecheck..."
pnpm typecheck

echo "3/4 Frontend tests..."
pnpm test -- --run

# Backend checks
echo "4/4 Backend checks..."
cd src-tauri
cargo fmt --check
cargo clippy -- -D warnings
cargo test
cd ..

echo "All pre-commit checks passed!"
```

- [ ] **Step 2: 设置可执行权限**

```bash
chmod +x /Users/zhangyi/my_project/k7s/scripts/pre-commit.sh
```

- [ ] **Step 3: 验证脚本**

```bash
cd /Users/zhangyi/my_project/k7s
./scripts/pre-commit.sh
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: add local CI pre-commit script"
```

---

## Phase 3: 代码质量 - 拆分大文件

### Task 3.1: 拆分 properties.rs

**Files:**
- MODIFY: `src-tauri/src/kube/properties.rs` → `src-tauri/src/kube/properties/`
- CREATE: `src-tauri/src/kube/properties/mod.rs`
- CREATE: `src-tauri/src/kube/properties/pod.rs`
- CREATE: `src-tauri/src/kube/properties/workload.rs`
- CREATE: `src-tauri/src/kube/properties/network.rs`
- CREATE: `src-tauri/src/kube/properties/config.rs`
- CREATE: `src-tauri/src/kube/properties/cluster.rs`
- CREATE: `src-tauri/src/kube/properties/rbac.rs`
- CREATE: `src-tauri/src/kube/properties/helm.rs`
- CREATE: `src-tauri/src/kube/properties/extensions.rs`

- [ ] **Step 1: 创建目录结构**

```bash
mkdir -p /Users/zhangyi/my_project/k7s/src-tauri/src/kube/properties
```

- [ ] **Step 2: 提取共享类型到 mod.rs**

```rust
// /Users/zhangyi/my_project/k7s/src-tauri/src/kube/properties/mod.rs
use serde::{Deserialize, Serialize};

// 从 properties.rs 提取的类型定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Field {
    pub label: String,
    pub value: String,
    pub tone: Option<String>,
}

// ... 其他类型

// 共享辅助函数
pub fn or_dash(s: &str) -> String {
    if s.is_empty() { "–" } else { s }.to_string()
}

// ... 其他辅助函数

// gather 主函数
pub async fn gather(kind: &str, ns: Option<&str>, name: &str, client: &crate::kube::Client) -> Result<Properties, String> {
    match kind {
        "Pod" => pod::gather_pod(ns, name, client).await,
        "Deployment" => workload::gather_deployment(ns, name, client).await,
        // ... 其他类型
        _ => Err(format!("Unknown kind: {}", kind)),
    }
}

// 子模块声明
pub mod pod;
pub mod workload;
pub mod network;
pub mod config;
pub mod cluster;
pub mod rbac;
pub mod helm;
pub mod extensions;
```

- [ ] **Step 3: 提取 Pod 相关函数到 pod.rs**

```rust
// /Users/zhangyi/my_project/k7s/src-tauri/src/kube/properties/pod.rs
use super::*;

pub async fn gather_pod(ns: Option<&str>, name: &str, client: &crate::kube::Client) -> Result<Properties, String> {
    // 从 properties.rs 提取的 gather_pod 实现
    // ...
}

pub async fn gather_volumes(ns: Option<&str>, name: &str, client: &crate::kube::Client) -> Result<Properties, String> {
    // 从 properties.rs 提取的 gather_volumes 实现
    // ...
}
```

- [ ] **Step 4: 提取其他模块**

类似地提取 workload.rs、network.rs、config.rs、cluster.rs、rbac.rs、helm.rs、extensions.rs

- [ ] **Step 5: 删除原文件**

```bash
rm /Users/zhangyi/my_project/k7s/src-tauri/src/kube/properties.rs
```

- [ ] **Step 6: 验证编译**

```bash
cd /Users/zhangyi/my_project/k7s/src-tauri
cargo check
cargo test
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: split properties.rs into domain-specific modules"
```

---

### Task 3.2: 拆分 mappers.rs

**Files:**
- MODIFY: `src-tauri/src/kube/mappers.rs` → `src-tauri/src/kube/mappers/`
- CREATE: `src-tauri/src/kube/mappers/mod.rs`
- CREATE: `src-tauri/src/kube/mappers/pod.rs`
- CREATE: `src-tauri/src/kube/mappers/workload.rs`
- CREATE: `src-tauri/src/kube/mappers/network.rs`
- CREATE: `src-tauri/src/kube/mappers/storage.rs`
- CREATE: `src-tauri/src/kube/mappers/config.rs`
- CREATE: `src-tauri/src/kube/mappers/rbac.rs`
- CREATE: `src-tauri/src/kube/mappers/cluster.rs`
- CREATE: `src-tauri/src/kube/mappers/dynamic.rs`

- [ ] **Step 1: 创建目录结构**

```bash
mkdir -p /Users/zhangyi/my_project/k7s/src-tauri/src/kube/mappers
```

- [ ] **Step 2: 提取共享辅助函数到 mod.rs**

```rust
// /Users/zhangyi/my_project/k7s/src-tauri/src/kube/mappers/mod.rs
use serde_json::Value;

// 从 mappers.rs 提取的辅助函数
pub fn uid_of(v: &Value) -> String {
    v["metadata"]["uid"].as_str().unwrap_or_default().to_string()
}

pub fn creation_rfc3339(v: &Value) -> String {
    v["metadata"]["creationTimestamp"].as_str().unwrap_or_default().to_string()
}

// ... 其他辅助函数

// 子模块声明
pub mod pod;
pub mod workload;
pub mod network;
pub mod storage;
pub mod config;
pub mod rbac;
pub mod cluster;
pub mod dynamic;
```

- [ ] **Step 3: 提取各模块**

类似 Task 3.1 的方式提取各模块

- [ ] **Step 4: 验证编译**

```bash
cd /Users/zhangyi/my_project/k7s/src-tauri
cargo check
cargo test
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: split mappers.rs into domain-specific modules"
```

---

### Task 3.3: 拆分 server.rs (MCP)

**Files:**
- MODIFY: `src-tauri/src/mcp/server.rs` → `src-tauri/src/mcp/`
- CREATE: `src-tauri/src/mcp/mod.rs`
- CREATE: `src-tauri/src/mcp/server.rs`
- CREATE: `src-tauri/src/mcp/params.rs`
- CREATE: `src-tauri/src/mcp/connection.rs`
- CREATE: `src-tauri/src/mcp/read_tools.rs`
- CREATE: `src-tauri/src/mcp/write_tools.rs`
- CREATE: `src-tauri/src/mcp/shell_tools.rs`
- CREATE: `src-tauri/src/mcp/helm_tools.rs`
- CREATE: `src-tauri/src/mcp/helpers.rs`

- [ ] **Step 1: 创建目录结构**

```bash
mkdir -p /Users/zhangyi/my_project/k7s/src-tauri/src/mcp
```

- [ ] **Step 2: 提取参数结构体到 params.rs**

```rust
// /Users/zhangyi/my_project/k7s/src-tauri/src/mcp/params.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct ListResourcesParams {
    pub context: String,
    pub kind: String,
    pub namespace: Option<String>,
}

// ... 其他参数结构体
```

- [ ] **Step 3: 提取辅助函数到 helpers.rs**

```rust
// /Users/zhangyi/my_project/k7s/src-tauri/src/mcp/helpers.rs
pub fn tool_error(msg: impl Into<String>) -> String {
    msg.into()
}

// ... 其他辅助函数
```

- [ ] **Step 4: 提取工具实现到各模块**

类似地提取 connection.rs、read_tools.rs、write_tools.rs、shell_tools.rs、helm_tools.rs

- [ ] **Step 5: 重构 server.rs 为入口模块**

```rust
// /Users/zhangyi/my_project/k7s/src-tauri/src/mcp/server.rs
use super::*;

pub struct K7sMcpServer {
    // ...
}

impl K7sMcpServer {
    pub fn new() -> Self {
        // ...
    }
}

// ServerHandler 实现
// ...
```

- [ ] **Step 6: 验证编译**

```bash
cd /Users/zhangyi/my_project/k7s/src-tauri
cargo check
cargo test
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: split MCP server.rs into domain-specific modules"
```

---

### Task 3.4: 拆分 commands.rs

**Files:**
- MODIFY: `src-tauri/src/commands.rs` → `src-tauri/src/commands/`
- CREATE: `src-tauri/src/commands/mod.rs`
- CREATE: `src-tauri/src/commands/core.rs`
- CREATE: `src-tauri/src/commands/shell.rs`
- CREATE: `src-tauri/src/commands/forward.rs`
- CREATE: `src-tauri/src/commands/helm.rs`
- CREATE: `src-tauri/src/commands/observability.rs`
- CREATE: `src-tauri/src/commands/storage.rs`

- [ ] **Step 1: 创建目录结构**

```bash
mkdir -p /Users/zhangyi/my_project/k7s/src-tauri/src/commands
```

- [ ] **Step 2: 提取核心命令到 core.rs**

```rust
// /Users/zhangyi/my_project/k7s/src-tauri/src/commands/core.rs
use tauri::command;

#[command]
pub async fn list_contexts(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    // 从 commands.rs 提取的实现
    // ...
}

// ... 其他核心命令
```

- [ ] **Step 3: 提取其他模块**

类似地提取 shell.rs、forward.rs、helm.rs、observability.rs、storage.rs

- [ ] **Step 4: 验证编译**

```bash
cd /Users/zhangyi/my_project/k7s/src-tauri
cargo check
cargo test
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: split commands.rs into domain-specific modules"
```

---

### Task 3.5: 拆分 handlers.rs (Web)

**Files:**
- MODIFY: `src-tauri/src/web/handlers.rs` → `src-tauri/src/web/`
- CREATE: `src-tauri/src/web/types.rs`
- CREATE: `src-tauri/src/web/handlers.rs`
- CREATE: `src-tauri/src/web/resource_handlers.rs`
- CREATE: `src-tauri/src/web/shell_handlers.rs`
- CREATE: `src-tauri/src/web/helm_handlers.rs`

- [ ] **Step 1: 提取类型定义到 types.rs**

```rust
// /Users/zhangyi/my_project/k7s/src-tauri/src/web/types.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct InvokeResponse {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

// ... 其他类型和参数结构体
```

- [ ] **Step 2: 提取各处理函数模块**

类似地提取 handlers.rs、resource_handlers.rs、shell_handlers.rs、helm_handlers.rs

- [ ] **Step 3: 验证编译**

```bash
cd /Users/zhangyi/my_project/k7s/src-tauri
cargo check
cargo test
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: split web handlers.rs into domain-specific modules"
```

---

### Task 3.6: 拆分 TypeScript 大文件

**Files:**
- MODIFY: `src/lib/i18n/dictionaries.ts` → `src/lib/i18n/en.ts` + `src/lib/i18n/zh.ts`
- MODIFY: `src/providers/types.ts` → `src/providers/types/`
- MODIFY: `src/lib/templates.ts` → `src/lib/templates/`

- [ ] **Step 1: 拆分 i18n dictionaries**

```bash
# 创建 en.ts 和 zh.ts
# 将 dictionaries.ts 中的英文和中文词典分别移动
```

- [ ] **Step 2: 拆分 providers/types.ts**

```bash
mkdir -p /Users/zhangyi/my_project/k7s/src/providers/types
# 创建 index.ts, resource.ts, provider.ts, cluster.ts, kubernetes.ts, helm.ts, observability.ts, image.ts, operations.ts
```

- [ ] **Step 3: 拆分 templates.ts**

```bash
mkdir -p /Users/zhangyi/my_project/k7s/src/lib/templates
# 创建 index.ts, types.ts, registry.ts, render.ts
```

- [ ] **Step 4: 更新所有 import 路径**

```bash
# 使用 grep 找到所有引用
grep -r "from.*providers/types" src/
grep -r "from.*lib/templates" src/
grep -r "from.*i18n/dictionaries" src/

# 更新 import 路径
```

- [ ] **Step 5: 验证 TypeScript 编译**

```bash
cd /Users/zhangyi/my_project/k7s
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: split TypeScript large files into domain modules"
```

---

### Task 3.7: 修复 unwrap() 调用

**Files:**
- MODIFY: `src-tauri/src/kube/client.rs`
- MODIFY: `src-tauri/src/kube/alerting.rs`
- MODIFY: `src-tauri/src/kube/metrics_config.rs`
- MODIFY: `src-tauri/src/kube/portforward.rs`
- MODIFY: `src-tauri/src/kube/promql.rs`
- MODIFY: `src-tauri/src/core/events.rs`

- [ ] **Step 1: 识别生产代码中的 unwrap()**

```bash
cd /Users/zhangyi/my_project/k7s/src-tauri
grep -rn "\.unwrap()" src/ --include="*.rs" | grep -v "#\[test\]" | grep -v "mod tests"
```

- [ ] **Step 2: 替换为 ? 操作符或 expect()**

```rust
// 修改前:
let value = some_result.unwrap();

// 修改后 (使用 ?):
let value = some_result?;

// 或者 (使用 expect):
let value = some_result.expect("Failed to get value");
```

- [ ] **Step 3: 验证编译和测试**

```bash
cd /Users/zhangyi/my_project/k7s/src-tauri
cargo check
cargo test
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: replace unwrap() with proper error handling"
```

---

## Phase 4: 测试覆盖

### Task 4.1: 增强测试基础设施

**Files:**
- MODIFY: `src/hooks/testUtils.ts`
- CREATE: `src/test/setup.ts`

- [ ] **Step 1: 扩展 testUtils.ts**

```typescript
// /Users/zhangyi/my_project/k7s/src/hooks/testUtils.ts
import { renderHook, cleanup } from '@testing-library/react';
import { vi, afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// Mock 数据工厂
export const createMockResource = (overrides = {}) => ({
  metadata: {
    name: 'test-resource',
    namespace: 'default',
    uid: 'test-uid',
    creationTimestamp: '2024-01-01T00:00:00Z',
    ...overrides,
  },
});

// ... 其他测试工具
```

- [ ] **Step 2: 创建测试 setup**

```typescript
// /Users/zhangyi/my_project/k7s/src/test/setup.ts
import '@testing-library/jest-dom';
```

- [ ] **Step 3: 更新 vite.config.ts**

```typescript
// vite.config.ts test config
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
  },
});
```

- [ ] **Step 4: 验证测试运行**

```bash
pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: enhance test infrastructure and utilities"
```

---

### Task 4.2: 编写核心组件测试 (Batch 1)

**Files:**
- CREATE: `src/components/table/ResourceTable.test.tsx`
- CREATE: `src/components/detail/DetailPanel.test.tsx`
- CREATE: `src/components/sidebar/Sidebar.test.tsx`
- CREATE: `src/components/sidebar/NavList.test.tsx`
- CREATE: `src/components/topbar/TopBar.test.tsx`
- CREATE: `src/components/statusbar/StatusBar.test.tsx`
- CREATE: `src/components/palette/CommandPalette.test.tsx`

- [ ] **Step 1: 编写 ResourceTable 测试**

```typescript
// /Users/zhangyi/my_project/k7s/src/components/table/ResourceTable.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ResourceTable from './ResourceTable';

describe('ResourceTable', () => {
  it('renders table with data', () => {
    const mockData = [
      { name: 'pod-1', namespace: 'default', status: 'Running' },
    ];
    render(<ResourceTable data={mockData} />);
    expect(screen.getByText('pod-1')).toBeInTheDocument();
  });

  it('handles row click', () => {
    const onRowClick = vi.fn();
    render(<ResourceTable data={[]} onRowClick={onRowClick} />);
    // ...
  });
});
```

- [ ] **Step 2: 编写其他核心组件测试**

类似地为 DetailPanel、Sidebar、NavList、TopBar、StatusBar、CommandPalette 编写测试

- [ ] **Step 3: 运行测试验证**

```bash
pnpm test -- --run
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: add core component tests (Batch 1)"
```

---

### Task 4.3: 编写详情标签页测试 (Batch 2)

**Files:**
- CREATE: `src/components/detail/PropertiesTab.test.tsx`
- CREATE: `src/components/detail/LogsTab.test.tsx`
- CREATE: `src/components/detail/EventsTab.test.tsx`
- CREATE: `src/components/detail/ShellTab.test.tsx`
- CREATE: `src/components/detail/YamlTab.test.tsx`
- CREATE: `src/components/detail/MetricsTab.test.tsx`
- CREATE: `src/components/detail/TabStrip.test.tsx`
- CREATE: `src/components/detail/RevisionsTab.test.tsx`

- [ ] **Step 1: 编写详情标签页测试**

类似 Batch 1 的方式编写测试

- [ ] **Step 2: 运行测试验证**

```bash
pnpm test -- --run
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: add detail tab component tests (Batch 2)"
```

---

### Task 4.4: 编写功能面板测试 (Batch 3)

**Files:**
- CREATE: `src/components/templates/TemplatePicker.test.tsx`
- CREATE: `src/components/imageimport/ImageImportPanel.test.tsx`
- CREATE: `src/components/imagerepo/ImageRepoPanel.test.tsx`
- CREATE: `src/components/alerting/AlertsPanel.test.tsx`
- CREATE: `src/components/dashboard/Dashboard.test.tsx`
- CREATE: `src/components/metrics/MetricsExplorer.test.tsx`
- CREATE: `src/components/grafana/GrafanaPanel.test.tsx`
- CREATE: `src/components/endpoints/EndpointsPanel.test.tsx`
- CREATE: `src/components/audit/AuditPanel.test.tsx`
- CREATE: `src/components/podfiles/PodFilesPanel.test.tsx`

- [ ] **Step 1: 编写功能面板测试**

类似 Batch 1 的方式编写测试

- [ ] **Step 2: 运行测试验证**

```bash
pnpm test -- --run
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: add feature panel component tests (Batch 3)"
```

---

### Task 4.5: 编写操作/Helm/拓扑测试 (Batch 4)

**Files:**
- CREATE: `src/components/actions/ActionList.test.tsx`
- CREATE: `src/components/actions/HelmRollbackForm.test.tsx`
- CREATE: `src/components/actions/ModifyImageForm.test.tsx`
- CREATE: `src/components/actions/RowContextMenu.test.tsx`
- CREATE: `src/components/helm/HelmMarket.test.tsx`
- CREATE: `src/components/helm/HelmInstallWizard.test.tsx`
- CREATE: `src/components/topology/TopologyPanel.test.tsx`
- CREATE: `src/components/topology/TopologyGraph.test.tsx`
- CREATE: `src/components/topology/IngressRouteTopology.test.tsx`

- [ ] **Step 1: 编写操作/Helm/拓扑测试**

类似 Batch 1 的方式编写测试

- [ ] **Step 2: 运行测试验证**

```bash
pnpm test -- --run
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: add actions/helm/topology component tests (Batch 4)"
```

---

### Task 4.6: 编写剩余组件测试 (Batch 5)

**Files:**
- CREATE: `src/components/ErrorBoundary.test.tsx`
- CREATE: `src/components/forwards/ForwardsBar.test.tsx`
- CREATE: `src/components/settings/SettingsPanel.test.tsx`
- CREATE: `src/components/settings/McpPanel.test.tsx`
- CREATE: `src/components/ingress/IngressEditor.test.tsx`
- CREATE: `src/components/diff/ResourceDiff.test.tsx`
- CREATE: `src/components/plugins/PluginPanel.test.tsx`
- CREATE: `src/components/sidebar/Hotbar.test.tsx`
- CREATE: `src/components/sidebar/ClusterSwitcher.test.tsx`
- CREATE: `src/components/sidebar/WatchFooter.test.tsx`
- CREATE: `src/components/detail/CronJobTimeline.test.tsx`
- CREATE: `src/components/detail/NodePodsTab.test.tsx`
- CREATE: `src/components/detail/NodeShellTab.test.tsx`
- CREATE: `src/components/detail/PodMetricsTab.test.tsx`
- CREATE: `src/components/detail/ActionsMenu.test.tsx`
- CREATE: `src/components/detail/CodeEditor.test.tsx`
- CREATE: `src/components/detail/PlotChart.test.tsx`

- [ ] **Step 1: 编写剩余组件测试**

类似 Batch 1 的方式编写测试

- [ ] **Step 2: 运行测试验证**

```bash
pnpm test -- --run
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: add remaining component tests (Batch 5)"
```

---

## Phase 5: 文档

### Task 5.1: 创建 CONTRIBUTING.md

**Files:**
- CREATE: `CONTRIBUTING.md`

- [ ] **Step 1: 创建 CONTRIBUTING.md**

```markdown
# Contributing to k7s

感谢你对 k7s 项目的关注！本文档将帮助你了解如何参与贡献。

## 开发环境设置

### 前置要求

- Node.js 26+
- pnpm 10.33.0+
- Rust 1.77.2+
- Tauri CLI

### 安装步骤

1. 克隆仓库
```bash
git clone https://github.com/your-org/k7s.git
cd k7s
```

2. 安装依赖
```bash
pnpm install
```

3. 启动开发服务器
```bash
pnpm tauri dev
```

## 代码规范

### TypeScript/React

- 使用 ESLint + Prettier
- 运行 `pnpm lint` 检查代码
- 运行 `pnpm format` 格式化代码

### Rust

- 使用 rustfmt + clippy
- 运行 `cargo fmt --check` 检查格式
- 运行 `cargo clippy -- -D warnings` 检查代码质量

## 提交规范

使用 Conventional Commits：

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

类型：
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `test`: 测试
- `chore`: 构建/工具

## Pull Request 流程

1. Fork 仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m "feat: add your feature"`
4. 推送分支：`git push origin feature/your-feature`
5. 创建 Pull Request

## 测试要求

- 前端测试：`pnpm test`
- 后端测试：`cargo test`
- 所有测试必须通过才能合并

## 问题反馈

使用 GitHub Issues 报告问题，请包含：
- 问题描述
- 复现步骤
- 预期行为
- 实际行为
- 环境信息
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "docs: add CONTRIBUTING.md"
```

---

### Task 5.2: 创建 ARCHITECTURE.md

**Files:**
- CREATE: `ARCHITECTURE.md`

- [ ] **Step 1: 创建 ARCHITECTURE.md**

```markdown
# k7s 架构文档

## 系统概述

k7s 是一个 Kubernetes 可视化监控桌面应用，采用 Tauri 2 + Rust + React 技术栈。

## 架构层次

```
┌─────────────────────────────────────┐
│           React Frontend            │
│  (TypeScript, Zustand, Vitest)      │
├─────────────────────────────────────┤
│          Provider Layer             │
│  (HttpProvider, TauriProvider,      │
│   MockProvider)                     │
├─────────────────────────────────────┤
│           Tauri IPC                 │
├─────────────────────────────────────┤
│          Rust Backend               │
│  (kube-rs, axum, MCP)              │
├─────────────────────────────────────┤
│        Kubernetes API               │
└─────────────────────────────────────┘
```

## 模块边界

### 前端模块

- `src/components/` - UI 组件
- `src/hooks/` - 自定义 Hooks
- `src/lib/` - 工具函数
- `src/providers/` - 数据提供者
- `src/store.ts` - 状态管理

### 后端模块

- `src-tauri/src/kube/` - Kubernetes 操作
- `src-tauri/src/commands/` - Tauri 命令
- `src-tauri/src/web/` - HTTP 服务器
- `src-tauri/src/mcp/` - MCP 服务器

## 数据流

```
User Action
    ↓
React Component
    ↓
Provider (HttpProvider/TauriProvider)
    ↓
Tauri IPC / HTTP Request
    ↓
Rust Command Handler
    ↓
kube-rs Client
    ↓
Kubernetes API
    ↓
Response → UI Update
```

## 构建目标

1. **桌面应用**：`pnpm tauri:build`
2. **Web 服务器**：`cargo build --features web --bin k7s-web`
3. **MCP 服务器**：`cargo build --features mcp --bin k7s-mcp`

## 测试策略

- 前端：Vitest + React Testing Library
- 后端：cargo test + 18 个 live verification examples
- CI：GitHub Actions 运行完整测试套件
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "docs: add ARCHITECTURE.md"
```

---

## 验证清单

完成所有任务后，运行完整验证：

- [ ] 前端验证
```bash
pnpm lint
pnpm typecheck
pnpm test -- --run
pnpm format:check
```

- [ ] 后端验证
```bash
cd src-tauri
cargo check
cargo clippy -- -D warnings
cargo fmt --check
cargo test
```

- [ ] 构建验证
```bash
pnpm tauri build --debug
```

- [ ] 文档验证
- [ ] CONTRIBUTING.md 存在
- [ ] ARCHITECTURE.md 存在
- [ ] 设计文档存在

---

## 执行建议

**推荐使用 Subagent-Driven Development**：
- 每个 Task 分派一个独立的 subagent
- 每个 Task 完成后验证
- 快速迭代，失败时重试

**备选使用 Inline Execution**：
- 在当前会话中按顺序执行
- 每个 Phase 完成后检查点审查
