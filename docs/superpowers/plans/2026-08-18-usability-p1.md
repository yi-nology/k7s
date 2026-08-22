# k7s 易用性重构 P1 实施计划(信息架构 + 概览首页 + 登录门)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 k7s-frontend 的「40 项平铺侧边栏」重构为「5 分区导航 + 概览首页」,并为 k7s-web 加上单用户密码登录门和首次引导向导。

**Architecture:** 前端在现有 Zustand store 上新增 `section` 维度(`overview/workloads/config/storage/tools`),侧边栏变为窄导航栏,分区内用页内副导航切换资源 kind;16 个 overlay 面板机制不动,收进「运维工具」目录页。后端在现有 Bearer token 中间件旁边加一条「密码 → HttpOnly cookie 会话」通路,argon2 哈希存文件,不引入数据库。

**Tech Stack:** React 19 + Zustand + Vitest(前端);axum + argon2 0.5(k7s-server);现有 `k7s-deps` 共享依赖不动。

**设计文档:** `docs/superpowers/specs/2026-08-18-usability-redesign-design.md`

**与设计文档的两处已知偏差(有意为之):**
1. 「命名空间选择器提升到全局顶栏」无需实现——调查确认 TopBar 已有全局 ns 选择器并全站生效(TopBar.tsx:3-4, 91),本计划不动它。
2. 首次引导第 1 步设计稿写了「粘贴/文件/路径」三种导入方式,现有 provider 只有 `importKubeconfig()` 文件选择;粘贴文本需要新增后端命令,P1 先做文件选择,粘贴/路径归入 P2。

## Global Constraints

- 提交分两个仓库:前端任务在 `k7s-frontend/`,服务端任务在 `k7s-server/`(各自独立 git 仓库)。
- 所有用户可见文案走 i18n(`src/lib/i18n/en.ts` + `zh.ts`),中文为默认语言;`t(key, fallback)` 的 fallback 用英文。
- 不得改动:91 个 MCP 工具、AI 助手、`k7s-core` 业务逻辑、overlay 面板组件本体(只改挂载方式)。
- 现有测试必须保持绿(允许跟随行为迁移改断言,不允许删除测试)。
- 每个任务结束跑 `pnpm test`(前端)或 `cargo test`(服务端)全绿再提交。

## 文件结构总览

```
k7s-frontend/src/
├── lib/sections.ts                      [新] 5 分区注册表 + kind→section 映射
├── store/types.ts                       [改] NavigationSlice 增加 section 字段
├── store/navigationSlice.ts             [改] section 状态 + setSection + setNav 自动推导
├── components/sidebar/Sidebar.tsx       [重写] 5 分区窄导航栏
├── components/sidebar/NavList.tsx       [删] 旧 40 项列表
├── components/subnav/SubNav.tsx         [新] 分区内 kind 副导航
├── components/subnav/SubNav.module.css  [新]
├── components/tools/ToolsPage.tsx       [新] 运维工具目录页(卡片网格)
├── components/dashboard/Dashboard.tsx   [改] overlay → 全页面 + 空状态 + 快捷入口
├── App.tsx                              [改] 按 section 分发内容区
├── components/auth/LoginGate.tsx        [新] 登录/设密页
├── components/onboarding/OnboardingWizard.tsx [新] 3 步引导
├── components/table/ResourceTable.tsx   [改] 空态 CTA
├── lib/i18n/{en,zh}.ts                  [改] 新词条
└── lib/settings.ts                      [改] 默认语言 zh

k7s-server/
├── Cargo.toml                           [改] +argon2
└── src/web/
    ├── auth_password.rs                 [新] 密码哈希 + 会话 + 登录 handlers
    ├── auth.rs                          [改] require_token 接受 cookie 会话
    ├── state.rs                         [改] WebState + password_auth 字段
    └── server.rs                        [改] 注册 /api/auth/* 路由
```

---

### Task 1: Section 注册表 + 导航模型

**Files:**
- Create: `k7s-frontend/src/lib/sections.ts`
- Modify: `k7s-frontend/src/store/types.ts`(`NavigationSlice` 接口,约 160 行附近)
- Modify: `k7s-frontend/src/store/navigationSlice.ts`
- Test: `k7s-frontend/src/lib/sections.test.ts`

**Interfaces:**
- Consumes: `KindId`(来自 `providers/types`,已有)。
- Produces: `SectionId`、`SECTION_ORDER`、`SECTION_ICONS`、`sectionForKind(kind: KindId): SectionId`、`kindsForSection(section: SectionId): KindId[]`、`SECTION_SUBGROUPS: Record<SectionId, {id: string; kinds: KindId[]}[]>`。后续 Task 2/3/4 全部依赖这些名字。

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/sections.test.ts
import { describe, it, expect } from 'vitest';
import { sectionForKind, SECTION_ORDER, kindsForSection } from './sections';

describe('sectionForKind', () => {
  it('routes workload kinds to workloads', () => {
    expect(sectionForKind('pods')).toBe('workloads');
    expect(sectionForKind('deployments')).toBe('workloads');
    expect(sectionForKind('helmreleases')).toBe('workloads');
  });
  it('routes config/network/rbac/cluster kinds to config', () => {
    for (const k of ['configmaps', 'secrets', 'services', 'ingresses',
      'serviceaccounts', 'nodes', 'namespaces', 'events'] as const) {
      expect(sectionForKind(k)).toBe('config');
    }
  });
  it('routes storage kinds to storage', () => {
    for (const k of ['persistentvolumes', 'persistentvolumeclaims', 'storageclasses'] as const) {
      expect(sectionForKind(k)).toBe('storage');
    }
  });
});

describe('SECTION_ORDER / kindsForSection', () => {
  it('has exactly 5 sections in order', () => {
    expect(SECTION_ORDER).toEqual(['overview', 'workloads', 'config', 'storage', 'tools']);
  });
  it('every resource kind appears in exactly one non-tool section', () => {
    const all = [...kindsForSection('workloads'), ...kindsForSection('config'), ...kindsForSection('storage')];
    expect(new Set(all).size).toBe(all.length);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd k7s-frontend && pnpm vitest run src/lib/sections.test.ts`
Expected: FAIL — `Cannot find module './sections'`

- [ ] **Step 3: 实现 sections.ts**

```ts
// src/lib/sections.ts — 5 分区注册表(P1 IA 重构)
import { Home, Boxes, Network, HardDrive, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import type { KindId } from '../providers/types';

export type SectionId = 'overview' | 'workloads' | 'config' | 'storage' | 'tools';

export const SECTION_ORDER: SectionId[] = ['overview', 'workloads', 'config', 'storage', 'tools'];

export const SECTION_ICONS: Record<SectionId, ReactNode> = {
  overview: <Home size={18} />,
  workloads: <Boxes size={18} />,
  config: <Network size={18} />,
  storage: <HardDrive size={18} />,
  tools: <Wrench size={18} />,
};

/** 工作负载分区副导航顺序。replicasets 不在一级(从 Deployment 详情页看)。 */
const WORKLOAD_KINDS: KindId[] = ['deployments', 'statefulsets', 'daemonsets',
  'jobs', 'cronjobs', 'pods', 'helmreleases'];

/** 配置与网络分区的副导航分组(组名即 SubNav 的分组标题)。 */
export const SECTION_SUBGROUPS = {
  config: [
    { id: 'config', kinds: ['configmaps', 'secrets'] as KindId[] },
    { id: 'network', kinds: ['services', 'ingresses', 'ingressclasses'] as KindId[] },
    { id: 'access', kinds: ['serviceaccounts', 'roles', 'rolebindings',
      'clusterroles', 'clusterrolebindings'] as KindId[] },
    { id: 'cluster', kinds: ['nodes', 'namespaces', 'events'] as KindId[] },
  ],
  storage: [
    { id: 'storage', kinds: ['persistentvolumeclaims', 'persistentvolumes', 'storageclasses'] as KindId[] },
  ],
} as const;

const KIND_TO_SECTION: Record<string, SectionId> = (() => {
  const map: Record<string, SectionId> = {};
  for (const k of WORKLOAD_KINDS) map[k] = 'workloads';
  for (const sg of SECTION_SUBGROUPS.config) for (const k of sg.kinds) map[k] = 'config';
  for (const sg of SECTION_SUBGROUPS.storage) for (const k of sg.kinds) map[k] = 'storage';
  // replicasets 归工作负载(副导航不展示,但 setNav('replicasets') 时分区正确高亮)
  map['replicasets'] = 'workloads';
  return map;
})();

/** kind → 分区。未登记的 kind(如 CRD)默认归 config 分区的「自定义资源」组。 */
export function sectionForKind(kind: KindId): SectionId {
  return KIND_TO_SECTION[kind] ?? 'config';
}

export function kindsForSection(section: SectionId): KindId[] {
  if (section === 'workloads') return [...WORKLOAD_KINDS];
  if (section === 'config') return SECTION_SUBGROUPS.config.flatMap((sg) => [...sg.kinds]);
  if (section === 'storage') return SECTION_SUBGROUPS.storage.flatMap((sg) => [...sg.kinds]);
  return [];
}
```

注意:以 `KIND_META`(kinds.tsx)实际存在的 kind id 为准——若上面某个 id(如 `helmreleases`、`ingressclasses`)与注册表拼写不同,以 kinds.tsx 为准并同步修改本表。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd k7s-frontend && pnpm vitest run src/lib/sections.test.ts`
Expected: PASS

- [ ] **Step 5: store 增加 section 状态**

`src/store/types.ts` 的 `NavigationSlice` 接口(约 155-170 行)加入:

```ts
  // State
  section: SectionId;
  // Actions
  setSection: (section: SectionId) => void;
```

文件顶部加 `import type { SectionId } from '../lib/sections';`。

`src/store/navigationSlice.ts` 改为:

```ts
import { sectionForKind } from '../lib/sections';
import type { SectionId } from '../lib/sections';
// ...
export interface NavigationSlice {
  nav: KindId;
  section: SectionId;          // 新增
  // ...其余不变
  setSection: (section: SectionId) => void;   // 新增
}

export const createNavigationSlice: StateCreator<AppState, [], [], NavigationSlice> = (set) => ({
  nav: 'pods',
  section: 'overview',         // 新增:默认落在概览页
  // ...
  setNav: (kind) =>
    set({
      nav: kind,
      section: sectionForKind(kind),   // 新增:kind 导航自动带出分区
      selectedRow: null,
      selection: EMPTY_SELECTION,
      openMenu: null,
      tableFilter: '',
      sortCol: null,
      sortDir: 'asc',
      overlay: null,
      overlayPodRef: null,
    }),
  setSection: (section) =>
    set({
      section,
      overlay: null,
      overlayPodRef: null,
      // 进入资源分区时切到该分区第一个 kind;概览/工具分区保留当前 nav,
      // 返回资源分区时表格还能显示上次的 kind。
      ...(section === 'workloads' || section === 'config' || section === 'storage'
        ? { nav: FIRST_KIND[section] }
        : {}),
    }),
  // ...
});

/** 每个资源分区的默认 kind。 */
const FIRST_KIND: Record<string, KindId> = {
  workloads: 'deployments',
  config: 'configmaps',
  storage: 'persistentvolumeclaims',
};
```

- [ ] **Step 6: 全量测试 + 提交**

Run: `cd k7s-frontend && pnpm test`
Expected: PASS(新增 section 字段有默认值,既有断言不受影响)

```bash
cd k7s-frontend && git add src/lib/sections.ts src/lib/sections.test.ts src/store/types.ts src/store/navigationSlice.ts
git commit -m "feat(nav): section registry + section state in navigation slice"
```

---

### Task 2: 五分区侧边栏(重写 Sidebar,删除 NavList)

**Files:**
- Rewrite: `k7s-frontend/src/components/sidebar/Sidebar.tsx`
- Delete: `k7s-frontend/src/components/sidebar/NavList.tsx`、`NavList.test.tsx`
- Modify: `k7s-frontend/src/components/sidebar/Sidebar.module.css`
- Test: `k7s-frontend/src/components/sidebar/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `SECTION_ORDER`、`SECTION_ICONS`、`useStore(s => s.section)`、`setSection`(Task 1);既有 `ClusterSwitcher`、`WatchFooter`(保留不动);既有 props `open/onClose/onToggle`(iPadOS 抽屉,保留)。
- Produces: `<Sidebar open onClose onToggle />` 签名不变,App.tsx 无需改动。

- [ ] **Step 1: 重写测试**

```tsx
// src/components/sidebar/Sidebar.test.tsx —— 全量替换旧内容
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import { useStore } from '../../store';

describe('Sidebar (5-section rail)', () => {
  it('renders exactly the 5 sections', () => {
    render(<Sidebar open onClose={() => {}} onToggle={() => {}} />);
    for (const label of ['概览', '工作负载', '配置与网络', '存储', '运维工具']) {
      expect(screen.getByTitle(label)).toBeTruthy();
    }
  });
  it('marks the active section', () => {
    useStore.setState({ section: 'workloads' });
    render(<Sidebar open onClose={() => {}} onToggle={() => {}} />);
    expect(screen.getByTitle('工作负载').className).toContain('active');
  });
});
```

词条 key:`chrome.sections.overview` 等(fallback 英文 `Overview`)——测试断言中文需 `useStore.setState({ settings: { ...useStore.getState().settings, language: 'zh' } })`;若 i18n 默认已在 Task 6 改为 zh 则无需。测试里稳妥起见先 setState language zh。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd k7s-frontend && pnpm vitest run src/components/sidebar/Sidebar.test.tsx`
Expected: FAIL — 旧 Sidebar 渲染的是分组列表,没有「概览」按钮。

- [ ] **Step 3: 重写 Sidebar.tsx**

```tsx
/**
 * Sidebar — 5 分区窄导航栏(P1 IA 重构)。
 * 结构:ClusterSwitcher / 分区导航 / WatchFooter。原 NavList 的 40 项列表
 * 由各分区页内的 SubNav 与 ToolsPage 取代,本组件不再枚举资源 kind。
 */
import { useStore } from '../../store';
import { useTranslation } from '../../hooks/useI18n';
import { ClusterSwitcher } from './ClusterSwitcher';
import { WatchFooter } from './WatchFooter';
import { SECTION_ICONS, SECTION_ORDER } from '../../lib/sections';
import styles from './Sidebar.module.css';

export function Sidebar({ open, onClose, onToggle }: {
  open: boolean; onClose: () => void; onToggle: () => void;
}) {
  const section = useStore((s) => s.section);
  const setSection = useStore((s) => s.setSection);
  const { t } = useTranslation();
  return (
    <aside className={styles.sidebar} data-open={open}>
      <ClusterSwitcher onToggle={onToggle} />
      <nav className={styles.rail} aria-label="sections">
        {SECTION_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            title={t(`chrome.sections.${id}`, id)}
            className={section === id ? `${styles.railItem} ${styles.active}` : styles.railItem}
            onClick={() => setSection(id)}
          >
            {SECTION_ICONS[id]}
            <span className={styles.railLabel}>{t(`chrome.sections.${id}`, id)}</span>
          </button>
        ))}
      </nav>
      <WatchFooter />
    </aside>
  );
}
```

`Sidebar.module.css`:保留旧 `.sidebar` 外框样式,追加:

```css
.rail { display: flex; flex-direction: column; gap: 2px; padding: 8px; flex: 1; overflow-y: auto; }
.railItem {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 8px 10px; border: none; border-radius: var(--radius-sm, 6px);
  background: none; color: var(--text-dim, #888); cursor: pointer;
  font-size: 13px; text-align: left;
}
.railItem:hover { background: var(--bg-hover, #ffffff14); color: var(--text, #eee); }
.active { background: var(--bg-active, #ffffff1a); color: var(--text, #fff); font-weight: 600; }
.railLabel { white-space: nowrap; }
```

(token 变量名以 `styles/tokens.css` 实际为准,对不上就用现有变量名替换。)

`ClusterSwitcher` 的实际 props 以其源码为准——若它不接受 `onToggle`,按原 Sidebar.tsx 中的用法照搬(旧文件 53 行,直接参考后删除)。

- [ ] **Step 4: 删除 NavList**

```bash
cd k7s-frontend && git rm src/components/sidebar/NavList.tsx src/components/sidebar/NavList.test.tsx
```

- [ ] **Step 5: 全量测试修绿 + 提交**

Run: `cd k7s-frontend && pnpm test`
Expected: 引用 NavList 的测试/组件报错——逐个改为使用新 Sidebar/SubNav;CommandPalette 若从 NavList 导航,改走 `setNav`/`setSection`(本任务只修编译与断言,不改功能)。

```bash
cd k7s-frontend && git add -A && git commit -m "feat(nav): 5-section sidebar rail replaces flat NavList"
```

---

### Task 3: SubNav 页内副导航

**Files:**
- Create: `k7s-frontend/src/components/subnav/SubNav.tsx`
- Create: `k7s-frontend/src/components/subnav/SubNav.module.css`
- Test: `k7s-frontend/src/components/subnav/SubNav.test.tsx`

**Interfaces:**
- Consumes: `SECTION_SUBGROUPS`、`kindsForSection`、`KIND_META`(kinds.tsx,取 label/icon)、`useStore` 的 `nav/setNav`、`useCustomKinds()` hook(TopBar.tsx:21 已在用)。
- Produces: `<SubNav section={section} />`,App.tsx(Task 4)在资源分区内容区顶部渲染。

- [ ] **Step 1: 写失败测试**

```tsx
// src/components/subnav/SubNav.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SubNav } from './SubNav';
import { useStore } from '../../store';

describe('SubNav', () => {
  it('lists workload kinds as tabs and marks the active one', () => {
    useStore.setState({ nav: 'deployments', section: 'workloads' });
    render(<SubNav section="workloads" />);
    expect(screen.getByRole('tab', { name: /Deployments/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Deployments/i }).className).toContain('active');
  });
  it('renders grouped subnav for the config section', () => {
    render(<SubNav section="config" />);
    expect(screen.getByText(/Access/i)).toBeTruthy();   // 分组标题
    expect(screen.getByRole('tab', { name: /Nodes/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd k7s-frontend && pnpm vitest run src/components/subnav/SubNav.test.tsx`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

```tsx
/**
 * SubNav — 资源分区内的页内副导航。workloads 是平铺 tab;
 * config/storage 按 SECTION_SUBGROUPS 分组(CRD 动态追加到 config 的
 * 「自定义资源」组,分组 id 'custom')。
 */
import { useStore } from '../../store';
import { useTranslation } from '../../hooks/useI18n';
import { useCustomKinds } from '../../hooks/useStoreHooks';
import { KIND_META } from '../../lib/kinds';
import { SECTION_SUBGROUPS } from '../../lib/sections';
import type { SectionId } from '../../lib/sections';
import type { KindId } from '../../providers/types';
import styles from './SubNav.module.css';

export function SubNav({ section }: { section: SectionId }) {
  const nav = useStore((s) => s.nav);
  const setNav = useStore((s) => s.setNav);
  const customKinds = useCustomKinds();
  const { t } = useTranslation();

  const groups =
    section === 'workloads'
      ? [{ id: 'workloads', label: '', kinds: kindsOfWorkloads() }]
      : section === 'config'
        ? [...SECTION_SUBGROUPS.config.map((g) => ({ id: g.id, label: g.id, kinds: [...g.kinds] as KindId[] })),
           { id: 'custom', label: 'custom', kinds: customKinds as KindId[] }]
        : SECTION_SUBGROUPS.storage.map((g) => ({ id: g.id, label: g.id, kinds: [...g.kinds] as KindId[] }));

  return (
    <div className={styles.subnav} role="tablist">
      {groups.map((g) => (
        <div key={g.id} className={styles.group}>
          {g.label && <span className={styles.groupLabel}>{t(`subnav.group.${g.id}`, g.id)}</span>}
          {g.kinds.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={nav === k}
              className={nav === k ? `${styles.tab} ${styles.active}` : styles.tab}
              onClick={() => setNav(k)}
            >
              {KIND_META[k]?.label ?? k}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function kindsOfWorkloads(): KindId[] {
  return ['deployments', 'statefulsets', 'daemonsets', 'jobs', 'cronjobs', 'pods', 'helmreleases'];
}
```

`useCustomKinds()` 返回类型以 `hooks/useStoreHooks.ts` 为准(TopBar.tsx:21 同款用法),类型对不上就按 TopBar 的消费方式适配。CSS:

```css
.subnav { display: flex; align-items: center; gap: 16px; padding: 6px 12px;
  border-bottom: 1px solid var(--border, #ffffff1a); overflow-x: auto; }
.group { display: flex; align-items: center; gap: 4px; }
.groupLabel { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--text-dim, #777); margin-right: 4px; }
.tab { padding: 5px 10px; border: none; border-radius: 6px; background: none;
  color: var(--text-dim, #888); font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.tab:hover { background: var(--bg-hover, #ffffff14); color: var(--text, #eee); }
.active { background: var(--bg-active, #ffffff1a); color: var(--text, #fff); font-weight: 600; }
```

- [ ] **Step 4: 跑测试确认通过,提交**

Run: `cd k7s-frontend && pnpm vitest run src/components/subnav/SubNav.test.tsx`
Expected: PASS

```bash
cd k7s-frontend && git add src/components/subnav && git commit -m "feat(nav): per-section SubNav with grouped kind tabs"
```

---

### Task 4: App 壳按 section 分发 + ToolsPage 工具目录

**Files:**
- Create: `k7s-frontend/src/components/tools/ToolsPage.tsx`
- Create: `k7s-frontend/src/components/tools/ToolsPage.module.css`
- Modify: `k7s-frontend/src/App.tsx:142-156`(内容区分发)
- Test: `k7s-frontend/src/components/tools/ToolsPage.test.tsx`

**Interfaces:**
- Consumes: `useStore` 的 `section/openOverlay`(types.ts:278)、`OverlayKey`(types.ts:63)、`IPADOS_HIDDEN_OVERLAYS`(lib/platform)。
- Produces: `<ToolsPage />`;App 内容区渲染规则(见 Step 3)。

- [ ] **Step 1: 写失败测试**

```tsx
// src/components/tools/ToolsPage.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolsPage } from './ToolsPage';
import { useStore } from '../../store';

describe('ToolsPage', () => {
  it('renders categorized tool cards', () => {
    render(<ToolsPage />);
    expect(screen.getByText(/可观测性|Observability/i)).toBeTruthy();
    expect(screen.getByTitle(/Helm Market/i)).toBeTruthy();
  });
  it('clicking a card opens the overlay', async () => {
    const openOverlay = vi.fn();
    useStore.setState({ openOverlay: openOverlay as never });
    render(<ToolsPage />);
    (await screen.findByTitle(/Helm Market/i)).click();
    expect(openOverlay).toHaveBeenCalledWith('helm-market', expect.anything());
  });
});
```

`openOverlay` 的完整签名以 `store/types.ts:278-281` 为准(第二个参数可能是 podRef 等),测试与实现同步适配;若只需一个参数则去掉 `expect.anything()`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd k7s-frontend && pnpm vitest run src/components/tools/ToolsPage.test.tsx`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 ToolsPage(目录数据从 NavList.tsx 95-131 行的注册表迁移)**

```tsx
/**
 * ToolsPage — 运维工具目录页。原侧边栏 Tools 组的 12+ 个入口改为
 * 分类卡片;点击调用既有 openOverlay,面板组件与渲染机制零改动。
 */
import { useStore } from '../../store';
import { useTranslation } from '../../hooks/useI18n';
import { IPADOS_HIDDEN_OVERLAYS } from '../../lib/platform';
import type { OverlayKey } from '../../store';
import styles from './ToolsPage.module.css';

interface ToolCard { key: OverlayKey; labelKey: string; fallback: string; }

const CATEGORIES: { id: string; tools: ToolCard[] }[] = [
  { id: 'observability', tools: [
    { key: 'metrics', labelKey: 'chrome.sidebar.tools.metrics', fallback: 'Prometheus' },
    { key: 'grafana', labelKey: 'chrome.sidebar.tools.grafana', fallback: 'Grafana' },
    { key: 'alerting', labelKey: 'chrome.sidebar.tools.alerting', fallback: 'Alerts' },
  ]},
  { id: 'helm', tools: [
    { key: 'helm-market', labelKey: 'chrome.sidebar.tools.helmMarket', fallback: 'Helm Market' },
    { key: 'templates', labelKey: 'chrome.sidebar.tools.templates', fallback: 'Templates' },
  ]},
  { id: 'images', tools: [
    { key: 'image-repos', labelKey: 'chrome.sidebar.tools.imageRepos', fallback: 'Image Registries' },
    { key: 'image-transfer', labelKey: 'chrome.sidebar.tools.imageTransfer', fallback: 'Image Transfer' },
  ]},
  { id: 'security', tools: [
    { key: 'sbom', labelKey: 'chrome.sidebar.tools.sbom', fallback: 'SBOM' },
    { key: 'audit', labelKey: 'chrome.sidebar.tools.audit', fallback: 'Audit' },
  ]},
  { id: 'network', tools: [
    { key: 'topology', labelKey: 'chrome.sidebar.tools.topology', fallback: 'Service Topology' },
    { key: 'ingress-routes', labelKey: 'chrome.sidebar.tools.ingressRoutes', fallback: 'Ingress Routes' },
    { key: 'endpoints', labelKey: 'chrome.sidebar.tools.endpoints', fallback: 'Endpoints' },
  ]},
  { id: 'cluster', tools: [
    { key: 'diff', labelKey: 'chrome.sidebar.tools.diff', fallback: 'Diff' },
    { key: 'plugins', labelKey: 'chrome.sidebar.tools.plugins', fallback: 'Plugins' },
  ]},
];

export function ToolsPage() {
  const openOverlay = useStore((s) => s.openOverlay);
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      {CATEGORIES.map((cat) => {
        const tools = cat.tools.filter((x) => !IPADOS_HIDDEN_OVERLAYS.has(x.key));
        if (!tools.length) return null;
        return (
          <section key={cat.id} className={styles.category}>
            <h2 className={styles.categoryTitle}>{t(`tools.category.${cat.id}`, cat.id)}</h2>
            <div className={styles.grid}>
              {tools.map((tool) => (
                <button
                  key={tool.key}
                  type="button"
                  className={styles.card}
                  onClick={() => openOverlay(tool.key)}
                >
                  <span className={styles.cardTitle}>{t(tool.labelKey, tool.fallback)}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
```

CSS:`.page{padding:20px;overflow-y:auto}`、`.categoryTitle{font-size:12px;text-transform:uppercase;color:var(--text-dim,#777);margin:16px 0 8px}`、`.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}`、`.card{padding:14px;border:1px solid var(--border,#ffffff1a);border-radius:10px;background:var(--bg-card,#ffffff08);color:var(--text,#eee);cursor:pointer;text-align:left}`、`.card:hover{border-color:var(--accent,#6ea8fe)}`。

- [ ] **Step 4: App.tsx 内容区按 section 分发**

把 `App.tsx:145-156` 的 tableArea 块改为(section 从 store 读):

```tsx
const section = useStore((s) => s.section);
// ...
<div className={styles.tableArea} style={{ display: overlay === null ? 'flex' : 'none' }}>
  {section === 'overview' ? (
    <Suspense fallback={null}><Dashboard /></Suspense>
  ) : section === 'tools' ? (
    <Suspense fallback={null}><ToolsPage /></Suspense>
  ) : (
    <>
      <SubNav section={section} />
      <ResourceTable />
      <DetailPanel />
    </>
  )}
  {aiOpen && AI_ENABLED && (
    <Suspense fallback={null}><AiChat onClose={() => setAiOpen(false)} /></Suspense>
  )}
</div>
```

顶部 `const ToolsPage = lazy(() => import('./components/tools/ToolsPage').then((m) => ({ default: m.ToolsPage })));`;`overlayPanels` 表中删除 `dashboard` 一行(Dashboard 不再是 overlay,App.tsx:74)。

- [ ] **Step 5: 全量测试 + 提交**

Run: `cd k7s-frontend && pnpm test && pnpm typecheck`
Expected: PASS;「点击侧边栏 Dashboard」类旧测试改为断言 `setSection('overview')`。

```bash
cd k7s-frontend && git add -A && git commit -m "feat(shell): section-based content routing + tools catalog page"
```

---

### Task 5: 概览页(Dashboard 转全页面 + 空状态 + 快捷入口)

**Files:**
- Modify: `k7s-frontend/src/components/dashboard/Dashboard.tsx`(481 行;`onClose` prop 变可选,新增快捷入口与空状态)
- Modify: `k7s-frontend/src/components/dashboard/Dashboard.module.css`
- Test: 修改 `Dashboard.test.tsx`

**Interfaces:**
- Consumes: `useStore` 的 `connection.connectionState.phase`(types.ts:83 `ConnectionState`)、`setSection`、`openOverlay`;Task 9 的 `onboardingOpen` 写入(本任务先用占位按钮 openOverlay('templates'),Task 9 落地后改指向)。
- Produces: `<Dashboard />` 无必填 props,概览区与详情两用。

- [ ] **Step 1: 改测试(节选新断言)**

```tsx
// Dashboard.test.tsx 追加:
it('renders without onClose (page mode)', () => {
  render(<Dashboard />);
  expect(screen.getByText(/overview|概览/i)).toBeTruthy();
});
it('shows the no-cluster empty state with an import button when disconnected', () => {
  useStore.setState({ connection: { ...useStore.getState().connection, phase: 'error' } });
  render(<Dashboard />);
  expect(screen.getByRole('button', { name: /导入集群|Import cluster/i })).toBeTruthy();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd k7s-frontend && pnpm vitest run src/components/dashboard/Dashboard.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现**

在 `Dashboard.tsx` 顶部 props 改 `export function Dashboard({ onClose }: { onClose?: () => void })`;`onClose` 仅在存在时渲染关闭按钮。组件 return 前插入空状态分支:

```tsx
const phase = useStore((s) => s.connection.phase);
const setSection = useStore((s) => s.setSection);
const openOverlay = useStore((s) => s.openOverlay);
const { t } = useTranslation();

if (phase !== 'connected') {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyCard}>
        <h2>{t('overview.empty.title', '还没有连接任何集群')}</h2>
        <p>{t('overview.empty.hint', '导入 kubeconfig 后即可开始浏览与操作集群资源。')}</p>
        <div className={styles.emptyActions}>
          <button type="button" className={styles.primary}
            onClick={() => useStore.setState({ onboardingOpen: true })}>
            {t('overview.empty.import', '导入集群')}
          </button>
          <button type="button" onClick={() => setSection('workloads')}>
            {t('overview.empty.browse', '先随便看看')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

(`onboardingOpen` store 字段 Task 9 定义;本任务先在 `store.ts` 根状态加 `onboardingOpen: false` 与 `setOnboardingOpen`,五行改动,随本任务提交。)已连接时在 Dashboard 顶部渲染快捷入口条:

```tsx
<div className={styles.quickEntries}>
  <button type="button" onClick={() => setSection('workloads')}>{t('overview.quick.workloads', '工作负载')}</button>
  <button type="button" onClick={() => openOverlay('metrics')}>{t('overview.quick.metrics', '指标查询')}</button>
  <button type="button" onClick={() => openOverlay('alerting')}>{t('overview.quick.alerts', '告警')}</button>
  <button type="button" onClick={() => openOverlay('templates')}>{t('overview.quick.create', '创建工作负载')}</button>
</div>
```

CSS:`.emptyState{flex:1;display:flex;align-items:center;justify-content:center}`、`.emptyCard{max-width:420px;padding:32px;border:1px solid var(--border,#ffffff1a);border-radius:14px;text-align:center}`、`.primary{background:var(--accent,#6ea8fe);color:#fff;border:none;border-radius:8px;padding:8px 16px;margin-right:8px;cursor:pointer}`、`.quickEntries{display:flex;gap:8px;padding:12px}`(按钮复用 `.primary` 去底色变体)。

- [ ] **Step 4: 跑测试 + 提交**

Run: `cd k7s-frontend && pnpm vitest run src/components/dashboard/Dashboard.test.tsx && pnpm test`
Expected: PASS。

```bash
cd k7s-frontend && git add -A && git commit -m "feat(overview): dashboard becomes the home page with empty state and quick entries"
```

---

### Task 6: i18n 中文默认 + 新词条

**Files:**
- Modify: `k7s-frontend/src/lib/i18n/index.ts`(默认 locale zh)
- Modify: `k7s-frontend/src/lib/i18n/zh.ts`、`en.ts`(追加词条)
- Modify: `k7s-frontend/src/lib/settings.ts`(`DEFAULT_SETTINGS.language: 'zh'`)
- Test: 修改现有 i18n 测试

**Interfaces:**
- Produces: 词条 key 前缀 `chrome.sections.*`、`subnav.group.*`、`tools.category.*`、`overview.*`、`auth.*`、`onboarding.*`(Task 7-9 消费)。

- [ ] **Step 1: 追加词条(zh.ts,en.ts 同 key 英文)**

```ts
// zh.ts 追加(结构以现有词典为准,通常是扁平 key 或嵌套对象,照现有风格):
'chrome.sections.overview': '概览',
'chrome.sections.workloads': '工作负载',
'chrome.sections.config': '配置与网络',
'chrome.sections.storage': '存储',
'chrome.sections.tools': '运维工具',
'subnav.group.config': '配置', 'subnav.group.network': '网络',
'subnav.group.access': '访问控制', 'subnav.group.cluster': '集群',
'subnav.group.custom': '自定义资源', 'subnav.group.storage': '存储',
'tools.category.observability': '可观测性', 'tools.category.helm': 'Helm 应用',
'tools.category.images': '镜像', 'tools.category.security': '安全合规',
'tools.category.network': '网络诊断', 'tools.category.cluster': '集群工具',
'overview.empty.title': '还没有连接任何集群',
'overview.empty.hint': '导入 kubeconfig 后即可开始浏览与操作集群资源。',
'overview.empty.import': '导入集群', 'overview.empty.browse': '先随便看看',
'overview.quick.workloads': '工作负载', 'overview.quick.metrics': '指标查询',
'overview.quick.alerts': '告警', 'overview.quick.create': '创建工作负载',
```

- [ ] **Step 2: 默认语言改 zh**

`settings.ts`:`DEFAULT_SETTINGS` 中 `language: 'zh'`;`i18n/index.ts` 的 `cachedLocale()` 兜底值从 `'en'` 改 `'zh'`(已有用户 localStorage 里的选择优先,不受影响)。

- [ ] **Step 3: 跑全量测试修绿 + 提交**

Run: `cd k7s-frontend && pnpm test`
Expected: 依赖默认 en 的快照/断言失败 → 在测试里显式 `setState language:'en'` 或更新快照。

```bash
cd k7s-frontend && git add -A && git commit -m "feat(i18n): Chinese default locale + section/tool/overview keys"
```

---

### Task 7: k7s-server 密码登录会话(argon2 + HttpOnly cookie)

**Files:**
- Modify: `k7s-server/Cargo.toml`(加 `argon2 = "0.5"`)
- Create: `k7s-server/src/web/auth_password.rs`
- Modify: `k7s-server/src/web/state.rs`(WebState 加字段,16 行处)
- Modify: `k7s-server/src/web/auth.rs`(`require_token` 接受会话,98 行处)
- Modify: `k7s-server/src/web/server.rs`(注册路由,141 行 router 处;`mod auth_password;` 声明加进 `mod.rs`)
- Test: `k7s-server/src/web/auth_password.rs` 内嵌 `#[cfg(test)]`

**Interfaces:**
- Consumes: `WebState { web_token, is_loopback, core.data_dir }`(state.rs 现有)。
- Produces: HTTP 端点 `GET /api/auth/status` → `{"authRequired":bool,"configured":bool}`;`POST /api/auth/setup {password}`(仅未配置时,200 或 409);`POST /api/auth/login {password}`(200 + Set-Cookie `k7s_session`,401 密码错);`POST /api/auth/logout`。会话 cookie 名 `k7s_session`。Task 8 前端消费这些端点。

- [ ] **Step 1: Cargo.toml 加依赖**

```toml
[dependencies]
argon2 = "0.5"
```

Run: `cd k7s-server && cargo build` — Expected: 编译通过。

- [ ] **Step 2: 写失败测试(先写模块骨架 + 测试)**

`auth_password.rs` 完整实现(含测试):

```rust
//! 单用户密码登录门(P1)。argon2 哈希落盘 `<data_dir>/web-password`,
//! 会话为内存 token → 过期时刻映射,cookie `k7s_session` 携带。
//! 与既有 Bearer token 并存:loopback 模式沿用 token 免登,
//! 非 loopback 且已设密码时要求会话。

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::http::header::SET_COOKIE;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use k7s_deps::rand::Rng;
use k7s_deps::serde_json::json;
use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;

use super::state::WebState;

const PASSWORD_FILE: &str = "web-password";
const SESSION_COOKIE: &str = "k7s_session";
const SESSION_TTL: Duration = Duration::from_secs(7 * 24 * 3600);

pub struct PasswordAuth {
    hash: Option<String>,
    sessions: Mutex<HashMap<String, Instant>>,
}

impl PasswordAuth {
    pub fn load(data_dir: &Path) -> Self {
        let hash = std::fs::read_to_string(data_dir.join(PASSWORD_FILE))
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        Self { hash, sessions: Mutex::new(HashMap::new()) }
    }

    pub fn configured(&self) -> bool {
        self.hash.is_some()
    }

    pub fn setup(&mut self, password: &str) -> Result<(), &'static str> {
        if self.configured() {
            return Err("password already configured");
        }
        let salt = SaltString::generate(&mut OsRng);
        let phc = Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map_err(|_| "hash failed")?
            .to_string();
        self.hash = Some(phc.clone());
        // 由调用方(web/mod.rs 装配处)负责落盘;此处只改内存,见 setup handler。
        Ok(())
    }

    pub fn persist(&self, data_dir: &Path) -> std::io::Result<()> {
        if let Some(h) = &self.hash {
            std::fs::write(data_dir.join(PASSWORD_FILE), h)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut p = std::fs::metadata(data_dir.join(PASSWORD_FILE))?.permissions();
                p.set_mode(0o600);
                std::fs::set_permissions(data_dir.join(PASSWORD_FILE), p)?;
            }
        }
        Ok(())
    }

    pub fn verify(&self, password: &str) -> bool {
        let Some(h) = &self.hash else { return false };
        let Ok(parsed) = PasswordHash::new(h) else { return false };
        Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok()
    }

    fn issue_session(&self) -> String {
        use k7s_deps::base64::Engine;
        let mut b = [0u8; 32];
        k7s_deps::rand::rng().fill_bytes(&mut b);
        let token = k7s_deps::base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b);
        if let Ok(mut s) = self.sessions.lock() {
            s.insert(token.clone(), Instant::now() + SESSION_TTL);
        }
        token
    }

    /// 校验 cookie 里的会话 token(滑动续期)。
    pub fn check_session(&self, token: &str) -> bool {
        let Ok(mut s) = self.sessions.lock() else { return false };
        match s.get(token) {
            Some(exp) if *exp > Instant::now() => {
                s.insert(token.to_string(), Instant::now() + SESSION_TTL);
                true
            }
            _ => false,
        }
    }

    pub fn drop_session(&self, token: &str) {
        if let Ok(mut s) = self.sessions.lock() {
            s.remove(token);
        }
    }

    pub fn cookie_of(token: &str) -> String {
        format!("{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}", SESSION_TTL.as_secs())
    }

    pub fn cookie_name() -> &'static str {
        SESSION_COOKIE
    }
}

fn cookie_token(req: &axum::http::Request<axum::body::Body>) -> Option<String> {
    let raw = req.headers().get(axum::http::header::COOKIE)?.to_str().ok()?;
    raw.split(';')
        .map(|c| c.trim())
        .find_map(|c| c.strip_prefix(&format!("{SESSION_COOKIE}=")))
        .map(|t| t.to_string())
}

// ---- handlers ----

pub async fn auth_status(State(state): State<WebState>) -> Response {
    let pa = state.password_auth.lock().unwrap_or_else(|e| e.into_inner());
    Json(json!({
        "authRequired": !state.is_loopback && pa.configured(),
        "configured": pa.configured(),
    }))
    .into_response()
}

pub async fn auth_setup(
    State(state): State<WebState>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let Some(pwd) = body["password"].as_str() else {
        return (StatusCode::BAD_REQUEST, Json(json!({"ok": false, "error": "password required"}))).into_response();
    };
    if pwd.len() < 8 {
        return (StatusCode::BAD_REQUEST, Json(json!({"ok": false, "error": "password must be >= 8 chars"}))).into_response();
    }
    let mut guard = state.password_auth.lock().unwrap_or_else(|e| e.into_inner());
    if let Err(e) = guard.setup(pwd) {
        return (StatusCode::CONFLICT, Json(json!({"ok": false, "error": e}))).into_response();
    }
    if let Err(e) = guard.persist(&state.data_dir) {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"ok": false, "error": e.to_string()}))).into_response();
    }
    let token = guard.issue_session();
    drop(guard);
    ([(SET_COOKIE, PasswordAuth::cookie_of(&token))], Json(json!({"ok": true}))).into_response()
}

pub async fn auth_login(
    State(state): State<WebState>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let Some(pwd) = body["password"].as_str() else {
        return (StatusCode::BAD_REQUEST, Json(json!({"ok": false, "error": "password required"}))).into_response();
    };
    let guard = state.password_auth.lock().unwrap_or_else(|e| e.into_inner());
    if !guard.verify(pwd) {
        return (StatusCode::UNAUTHORIZED, Json(json!({"ok": false, "error": "wrong password"}))).into_response();
    }
    let token = guard.issue_session();
    drop(guard);
    ([(SET_COOKIE, PasswordAuth::cookie_of(&token))], Json(json!({"ok": true}))).into_response()
}

pub async fn auth_logout(req: axum::http::Request<axum::body::Body>, State(state): State<WebState>) -> Response {
    if let Some(t) = cookie_token(&req) {
        state.password_auth.lock().unwrap_or_else(|e| e.into_inner()).drop_session(&t);
    }
    ([(SET_COOKIE, format!("{}=; Path=/; HttpOnly; Max-Age=0", PasswordAuth::cookie_name()))], Json(json!({"ok": true}))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_verify_roundtrip() {
        let dir = std::env::temp_dir().join("k7s-pwd-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut pa = PasswordAuth { hash: None, sessions: Mutex::new(HashMap::new()) };
        assert!(!pa.configured());
        pa.setup("correct-horse-battery").unwrap();
        assert!(pa.configured());
        assert!(pa.verify("correct-horse-battery"));
        assert!(!pa.verify("wrong"));
        pa.persist(&dir).unwrap();
        let loaded = PasswordAuth::load(&dir);
        assert!(loaded.verify("correct-horse-battery"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn session_issue_check_drop() {
        let pa = PasswordAuth { hash: None, sessions: Mutex::new(HashMap::new()) };
        let t = pa.issue_session();
        assert!(pa.check_session(&t));
        pa.drop_session(&t);
        assert!(!pa.check_session(&t));
    }
}
```

**注意**:共享可变 `PasswordAuth` 在 `WebState` 里用 `Mutex<PasswordAuth>` 封装(handler 统一走 `state.password_auth.lock()`);`setup()` 只改内存并返回,`persist()` 落盘 `web-password`(0600)。

- [ ] **Step 3: 接线 state.rs / mod.rs(编译前提)**

`mod.rs` 加 `pub mod auth_password;`。`state.rs`(`WebState` struct,16 行处)加:

```rust
pub password_auth: std::sync::Mutex<crate::web::auth_password::PasswordAuth>,
pub data_dir: std::path::PathBuf,
```

构造处(63 行附近 `web_token` 初始化旁边)加:

```rust
password_auth: std::sync::Mutex::new(crate::web::auth_password::PasswordAuth::load(&core.data_dir)),
data_dir: core.data_dir.clone(),
```

(`core.data_dir` 的真实访问路径以 state.rs 现有代码为准——63 行已在用 `&core.data_dir`。)

Run: `cd k7s-server && cargo test auth_password`
Expected: 2 个测试 PASS。

- [ ] **Step 4: 注册路由 + 中间件接受会话**

`server.rs` router(141 行附近)加:

```rust
.route("/api/auth/status", get(auth_password::auth_status))
.route("/api/auth/setup", post(auth_password::auth_setup))
.route("/api/auth/login", post(auth_password::auth_login))
.route("/api/auth/logout", post(auth_password::auth_logout))
```

`auth.rs` 的 `require_token`(98 行)在 public 判定里追加 `|| path.starts_with("/api/auth/")`,并在 bearer 校验失败后追加 cookie 会话判定:

```rust
    // 会话 cookie 兜底:密码登录门(P1)。loopback 未设密码时维持原 token 行为。
    if !ok {
        if let Some(tok) = cookie_session(&req, &state) {
            return next.run(req).await;
        }
    }
```

辅助函数(放 auth.rs 底部):

```rust
fn cookie_session(req: &Request<Body>, state: &WebState) -> Option<()> {
    let raw = req.headers().get(k7s_deps::http::header::COOKIE)?.to_str().ok()?;
    let name = format!("{}=", super::auth_password::PasswordAuth::cookie_name());
    let token = raw.split(';').map(str::trim).find(|c| c.starts_with(&name))?.strip_prefix(&name)?;
    state.password_auth.lock().unwrap_or_else(|e| e.into_inner()).check_session(token).then_some(())
}
```

- [ ] **Step 5: cargo test + 提交**

Run: `cd k7s-server && cargo test`
Expected: PASS。

```bash
cd k7s-server && git add Cargo.toml Cargo.lock src/web/ && git commit -m "feat(web): single-user password gate with argon2 + cookie sessions"
```

---

### Task 8: 前端 LoginGate

**Files:**
- Create: `k7s-frontend/src/components/auth/LoginGate.tsx`
- Create: `k7s-frontend/src/components/auth/LoginGate.module.css`
- Modify: `k7s-frontend/src/App.tsx`(ErrorBoundary 内包一层)
- Test: `k7s-frontend/src/components/auth/LoginGate.test.tsx`

**Interfaces:**
- Consumes: `GET /api/auth/status` → `{authRequired: boolean; configured: boolean}`(Task 7);`POST /api/auth/setup|login`(body `{password}`);`provider instanceof HttpProvider` 判定(providers/HttpProvider.ts 导出)。
- Produces: `<LoginGate>{children}</LoginGate>`——authRequired=false 时直接渲染 children;桌面端(Tauri)永远直通。

- [ ] **Step 1: 写失败测试**

```tsx
// src/components/auth/LoginGate.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LoginGate } from './LoginGate';

vi.mock('../../providers/HttpProvider', () => ({
  HttpProvider: class {},
  isHttpMode: () => false,   // 桌面直通分支
}));

describe('LoginGate', () => {
  it('passes through on desktop', async () => {
    render(<LoginGate><div>app</div></LoginGate>);
    await waitFor(() => expect(screen.getByText('app')).toBeTruthy());
  });
});
```

(HTTP 模式的登录表单交互用 Playwright e2e 覆盖,见 Task 11;单测 mock 掉 fetch 即可再补一条 401 分支。)

- [ ] **Step 2: 跑测试确认失败**

Run: `cd k7s-frontend && pnpm vitest run src/components/auth/LoginGate.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现**

```tsx
/**
 * LoginGate — 单用户登录门。仅在 Web 模式且服务端要求认证时拦住应用:
 * 未设密码 → 设置密码表单;已设 → 登录表单。成功后整页刷新拿会话 cookie。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from '../../hooks/useI18n';
import { isHttpMode } from '../../providers/HttpProvider';
import styles from './LoginGate.module.css';

interface Status { authRequired: boolean; configured: boolean; }

export function LoginGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (!isHttpMode()) return;
    fetch('/api/auth/status').then((r) => r.json()).then(setStatus).catch(() => setStatus(null));
  }, []);

  if (!isHttpMode() || !status || !status.authRequired) return <>{children}</>;

  const submit = async () => {
    setBusy(true); setErr('');
    const endpoint = status.configured ? '/api/auth/login' : '/api/auth/setup';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd }),
    }).finally(() => setBusy(false));
    if (res.ok) { window.location.reload(); return; }
    const body = await res.json().catch(() => ({}));
    setErr(body.error === 'password already configured'
      ? t('auth.err.configured', '密码已设置,请直接登录')
      : body.error === 'password must be >= 8 chars'
        ? t('auth.err.short', '密码至少 8 位')
        : t('auth.err.wrong', '密码错误'));
  };

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h1>k7s</h1>
        <h2>{status.configured ? t('auth.login.title', '登录') : t('auth.setup.title', '设置访问密码')}</h2>
        {!status.configured && <p>{t('auth.setup.hint', '首次使用,请为这个实例设置一个管理密码(至少 8 位)。')}</p>}
        <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus />
        {err && <div className={styles.err}>{err}</div>}
        <button type="submit" disabled={busy || pwd.length < 8}>
          {status.configured ? t('auth.login.submit', '登录') : t('auth.setup.submit', '保存并进入')}
        </button>
      </form>
    </div>
  );
}
```

`HttpProvider.ts` 若无 `isHttpMode` 导出,加一行 `export const isHttpMode = () => typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__;`。`App.tsx` 把 `<ErrorBoundary>` 内的 `<div className={styles.app}>` 整体包进 `<LoginGate>`。

- [ ] **Step 4: 测试 + 提交**

Run: `cd k7s-frontend && pnpm vitest run src/components/auth && pnpm test`
Expected: PASS。

```bash
cd k7s-frontend && git add -A && git commit -m "feat(auth): login gate for web mode (setup/login forms)"
```

---

### Task 9: Onboarding 3 步引导

**Files:**
- Create: `k7s-frontend/src/components/onboarding/OnboardingWizard.tsx`
- Create: `k7s-frontend/src/components/onboarding/OnboardingWizard.module.css`
- Modify: `k7s-frontend/src/App.tsx`(挂载)
- Test: `k7s-frontend/src/components/onboarding/OnboardingWizard.test.tsx`

**Interfaces:**
- Consumes: store `onboardingOpen`(Task 5 已加)、`provider.importKubeconfig(): Promise<ImportResult | null>`(providers/types/provider.ts:98)、`useConnection()`、`setSettings`(主题/语言/默认 ns)。
- Produces: `<OnboardingWizard />`;完成标记 `localStorage['k7s.onboarded'] = '1'`;App 首次启动(无标记)自动打开。

- [ ] **Step 1: 写失败测试**

```tsx
// src/components/onboarding/OnboardingWizard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OnboardingWizard } from './OnboardingWizard';
import { useStore } from '../../store';

describe('OnboardingWizard', () => {
  it('renders step 1 (import) when open', () => {
    useStore.setState({ onboardingOpen: true });
    render(<OnboardingWizard />);
    expect(screen.getByText(/导入|Import/i)).toBeTruthy();
  });
  it('renders nothing when closed', () => {
    useStore.setState({ onboardingOpen: false });
    const { container } = render(<OnboardingWizard />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: 确认失败**

Run: `cd k7s-frontend && pnpm vitest run src/components/onboarding/OnboardingWizard.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现**

```tsx
/**
 * OnboardingWizard — 首次引导三步:导入 kubeconfig → 连接确认 → 偏好设置。
 * provider 走 DataProvider 抽象,桌面/Web 两模式同码。
 */
import { useState } from 'react';
import { useStore } from '../../store';
import { useTranslation } from '../../hooks/useI18n';
import { useProvider } from '../../providers';   // 以 providers/index.ts 实际导出为准
import styles from './OnboardingWizard.module.css';

export function OnboardingWizard() {
  const open = useStore((s) => s.onboardingOpen);
  const setOpen = useStore((s) => s.setOnboardingOpen);
  const connection = useStore((s) => s.connection);
  const [step, setStep] = useState(0);
  const [defaultNs, setDefaultNs] = useState('default');
  const { t } = useTranslation();
  const provider = useProvider();
  if (!open) return null;

  const finish = () => {
    localStorage.setItem('k7s.onboarded', '1');
    useStore.getState().setNamespace(defaultNs);
    setOpen(false);
  };

  return (
    <div className={styles.backdrop}>
      <div className={styles.dialog}>
        <div className={styles.stepper}>① {t('onboarding.step1', '导入集群')} ② {t('onboarding.step2', '连接确认')} ③ {t('onboarding.step3', '偏好设置')}</div>
        {step === 0 && (
          <div>
            <p>{t('onboarding.import.hint', '选择一个 kubeconfig 文件,或粘贴其内容。')}</p>
            <button type="button" className={styles.primary}
              onClick={async () => { const r = await provider?.importKubeconfig(); if (r) setStep(1); }}>
              {t('onboarding.import.pick', '选择文件…')}
            </button>
          </div>
        )}
        {step === 1 && (
          <div>
            <p>{connection.phase === 'connected'
              ? t('onboarding.conn.ok', '已连接:{cluster}').replace('{cluster}', connection.clusterName ?? connection.context ?? '?')
              : t('onboarding.conn.wait', '连接中…若长时间未成功,请检查 kubeconfig。')}</p>
            <button type="button" disabled={connection.phase !== 'connected'} onClick={() => setStep(2)}>
              {t('onboarding.next', '下一步')}
            </button>
          </div>
        )}
        {step === 2 && (
          <div>
            <label>
              {t('onboarding.prefs.ns', '默认命名空间')}
              <input value={defaultNs} onChange={(e) => setDefaultNs(e.target.value)} />
            </label>
            <button type="button" className={styles.primary} onClick={finish}>
              {t('onboarding.done', '进入概览')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

`useProvider` 的真实取法以现有代码为准(App 用 `useBootstrap` 装 provider;查 `providers/index.ts` 的导出,通常是 `getProvider()` 或 store 里的实例——对齐后替换)。App.tsx 在 `<CommandPalette />` 旁挂 `<OnboardingWizard />`,并加首启自动打开:

```tsx
useEffect(() => {
  if (!localStorage.getItem('k7s.onboarded') && useStore.getState().connection.phase === 'idle') {
    useStore.setState({ onboardingOpen: true });
  }
}, []);
```

- [ ] **Step 4: 测试 + 提交**

Run: `cd k7s-frontend && pnpm test && pnpm typecheck`
Expected: PASS。

```bash
cd k7s-frontend && git add -A && git commit -m "feat(onboarding): 3-step first-run wizard (import/connect/prefs)"
```

---

### Task 10: 表格空态 CTA

**Files:**
- Modify: `k7s-frontend/src/components/table/ResourceTable.tsx:455-463`(空态分支)
- Test: 修改 `ResourceTable.test.tsx`

**Interfaces:**
- Consumes: `useStore` 的 `nav`、`tableFilter`;`openOverlay('templates')`。

- [ ] **Step 1: 改测试**

```tsx
// ResourceTable.test.tsx 追加:
it('empty workload table shows a create CTA', () => {
  useStore.setState({ nav: 'deployments', tableFilter: '', section: 'workloads' });
  render(<ResourceTable />);
  expect(screen.getByRole('button', { name: /创建第一个工作负载|Create your first workload/i })).toBeTruthy();
});
```

(rows 为空需 mock store rows;按现有 ResourceTable.test.tsx 的 setup 方式注入空 rows。)

- [ ] **Step 2: 实现(455 行空态分支)**

```tsx
) : rows.length === 0 ? (
  <div className={styles.empty}>
    <span>{tableFilter ? t('table.empty', 'no resources match filter') : t('table.emptyNone', 'no resources')}</span>
    {!tableFilter && sectionForKind(nav) === 'workloads' && (
      <button type="button" className={styles.emptyCta} onClick={() => useStore.getState().openOverlay('templates')}>
        {t('table.emptyCta', '创建第一个工作负载')}
      </button>
    )}
  </div>
)
```

(`sectionForKind` 从 `lib/sections` 导入;`.emptyCta` 样式复用 Dashboard 的 `.primary` 写法。P2 落地后此按钮改为打开创建向导。)

- [ ] **Step 3: 测试 + 提交**

Run: `cd k7s-frontend && pnpm test`
Expected: PASS。

```bash
cd k7s-frontend && git add -A && git commit -m "feat(table): empty-state CTA opens the template picker for workloads"
```

---

### Task 11: 收尾 — 全量验证 + e2e + 文档

**Files:**
- Create: `k7s-frontend/e2e/p1-usability.spec.ts`(目录以现有 playwright 配置为准,package.json 已有 test:e2e)
- Modify: `k7s-frontend/README.md`、`k7s/README.zh-CN.md`(导航章节改为 5 分区说明)

- [ ] **Step 1: Playwright e2e 核心路径**

```ts
// e2e/p1-usability.spec.ts
import { test, expect } from '@playwright/test';

test('P1 usability smoke', async ({ page }) => {
  await page.goto('/');
  // 5 分区导航可见
  await expect(page.locator('nav[aria-label="sections"] button')).toHaveCount(5);
  // 概览 → 工作负载 → 配置与网络 → 运维工具
  await page.getByTitle('工作负载').click();
  await expect(page.getByRole('tab', { name: 'Deployments' })).toBeVisible();
  await page.getByTitle('运维工具').click();
  await expect(page.getByTitle('Helm Market')).toBeVisible();
});
```

(文案语言按 Task 6 默认 zh;CI 环境语言不同则用 title 属性选择器兜底。)

- [ ] **Step 2: 全量验证**

```bash
cd k7s-frontend && pnpm typecheck && pnpm lint && pnpm test && pnpm build
cd ../k7s-server && cargo test && cargo build --features web --bin k7s-web
```

Expected: 全部通过。

- [ ] **Step 3: 手工冒烟(loopback 免登 + 非 loopback 登录门)**

```bash
# 1) loopback:直接进应用,无登录页
cd k7s-frontend && pnpm build && cd ../k7s-server && cargo run --features web --bin k7s-web -- --addr 127.0.0.1:8080 --static ../k7s-frontend/dist
# 浏览器 http://127.0.0.1:8080 → 应直达概览空状态(未连集群)→ 导入向导可用

# 2) 非 loopback + 未设密码:应提示设置密码
K7S_WEB_TOKEN= cargo run --features web --bin k7s-web -- --addr 0.0.0.0:8080 --static ../k7s-frontend/dist
# curl -s localhost:8080/api/auth/status → {"authRequired":false,"configured":false}
#   (未设密码时 authRequired=false,但 bearer 缺失仍挡 /api/invoke/*;
#    设密码后 authRequired=true → 前端出登录表单)
```

若希望「非 loopback 一启动就强制设密码」,在 `auth_status` 里把 `authRequired` 改为 `!state.is_loopback`(无论是否已配置)——按此口径调整并同步 LoginGate 文案。

- [ ] **Step 4: 文档 + 提交**

README 导航章节替换为 5 分区说明 + 登录门行为(loopback 免登、非 loopback 强制)。

```bash
cd k7s-frontend && git add -A && git commit -m "docs+test: P1 usability e2e smoke and README refresh"
```

---

## P2 / P3 展开要点(另行立计划)

- **P2 表单向导**:`components/wizard/CreateWorkloadWizard.tsx` 4 步(基本→容器→存储→YAML 预览);复用 `templates` 的 dry-run/apply 通道;Service/Ingress/ConfigMap/Secret 表单;表单↔YAML 双向绑定(现有 YAML 编辑器组件包一层)。
- **P3 视觉打磨**:状态徽章中文映射表(`lib/status.ts`);表格密度两档;行内 hover 操作;错误文案翻译层(`errorHandler` 里按 API 错误码映射建议动作)。

## 风险与回退

- **1253 个既有测试**:Task 2/4 是破坏面最大的两步,均要求当任务内修绿,不留跨任务红灯。
- **会话仅内存**:k7s-web 重启后需重新登录(P1 接受;P2 可选落盘会话)。
- **回退**:每个任务独立 commit,按仓库 `git revert` 单任务回退,不影响其余任务。

---

## 执行结果(2026-08-18,P1 完成)

- 11 个任务全部完成,每任务经独立实现者 + 审查者把关;Task 1/2 各 1 轮修复后通过。
- 终审发现 1 Critical + 3 Important(登录门死循环、首装无设密入口、8 个 kind 导航丢失、引导向导重复弹出),已由修复波全部解决并复审通过。
- 最终:k7s-frontend `d06e3a0..353ffbd`(15 commits)、k7s-server `355bf08..b370217`(2 commits),分支均为 `feat/usability-p1`。

### P1 遗留(已裁决可延后,P2/P3 候选)

- 会话仅内存:k7s-web 重启后需重新登录(计划风险节已接受)
- cookie 无 Secure 标志(明文 HTTP 自建场景刻意为之);/api/auth/login 无速率限制(单用户 + argon2 成本缓解)
- SubNav 无方向键漫游(ARIA tabs 完整性);.emptyCta 无 :focus-visible(与既有模式一致)
- LoginGate 网络错误映射为「密码错误」;demo 模式每次加载探测 /api/auth/status(失败开放)
- 向导无 X 关闭按钮(Esc/背景可关);⌘K 在首启向导期间被遮罩盖住(仅首启)
- e2e 文件不在 typecheck 范围(tsconfig 只含 src/,建议 tsconfig.e2e.json)
- 上游旧账:k7s-server `resolve_token_env_wins` 测试 env 竞态(本次改动之前就存在,测得 8/15 概率失败)
- P2 重点:表单向导(创建工作负载 4 步)+ 粘贴 kubeconfig 导入(需新后端命令)
