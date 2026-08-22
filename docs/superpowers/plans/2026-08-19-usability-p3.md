# k7s 易用性重构 P3 实施计划(视觉与交互打磨)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 设计文档 §5 收官——状态徽章中文化、表格密度两档、行内 hover 操作、错误友好化,并清掉积压小尾巴(--border-subtle 令牌、成功 toast、向导数字输入清空)。

**Architecture:** 全部纯前端。状态本地化做成 `lib/statusLabels.ts` 纯映射(未知状态回退原文,tooltip 保留原始状态);密度走 settings + 表格 className;hover 操作复用既有 RowContextMenu(⋯ 按钮在其位置打开,不做 ActionList 重构);错误友好化做 `lib/errorsHuman.ts` 返回 i18n key,在 App 的 setErrorReporter 处统一包装;Toast 加 `kind` 字段区分成功/错误样式。

**Tech Stack:** React 19 + Zustand + Vitest;现有 tokens.css / SettingsPanel / ActionList 体系。

**设计文档:** `docs/superpowers/specs/2026-08-18-usability-redesign-design.md` §5

## Global Constraints

- 工作目录 `k7s-frontend/`,分支 `feat/usability-p3`(自最新 main)。
- 所有用户可见文案走 i18n 三文件(`dictionaries.ts` + `en.ts` + `zh.ts`),`t(key, 英文fallback)`。
- 不得改动:MCP 工具、AI 助手、k7s-server/k7s-core、overlay 面板本体。
- 现有测试保持绿;提交只 stage 本任务文件(工作区有用户未提交改动:ShellTab/useTerminal/HttpProvider/TauriProvider)。
- 状态本地化**永不丢失信息**:未知状态显示原文;已知状态 tooltip 含原始英文状态。

## 文件结构总览

```
k7s-frontend/src/
├── lib/statusLabels.ts                  [新] K8s 状态 → {zh标签, 提示} 映射
├── components/table/tableUtils.tsx      [改] renderCell 增 locale 参数,状态列本地化+title
├── components/table/ResourceTable.tsx   [改] 传 locale;密度 className;hover 快捷操作
├── components/table/RowQuickActions.tsx [新] 行 hover 显现的 详情/⋯ 按钮
├── lib/settings.ts                      [改] +tableDensity 字段
├── components/settings/SettingsPanel.tsx[改] 密度下拉(仿 theme 行)
├── lib/errorsHuman.ts                   [新] 错误串模式 → i18n key 映射
├── hooks/useErrorToast.ts               [改] Toast.kind + showSuccess
├── components/common/ErrorToast.tsx     [改] 成功样式变体
├── components/wizard/CreateWorkloadWizard.tsx [改] applyOk 走 showSuccess
├── styles/tokens.css                    [改] 定义 --border-subtle(三个块)
├── components/wizard/StepFields.tsx     [改] 数字输入允许清空
├── components/auth/LoginGate.tsx        [改] 过时 docblock 修正
└── lib/i18n/{dictionaries,en,zh}.ts     [改] status.*/settings.density.*/errors.* 词条
```

---

### Task 1: 状态徽章中文化

**Files:**
- Create: `src/lib/statusLabels.ts` + `src/lib/statusLabels.test.ts`
- Modify: `src/components/table/tableUtils.tsx`(renderCell 加 locale 参数)、`src/components/table/ResourceTable.tsx`(传 locale)
- Modify: i18n 三文件(`status.*` 词条组)

**Interfaces:**
- Produces(Task 1 内部 + ResourceTable 消费):
```ts
export interface StatusLocal { label: string; hint: string; raw: string; }
/** 已知状态 → 本地化;未知返回 null(调用方显示原文)。 */
export function localizeStatus(status: string, locale: 'en' | 'zh'): StatusLocal | null;
```
- `renderCell(cell: Cell, now: number, locale?: 'en' | 'zh')` — 第三参可选,默认现行为。

- [ ] **Step 1: 失败测试**(核心断言):

```ts
import { describe, it, expect } from 'vitest';
import { localizeStatus } from './statusLabels';

describe('localizeStatus', () => {
  it('localizes common pod statuses to zh with raw in hint', () => {
    const s = localizeStatus('CrashLoopBackOff', 'zh');
    expect(s?.label).toBe('崩溃循环');
    expect(s?.raw).toBe('CrashLoopBackOff');
    expect(s?.hint.length).toBeGreaterThan(0);
  });
  it('covers the K8s status vocabulary', () => {
    for (const [raw, zh] of [
      ['Running', '运行中'], ['Pending', '待调度'], ['ContainerCreating', '容器创建中'],
      ['ImagePullBackOff', '镜像拉取失败'], ['Evicted', '已驱逐'], ['Terminating', '终止中'],
      ['Completed', '已完成'], ['Succeeded', '成功'], ['Failed', '失败'],
      ['Ready', '就绪'], ['Bound', '已绑定'], ['Active', '活跃'], ['Unknown', '未知'],
    ] as const) expect(localizeStatus(raw, 'zh')?.label).toBe(zh);
  });
  it('returns null for unknown statuses', () => {
    expect(localizeStatus('SomeNewState', 'zh')).toBeNull();
  });
  it('en locale keeps raw label', () => {
    expect(localizeStatus('CrashLoopBackOff', 'en')?.label).toBe('CrashLoopBackOff');
  });
});
```

- [ ] **Step 2:** RED 确认(`pnpm vitest run src/lib/statusLabels`)。
- [ ] **Step 3:** 实现 `statusLabels.ts`:内部表 `Record<string, { zh: string; hint: string }>`(hint 为中文原因简述,如 CrashLoopBackOff→「应用反复崩溃退出,查看日志或上一个容器的日志」;ImagePullBackOff→「镜像拉不下来,检查镜像名与仓库凭据」;Evicted→「节点资源不足被驱逐」等,每条一句)。`localizeStatus`:命中表且 locale==='zh' → `{label: zh, hint, raw}`;locale==='en' → `{label: raw, hint: enHint?raw, raw}`(en 直接原文);未命中 → null。**hint 不进词典三文件**——它是数据表内嵌文案(zh/en 双列),理由:与状态一一对应、数量固定,词典化收益低;label 也不走 t()(由本模块按 locale 输出)。
- [ ] **Step 4:** `renderCell` 接 locale:签名加可选参;`cell.dot` 分支里 `const loc = locale ? localizeStatus(text, locale) : null;` 徽章文案用 `loc?.label ?? text`,`title` 属性设 `loc ? \`${loc.raw} — ${loc.hint}\` : text`。ResourceTable 调用处(448-461 行附近,唯一调用点)传 `useTranslation()` 的 locale。
- [ ] **Step 5:** 追加 renderCell 测试(tableUtils 测试或新增):zh locale 下 CrashLoopBackOff 单元格含「崩溃循环」且 title 含 raw;未知状态显示原文。
- [ ] **Step 6:** 全量 + 提交:`feat(table): localized status badges with raw-status tooltips`

---

### Task 2: 表格密度两档 + settings 接线

**Files:**
- Modify: `src/lib/settings.ts`(`tableDensity: 'comfortable' | 'compact'`,默认 'comfortable',sanitize 白名单)
- Modify: `src/components/table/ResourceTable.tsx` + `ResourceTable.module.css`(容器加 `styles.compact` className:td/th 内边距与行高收紧)
- Modify: `src/components/settings/SettingsPanel.tsx`(仿 theme 行的下拉)+ i18n 三文件(`settings.density.{label,hint,comfortable,compact}`)
- Test: settings 消毒测试 + ResourceTable className 断言 + SettingsPanel 渲染断言

- [ ] **Step 1: 失败测试**:settings.test 断言 `DEFAULT_SETTINGS.tableDensity === 'comfortable'`、`sanitizeSettings({tableDensity:'compact'})` 保留、非法值回落 comfortable;ResourceTable.test 断言 store 设 compact 后容器带 `[class*="compact"]`。
- [ ] **Step 2:** RED 确认。
- [ ] **Step 3:** 实现:settings 字段 + sanitize;ResourceTable 外层 `<div className={cx(styles.tableWrap, density==='compact' && styles.compact)}>`(以现有外层容器为准);CSS:`.compact td, .compact th { padding-top: 2px; padding-bottom: 2px; } .compact td { height: 26px; }`(舒适档维持现状值,具体以现行 .td/.th padding 为基准各减一半,行高 26px);SettingsPanel 照抄 theme 行(`settings.density.*` 四个 key,两 option)。
- [ ] **Step 4:** 全量 + 提交:`feat(table): comfortable/compact density setting`

---

### Task 3: 行内 hover 快捷操作

**Files:**
- Create: `src/components/table/RowQuickActions.tsx`
- Modify: `src/components/table/ResourceTable.tsx`(行尾单元格渲染 hover 操作)、`ResourceTable.module.css`(hover 显现样式)
- Test: `RowQuickActions.test.tsx` + ResourceTable 集成断言

**Interfaces:**
- Consumes: 既有 `RowContextMenu` 渲染路径(ResourceTable 520-530 行,`menu` state + `setMenu({x,y})` 同款签名——实现者读该文件确认)、store 的 `selectedRow`/`setSelectedRow`(或等价选中动作,以 ResourceTable 行点击处理器为准)。
- Produces: `<RowQuickActions row={row} onOpenMenu={(row) => void} />`——两个图标按钮:**详情**(选中该行,与行点击同效)与 **⋯**(在按钮位置打开 RowContextMenu)。

- [ ] **Step 1: 失败测试**:RowQuickActions 渲染两个按钮(aria-label 详情/更多操作);点「详情」调用 onOpenDetail(row);点「⋯」调用 onOpenMenu(row)。ResourceTable 集成:行 hover 区域存在(测试断言行内 `[class*="quick"]` 容器存在且含两个按钮;events kind 行不含)。
- [ ] **Step 2:** RED 确认。
- [ ] **Step 3:** 实现:行渲染末尾追加一列(hover 前不可见,不占布局——绝对定位在行内右侧或额外 td,实现者按现有表格布局选冲击最小方案,**不得破坏列对齐**:推荐行内 `position:absolute` 叠加于行尾,`.rowClickable:hover .quick { opacity: 1 }`,默认 `opacity: 0; pointer-events: none`)。「详情」复用行点击同款处理器;「⋯」调 `setMenu({ x: 按钮 rect.left, y: rect.bottom })` 走现有菜单。图标用 lucide(Info/Ellipsis 或 Eye/MoreHorizontal),aria-label 走 i18n(`table.quick.detail`/`table.quick.more`,三文件)。events kind 行不渲染(nav==='events' 已跳过上下文菜单,保持一致)。
- [ ] **Step 4:** 全量 + 提交:`feat(table): hover quick actions (detail + context menu)`

---

### Task 4: 错误友好化 + Toast 成功样式

**Files:**
- Create: `src/lib/errorsHuman.ts` + 测试
- Modify: `src/App.tsx`(setErrorReporter 包装 humanize)、`src/hooks/useErrorToast.ts`(Toast.kind + showSuccess)、`src/components/common/ErrorToast.tsx`(+模块 css 成功变体)、`src/components/wizard/CreateWorkloadWizard.tsx`(applyOk → showSuccess)
- Modify: i18n 三文件(`errors.*` 词条组)

**Interfaces:**
- Produces:
```ts
/** 已知错误模式 → i18n key + 英文 fallback;未知返回 null。 */
export function humanizeError(raw: string): { key: string; fallback: string } | null;
// useErrorToast: showError(title, message, duration?)不变;新增
//   showSuccess(title: string, message: string, duration = 4000): void
// Toast 增加可选 kind?: 'error' | 'success'(默认 'error',向后兼容)
```

- [ ] **Step 1: 失败测试**:
  - errorsHuman:`/client error \(Connect\)|connection refused/i` → key `errors.connect`;`/forbidden|403/i` → `errors.rbac`;`/unauthorized|invalid token|401/i` → `errors.auth`;`/timed? ?out|timeout/i` → `errors.timeout`;其余 null。
  - useErrorToast:showSuccess 产生 `kind:'success'` toast;showError 默认 `kind:'error'`。
  - ErrorToast:kind success 的条目带 `[class*="success"]`。
- [ ] **Step 2:** RED 确认。
- [ ] **Step 3:** 实现:
  - `errorsHuman.ts` 纯正则表;`App.tsx` 的 `setErrorReporter` 处包装:`const h = humanizeError(message); showError(h ? t(h.key, h.fallback) : title, message)`——本地化标题 + 原始错误串作正文(信息不丢)。
  - i18n `errors.*`:zh 连接失败「连不上集群 API,检查网络与 kubeconfig 服务器地址」/ 没有权限「当前身份无此操作权限(RBAC 拒绝),联系管理员或切换上下文」/ 认证失败「认证失效,检查 token 或重新登录」/ 请求超时「请求超时,集群响应过慢或网络不稳」;en 对应。
  - Toast kind:useErrorToast 的 push 逻辑加 kind 入参;ErrorToast 按 kind 切图标(CheckCircle2 vs AlertCircle)与颜色(success 用 `--status-ok` 边框/图标);CSS 类 `.success`。
  - 向导 applyOk 改 `showSuccess`(经 store 上的途径——useErrorToast 是 hook,向导里用 `getErrorReporter()` 通道的话,给 reporter 增加成功通道:最简做法 App 注册 `setErrorReporter((t,m)=>showError(...))` 之外再暴露 `setSuccessReporter`;实现者按 errorHandler.ts 现结构选最小改动,保持 getErrorReporter 既有签名不变)。
- [ ] **Step 4:** 全量 + 提交:`feat(errors): humanized error toasts + success variant`

---

### Task 5: 小尾巴清理批(--border-subtle 令牌 / 数字输入清空 / LoginGate docblock)

**Files:**
- Modify: `src/styles/tokens.css`(三个块各加 `--border-subtle`:dark `#1e1e26`、light `#e4e4ec`、light-panel `#23232e`——比 --border-default 略弱)
- Modify: `src/components/wizard/StepFields.tsx`(数字输入 onChange:`e.target.value === '' ? '' : clamp` —— 允许清空重输;生成 YAML 时空值按 min/默认处理,读 workloadSpec 的 emptyWorkloadForm 默认——若表单类型是 number 字段存 string|number 联合,实现者按现有 state 结构最小改)
- Modify: `src/components/auth/LoginGate.tsx:7` docblock(删「or password not set up yet」过时括注)
- Test: 数字输入清空行为测试(StepFields 或向导测试追加:清空副本数输入框不强制跳回最小值,blur/生成时按默认 1)

- [ ] **Step 1:** 失败测试(数字清空)→ RED → 实现(tokens/docblock 无需测试)→ 全量 → 提交:`chore(p3): define --border-subtle token, allow clearing wizard number inputs, fix stale docblock`

---

### Task 6: e2e 触点 + README + 收尾

**Files:**
- Modify: `e2e/p1-usability.spec.ts` 或新增小 spec(密度切换冒烟:打开设置 → 选 紧凑 → 表格带 compact class;若 harness 不可达则单测已覆盖,记录说明)
- Modify: `README.md`(Features 增 P3 条目:localized status badges / density / hover actions / humanized errors + success toasts)

- [ ] **Step 1:** e2e(能跑则跑,不能跑说明原因并保留单测覆盖说明)。
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e` 全绿。
- [ ] **Step 3:** 提交:`test+docs: P3 polish e2e touch and README`

---

## 明确不做(本期)

- 空实例 CRD 隐藏(需后端计数命令)、NodePodsTab 的独立状态映射统一、会话落盘、login 限速(均已记录,后续期)。
- ActionList 重构( hover ⋯ 复用现有菜单即是本期边界)。

## 风险与回退

- Task 3 涉及表格行布局,破坏列对齐的风险最高——实现前必须读现行行渲染结构,选叠加方案;每任务独立 commit 可单退。

---

## 执行结果(2026-08-19,P3 完成)

- 6 任务全部一次通过任务审查(零修复轮);终审 1 Important(ROW_HEIGHT 26/32 双常量 → 虚拟化大表密度无效 + 深滚动空白行)由修复波 `ef98031` 解决并复审通过。
- 分支 `feat/usability-p3`,c83bab4..ef98031,7 commits;全量 1240/1240 + typecheck + e2e 3/3。

### P3 遗留(后续期)

- 舒适档虚拟行高 34px vs 自然 CSS ~38px(数学自洽,纯视觉);小表双密度测试标题过言
- hover 药丸在 900px 最小宽度遮末列文本;选中行 hover 渐变色不匹配
- errorsHuman 的 \b403\b/\b401\b 加固与 "time out" 双词形
- 测试选择器加固([class*="quick"] → [data-quick-actions];resetStore 全量 DEFAULT_SETTINGS)
- 容器端口默认值借自 readiness.port(命名别名即可)
