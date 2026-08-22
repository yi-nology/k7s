# k7s 项目演进轨迹

> 从原型到多端平台的 17 天（2026-08-01 ~ 2026-08-18）

## 概述

k7s 是一个跨平台 Kubernetes 集群可视化管理器，基于 Tauri 2 (Rust) + React 构建。项目从第一天的原型到多端拆分仅用了 17 天，产出 481 个主仓 commit、15 个版本、6 个子仓库。本文记录了项目从单体到多仓库的完整演进过程，包括每次架构决策的背景和驱动力。

**技术栈**：Tauri 2 / Rust / React / TypeScript / xterm.js / CodeMirror

**对标项目**：k9s（终端）、KubePi（Web UI）

---

## 时间线总览

```
08-01  原型爆发 ──────────── v0.1.0, 首日 13 commits, 模块拆分
  │
08-02  功能闭环 ──────────── v0.2.1~v0.2.4, TTY/Port-forward/⌘K/i18n
  │
08-03  QA 工程化 ─────────── 27 轮 QA pass, KubePi 功能对标
  │
08-04  质量加固 ──────────── v0.2.8, RBAC/安装脚本/ESLint/Prettier/rustfmt/CSP
  │
08-05  架构重构 ──────────── v0.3.0, 大文件拆分/测试/k7s-web 独立模式
  │
08-06  安全扫描 ──────────── v0.3.2, SBOM/镜像传输/10 轮质量改进
  │
08-07  安全审计 ──────────── v0.3.3, 命令注入修复/CORS/代码去重
  │
08-09  AI 集成 ───────────── 内置 AI 助手, 4 层记忆, MCP 91 工具
  │
08-11~14  稳定期 ─────────── 依赖升级, clippy 修复, SBOM 配置化
  │
08-17  功能深化 ──────────── Pod 诊断/CSV 导出/Helm diff/YAML 校验/网络策略模拟
  │
08-17  多端拆分 ──────────── k7s-core / k7s-frontend / k7s-ios / k7s-android
  │
08-18  架构收敛 ──────────── k7s-desktop / k7s-server, 拆分→回调→精确拆分
```

---

## 第一阶段：原型爆发（08-01）

### 背景

k7s 的诞生源于 fuxi_engine 运维需求的积累。在管理多个 K3s/K8s 集群（test/dev/studio-prod/tencent-prod）的过程中，对一个可视化、跨平台的集群管理工具有了明确的需求画像。

### 首日产出

| 时间 | Commit | 内容 |
|---|---|---|
| 20:26 | `8dff702` | v0.1.0 init — Tauri 2 + React 架构 |
| 20:41 | `b87d186` | E2E 测试框架 (probe.mjs + snap.mjs) |
| 20:47 | `02b8164` | 独立 Rust probe 二进制，验证 K8s 资源映射 |
| 23:28 | `40f48e0` | probe 覆盖 14 种 K8s 资源类型 |
| 23:43 | `86d76a3` | k9s 风格快捷键 `:logs` / `:exec` / `:pf` |
| 23:59 | `54b1eee` | **首次内部重构** — 高内聚模块拆分 (P1-P3) |

**设计决策**：
- 选择 Tauri 2 而非 Electron：Rust 后端直接调用 kube-rs，无 Node.js 中间层，性能更好
- 选择 React 而非 Vue：生态更丰富，组件库选择更多
- 测试先行：首日就建立了 E2E 测试框架，而非"先写功能再补测试"

---

## 第二阶段：功能闭环（08-02）

一天之内完成了 k9s 的核心交互能力：

| 功能 | Commit | 说明 |
|---|---|---|
| 交互式终端 | `2dfddba` | xterm.js + Rust AttachedProcess，支持 exec 进入 Pod |
| SPDY 端口转发 | `246bbd9` | 每个 forward 一条 TCP 连接，非模拟 |
| ⌘K 命令面板 | `e55fbe9` | k9s 风格的快速操作入口 |
| 批量删除 | `4cb30d3` | Space 标记 + 批量操作 |
| i18n | `598b445` | 中英文双语，从一开始就国际化 |
| 竞品文档 | `d5644d3` | 明确对标 Linear/Vercel 方向 |

同时搭建了 GitHub Actions 发布流水线（Docker + 桌面端打包），经历了大量 CI 调试（20 个 TEMP commit）。

**版本**：v0.2.1 → v0.2.4

---

## 第三阶段：QA 工程化（08-03）

这是整个项目最独特的实践 — **27 轮结构化 QA**。

### QA 工作模式

每一轮 QA 聚焦一个功能区域，流程为：
1. 手动测试或自动化测试发现问题
2. 修复问题
3. 记录 QA pass 报告

### QA Pass 索引

| Pass | 焦点 | 发现 |
|---|---|---|
| 1 | 行上下文菜单 + Esc 关闭 | overlay Esc 键修复 |
| 2 | ⌘K 命令面板 i18n | 9 个标签翻译缺失 |
| 3 | Service 拓扑图 | cursor:pointer 误导 |
| 4 | 拓扑边和布局 | --border alias 缺失 |
| 5 | Pod 文件 overlay 空状态 | i18n 路由缺失 |
| 6 | 侧边栏/命名空间过滤 | 表格空状态描述错误 |
| 7 | 详情面板 Tab 切换 | 无缺陷 |
| 8 | i18n EN ↔ zh 切换 | Alerting 面板字符串未翻译 |
| 9 | 设置面板 | 无缺陷，4 个 i18n 测试 |
| 10 | Dashboard 资源卡片 | kindLabelFor 未路由 |
| 11 | 保存查询 CRUD | Refresh tooltip 不准确 |
| 12 | Helm 仓库表单 | Enter 提交 + required 字段 |
| 13 | 模板 Ingress/ConfigMap | 数字边界 + Enter 提交 |
| 14 | 镜像仓库标签列表 | 垂直布局 + i18n key-path |
| 15 | 详情面板 + Dashboard | 残留英文 |
| 16 | 模板标题/描述 | Inspect manifest tooltip |
| 17 | 状态栏/集群切换/指标表 | chrome 区域 i18n |
| 18 | ActionList scale/forward | 表单打磨 |
| 19 | 保存查询 CRUD | 覆盖提示 + 缓存反馈 |
| 20 | 端口转发栏 | tooltip + i18n |
| 21 | 集群切换器版本 | 版本截断 + WatchFooter 状态点 |
| 22 | 模板表单 | required 属性 |
| 23 | 设置面板全量 | MCP 配置路径 + 主题标签 |
| 24 | YAML 编辑器 | 编辑模式状态清理 |
| 25 | 主题选择器 | 中间会话主题解析 |
| 26 | 跨命名空间批量确认 | 命名空间显示 |
| 27 | Chrome kind-label | 侧边栏/顶栏/详情面板 |

**价值**：这不是"写完再测"，而是"边写边测，每轮一个焦点"。27 轮 QA 覆盖了几乎所有 UI 区域，建立了完整的质量基线。

---

## 第四阶段：质量加固（08-04）

### KubePi 功能对标

一次性完成 13 项特性，追平 KubePi：

- PDB (PodDisruptionBudget) 管理
- Webhooks 查看
- APIServices 查看
- 审计日志
- 告警静默管理
- CRD 详情
- Helm 回滚
- Ingress 编辑器
- 健康检查配置
- Grafana 搜索集成
- MCP 工具扩展
- 离线 Chart 支持

### 工具链完善

| 工具 | 用途 |
|---|---|
| ESLint | JavaScript/TypeScript 静态检查 |
| Prettier | 代码格式化 |
| rustfmt | Rust 代码格式化 |
| clippy | Rust lint |
| CSP | Tauri 内容安全策略 |

### RBAC 禁止态

当用户无权限访问某个资源时，侧边栏显示锁图标，表格显示"权限拒绝"而非空列表——区分"没有资源"和"没有权限"。

**版本**：v0.2.8

---

## 第五阶段：架构重构（08-05）

### 大文件拆分

将多个超过 1000 行的单体文件拆分为领域模块：

| 原文件 | 拆分结果 |
|---|---|
| `properties.rs` | 按资源类型拆分 |
| `mappers.rs` | 按映射逻辑拆分 |
| `commands.rs` | 按 Tauri IPC 命令拆分 |
| `handlers.rs` | 按 HTTP 处理器拆分 |
| TypeScript 大文件 | 按功能域拆分 |

### 测试体系建设

5 批组件测试，覆盖：
- 核心组件 (Batch 1)
- 详情 Tab (Batch 2)
- 功能面板 (Batch 3)
- Actions/Helm/Topology (Batch 4)
- 其余组件 (Batch 5)

同时修复了所有 58 个 TypeScript 类型错误。

### k7s-web 独立模式

新增纯 Web 部署模式，无需 Tauri 桌面环境：
- 嵌入式前端资源 (rust-embed)
- 自动端口选择
- 浏览器自动打开
- 系统托盘图标
- 兼容 Windows 7

**版本**：v0.3.0

---

## 第六阶段：安全扫描能力（08-05 ~ 08-06）

### SBOM 引擎

实现了三级回退的 SBOM（Software Bill of Materials）扫描：

```
grype 外部扫描器 → 原生解析器 → 降级模式
```

### 镜像传输

完整的离线集群镜像管理：
- **导入**：本地 tar 文件 → 集群节点
- **导出**：集群节点 / 镜像仓库 → 本地 tar
- **批量**：多文件拖拽上传
- **进度**：实时传输进度反馈

**版本**：v0.3.2

---

## 第七阶段：安全审计（08-07）

### 修复的安全问题

| 问题 | 严重性 | 修复 |
|---|---|---|
| 命令注入 | Critical | 参数转义 + 输入校验 |
| 凭据泄漏 | High | authfile 权限 0o600 |
| CORS 过宽 | High | allow_origin(Any) → 白名单 |
| 非回环绑定警告 | Medium | 127.0.0.1 默认绑定 |
| ReDoS 漏洞 | Medium | react-syntax-highlighter → react-shiki |

### 代码去重

- 抽取 `BaseRpcProvider`，Tauri 和 HTTP Provider 继承 → -326 行
- 收窄 9 个读取整个 rows map 的 store 订阅
- 统一 `formatError()` 处理
- 引入 `useAsyncEffect` hook，替代 10 处 cancelled-flag 样板代码

**版本**：v0.3.3

---

## 第八阶段：AI 集成（08-09）

这是项目最大的功能跳跃 — 从"K8s 可视化工具"进化为"AI 驱动的 K8s 运维平台"。

### AI 助手架构

```
┌─────────────────────────────────────────────┐
│                  AI 助手                      │
├─────────────────────────────────────────────┤
│  推理层    │  SSE 流式推理 + 推理过程透明展示  │
│  记忆层    │  4 层记忆 (短期/工作/长期/知识)   │
│  规划层    │  任务规划器 + 定时调度             │
│  工具层    │  91 个 MCP 工具 (与 AI 共享实现)  │
│  安全层    │  写操作门控 + 密钥存储 + 沙箱     │
└─────────────────────────────────────────────┘
```

### 关键实现

- **模型接入**：支持多种 LLM，E2E 测试验证 Xiaomi MiMo 推理模型
- **工具复用**：AI 和 MCP 共享同一套工具实现层 (shared impls)，79→91 个工具
- **推理透明**：前端展示完整的推理过程和上下文引用
- **自主学习**：从操作历史中学习，更新知识库

### MCP 工具扩展

从 79 个扩展到 91 个，新增：
- AI 容量规划 (top_nodes, top_pods, capacity_report)
- AI kubectl 命令生成器
- AI 安全审计
- AI Pod 深度诊断
- 资源变更时间线
- 资源依赖图

---

## 第九阶段：稳定期（08-11 ~ 08-14）

| 日期 | 内容 |
|---|---|
| 08-11 | 14 个 clippy 警告修复，TypeScript 回退 5.x (与 eslint 8 不兼容) |
| 08-11 | 可配置 SBOM 扫描器 + 状态可见性 |
| 08-14 | clippy unused lifetime + scanner config 审查 |
| 08-15 | 依赖升级 (base64, xterm, codemirror, react-shiki) |

---

## 第十阶段：功能深化（08-17 上午）

在拆分之前，先完成了一批高价值功能：

| 功能 | Commit | 说明 |
|---|---|---|
| Pod 终止诊断 | `5292103` | 分析 Pod 终止原因 |
| CSV 导出 | `f0323f6` | 资源表格导出为 CSV |
| AI 解释 YAML | `82cf8cc` | 编辑器选中文本 → AI 解释 |
| Helm 版本 Diff | `b88d26a` | Helm release 版本对比 |
| YAML Schema 校验 | `b1e3d26` | apply 前校验 |
| Pod 日志搜索 | `bd9e051` | 高亮 + 导航 |
| 节点压力检测 | `3cde2b0` | 健康摘要 |
| 资源依赖图 | `215cf21` | API 层面的依赖关系 |
| Ingress 路由调试 | `ec2988d` | 路由排查工具 |
| AI 安全审计 | `8404998` | 集群安全检查 |
| 网络策略模拟 | `4d95105` | NetworkPolicy 影响分析 |
| RBAC 权限矩阵 | `b286914` | 可视化权限关系 |
| 变更时间线 | `872b67d` | 所有资源类型的变更历史 |

---

## 第十一阶段：多端拆分（08-17 下午 ~ 08-18）

### 拆分前的单体结构

```
k7s/
├── src-tauri/          # Rust 后端 (Tauri)
│   ├── src/
│   │   ├── commands.rs
│   │   ├── mappers.rs
│   │   ├── properties.rs
│   │   ├── handlers.rs
│   │   ├── mcp/
│   │   └── ...
│   └── Cargo.toml
├── src/                # React 前端
│   ├── components/
│   ├── providers/
│   ├── stores/
│   └── ...
├── package.json
└── Cargo.toml
```

**问题**：
- iOS/Android 需要编译整个 Rust 后端
- 前端和后端耦合在一个仓库，CI 要全量构建
- 各端的 K8s 资源映射逻辑完全一致，但无法复用

### 拆分过程

#### Step 1：前端独立（08-17 14:41）

```bash
# 创建 k7s-frontend 独立仓库
# 包含所有 React 组件、stores、providers
# 独立的 package.json 和 CI
```

k7s-frontend 拆出后 24 小时内就有 28 个 commit，迭代速度明显加快：
- 性能优化（代码分割、懒加载、渲染收敛）
- iPadOS 适配（平台检测 + 侧边栏抽屉）
- 侧边栏两区布局重构
- 命令面板增强 + 快捷键速查
- 通用 store hooks 提取

#### Step 2：移动端创建（08-17 14:53 ~ 15:24）

```bash
# k7s-ios — iPad/iOS 客户端
# k7s-android — Android 客户端
# 都基于 Tauri 2 Mobile
# 都依赖 k7s-core
```

#### Step 3：核心库抽取（08-17 16:14）

从主仓抽取 ~76 个重复源文件到 k7s-core：
- K8s 资源映射逻辑
- 序列化/反序列化
- 资源类型定义
- 共享工具函数

#### Step 4：共享依赖管理（08-17 17:11 ~ 18:27）

创建 k7s-deps 统一管理 Cargo 依赖，避免各端版本不一致。

#### Step 5：回调与再拆分（08-18 09:05 ~ 15:12）

```
09:05  移除 src-tauri/crates 子模块，合并到 k7s-desktop
       ← 发现过度拆分：Tauri 配置和桌面端逻辑不应该独立于应用代码

09:33  k7s-desktop 独立 CI
       ← 桌面端需要独立的构建和发布流水线

15:12  从 k7s-desktop 抽取 k7s-server
       ← Web + MCP server 应该独立于 Tauri 桌面壳
```

### 拆分后的最终架构

```
k7s (主仓 — 聚合器 + Docker 构建)
│
├── frontend/              → git submodule → k7s-frontend
│   ├── src/
│   │   ├── components/    # React 组件
│   │   ├── stores/        # Zustand 状态管理
│   │   ├── providers/     # 数据提供层
│   │   ├── hooks/         # 自定义 hooks
│   │   └── i18n/          # 国际化
│   ├── package.json
│   └── .github/workflows/ # 独立 CI
│
├── crates/k7s-core/       → git submodule → k7s-core
│   ├── src/
│   │   ├── mapper/        # K8s 资源映射
│   │   ├── types/         # 资源类型定义
│   │   ├── image_scan/    # SBOM 扫描
│   │   └── ...
│   └── Cargo.toml         # 依赖 k7s-deps
│
├── Dockerfile             → 基于 k7s-server 构建
├── .github/workflows      → 按平台拆分的 CI
│   ├── ci.yml             # 主仓 CI
│   ├── release-desktop.yml
│   ├── release-android.yml
│   └── release-ios.yml
│
└── .gitmodules
    ├── frontend → k7s-frontend.git
    └── crates/k7s-core → k7s-core.git

独立仓库:

k7s-frontend/          # React 前端 (28 commits)
├── 独立 package.json
├── 独立 CI (lint + test + build)
└── 被 k7s 主仓以 submodule 方式引用

k7s-core/              # Rust 共享核心 (2 commits)
├── K8s 资源映射
├── 类型定义
├── 被 desktop/ios/android 引用
└── 依赖 k7s-deps

k7s-desktop/           # Tauri 桌面端 (13 commits)
├── Tauri 配置 + IPC 命令
├── Web server (axum)
├── MCP server
├── 独立 CI (build + release)
└── Dockerfile

k7s-ios/               # iPad/iOS 客户端 (9 commits)
├── Tauri 2 Mobile 配置
├── iPadOS 平台适配
└── 依赖 k7s-core

k7s-android/           # Android 客户端 (6 commits)
├── Tauri 2 Mobile 配置
├── Android 8.0+ (API 26)
└── 依赖 k7s-core

k7s-server/            # Web + MCP server (1 commit)
├── 从 k7s-desktop 抽取
├── 独立 Docker 镜像
└── 被 k7s 主仓 Dockerfile 引用
```

### 拆分驱动力

| 驱动力 | 说明 |
|---|---|
| **多端需求** | 08-17 同时创建 iOS 和 Android 项目，单体仓库无法高效支持 |
| **~76 个重复文件** | 各端的 K8s 资源映射、序列化逻辑完全一致 |
| **CI 效率** | 单体仓库的 CI 要构建所有端，拆分后各端独立构建 |
| **前端独立迭代** | k7s-frontend 拆出后 24 小时内 28 个 commit，迭代速度明显加快 |
| **Docker 镜像优化** | k7s-server 独立后，Docker 镜像只包含 Web server，不包含 Tauri 桌面壳 |

### 拆分中的试错

```
08-17 17:11  创建 k7s-deps 共享依赖 crate
08-17 20:59  发现 k7s-deps 不应在 workspace 中（standalone crate）
08-17 22:44  迁移 k7s-core 到 k7s-deps
08-18 09:05  反向整合：移除 src-tauri/crates 子模块 → k7s-desktop
08-18 15:12  再次拆分：从 k7s-desktop 抽取 k7s-server
```

这是一个 **先过度拆分 → 发现不合理 → 回调 → 再精确拆分** 的典型过程。

---

## 版本节奏

| 版本 | 日期 | 主题 |
|---|---|---|
| v0.1.0 | 08-01 | 原型 |
| v0.2.1 | 08-02 | TTY + Port-forward + ⌘K |
| v0.2.2 | 08-02 | i18n + 主题 |
| v0.2.3 | 08-02 | CI 修复 |
| v0.2.4 | 08-02 | 依赖修复 |
| v0.2.5 | 08-03 | YAML 导入 + 镜像导入 |
| v0.2.6 | 08-03 | 侧边栏重组 + Dashboard 重建 |
| v0.2.7 | 08-03 | HPA 监控 + 节点 Shell + Rollout 版本 |
| v0.2.8 | 08-04 | UI 打磨 + RBAC + 安装脚本 |
| v0.2.9 | 08-05 | 架构重构 + 测试 |
| v0.3.0 | 08-05 | k7s-web 独立模式 + SBOM |
| v0.3.2 | 08-06 | 镜像传输 + 质量改进 |
| v0.3.3 | 08-07 | 安全审计 + 代码去重 |
| v0.3.4 | 08-09 | AI 助手 |
| v0.3.6 | 08-17 | 功能深化 + 拆分前收尾 |
| v0.3.7 | 08-18 | 多端拆分 + k7s-server |

---

## 关键数字

| 指标 | 数值 |
|---|---|
| 总天数 | 17 天 |
| 主仓 commits | 481 |
| 子仓库 commits | 59 |
| 版本数 | 16 |
| QA pass 数 | 27 |
| MCP 工具数 | 91 |
| K8s 资源类型 | 27 |
| 抽取的重复文件 | ~76 |
| 子仓库数 | 6 |

---

## 经验总结

### 什么做对了

1. **测试先行**：首日就建立 E2E 测试框架，而非"先写功能再补测试"
2. **QA 工程化**：27 轮结构化 QA，每轮一个焦点，建立质量基线
3. **安全意识**：命令注入、凭据泄漏、CORS 等安全问题在早期就被发现和修复
4. **渐进拆分**：先在单体中验证功能，再按需拆分，避免过早优化
5. **工具复用**：AI 和 MCP 共享工具实现层，减少重复代码

### 什么可以改进

1. **CI 调试**：20 个 TEMP commit 说明 CI 配置缺乏本地验证手段
2. **拆分节奏**：08-17 一天内做了太多架构变更，导致 08-18 需要回调
3. **依赖管理**：k7s-deps 的 standalone vs workspace 问题说明依赖策略需要提前规划

### 对未来项目的启示

1. **单体先行**：在功能验证完成之前，不要急于拆分
2. **QA 不是事后工作**：结构化的 QA pass 比"最后集中测试"更有效
3. **拆分要有驱动力**：不是"应该拆"，而是"不得不拆"（重复文件、CI 效率、多端需求）
4. **接受试错**：拆分过程中的回调是正常的，关键是快速纠正
