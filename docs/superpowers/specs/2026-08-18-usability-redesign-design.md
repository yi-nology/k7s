# k7s 易用性彻底重构设计文档

- **日期**: 2026-08-18
- **状态**: 待用户审阅
- **范围**: k7s-frontend(主)、k7s-server(登录会话层)、k7s-desktop(随 frontend 受益)
- **不涉及**: k7s-android / k7s-ios、后端 Rust 业务逻辑(91 个 MCP 工具、AI 助手)、多用户体系

## 1. 背景与决策记录

用户反馈四个痛点全中:导航/信息架构太乱、操作太工程师向(创建/编辑靠 YAML)、首次上手没有引导、界面视觉/交互粗糙。经确认的决策:

| 决策点 | 结论 |
|---|---|
| 改造策略 | 彻底重构(按 KubePi/Kuboard 范式重做信息架构与交互) |
| 主战场 | Web 优先(k7s-web 浏览器体验为首要目标) |
| 用户体系 | 单用户 + 登录门(不做多用户/RBAC/审计,留二期) |
| 功能取舍 | 现有全部功能保留,重新归类收纳,不裁剪 |

### 参照系

| 来源 | 借鉴点 |
|---|---|
| Kuboard | 工作负载创建表单分层向导、概览页图形化 |
| KubePi | 大区分区导航、命名空间全局选择器、集群导入向导、登录后干净首页 |
| k7s 自身保留 | 深色 Linear 美学、虚拟滚动表格性能、MCP/AI 差异化能力、YAML 专家入口 |

## 2. 信息架构重构

### 现状问题

`k7s-frontend/src/components/sidebar/NavList.tsx` 将 8 个 K8s 资源组(workloads/network/storage/config/access/helm/cluster/custom)与 12+ 个 overlay 工具(grafana/helm-market/diff/pod-files/topology/image-repos/image-transfer/sbom/audit/plugins/templates…)平铺在一列;`kinds.tsx` 的 `GROUP_LABELS` 全英文;打开应用直达 Pods 空表格。

### 目标结构

5 大分区,每分区为独立页面,导航壳采用「左侧窄边栏(仅 5 个分区图标 + 文字)+ 页内副导航」,侧边栏不再承载全部入口:

```
🏠 概览        集群仪表盘(默认首页)
📦 工作负载    Deployments / StatefulSets / DaemonSets / Jobs / CronJobs / Pods / Helm Releases
⚙️ 配置与网络  ConfigMaps / Secrets / Services / Ingress / Endpoints / ServiceAccounts
💾 存储        PV / PVC / StorageClass
🧰 运维工具    可观测性(Prometheus/Grafana/AlertManager/Loki)、镜像仓库/传输、
              安全(SBOM/审计/RBAC)、服务拓扑、模板、Diff、插件
```

规则:

- **命名空间选择器提升到全局顶栏**:选择一次,全站过滤(KubePi 核心交互)。
- ReplicaSets 从一级导航移入 Deployment 详情页(所属关系查看);CRD 发现(custom 组)归入「配置与网络」页底部的「自定义资源」区。
- **中文为默认语言**,顶栏可切英文;i18n 词典补全所有新文案。
- `store/navigationSlice.ts` 的 `overlay/kind` 二元模型升级为 `section/subpage` 模型,旧 overlay 组件挂到对应 subpage,组件本体不大改。

## 3. 登录门 + 首次引导

### 登录门

- 单用户密码:首次启动 `k7s-web` 时走「设置密码」页,服务端加盐哈希存文件(`--data-dir` 下,不上数据库)。
- 会话:登录成功后签发 HttpOnly cookie(复用现有 loopback 自动 token 机制合并为统一会话层);非 loopback 绑定时强制登录,loopback 默认免登(可用 `--require-auth` 覆盖)。
- `K7S_WEB_TOKEN` 环境变量继续兼容(脚本/API 场景)。
- 桌面端(Tauri 本地 IPC 可信)自动跳过登录门。

### 首次引导(3 步向导)

1. 导入 kubeconfig:粘贴文本 / 选择文件 / 输入路径三种方式。
2. 连接测试:成功后展示集群摘要卡(版本、节点数、ns 数)。
3. 偏好设置:主题 / 语言 / 默认命名空间 → 进入概览页。

### 空状态

- 无集群:概览页显示「导入集群」引导大卡片,非空表格。
- 表格空态:显示「创建第一个工作负载」按钮,直通创建向导。

## 4. 表单化操作向导(Kuboard 范式)

### 创建工作负载向导(4 步)

1. 基本信息:名称、命名空间、容器镜像、副本数。
2. 容器配置:端口、环境变量、资源限额、存活/就绪探针 —— 高级项默认折叠。
3. 存储与配置:Volume/PVC/ConfigMap/Secret 挂载。
4. 预览与应用:展示生成的 YAML(可直接编辑)→ 服务端 dry-run 校验 → Apply。

### 配套表单

- Service(端口映射)、Ingress(复用现有可视化编辑器并入)、ConfigMap、Secret 创建表单。
- 现有「YAML 模板」功能与向导合并为统一「创建」入口(模板作为向导起点选项)。
- **YAML 专家模式保留**:快捷键直达编辑器;表单与 YAML 双向同步。

### 不变项

扩缩容、重启、删除、drain、port-forward 等现有操作交互不动,仅随新导航换挂载位置。

## 5. 视觉与交互打磨

- **概览页卡片化**:现有 `components/dashboard/Dashboard.tsx`(481 行)升级为首页 —— 健康评分大卡(复用现有 `cluster_health`)、节点状态矩阵、异常事件流、CPU/MEM Top5、快捷入口。
- **状态徽章中文化**:`CrashLoopBackOff` → 红色徽章「崩溃循环」+ tooltip 展示原始状态与可能原因。
- **表格**:行内 hover 操作按钮(降低右键菜单依赖);密度分「舒适/紧凑」两档(设置持久化)。
- **错误友好化**:API 错误翻译为人话 + 建议动作(RBAC 拒绝时提示所需权限;连接失败时给出排查步骤)。

## 6. 技术边界

| 仓库 | 改动 |
|---|---|
| k7s-frontend | 导航壳重构(分区页 + 副导航)、Onboarding 向导、CreateWorkload 向导、Dashboard 升级、i18n 词典、navigationSlice 模型升级 —— 改动集中地 |
| k7s-server | 登录会话层(密码哈希 + cookie 会话 + 静态文件服务),不引入数据库 |
| k7s-desktop | 共用 frontend 自动受益;登录门跳过逻辑 |
| k7s-core / MCP / AI | 零改动 |

## 7. 实施阶段

- **P1**:信息架构重构 + 概览首页 + 登录门(解决「不知道去哪看、没有引导」)。
- **P2**:创建/编辑表单向导(解决「必须会写 YAML」)。
- **P3**:视觉打磨 + 空状态 + 错误友好化。
- **二期(本期不做)**:多用户、RBAC、审计日志(KubePi 团队范式)、Web 模式 AI 写操作解禁。

## 8. 测试策略

- 现有 1253 个前端测试随组件迁移改写,行为不变的不改断言。
- 向导组件新增单测:表单输入 → 生成 YAML 的快照测试;表单 ↔ YAML 双向同步用例。
- 登录会话:服务端单测(哈希、会话过期、token 兼容)。
- Playwright e2e 核心路径:登录 → 导入集群 → 创建工作负载 → 概览页可见。
