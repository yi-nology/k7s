# ChartOps 能力整合设计 — k7 离线 Chart 库与发布更新工作流

日期：2026-08-28
状态：待评审（未实施）
来源：`/Users/zhangyi/work/chart/README.md`（ChartOps，Node.js 零依赖单文件工具）

## 1. 背景与目标

ChartOps 是一个面向离线/内网环境的 Helm Chart 管理工具，核心场景是
「本地 chart 包 → 检查 → 发布/升级 release → 出问题回滚」。本设计评估将其
能力整合进 k7（k7s）的方案，目标是让 k7 的 Helm 页从「在线市场」升级为
「市场 + 本地库 + 升级工作流」，完整覆盖气隙环境的 chart 发布更新，
此后 ChartOps 不再单独维护。

## 2. 现状差距分析

### k7 已具备（不重复建设）

| ChartOps 功能 | k7 现状 | 位置 |
| --- | --- | --- |
| Release 列表/详情/历史/values/manifest | ✅ 更优：直接解码集群 Secret，无需 helm | `k7s-core/src/kube/helm/mod.rs` |
| install/upgrade/uninstall/rollback | ✅ CLI 封装 + 流式日志 + 临时文件 RAII | `k7s-core/src/kube/helm/ops.rs` |
| 市场：仓库 CRUD/搜索/版本 | ✅ | `k7s-core/src/kube/helm/market.rs` |
| 集群资源浏览/命名空间/Pod 日志/事件 | ✅ k7 核心功能，远强于 ChartOps | 全仓 |
| 审计日志（JSONL） | ✅ `<data_dir>/audit.log` | `k7s-core/src/core/audit.rs` |
| 后台任务 + SSE | ✅ web 已有 SSE | `k7s-server/src/web/sse.rs` |
| release revision manifest diff | ✅ | 前端 `HelmDiff.tsx` + `lib/diff.ts` |
| MCP helm 工具 | ✅ | `k7s-server/src/mcp/tools/helm.rs` |

### 真正的差距（= 本设计的范围）

1. **本地 chart 库**：k7 的 `import_chart` 只把 tgz 复制进缓存目录，
   `list_local_charts` 只返回文件名；无 Chart.yaml 解析、无 UI 入口
   （HelmMarket 只有 charts/repos 两个 tab；HttpProvider 的
   `helmImportChart/helmLocalCharts` 是 `notImplemented` 陈旧 stub）。
2. **web 端 .tgz 上传**：k7 导入靠本地路径（桌面 dialog），web 无法上传。
3. **chart 包详情**：Chart.yaml 元信息、文件树、values、模板、README。
4. **两版本 chart 包 diff**（升级前预览）：k7 只有 release revision diff。
5. **`helm template` 离线渲染预览**（无需集群）：k7 只有 default values。
6. **helm lint / verify / package**：无。
7. **升级 flag 缺口**：无 `--set`、`--atomic`、`--force`、upgrade 侧
   `--create-namespace`、自定义 `--timeout`（目前固定写死）。
8. **部署方案 Profiles**（保存 values/flags 复用）：无。

## 3. 方案比较

### 方案 A：双工具并存（k7 发布物附带 ChartOps）

- 优点：零开发量。
- 缺点：两套 UI/两份集群连接配置；ChartOps **无任何鉴权**（其 README 安全
  一节仅靠监听 127.0.0.1），与 k7 的 token 认证模型并存是安全倒退——
  v0.5.2 评审中「/mcp 无鉴权」列为严重问题的教训不重复。放弃。

### 方案 B：ChartOps 整目录 vendor 进 k7 仓，反代/iframe 挂进 web

- 优点：功能即时全有。
- 缺点：Node 技术栈进 Rust 仓（CI/发布/Docker 镜像都要双轨）；iframe 双登录；
  长期维护两套实现。放弃。

### 方案 C（推荐）：按功能吸收，重写为 k7 原生模块

ChartOps 是 ~56KB server.js + 原生 JS 前端，功能面广但每个功能的深度
都不及 k7 已有实现（集群侧）。真正值得搬的只有「本地 chart 库」半边，
按 k7 架构（CommandRegistry → k7s-core）用 Rust 重写，约 6 个后端函数 +
2 个前端页面组件。新增依赖仅 `tar` 一个（纯 Rust）。

## 4. 设计（方案 C）

### 4.1 后端 — `k7s-core/src/kube/helm/local.rs`（新模块）

```
pub struct LocalChartEntry {
    id: String,            // "<name>-<version>"（tgz）或目录名
    kind: LocalChartKind,  // Tgz | Dir
    name: String, version: String, app_version: String,
    description: String, icon: String,
    path: PathBuf, size_bytes: u64, modified_at: String,
}
```

- `scan_local_charts(dir)`：扫描 `<data_dir>/charts/` 下 `.tgz` 与解压目录。
  tgz 用 `flate2::GzDecoder` + `tar::Archive` **只读取条目**（不解压落盘），
  从 Chart.yaml 提取元信息（`yaml_serde` 已在依赖伞）。目录型直接读文件。
- `local_chart_detail(id)`：文件树 + 指定文件内容（values.yaml / 模板 /
  README），条目名做路径穿越校验（拒绝 `..` 与绝对路径）。
- `import_local_chart(path)`（桌面：从任意路径复制入库）与
  `import_local_chart_bytes(name, bytes)`（web 上传落盘，服务端校验
  gzip magic、扩展名、大小上限默认 50MB）。
- `remove_local_chart(id)`：仅允许删除库目录内文件。
- `render_local_chart(id, values, kubeconfig)`：`helm template <path>`
  封装（本地渲染，无需集群），沿用 `ops.rs` 的进程流式模式。
- `lint_local_chart(id)` / `package_chart(dir_id)`（P2）。

### 4.2 后端 — `ops.rs` 扩展

- `InstallArgs`/`UpgradeArgs` 增加：
  `set: JsonObject`（→ 逐条 `--set k=v`）、`atomic: bool`（→ `--atomic`，
  取代现 `rollback_on_failure` 的语义并保留别名）、`force: bool`、
  `timeout_secs: Option<u64>`（替换写死的固定值）、upgrade 侧
  `create_namespace`。
- `chart` 字段允许传本地 tgz/目录的绝对路径（helm 原生支持路径安装，
  现有 argv 构造无需分支）。
- helm v3/v4 输出归一化沿用 ChartOps 已踩过的坑（`--kube-context` 等）。

### 4.3 后端 — Profiles 与审计

- `<data_dir>/helm-profiles.json`：`{ name, chart_source, values, flags }`
  列表，CRUD 命令 3 个（list/save/delete）。
- 导入/删除/lint/升级全部写 `audit.log`（复用 `core/audit.rs`）。

### 4.4 服务端 — web 上传路由

- `POST /api/charts/upload`（axum `Bytes` body，流式写盘）挂在现有 auth
  中间件之后；`Content-Length` 上限 + 落盘前 magic 校验。
- 上传完成即返回 `LocalChartEntry`，前端列表自动刷新。

### 4.5 命令面与 MCP

- `k7s-commands/src/commands/helm.rs` 新增 ~8 个命令并注册 registry
  （web 经 `/api/invoke/{cmd}` 自动可用）：
  `local_charts_list / local_chart_detail / local_chart_import /
   local_chart_remove / local_chart_render / helm_profile_list /
   helm_profile_save / helm_profile_delete`。
- MCP 新增 `helm_local_charts / helm_local_chart_render` 两个工具，
  AI 助手可辅助「看看库里有什么版本 → 渲染对比 → 升级」。
- 移动端：`local.rs` 与 `market.rs/ops.rs` 一样 `#[cfg(not(any(ios, android)))]`
  （注意单层 cfg，吸取 triple-stacked cfg 事故教训）。

### 4.6 前端（k7s-frontend）

- `HelmMarket.tsx` 增加第三 tab「本地 Charts」→ 新组件 `LocalCharts.tsx`：
  列表（名称/版本/类型/时间/大小）+ 拖拽上传 + 删除。
- `ChartDetailDrawer.tsx`：元信息 / values（复用现有 YAML 树组件）/
  模板树 / README 四个分区；P1 加「与库内其他版本对比」（复用
  `lib/diff.ts`，与 HelmDiff 同一引擎）与「渲染预览」。
- `HelmInstallWizard.tsx`：chart 来源选择增加「本地库」；升级场景预填
  当前 release 的 `config` values；执行前 `--dry-run` diff 预览（P1）。
- `HttpProvider.ts` 清理陈旧 helm stub（后端 registry 本就支持，
  走通用 invoke 即可）。

### 4.7 安全清单

- 上传必须经过 web token 认证；tar 只读条目、不 `unpack` 落盘；
  删除操作限制在库目录内（canonicalize 前缀校验）；文件大小上限；
  audit 全覆盖写操作。

## 5. 分阶段交付

| 阶段 | 内容 | 规模估计 |
| --- | --- | --- |
| **P0 发布更新闭环** | local.rs 扫描/解析/导入/删除；web 上传路由；本地库 tab + 基本详情；向导支持本地 chart install/upgrade；ops.rs flag 补齐；审计 | 后端 ~500 行 + 前端 ~600 行 |
| **P1 预览与对比** | helm template 渲染预览；两版本包 diff；升级 dry-run diff；Profiles | ~400 行 |
| **P2 工具箱** | lint / verify / package；helm dependency 管理；MCP 工具补全 | 按需 |

## 6. 明确不做（YAGNI）

- ChartOps 的集群资源/命名空间/日志/事件浏览 — k7 已有且更强。
- 收藏置顶、键盘快捷键、部署记录 JSON/CSV 导出 — k7 audit 已有基底，需要时后加。
- ChartOps 的 Node 运行时、Docker 镜像、离线 tar 分发 — k7 单二进制 + Docker 已覆盖。
- ChartOps 本身的持续维护 — 整合完成后归档。

## 7. 风险

| 风险 | 缓解 |
| --- | --- |
| helm v3/v4 CLI 行为差异（本地路径、flag 支持） | 沿用 ops.rs 归一化层；CI 加 helm v3/v4 矩阵用例 |
| 大 tgz 上传占用内存 | 流式写盘 + Content-Length 上限，超限 413 |
| 移动端 cfg 漏配 | 单层 `#[cfg]`，与 market.rs 完全同构，编译门禁兜底 |
| 库目录与 market 的 cache 目录混淆 | 本地库固定 `<data_dir>/charts/`，与 `helm-local-charts/` 缓存彻底分离，旧缓存不迁移 |
