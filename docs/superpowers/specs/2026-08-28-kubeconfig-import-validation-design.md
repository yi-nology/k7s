# kubeconfig 导入解析/验证阶段与页面错误展示设计

日期：2026-08-28
状态：方案 A 已选定（评审未及回复，按推荐推进；可推翻重做）
范围：k7s-core + k7s-server + k7s-commands + frontend

## 1. 背景与问题

kubeconfig 导入目前只有「YAML 解析」一步，没有结构验证；且失败时页面几乎
无反馈：

| 环节 | 现状 | 位置 |
| --- | --- | --- |
| web 解析 | `Kubeconfig::from_yaml()`，失败报 `couldn't parse xx: ...`（serde_yaml 带行列号，够具体） | `k7s-server/src/web/handlers.rs:107` |
| 桌面解析 | `Kubeconfig::read_from()` | `k7s-core/src/kube/client.rs:77` |
| 结构验证 | **完全没有**。空 contexts、引用不存在的 cluster/user、缺 server、坏 URL 全部放行，直到 connect 才炸 | 同上 |
| web 失败展示 | `ClusterSwitcher`/`OnboardingWizard` 只 `console.error`，**页面零反馈** | `ClusterSwitcher.tsx:71`、`OnboardingWizard.tsx:80` |
| wire 错误 | `AppError` 序列化为扁平字符串 `{ ok:false, error }` | `k7s-core/src/error.rs:44` |

注意：kube 0.99 的 `Cluster.server` 是 `Option<String>`，**缺 server 能通过
YAML 解析**——必须靠显式验证才能提前抓出。

## 2. 目标

1. 导入分两个阶段：**解析**（YAML 语法，现状保留）→ **验证**（结构/引用/
   语义，新增）。
2. 失败时页面上逐条告诉用户什么错、属于哪个阶段；带警告的导入允许成功但
   明确提示。
3. 两条 shell（浏览器 / 桌面）共用同一套验证逻辑，行为一致。

## 3. 方案（已选 A）

- **A（选定）**：k7s-core 共享验证模块 + 结构化 issues 穿透 wire + 前端
  inline/toast 展示。改动 k7s-core、k7s-server、k7s-commands、frontend。
- B（否决）：仅 web handler 内联验证、错误拼字符串。桌面不受益，无法表达
  「带警告成功」。
- C（否决）：前端 js-yaml 本地解析验证。与 Rust 解析行为漂移，双份逻辑。

## 4. 详细设计

### 4.1 k7s-core：共享验证模块

新增 `crates/k7s-core/src/kube/kubeconfig_check.rs`（`kube/mod.rs` 挂载，
全平台编译，无 cfg 门）：

```rust
pub enum IssueSeverity { Error, Warning }          // serde rename_all = "camelCase"

pub struct KubeconfigIssue {
    pub severity: IssueSeverity,
    pub code: String,          // 稳定机器码，如 "missingClusterRef"
    pub message: String,       // 英文人类可读（与现有错误消息风格一致）
    pub context: Option<String>, // 所属 context 名，文件级问题为 None
}

pub fn validate_kubeconfig(kc: &Kubeconfig) -> Vec<KubeconfigIssue>
```

检查项（对每个 context 独立报告，一条 context 的错误不掩盖其余）：

| code | 级别 | 条件 |
| --- | --- | --- |
| `noContexts` | Error | `contexts` 为空 |
| `missingClusterRef` | Error | `ctx.context.cluster` 在 `clusters` 中不存在 |
| `missingUserRef` | Error | `ctx.context.user` 在 `users`(auth_infos) 中不存在 |
| `missingContextBody` | Error | `NamedContext.context` 为 None |
| `missingServer` | Error | 引用的 cluster 无 `server` |
| `badServerUrl` | Error | `server` 解析失败或 scheme 非 http/https |
| `danglingCurrentContext` | Warning | `current-context` 指向不存在的 context |
| `noCaBundle` | Warning | server 为 https 且无 `certificate-authority[-data]` 且未设 `insecure-skip-tls-verify` |
| `noCredentials` | Warning | user 无 token/tokenFile/client-cert(+key)/basic/auth-provider/exec 任何一种 |

Error 阻止导入；Warning 放行并随响应返回。

### 4.2 wire 变更（camelCase，沿用仓库惯例）

- `ImportResultWire`（web）与 Tauri `import_kubeconfig` 返回值统一为：

```json
{ "contexts": [...], "path": "...", "issues": [ { "severity": "warning", "code": "noCaBundle", "message": "...", "context": "minikube" } ] }
```

  `issues` 可选（向后兼容旧前端），只含 Warning（Error 走失败路径）。
- 验证失败时 web 返回扩展错误信封：`{ ok:false, error: "<汇总>", issues: [...全量 issue...] }`。
  `types.rs` 新增 `InvokeErrorWithIssues`，import handler 失败路径用它；其余命令不变。
- 桌面端验证失败：`AppError::Kubeconfig`（多行汇总字符串，逐条列出）——
  Tauri 错误通道是纯字符串，结构化 issues 仅成功路径携带。

### 4.3 k7s-server（web handler）

`import_kubeconfig_content` 流程改为：

1. `Kubeconfig::from_yaml()` 失败 → 现状错误（阶段：解析）。
2. `validate_kubeconfig()` → 有 Error 级 → `InvokeErrorWithIssues`（阶段：验证）。
3. 仅 Warning → 正常注册导入，`ImportResultWire.issues` 带回警告。

### 4.4 k7s-commands（桌面）

`import_kubeconfig_impl`：`contexts_from_file` 解析后跑同一 `validate_kubeconfig`；
Error 级 → `AppError::Kubeconfig` 多行汇总；仅 Warning → 放行，返回值从
`Vec<ContextInfo>` 升级为含 `path`/`issues` 的结构（见 4.2），`TauriProvider`
相应包装。

### 4.5 frontend

- `transport.ts`：`WireResponse` 增加 `issues?`；存在时抛
  `KubeconfigImportError extends Error`（携带 `issues`），普通命令不受影响。
- `OnboardingWizard` step0：失败 inline 错误块，区分「解析失败/校验失败」
  标签 + 逐条 message；成功但带 Warning → 黄色警告块，流程继续。
- `ClusterSwitcher`：失败走全局 `getErrorReporter()`（ErrorToast）展示汇总 +
  逐条；成功带 Warning → 成功 toast 附警告数。
- i18n：`en.ts`/`zh.ts` 新增 `onboarding.import.parseFailed`、
  `onboarding.import.validationFailed`、`onboarding.import.importedWithWarnings`
  等标签；issue.message 后端英文直出（与现有错误一致，v1 不做 message 翻译）。

## 5. 错误处理

- 解析错误消息保持 serde_yaml 原文（含行列号）。
- 验证汇总格式：`kubeconfig validation failed (N issues):` + 每行
  `[error] context 'x': cluster 'y' not found`。
- 前端对 `KubeconfigImportError.issues` 为空时回退显示 `error.message`，
  保证旧后端 + 新前端不出现空白错误。

## 6. 测试

- k7s-core：`kubeconfig_check` 单测覆盖每个 code + 全绿文件。
- k7s-server `tests/web_api.rs`：缺 cluster 引用 → `ok:false` + `issues` 数组；
  仅 Warning（无 CA）→ `ok:true` 且 `data.issues` 非空；现有两条导入测试保持通过。
- k7s-commands：`import_kubeconfig_impl` Error 阻止 / Warning 放行。
- 前端：`OnboardingWizard.test.tsx` 增加失败 inline 展示与 Warning 提示用例。

## 7. 非目标（YAGNI）

- issue message 的多语言翻译（后端 code 已稳定，后续可做 code→文案映射）。
- 单条 context「部分导入」语义（本次按文件整体成功/失败）。
- 连接期（connect）错误的结构化（另行立项）。
