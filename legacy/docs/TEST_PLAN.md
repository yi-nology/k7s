# k7s — Test Plan

> 适用范围:k7s MVP 0.1.0 及后续迭代。覆盖 Tauri 2 桌面端两条链路(Rust 后端 + React 渲染器)以及它们与真实/模拟 Kubernetes 集群的交互。
>
> 状态:**Draft v1** — 与 `README.md` 中的功能列表保持一致,随代码演进持续更新。

---

## 1. 目标与非目标

### 1.1 测试目标
- **正确性**:每一个 Tauri command 在正常 / 边界 / 失败路径下的行为都被验证。
- **健壮性**:在弱网、无 cluster 权限、K8s API 版本不一致、context 切换中途等异常情况下,应用不崩溃、给出可读错误。
- **跨平台**:macOS / Linux 上 `npm run tauri:dev` 与 `tauri:build` 全流程稳定;Windows 至少保证 `cargo check` 通过。
- **回归保护**:核心资源视图(20+ 种)、YAML 编辑 / Apply、scale / restart / cordon / drain 等破坏性操作,在每次发版前有自动化覆盖。
- **可观测**:测试本身要快、可重跑、产物可定位,CI 上失败 5 分钟内能定位到模块。

### 1.2 非目标(本期)
- 不做大规模性能压测(资源规模上限 1k objects / 集群足够,后续如要扩,单列 benchmark 计划)。
- 不做安全审计 / 渗透测试(Tauri capability 规则另立 `docs/SECURITY.md`)。
- 不覆盖 beta / alpha 资源(只在清单里出现 GA + well-known beta)。

---

## 2. 测试层级(测试金字塔)

```
        ┌──────────────────────┐
        │  E2E (Playwright)    │  数量:少,跑得慢,贴近用户    ← 关键路径
        ├──────────────────────┤
        │  Integration (Rust)  │  数量:中,真集群 / kind       ← 命令层
        ├──────────────────────┤
        │  Unit (TS + React)   │  数量:多,纯组件逻辑          ← 渲染层
        ├──────────────────────┤
        │  Unit (Rust)         │  数量:最多,纯函数 / 解析     ← 业务核心
        └──────────────────────┘
```

| 层级 | 工具 | 运行环境 | 执行时长预算 | 触发 |
|------|------|---------|------------|------|
| Rust 单元 | `cargo test` 内置 | 本地 | < 30s | 每次 push |
| TS 单元 | Vitest + Testing Library | jsdom | < 30s | 每次 push |
| Rust 集成 | `cargo test --test '*'` + kind | Docker + kind | < 3min | 每次 push(main / MR) |
| TS 组件 | Vitest + @testing-library/react | jsdom | < 30s | 每次 push |
| E2E | Playwright + `_tauri` driver | Tauri dev build | < 5min | MR / nightly |
| 烟雾 | `npm run tauri:build` + 启动 | 真实 desktop | < 2min | release tag |

---

## 3. 测试覆盖矩阵

### 3.1 业务功能 → 测试层级映射

| 模块 | 命令(Rust) | Rust 单元 | Rust 集成 | TS 单元 | E2E |
|------|-----------|-----------|-----------|---------|-----|
| Context 列表 / 切换 | `list_contexts` / `current_context` / `import_kubeconfig` | ✅ 解析 | ✅ 真 kubeconfig | ✅ 选择器 | ✅ |
| 连接 / 断开 | `connect` / `disconnect` | ✅ | ✅ | ✅ 状态机 | ✅ |
| 资源列表(20+) | `list_pods` / `list_deployments` / ... | ✅ mapper / dto | ✅ 真集群 + 固定 fixture | ✅ 表格渲染 | ✅ 抽样 5 类 |
| YAML get / apply / delete | `get_yaml` / `apply_yaml` / `delete_resource` | ✅ 解析 | ✅ 真集群 dry-run | ✅ 编辑器交互 | ✅ |
| 写操作:scale / restart / cordon / drain | `scale_resource` / `restart_pod` / `restart_rollout` / `set_cordon` / `drain_node` | ✅ 参数校验 | ✅ 真集群 + 隔离 namespace | ❌ | ✅(dry-run 模式) |
| Logs 流 | `start_log_stream` / `stop_log_stream` / `export_logs` | ✅ 取消逻辑 | ✅ | ✅ 模态框 | ⚠️ 手动 |
| Shell | `start_shell` / `shell_input` / `shell_resize` / `stop_shell` | ✅ | ⚠️ 隔离 | ❌ | ⚠️ 手动 |
| Port-forward | `start_port_forward` / `list_port_forwards` / `stop_port_forward` | ✅ | ✅ localhost | ✅ 模态框 | ⚠️ 手动 |
| Events | `list_events` | ✅ | ✅ | ✅ | ✅ |
| 错误处理 | 所有命令的 `AppError` 路径 | ✅ | ✅ | ✅ toast | ✅ |

图例:✅ 覆盖 ⚠️ 手动 / 半自动 ❌ 暂不覆盖

### 3.2 平台覆盖

| 平台 | 单元 / 集成 | E2E | Build | 备注 |
|------|------------|-----|-------|------|
| macOS(arm64 / x86) | ✅ dev 机 | ✅ | ✅ | 主战场 |
| Linux(Ubuntu 22.04) | ✅ CI runner | ✅(nightly) | ✅ | 矩阵扩展 |
| Windows 11 | ✅ `cargo check` | ❌ | ❌ | README 标注:仅 dev |

---

## 4. Rust 后端测试

### 4.1 单元测试

**目标模块**:`src-tauri/src/kube/{mappers, dto, properties, metrics, discovery, watchers, logs, exec, portforward}` 与 `src-tauri/src/error.rs`。

- **mappers**:把 `k8s_openapi::...` 结构 → `*Row` DTO。覆盖:
  - 字段缺失(`status`、`metadata.labels`、`nodeInfo` 为空)。
  - Container status 状态组合(`running` / `waiting` / `terminated`)。
  - Node conditions / addresses 提取。
  - 时间戳序列化(`NaiveDateTime` → ISO8601 字符串)。
- **dto**:序列化 / 反序列化,字段别名、Option 字段。
- **properties**:**重点**。负责把任意 K8s object → 通用 `(name, kind, age, status, ...)` 列表,被多数资源视图复用。必须有:
  - 单元测试覆盖 `Pod / Deployment / Service / Node / ConfigMap / Secret / Job / CronJob / StatefulSet / DaemonSet / ReplicaSet / Ingress / IngressClass / ServiceAccount / PVC / StorageClass / PodDisruptionBudget / RoleBinding / HPA / Namespace / Event` 全部 20+ 类。
  - unknown kind 走 fallback 路径(显示 kind + name + age)。
- **error**:`AppError` 的 `Display` / `From<kube::Error>` / serde 序列化。确保前端拿到的错误信息可读、不泄漏 token。
- **watchers / logs / portforward**:
  - cancel token 状态转换(`Active → Cancelling → Dropped`)。
  - buffer 满后的丢弃策略。
  - 多 consumer 时的 channel close 行为。

**目录**:`src-tauri/src/kube/<module>.rs` 同文件内 `#[cfg(test)] mod tests`。覆盖门槛:行覆盖 ≥ 80%,关键模块(mappers / properties)≥ 90%。

### 4.2 集成测试

**目标**:验证 Tauri command 在真实 K8s API 下的端到端行为。

**环境**:
- 本地 / CI 启动 `kind create cluster --name k7s-test`(1 control-plane + 2 workers,关掉 default CNI 之外的全部 addon)。
- `tests/fixtures/k8s/` 下放 YAML fixture:`namespace.yaml` / `pod-nginx.yaml` / `deployment-echo.yaml` / `service-clusterip.yaml` / `pvc.yaml` / `hpa.yaml` / `pdb.yaml` / `serviceaccount.yaml` / `job.yaml` / `cronjob.yaml` 等。
- 测试 setup 用 `kube::Client` 直连 kind,不经过 Tauri runtime。`ClientManager` 可被 `Arc::new` 后直接调用方法,只需要在测试里手动 `connect()`。

**测试用例**(每个 command 一组):
- `list_pods`:
  - 空 namespace 返回空数组,不报错。
  - 多 pod 返回正确数量,字段映射无遗漏。
  - 跨 namespace 列表用 `--all-namespaces` 等价参数。
- `get_yaml` / `apply_yaml` / `delete_resource`:
  - round-trip:`get_yaml` 拿到的字符串 → `apply_yaml` 重新应用 → `get_yaml` 内容稳定(去掉 `managedFields` / `resourceVersion` 等 server-side 字段)。
  - apply 到不存在的资源 = create,apply 到已存在 = patch。
  - delete 不存在的资源返回 AppError::NotFound,前端能区分 "not found" 和 "forbidden"。
- `list_events`:至少能拿到 `kube-system` 下的 Normal event,字段不丢。
- **写操作**:
  - `scale_resource(deployment, 3)` → `list_deployments` 显示 3 副本,`status.replicas == 3`。**测试结束必须 scale 回 1**。
  - `restart_pod(pod)` → 旧 pod 被删,同名 pod 重新创建,`metadata.uid` 变化(用 readiness probe 保证稳定)。
  - `set_cordon(node, true)` → `kubectl uncordon` 收尾。
  - `drain_node`:测试用 **空节点**(`--ignore-daemonsets --force`),跑完立即 uncordon。
- `logs`:`start_log_stream(pod, follow=true)` → 后台写日志到文件 → `export_logs` 导出文件 → 检查行数 ≥ 10。**每个流用完 stop**。
- `portforward`:起一个 `Service clusterip:80 → localhost:18080` → curl 通,跑完 stop。

**隔离**:每个测试用独立 namespace(`k7s-it-<uuid8>`),setup 创建、teardown 删除(用 `tokio::time::timeout` 兜底,避免卡住 CI)。

**目录**:`src-tauri/tests/<area>_<command>.rs`。如 `src-tauri/tests/cmd_scale.rs`、`src-tauri/tests/cmd_logs.rs`。

### 4.3 探针 / 烟雾

- 已有 `probe.mjs` 和 `crates/probe`,**升级为发布前必跑项**:
  - `node probe.mjs`:用 JS client 走通核心 API,作为"集群可达 + 权限正确"的最弱断言。
  - 计划新增 `crates/probe/src/bin/tauri_smoke.rs`:`ClientManager` 启动后跑一次 `list_pods(kube-system)`,把 row 数打印到 stdout。
  - 这两个 probe 既给 dev 用,也在 release pipeline 里做最后一道闸口。

---

## 5. TypeScript / React 渲染层测试

### 5.1 工具链(待引入)

```jsonc
// package.json devDependencies 增量
{
  "vitest": "^2.1",
  "@testing-library/react": "^16",
  "@testing-library/user-event": "^14",
  "@testing-library/jest-dom": "^6",
  "jsdom": "^25",
  "@vitest/coverage-v8": "^2.1",
  "msw": "^2.6"          // Mock Service Worker,模拟 invoke()
}
```

`vite.config.ts` 加 `test:` 段;`tsconfig` 把 `vitest/globals` 加入 `types`。

### 5.2 单元测试

- `src/lib/tauri.ts`:command wrapper 透传正确,error 抛出统一形状(可在 MSW handler 模拟 invoke 响应)。
- `src/lib/types.ts`:Row 类型的运行时 guard(narrowing / 防御性 default)。
- 纯函数工具:如时间格式化、status → 颜色映射、表格列宽计算。
- 状态机:context 切换、namespace 过滤、active resource 切换的 reducer / context provider。

### 5.3 组件测试

- `Sidebar`:点击导航项触发 onChange,active 高亮。
- `TopBar`:context 切换 / namespace 切换 / "all" 选项,触发正确回调。
- `ResourceTable`:空 / 单行 / 多行 / 加载 / 错误 5 种状态;排序、列宽;键盘 ↑↓ 选中。
- `DetailPanel` / `LogsModal` / `ExecModal` / `PortForwardModal`:mount → 输入 → 提交 → 断言 invoke 被调用且参数正确;Esc 关闭;关闭时清理资源。
- 错误兜底:模拟 invoke 抛出 string,UI 显示 toast,组件不崩。

### 5.4 视觉回归(可选,P1 起)

引入 `playwright` + `expect.toHaveScreenshot()`。每个核心视图(pods / deployments / services)做一次基线截图,后续像素级对比。注意 Tauri webview 在不同 OS 上 DPR 不同,需要按平台分别落基线。

---

## 6. E2E 测试(Playwright + Tauri)

### 6.1 驱动接入

Tauri 2 推荐用 `@tauri-apps/test` + `tauri-driver`,但实践里更稳的做法是 **Playwright 直连 WebView 的 devtools 协议**。两条路并存:

- **路线 A(推荐)**:Playwright + `_tauri` WebDriver 端口(由 `tauri-plugin-webdriver` 暴露),需要 Rust 编译。CI 上跑。
- **路线 B(降级)**:Playwright + `tauri dev` 的 Vite 端口(`http://localhost:5173`),把 `invoke()` 用 MSW mock 掉。**只覆盖渲染层**,业务正确性靠集成测试保。

**本期建议**:路线 B 起步,等稳定后切 A。

### 6.2 用例(关键路径)

每个用例前都 `await page.goto('/')` + 等待 sidebar 出现。

1. **Connect flow**
   - 打开 app → 看到 context 列表(用 fixture kubeconfig)→ 选择 → connect → 进入 Pods 视图且 rows 渲染。
2. **Resource 浏览**
   - 切 namespace 过滤(默认 / all / 自定义)→ 列表行数变化。
   - 切换 Sidebar 资源类型(至少覆盖 Pods / Deployments / Services / Nodes / Namespaces)。
3. **详情 + YAML**
   - 点行 → 详情面板打开 → 切到 YAML tab → 看到完整 manifest。
   - 编辑 replicas → Apply → 回到列表,数字更新。
4. **写操作(危险)**
   - Deployment → Scale → 输入 2 → 确认 → 列表更新。**必须在隔离 namespace**。
   - Pod → Restart → 列表出现新 uid。
5. **Logs**
   - Pod → Logs → 模态框打开 → 看到 ≥ 1 行(由 fixture pod 主动 echo)。
   - 关闭 → 后台 stream 被 cancel(通过 manager task 计数断言)。
6. **断连恢复**
   - 模拟集群不可达(关 kind)→ UI 显错误 toast,不崩 → 重启 kind → 点 "Reconnect" → 恢复。
7. **Port-forward**
   - Service → Port Forward → 起 8080 → curl localhost:8080 通 → Stop → curl 失败。
8. **错误处理**
   - 加载不存在的 namespace → 显示空状态 + 提示,不是崩溃。

### 6.3 数据准备

- E2E 启动前,CI job 执行 `tests/e2e/setup.sh`:创建 kind cluster、应用 `tests/fixtures/k8s/` 下的全套 fixture、暴露 `KUBECONFIG` 路径给 app。
- 结束后 `tests/e2e/teardown.sh` 删集群(无论成败)。

---

## 7. 性能 / 稳定性(轻量,本期不深做)

- **冷启动**:`tauri:build` 产物首次启动到 sidebar 可交互,< 2s(macOS M1 / Linux i5 基线)。
- **大列表**:1k pods 渲染不卡顿(虚拟滚动 / 分页)。用一个 bench harness 灌 1k 假数据(后端命令可注入 count 参数)。
- **内存**:logs 持续 5 分钟不泄漏。`dhat` 或单纯 RSS 对比。
- **Watch 风暴**:频繁更新场景下(kubectl apply 循环)events 列表不丢、不重复。

---

## 8. 测试数据 & 环境

### 8.1 Kubeconfig fixture
- `tests/fixtures/kubeconfig/`:
  - `single-cluster.yaml` — 1 cluster,3 context(默认 / staging / dev)。
  - `multi-cluster.yaml` — 2 cluster,模拟多集群切换。
  - `broken.yaml` — 故意写错 server,用于错误路径。
  - `expired.yaml` — token 过期,验证错误提示是 "Unauthorized" 而不是 "Internal error"。
  - `large-token.yaml` — token > 4KB,验证不截断。

### 8.2 资源 fixture
- 见 §4.2。统一放在 `tests/fixtures/k8s/`,apply 时用 `kustomize` 或裸 `kubectl apply -f`。
- 包含至少 1 个 Pending pod(用于 Failed / Pending 颜色),1 个 NotReady node,1 个 OOMKilled container(给 status 映射做边界)。

### 8.3 CI Runner
- macOS:`macos-14`,arm64。
- Linux:`ubuntu-22.04`。
- Docker in Docker(kind 需要)。
- 缓存:`target/`、`node_modules/`、playwright browser cache。

---

## 9. 工具链与脚本

### 9.1 新增 npm scripts
```jsonc
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:cov": "vitest run --coverage",
  "test:ui": "vitest --ui",
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui",
  "test:rust": "cargo test --workspace",
  "test:rust:it": "cargo test --workspace --test '*' -- --test-threads=1",
  "test:all": "npm run test:rust && npm run test && npm run test:e2e"
}
```

### 9.2 报告产物
- Rust:`cargo test --workspace -- -Z unstable-options --format json` → `target/test-report.json`,CI 解析。
- Vitest:`@vitest/coverage-v8` → `coverage/`,上传 codecov。
- Playwright:HTML report + trace,artifact 保留 7 天。

---

## 10. CI 集成

### 10.1 Pipeline(`.github/workflows/ci.yml`,示意)

```yaml
jobs:
  rust-unit:
    runs-on: ubuntu-22.04
    steps: [checkout, setup-rust, cache, run: cargo test --workspace]

  ts-unit:
    runs-on: ubuntu-22.04
    steps: [setup-node, install, run: npm ci && npm run test:cov]

  rust-integration:
    runs-on: ubuntu-22.04
    services: [docker]
    steps: [setup-rust, install-kind, run: ./scripts/it.sh]   # 含 kind up + fixture apply + cargo test

  e2e:
    needs: [rust-unit, ts-unit, rust-integration]
    runs-on: macos-14
    steps: [setup-node, setup-rust, install, run: npm run tauri:build, run: npm run test:e2e]

  release-smoke:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: [e2e]
    runs-on: macos-14
    steps: [build dmg, install, run node probe.mjs, run crates/probe binary]
```

### 10.2 MR 准入
- 单元 + 集成全绿。
- 新增代码覆盖下降 > 1% 需 reviewer 确认。
- E2E 在 main / MR 上跑;不强制每个 commit 跑(慢)。

---

## 11. 准出标准(Release Gate)

MVP 0.1.0 之前必须满足:

- [ ] 所有 §3 矩阵中标注 ✅ 的项有自动化用例。
- [ ] 单元 + 集成测试在本地全绿,CI 主线 5 次连续无 flake。
- [ ] 关键路径(connect、Pods/Deployments 浏览、YAML apply、scale、restart、port-forward)E2E 通过。
- [ ] 一次完整 `tauri:build` 产物可在 macOS 干净机器上启动并 connect 到 kind 集群。
- [ ] 至少一份 release notes 描述已知限制(Windows 不打包 / Shell exec 仅 Linux 等)。
- [ ] 失败用例分类:基础设施问题 vs 产品 bug,后者必须修复或显式 defer。

---

## 12. 风险与权衡

| 风险 | 影响 | 缓解 |
|------|------|------|
| kind 在 macOS arm64 runner 上慢 / 不稳 | E2E 跑不完 | Linux runner 跑 E2E,macOS 仅 build smoke |
| kube-rs 版本与 k8s-openapi 漂移 | mapper 测试失效 | pin 依赖到具体 minor,升版本时单独 PR + 跑全套 |
| Tauri WebDriver 在 WebView2/WebKit 上行为差 | E2E 跨平台不稳 | 走"渲染层 + 集成"双轨,不强求一站式 |
| Logs / Shell 流式数据难断言 | flaky | 只断言"有 ≥N 行"和"关闭后无新增",不比对内容 |
| cluster 状态非空,测试互相污染 | 假阳性 | namespace 隔离 + teardown + 顺序无关 |
| `cargo` + `tauri` 全量编译 5+ 分钟 | CI 反馈慢 | cache + sccache,`cargo test` 走增量 |

---

## 13. 路线图

| 阶段 | 时机 | 内容 |
|------|------|------|
| **P0 — 起步**(本周) | 当前 | 引入 Vitest / Testing Library;`kube/properties.rs` 全量单元测试;mappers 模块单测基线 |
| **P1 — 命令层** | 2 周内 | 集成测试 harness(kind + fixture)覆盖全部 list / get / apply / delete |
| **P2 — 写操作** | 3 周内 | scale / restart / cordon / drain 在隔离集群跑通 |
| **P3 — 渲染层** | 4 周内 | ResourceTable / DetailPanel / 4 个 Modal 组件测试 |
| **P4 — E2E** | 5–6 周 | Playwright 路线 B 上线;路线 A 视官方稳定度评估 |
| **P5 — 加固** | 持续 | 视觉回归 / 性能基线 / flaky 治理 |

---

## 14. 相关文档

- `README.md` — 功能与技术栈
- `src-tauri/src/lib.rs` — 命令注册中心(测试对象清单)
- `probe.mjs` / `crates/probe/` — 已有探针(纳入 §4.3)
- 后续:`docs/SECURITY.md`(Tauri capability 审计)、`docs/PERFORMANCE.md`(基准)
