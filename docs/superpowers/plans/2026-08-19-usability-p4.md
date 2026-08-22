# k7s 易用性 P4 收尾批实施计划(Job/CronJob 向导 + 空 CRD 隐藏 + 小尾巴)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全 P2 遗留——向导支持 Job/CronJob;落地用户点名的空 CRD 隐藏(跨 4 仓库计数链);清掉积压小尾巴(引导 X 按钮、errorsHuman 加固、回填复活、选择器加固)。

**Architecture:** 前端向导扩展 `WorkloadForm`(schedule/completions 字段)+ 生成器嵌套参数化(cronjob 模板深 6 空格)+ parse 双向补全(mounts/command/resources 回收,根治回填复活)。空 CRD:k7s-core 新增 `custom_kind_counts`(逐 CRD `LIST limit=1` 读 `remainingItemCount`,每 CRD 一次轻调用)→ k7s-server web 桥路由 → k7s-desktop Tauri 命令 → 前端 provider/store/SubNav 过滤。

**Tech Stack:** React 19 + Zustand + Vitest;kube-rs(`Api::all_with` + ListParams limit);axum;Tauri commands。

**设计文档:** 三期计划「执行结果」遗留清单。

## Global Constraints

- 前端工作目录 `k7s-frontend/`(分支 `feat/usability-p4`);Rust 仓库各自从 main 拉同名分支。
- 所有用户可见文案走 i18n 三文件;`t(key, 英文fallback)`。
- 现有测试保持绿;提交只 stage 本任务文件(k7s-frontend 工作区有用户未提交改动)。
- **CRD 计数只做一次性查询**(连接后或展开时触发一次),不得为全部 CRD 常驻 watch。
- YAML 生成保持字符串拼接风格;cronjob 的 schedule 双引号包裹(对齐模板)。

## 文件结构总览

```
k7s-frontend/src/components/wizard/workloadSpec.ts   [改] job/cronjob 类型 + parse 补全
k7s-frontend/src/components/wizard/StepFields.tsx    [改] 类型下拉 + schedule/completions 字段
k7s-frontend/src/components/table/ResourceTable.tsx  [改] WIZARD_KINDS + jobs/cronjobs
k7s-core/src/kube/discovery.rs (或 mod.rs)           [新] custom_kind_counts
k7s-server/src/web/{types,resource_handlers,server}.rs [新] 桥接 custom_kind_counts
k7s-desktop/src/commands/ + src/lib.rs               [新] Tauri 命令
k7s-frontend/src/providers/** + store                [改] provider 方法 + customKindCounts
k7s-frontend/src/components/subnav/SubNav.tsx        [改] 空实例 kind 隐藏
k7s-frontend/src/components/onboarding/OnboardingWizard.tsx [改] X 关闭按钮
k7s-frontend/src/lib/errorsHuman.ts                  [改] \b 加固 + time out
```

---

### Task 1: Job/CronJob 向导支持 + parse 回收补全(前端)

**Files:**
- Modify: `src/components/wizard/workloadSpec.ts`(+`.test.ts`)、`src/components/wizard/StepFields.tsx`、`src/components/table/ResourceTable.tsx`、i18n 三文件(`wizard.field.schedule/completions/scheduleHint` 等)

**Interfaces(扩展后):**
```ts
export interface WorkloadForm {
  // …现有字段不变…
  schedule: string;        // cronjob 专用,默认 '0 * * * *'
  completions: number;     // job 专用,0 = 省略
}
// WorkloadType 增 'job' | 'cronjob';KIND_OF 增 batch/v1 两项(编译器强制)
// parseWorkloadYaml 回收字段扩展:command/args/cpuRequest/memRequest/cpuLimit/memLimit/mounts(与生成对称)
```

**要求(测试先行,断言生成 YAML 形状):**
1. Job:无 replicas/selector;`restartPolicy: OnFailure` 进 template.spec;`completions: N`(N>0 时);模板与 Deployment 同深。
2. CronJob:`schedule: "…"`(双引号);pod 模板整体深 6 空格(`jobTemplate.spec.template`);template.spec 含 restartPolicy: OnFailure;无 replicas/selector。
3. validate:cronjob 时 schedule 必填(五段 cron 粗校验 `/\S+\s+\S+\s+\S+\s+\S+\s+\S+/`,错误后缀 'schedule')。
4. StepFields:类型下拉加 Job/CronJob;replicas 仅 deployment/statefulset 显示;cronjob 显示 schedule 文本框(带格式提示);job 显示 completions NumberField(0=省略提示)。
5. WIZARD_KINDS 增 `jobs`,`cronjobs`(空态 CTA 与新建路由随之生效)。
6. parse:kind 映射加 Job/CronJob(cronjob 走 jobTemplate 链);回收 command/args/resources 四字段/mounts(volumeMounts→{pvcName,mountPath,readOnly})——回填删除 mounts 不再复活;round-trip 测试覆盖新字段。

- 提交:`feat(wizard): Job and CronJob support + fuller YAML parse-back`

### Task 2: k7s-core `custom_kind_counts` + k7s-server 桥接

**Files:**
- k7s-core:`src/kube/discovery.rs` 增 `pub async fn custom_kind_counts(client: &Client) -> AppResult<Vec<CustomKindCount>>`;`CustomKindCount { id: String, count: u64 }`(serde Serialize)放同文件。
- k7s-server:`src/web/types.rs` 增 `CustomKindCountsArgs`(无字段或带可选刷新标记——无参即可)、`resource_handlers.rs` 增 handler、`server.rs` 注册 `/api/invoke/custom_kind_counts`;测试:路由存在(非 501)。

**实现要点:** 逐 CustomKind 构造 `Api::<DynamicObject>::all_with(client, &ApiResource)`,`list(&ListParams::default().limit(1))`;count = `items.len() + metadata.remaining_item_count.unwrap_or(0)`(kube-rs `List` metadata 字段名以实际 API 为准);单 CRD 失败(RBAC 拒绝)计 0 并继续(尽力而为)。**并发**:`futures::stream::iter(...).buffer_unordered(8)` 限并发,防 44 CRD 打爆 API server。

- 提交(k7s-core):`feat(kube): custom_kind_counts — cheap per-CRD instance counts`
- 提交(k7s-server):`feat(web): bridge custom_kind_counts`

### Task 3: k7s-desktop Tauri 命令

**Files:** `src/commands/`(新文件或在既有合适模块)`custom_kind_counts` 命令(`State<Arc<CoreState>>`,require_client 后调 core fn,返回 `Vec<CustomKindCount>`);`src/lib.rs` invoke_handler 注册。

- 提交:`feat(commands): custom_kind_counts Tauri command`

### Task 4: 前端计数接线 + SubNav 空实例隐藏

**Files:** `src/providers/types/provider.ts`(`customKindCounts(): Promise<Array<{id: string; count: number}>>`)+ `BaseRpcProvider.ts`(rpc `custom_kind_counts`)+ `MockProvider`(返回固定 mock)+ store(`customKindCounts: Record<string, number>`,连接后由 useBootstrap 拉一次,断开清空)+ `src/components/subnav/SubNav.tsx`(+测试)。

**要求:**
1. 隐藏规则:`count === 0` 的 custom kind 不渲染 tab;**活动中的 kind 永不隐藏**(深链可达);折叠组数量徽标改为显示「非空数量」(如 `自定义资源 3`),tooltip 说明已隐藏空类型。
2. 计数失败(provider 抛错)→ 退化为现状(全部显示),console.warn,不 toast。
3. Mock/dev 模式返回非零计数(演示可见)。

- 提交:`feat(nav): hide empty custom kinds via instance counts`

### Task 5: 小尾巴批(前端)

**Files/要求:**
1. `OnboardingWizard.tsx`:头部加 X 关闭按钮(复用 CreateWorkloadWizard 的 closeBtn 样式模式),点击 = dismiss(写 onboarded 标记)。
2. ⌘K/首启遮罩 z 序:**先验证再修**——palette backdrop z=200 > onboarding modal z=100,数值上 palette 在上;写一个测试同开两者断言 palette 可见性/可点击,若测试证明有问题才改(否则记录「不修,证据闭合」)。
3. `errorsHuman.ts`:`\b403\b`/`\b401\b` 边界;`timed? ?out` 补双词形;删冗余 `missing or invalid token` 分支。
4. 测试加固:Task 3 遗留的 `[class*="quick"]` → `[data-quick-actions]`;ResourceTable resetStore 改铺 `DEFAULT_SETTINGS`。
5. P3 遗留:容器端口默认值命名别名 `DEFAULT_PORT`。

- 提交:`chore(p4): onboarding X button, errorsHuman hardening, test/selector cleanup`

### Task 6: e2e + 全量验证 + 文档

- e2e:向导类型下拉含 Job/CronJob 冒烟(p2-wizard spec 扩展或新 spec);SubNav 折叠组计数徽标断言(展开后有 tab)。
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` 全绿;Rust 侧 `cargo test --features web`(server)绿。
- README:向导支持五种工作负载 + 空 CRD 隐藏条目。
- 提交:`test+docs: P4 closeout e2e and README`

---

## 明确不做(本轮)

- 粘贴 kubeconfig 导入(跨 core/server/desktop 新命令链,下一轮)、会话落盘、login 限速、Secure cookie、e2e VITE_DEMO project、zh 解耦。

## 顺序与回退

- Task 2/3(Rust 链)先行或与 Task 1 并行皆可;Task 4 依赖 2/3;每任务独立 commit/PR 可单退。计数查询仅在连接后触发一次,失败静默降级——无破坏面。
