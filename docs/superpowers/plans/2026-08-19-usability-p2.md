# k7s 易用性重构 P2 实施计划(表单化创建向导)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 Kuboard 式 4 步「创建工作负载」向导(表单 → dry-run 把关 → apply),修通 Web 模式创建链路,并把所有创建入口接到向导。

**Architecture:** 向导复用既有基础设施——provider 的 `dryRunYamlBundle`/`applyYamlBundle` 通道、`YamlReview` 文档审查组件、`CodeEditor`、OnboardingWizard 的多步对话框模式。新增纯函数模块 `workloadSpec.ts`(表单模型 → YAML 字符串拼接生成,风格对齐 `lib/templates/helpers.ts`,不引入 yaml 序列化;反向用 `yaml` 包 parseDocument 做尽力而为的回填)。向导以新 OverlayKey `'wizard'` 挂进 overlayPanels 表,组件内部本地管步骤状态。非工作负载 kind 的创建继续走 TemplatePicker(它已按当前 nav 预选模板)。

**Tech Stack:** React 19 + Zustand + Vitest;CodeMirror(CodeEditor);yaml@2.9(仅回填解析)。

**设计文档:** `docs/superpowers/specs/2026-08-18-usability-redesign-design.md` §4(表单化操作向导)

## Global Constraints

- 工作目录 `k7s-frontend/`(git 仓库,开工前从最新 main 拉 `feat/usability-p2` 分支)。
- 所有用户可见文案走 i18n 三文件(`dictionaries.ts` 类型 + `en.ts` + `zh.ts`),`t(key, 英文fallback)`。
- **Apply 必须以干净 dry-run 为前置**(对齐 YamlTab/YAML-import 模式的最严格档;不得学 form-mode TemplatePicker 的直通 apply)。
- 不得改动:MCP 工具、AI 助手、k7s-core/server 端逻辑(本计划纯前端 + 一处 provider 前端层修改)。
- 现有测试保持绿;提交只 stage 本任务文件(工作区可能有用户未提交改动)。
- YAML 生成沿用字符串拼接风格(见 `src/lib/templates/helpers.ts`),除回填解析外不得新增 yaml 库用途。

## 文件结构总览

```
k7s-frontend/src/
├── providers/HttpProvider.ts            [改] 删除 applyYamlBundle 空桩(继承 BaseRpc)
├── components/wizard/
│   ├── workloadSpec.ts                  [新] 表单模型 + generateWorkloadYaml + parseWorkloadYaml(回填)
│   ├── CreateWorkloadWizard.tsx         [新] 4 步向导主组件(overlay 'wizard')
│   ├── CreateWorkloadWizard.module.css  [新]
│   └── StepFields.tsx                   [新] 各步骤表单片段(复用于步骤1/2/3)
├── store/types.ts                       [改] OverlayKey 增加 'wizard'
├── App.tsx                              [改] overlayPanels 挂 CreateWorkloadWizard
├── components/table/ResourceTable.tsx   [改] 新建按钮/空态 CTA 分流
├── components/dashboard/Dashboard.tsx   [改] 快捷入口指向向导
├── lib/i18n/{dictionaries,en,zh}.ts     [改] wizard.* 词条(随各任务)
└── e2e/p1-usability.spec.ts             [改] 追加向导冒烟断言
```

---

### Task 1: 修通 Web 模式创建链路(删除 applyYamlBundle 空桩)

**Files:**
- Modify: `k7s-frontend/src/providers/HttpProvider.ts:593-598`
- Test: `k7s-frontend/src/providers/HttpProvider.test.ts`(若无则新建,按同目录既有 provider 测试模式)

**Interfaces:**
- Consumes: `BaseRpcProvider.applyYamlBundle(yaml: string): Promise<ApplyResult[]>`(已实现,走 `rpc('apply_yaml_bundle', { yaml })`);`ApplyResult`(`providers/types/operations.ts:7-12`)。
- Produces: HttpProvider 继承的 `applyYamlBundle` 与 TauriProvider 同构;后续任务的向导 apply 在两种传输下一致。

- [ ] **Step 1: 写失败测试**(mock rpc 层,断言 HttpProvider.applyYamlBundle 发出 `apply_yaml_bundle` 调用并透传结果;参考 HttpProvider 既有测试对 `dryRunYamlBundle` 的断言方式——若现测试文件无此模式,按 `vi.fn` mock `fetch`/rpc 基类):

```ts
it('applyYamlBundle delegates to rpc (not stubbed)', async () => {
  const calls: Array<[string, unknown]> = [];
  const provider = makeHttpProvider({ rpc: async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === 'apply_yaml_bundle') return [{ name: 'nginx', kind: 'Deployment', namespace: 'default', action: 'created', error: null }];
    return [];
  }});
  const r = await provider.applyYamlBundle('apiVersion: apps/v1\n...');
  expect(r).toEqual([{ name: 'nginx', kind: 'Deployment', namespace: 'default', action: 'created', error: null }]);
  expect(calls[0][0]).toBe('apply_yaml_bundle');
});
```

(`makeHttpProvider` 按现有测试的工具函数适配——关键是让 rpc 可注入;若 BaseRpcProvider 的 rpc 不可注入,则 mock `globalThis.fetch` 返回该 JSON,断言请求体 cmd 名。)

- [ ] **Step 2: 跑测试确认失败**

Run: `cd k7s-frontend && pnpm vitest run src/providers/HttpProvider.test.ts`
Expected: FAIL —— 当前桩返回 `[]`。

- [ ] **Step 3: 删除桩**

删除 `HttpProvider.ts` 中 `applyYamlBundle` 的 override(593-598 行附近,带 "not proxied yet" 注释的方法),使其继承 `BaseRpcProvider` 实现(与 `dryRunYamlBundle` 同款)。保留文件内其他 override。

- [ ] **Step 4: 跑测试 + 全量 + 提交**

Run: `cd k7s-frontend && pnpm vitest run src/providers && pnpm test && pnpm typecheck`
Expected: PASS。

```bash
cd k7s-frontend && git add src/providers/HttpProvider.ts src/providers/HttpProvider.test.ts
git commit -m "fix(providers): applyYamlBundle inherits rpc path — un-stub web-mode create"
```

---

### Task 2: 工作负载表单模型 + YAML 生成器

**Files:**
- Create: `k7s-frontend/src/components/wizard/workloadSpec.ts`
- Test: `k7s-frontend/src/components/wizard/workloadSpec.test.ts`

**Interfaces:**
- Consumes: `src/lib/security.ts` 的 `isValidK8sName`/`isValidNamespace`(119/129 行)。
- Produces(Task 3/4 消费):

```ts
export interface ContainerPort { name: string; port: number; protocol: 'TCP' | 'UDP'; }
export interface EnvVar { key: string; value: string; }
export interface ProbeCfg { enabled: boolean; path: string; port: number; initialDelay: number; }
export interface VolumeMount { pvcName: string; mountPath: string; readOnly: boolean; }
export interface WorkloadForm {
  name: string; namespace: string; workloadType: 'deployment' | 'statefulset' | 'daemonset';
  replicas: number; image: string; imagePullPolicy: 'IfNotPresent' | 'Always';
  command: string; args: string;            // 空格分隔,可留空
  ports: ContainerPort[]; env: EnvVar[];
  cpuRequest: string; memRequest: string; cpuLimit: string; memLimit: string;
  liveness: ProbeCfg; readiness: ProbeCfg;
  mounts: VolumeMount[];
}
export function emptyWorkloadForm(type?: WorkloadForm['workloadType']): WorkloadForm;
export function validateWorkloadForm(f: WorkloadForm): string[];   // 中文?否——返回 i18n key 后缀数组,如 ['name','image'] 
export function generateWorkloadYaml(f: WorkloadForm): string;     // 单文档(仅工作负载本体,不含 Service)
export function parseWorkloadYaml(yaml: string): Partial<WorkloadForm> | null; // 尽力而为回填,失败返回 null
```

- [ ] **Step 1: 写失败测试**(核心断言,写成快照式明确字符串比对):

```ts
import { describe, it, expect } from 'vitest';
import { emptyWorkloadForm, generateWorkloadYaml, validateWorkloadForm, parseWorkloadYaml } from './workloadSpec';

const base = emptyWorkloadForm('deployment');

describe('validateWorkloadForm', () => {
  it('requires name and image', () => {
    expect(validateWorkloadForm({ ...base })).toContain('name');
    expect(validateWorkloadForm({ ...base, name: 'nginx', image: '' })).toContain('image');
    expect(validateWorkloadForm({ ...base, name: 'nginx', image: 'nginx:1.27' })).toEqual([]);
  });
  it('rejects invalid k8s names', () => {
    expect(validateWorkloadForm({ ...base, name: 'Bad_Name', image: 'nginx' })).toContain('name');
  });
});

describe('generateWorkloadYaml', () => {
  it('renders a minimal Deployment', () => {
    const y = generateWorkloadYaml({ ...base, name: 'nginx', image: 'nginx:1.27', replicas: 3 });
    expect(y).toContain('kind: Deployment');
    expect(y).toContain('name: nginx');
    expect(y).toContain('replicas: 3');
    expect(y).toContain('image: nginx:1.27');
    expect(y).toContain('namespace: default');
  });
  it('renders ports, env, resources, probes and mounts when set', () => {
    const y = generateWorkloadYaml({
      ...base, name: 'web', image: 'web:1',
      ports: [{ name: 'http', port: 8080, protocol: 'TCP' }],
      env: [{ key: 'MODE', value: 'prod' }],
      cpuRequest: '100m', memLimit: '512Mi',
      readiness: { enabled: true, path: '/healthz', port: 8080, initialDelay: 5 },
      mounts: [{ pvcName: 'data', mountPath: '/data', readOnly: false }],
    });
    expect(y).toContain('containerPort: 8080');
    expect(y).toContain('name: MODE');
    expect(y).toContain('cpu: 100m');
    expect(y).toContain('memory: 512Mi');
    expect(y).toContain('path: /healthz');
    expect(y).toContain('persistentVolumeClaim:');
  });
  it('omits empty optional blocks entirely', () => {
    const y = generateWorkloadYaml({ ...base, name: 'n', image: 'i' });
    expect(y).not.toContain('ports:');
    expect(y).not.toContain('resources:');
    expect(y).not.toContain('livenessProbe:');
    expect(y).not.toContain('volumeMounts:');
  });
  it('statefulset/daemonset kinds', () => {
    expect(generateWorkloadYaml({ ...base, workloadType: 'statefulset', name: 'a', image: 'i' })).toContain('kind: StatefulSet');
    expect(generateWorkloadYaml({ ...base, workloadType: 'daemonset', name: 'a', image: 'i' })).toContain('kind: DaemonSet');
  });
});

describe('parseWorkloadYaml (round-trip)', () => {
  it('round-trips wizard-generated yaml back into form fields', () => {
    const f = { ...base, name: 'web', image: 'web:1', replicas: 2,
      ports: [{ name: 'http', port: 8080, protocol: 'TCP' as const }],
      env: [{ key: 'MODE', value: 'prod' }] };
    const back = parseWorkloadYaml(generateWorkloadYaml(f));
    expect(back?.name).toBe('web');
    expect(back?.image).toBe('web:1');
    expect(back?.replicas).toBe(2);
    expect(back?.ports).toEqual(f.ports);
    expect(back?.env).toEqual(f.env);
  });
  it('returns null for non-workload yaml', () => {
    expect(parseWorkloadYaml('kind: Service\napiVersion: v1\n')).toBeNull();
  });
});
```

- [ ] **Step 2: 确认失败**

Run: `cd k7s-frontend && pnpm vitest run src/components/wizard/workloadSpec.test.ts` → FAIL(模块不存在)。

- [ ] **Step 3: 实现 workloadSpec.ts**

生成器用字符串拼接,缩进/转义风格对齐 `src/lib/templates/helpers.ts`(读它以后照抄其引号与标签处理)。要点:

```ts
import { isValidK8sName, isValidNamespace } from '../../lib/security';
import { parseDocument } from 'yaml';

// ...类型定义如 Interfaces 所列...

export function emptyWorkloadForm(type: WorkloadForm['workloadType'] = 'deployment'): WorkloadForm {
  return {
    name: '', namespace: 'default', workloadType: type, replicas: 1,
    image: '', imagePullPolicy: 'IfNotPresent', command: '', args: '',
    ports: [], env: [],
    cpuRequest: '', memRequest: '', cpuLimit: '', memLimit: '',
    liveness: { enabled: false, path: '/', port: 80, initialDelay: 15 },
    readiness: { enabled: false, path: '/', port: 80, initialDelay: 5 },
    mounts: [],
  };
}

export function validateWorkloadForm(f: WorkloadForm): string[] {
  const errs: string[] = [];
  if (!f.name || !isValidK8sName(f.name)) errs.push('name');
  if (f.namespace && !isValidNamespace(f.namespace)) errs.push('namespace');
  if (!f.image) errs.push('image');
  if (f.replicas < 0) errs.push('replicas');
  return errs;
}

const KIND_OF = { deployment: ['apps/v1', 'Deployment'], statefulset: ['apps/v1', 'StatefulSet'], daemonset: ['apps/v1', 'DaemonSet'] } as const;

export function generateWorkloadYaml(f: WorkloadForm): string {
  const [api, kind] = KIND_OF[f.workloadType];
  const L: string[] = [];
  const push = (indent: number, s: string) => L.push(' '.repeat(indent) + s);
  push(0, `apiVersion: ${api}`); push(0, `kind: ${kind}`);
  push(0, 'metadata:'); push(2, `name: ${f.name}`); push(2, `namespace: ${f.namespace}`);
  push(0, 'spec:');
  if (f.workloadType !== 'daemonset') push(2, `replicas: ${f.replicas}`);
  push(2, 'selector:'); push(4, 'matchLabels:'); push(6, `app: ${f.name}`);
  push(2, 'template:'); push(4, 'metadata:'); push(6, 'labels:'); push(8, `app: ${f.name}`);
  push(4, 'spec:'); push(6, 'containers:');
  push(8, `- name: ${f.name}`); push(10, `image: ${f.image}`); push(10, `imagePullPolicy: ${f.imagePullPolicy}`);
  if (f.command) push(10, `command: [${f.command.split(/\s+/).map(shellQuote).join(', ')}]`);
  if (f.args) push(10, `args: [${f.args.split(/\s+/).map(shellQuote).join(', ')}]`);
  if (f.ports.length) { push(10, 'ports:'); for (const p of f.ports) { push(12, `- name: ${p.name}`); push(14, `containerPort: ${p.port}`); push(14, `protocol: ${p.protocol}`); } }
  if (f.env.length) { push(10, 'env:'); for (const e of f.env) { push(12, `- name: ${e.key}`); push(14, `value: "${escapeDq(e.value)}"`); } }
  const hasReq = f.cpuRequest || f.memRequest, hasLim = f.cpuLimit || f.memLimit;
  if (hasReq || hasLim) { push(10, 'resources:');
    if (hasReq) { push(12, 'requests:'); if (f.cpuRequest) push(14, `cpu: ${f.cpuRequest}`); if (f.memRequest) push(14, `memory: ${f.memRequest}`); }
    if (hasLim) { push(12, 'limits:'); if (f.cpuLimit) push(14, `cpu: ${f.cpuLimit}`); if (f.memLimit) push(14, `memory: ${f.memLimit}`); } }
  for (const [label, p] of [['readinessProbe', f.readiness], ['livenessProbe', f.liveness]] as const) {
    if (!p.enabled) continue;
    push(10, `${label}:`); push(12, 'httpGet:'); push(14, `path: ${p.path}`); push(14, `port: ${p.port}`);
    push(12, `initialDelaySeconds: ${p.initialDelay}`);
  }
  if (f.mounts.length) { push(10, 'volumeMounts:');
    for (const m of f.mounts) { push(12, `- name: ${m.pvcName}`); push(14, `mountPath: ${m.mountPath}`); if (m.readOnly) push(14, 'readOnly: true'); }
    push(6, 'volumes:');
    for (const m of f.mounts) { push(8, `- name: ${m.pvcName}`); push(10, 'persistentVolumeClaim:'); push(12, `claimName: ${m.pvcName}`); } }
  return L.join('\n') + '\n';
}

const shellQuote = (s: string) => (/[^\w./:-]/.test(s) ? `"${escapeDq(s)}"` : s);
const escapeDq = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function parseWorkloadYaml(yaml: string): Partial<WorkloadForm> | null {
  const doc = parseDocument(yaml, { strict: false });
  const kind = String(doc.get('kind') ?? '');
  const type = kind === 'Deployment' ? 'deployment' : kind === 'StatefulSet' ? 'statefulset' : kind === 'DaemonSet' ? 'daemonset' : null;
  if (!type) return null;
  const md = doc.get('metadata') as Map<string, unknown> | undefined;
  const spec = doc.get('spec') as Map<string, unknown> | undefined;
  const tmpl = (spec?.get('template') as Map<string, unknown> | undefined);
  const ctn = ((tmpl?.get('spec') as Map<string, unknown> | undefined)?.get('containers') as unknown[] | undefined)?.[0] as Map<string, unknown> | undefined;
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || undefined);
  const ports = (ctn?.get('ports') as Map<string, unknown>[] | undefined)?.map(p => ({ name: String(p.get('name') ?? ''), port: num(p.get('port')) ?? 0, protocol: (String(p.get('protocol') ?? 'TCP') as 'TCP' | 'UDP') }));
  const env = (ctn?.get('env') as Map<string, unknown>[] | undefined)?.map(e => ({ key: String(e.get('name') ?? ''), value: String(e.get('value') ?? '') }));
  return {
    name: String(md?.get('name') ?? ''), namespace: String(md?.get('namespace') ?? 'default'),
    workloadType: type, replicas: num(spec?.get('replicas')) ?? 1,
    image: String(ctn?.get('image') ?? ''), ports: ports ?? [], env: env ?? [],
  };
}
```

(`yaml` 包的 Map/get 语义:node.toJS() 也可——实现时以测试通过为准,风格自定,但**接口签名不得偏离**。)

- [ ] **Step 4: 跑测试 + 提交**

Run: `cd k7s-frontend && pnpm vitest run src/components/wizard/workloadSpec.test.ts` → PASS。

```bash
cd k7s-frontend && git add src/components/wizard/workloadSpec.ts src/components/wizard/workloadSpec.test.ts
git commit -m "feat(wizard): workload form model, yaml generator and best-effort parse-back"
```

---

### Task 3: 向导组件(4 步 UI + 步骤校验 + OverlayKey)

**Files:**
- Create: `k7s-frontend/src/components/wizard/CreateWorkloadWizard.tsx`
- Create: `k7s-frontend/src/components/wizard/CreateWorkloadWizard.module.css`
- Create: `k7s-frontend/src/components/wizard/StepFields.tsx`(步骤 1/2/3 的表单片段,纯受控组件)
- Modify: `k7s-frontend/src/store/types.ts:64-81`(OverlayKey 加 `'wizard'`)
- Modify: `k7s-frontend/src/App.tsx`(lazy + overlayPanels 加 `wizard: CreateWorkloadWizard`)
- Modify: `src/lib/i18n/{dictionaries,en,zh}.ts`(wizard.* 词条,本任务加步骤框架部分,见 Step 3 词表)
- Test: `k7s-frontend/src/components/wizard/CreateWorkloadWizard.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `WorkloadForm/emptyWorkloadForm/validateWorkloadForm/generateWorkloadYaml`;store `openOverlay/closeOverlay`;`useTranslation`;既有 `componentUtils` 测试工具;onboarding 的多步对话框样式模式(`OnboardingWizard.tsx`)。
- Produces: `<CreateWorkloadWizard onClose />` 挂在 overlay `'wizard'`;`openOverlay('wizard')` 即打开(Task 4 接线)。

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '../../test/componentUtils'; // 按仓库实际工具
import { useStore } from '../../store';
import { CreateWorkloadWizard } from './CreateWorkloadWizard';

describe('CreateWorkloadWizard', () => {
  it('renders step 1 (basics) when opened', () => {
    useStore.setState({ overlay: 'wizard' });
    render(<CreateWorkloadWizard onClose={() => {}} />);
    expect(screen.getByText(/基本信息|Basics/i)).toBeTruthy();
    expect(screen.getByLabelText(/镜像|Image/i)).toBeTruthy();
  });
  it('next is disabled until name+image valid', () => {
    useStore.setState({ overlay: 'wizard' });
    render(<CreateWorkloadWizard onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /下一步|Next/i }).hasAttribute('disabled')).toBe(true);
  });
  it('reaches step 4 preview with generated yaml', async () => {
    useStore.setState({ overlay: 'wizard' });
    render(<CreateWorkloadWizard onClose={() => {}} />);
    // 按仓库工具填写:名称 nginx、镜像 nginx:1.27,连点下一步 3 次
    // 断言:出现 YAML 预览(CodeEditor 渲染的 .cm-editor)且包含 'kind: Deployment'
  });
});
```

(具体选择器按 `componentUtils` 能力适配;语言锁定 `language:'zh'` 后用中文断言,同 Sidebar.test 模式。)

- [ ] **Step 2: 确认失败** → Run: `pnpm vitest run src/components/wizard/CreateWorkloadWizard.test.tsx` → FAIL。

- [ ] **Step 3: 实现**

`store/types.ts` OverlayKey 增加 `| 'wizard'`。`App.tsx`:

```tsx
const CreateWorkloadWizard = lazy(() => import('./components/wizard/CreateWorkloadWizard').then((m) => ({ default: m.CreateWorkloadWizard })));
// overlayPanels 表加:
wizard: CreateWorkloadWizard,
```

组件骨架(步骤状态本地;`IPADOS_HIDDEN_OVERLAYS` 无需加——iPadOS 本就隐藏 templates,向导同样在 overlay 渲染处统一受既有逻辑管):

```tsx
export function CreateWorkloadWizard({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<WorkloadForm>(emptyWorkloadForm('deployment'));
  const set = <K extends keyof WorkloadForm>(k: K, v: WorkloadForm[K]) => setForm(f => ({ ...f, [k]: v }));
  const errs = validateWorkloadForm(form);
  const steps = [t('wizard.step.basics', 'Basics'), t('wizard.step.container', 'Container'), t('wizard.step.storage', 'Storage & Config'), t('wizard.step.review', 'Review & Apply')];
  // backdrop + dialog 结构照抄 OnboardingWizard(role=dialog aria-modal,Esc 关闭调 onClose)
  // stepper: ①②③④ 文案用 steps[step]
  // step 0: StepFields.Basics(name/namespace/workloadType/replicas/image/imagePullPolicy)
  // step 1: StepFields.Container(command/args/ports[]/env[]/resources/liveness/readiness —— 高级项 <details> 折叠)
  // step 2: StepFields.Mounts(mounts[]: pvcName/mountPath/readOnly)
  // step 3: 预览 + dry-run/apply(Task 4 实现,本任务先渲染只读预览 <CodeEditor value={generateWorkloadYaml(form)} editable={false} />)
  // footer: 上一步(step>0)/下一步(step<3,step 0 时 disabled={errs.length>0})/关闭
}
```

StepFields 导出三个片段组件,全部受控(`value: WorkloadForm` + `onChange(patch)`)。数组行(ports/env/mounts)用「+ 添加」按钮追加空行、每行尾部「×」删除,风格照 IngressEditor 的 rules 编辑。

词条(`wizard.step.*`、`wizard.field.*` 常用字段名、`wizard.next/prev/close`):zh = 基本信息/容器配置/存储与配置/预览与应用、下一步/上一步/关闭;字段 = 名称/命名空间/类型/副本数/镜像/拉取策略/命令/参数/端口/环境变量/CPU 请求/内存请求/CPU 上限/内存上限/就绪探针/存活探针/挂载 PVC/挂载路径/只读;en 对应 Basics 字段名。全部进三文件 Dictionary。

- [ ] **Step 4: 跑测试 + 全量 + 提交**

Run: `cd k7s-frontend && pnpm test && pnpm typecheck` → PASS。

```bash
cd k7s-frontend && git add -A src/components/wizard src/store/types.ts src/App.tsx src/lib/i18n
git commit -m "feat(wizard): 4-step create-workload wizard component (steps 1-3 forms + preview)"
```

(此命令 `git add -A` 仅限 wizard 新目录与列出文件;不得波及用户未提交改动——改为逐文件 add 更稳。)

---

### Task 4: 第 4 步 dry-run 把关 + apply + 入口接线

**Files:**
- Modify: `k7s-frontend/src/components/wizard/CreateWorkloadWizard.tsx`(step 3 → dry-run/apply 逻辑)
- Modify: `k7s-frontend/src/components/table/ResourceTable.tsx:344-356`(新建按钮分流)与 `:470-481`(空态 CTA → 'wizard')
- Modify: `k7s-frontend/src/components/dashboard/Dashboard.tsx:193-200`(快捷入口 → 'wizard')
- Modify: `src/lib/i18n/{dictionaries,en,zh}.ts`(wizard.dryrun/apply/ok/err 词条)
- Test: 向导测试追加 apply 流;`ResourceTable.test.tsx` 空态 CTA 断言改为 'wizard'

**Interfaces:**
- Consumes: `getProvider().dryRunYamlBundle(yaml): Promise<DocDryRun[]>`、`applyYamlBundle(yaml): Promise<ApplyResult[]>`(Task 1 修通);`src/components/templates/YamlReview.tsx`(按其现 props 复用:读文件确认签名);`sectionForKind`(lib/sections)。
- Produces: 完整创建链路;`openOverlay('wizard')` 为工作负载类创建的统一入口。

- [ ] **Step 1: 失败测试**

向导测试追加(mock provider):

```tsx
it('apply is gated on a clean dry-run', async () => {
  // 填表到 step 4 → 点「检查」(dry-run mock 返回 [{...error:'namespaces "x" not found'}])
  // 断言 Apply 按钮 disabled
  // mock 改为干净 [{error:null}] 重新检查 → Apply 可点 → 点击后调 applyYamlBundle 且 onClose
});
```

ResourceTable 空态 CTA 测试:断言点击后 `overlay === 'wizard'`(替换原 'templates' 断言)。

- [ ] **Step 2: 确认失败** → FAIL。

- [ ] **Step 3: 实现**

step 4 逻辑(模式对齐 TemplatePicker YAML-import 模式 154-210 行):

```tsx
const [dry, setDry] = useState<DocDryRun[] | null>(null);
const [stale, setStale] = useState(false);
const [applying, setApplying] = useState(false);
const yaml = useMemo(() => generateWorkloadYaml(form), [form]);
const [yamlDraft, setYamlDraft] = useState(yaml);   // 进入第 4 步时以生成值初始化(可改为 useEffect 同步一次)
// yaml 可编辑:<CodeEditor key={stale ? 's' : 'c'} value={yamlDraft} editable onChange={d => { setYamlDraft(d); setStale(true); setDry(null); }} />
// 「从 YAML 回填表单」按钮:parseWorkloadYaml(yamlDraft) 成功则 setForm(f => ({ ...f, ...parsed })),失败 toast t('wizard.parseFail', ...)
const check = async () => { setDry(await getProvider().dryRunYamlBundle(yamlDraft)); setStale(false); };
const clean = dry !== null && !stale && dry.every(d => !d.error);
const apply = async () => {
  setApplying(true);
  try { const r = await getProvider().applyYamlBundle(yamlDraft);
    // r 里 action==='failed' 的条目 toast error,否则 toast 成功并 onClose()
  } finally { setApplying(false); }
};
// Apply 按钮 disabled={!clean || applying}
```

入口分流(ResourceTable 344 行;IngressEditor 支持从空表单创建,只是此前无调用方——探索报告第 3 节):

```tsx
onClick={() =>
  openOverlay(
    nav === 'ingresses' ? 'ingress-editor'
    : sectionForKind(nav) === 'workloads' ? 'wizard'
    : 'templates'
  )
}
```

空态 CTA(478 行)与 Dashboard(197 行):`openOverlay('wizard')`。词条:zh 检查/应用/应用中/检查通过/有错误,从 YAML 回填表单/无法解析为工作负载;en 对应。

- [ ] **Step 4: 测试 + 全量 + 提交**

Run: `cd k7s-frontend && pnpm test && pnpm typecheck && pnpm test:e2e` → PASS。

```bash
cd k7s-frontend && git add <本任务文件>
git commit -m "feat(wizard): dry-run-gated apply + rewire create entries to the wizard"
```

---

### Task 5: e2e 扩展 + 收尾

**Files:**
- Modify: `k7s-frontend/e2e/p1-usability.spec.ts`(或新建 `e2e/p2-wizard.spec.ts`)
- Modify: `k7s-frontend/README.md`(创建向导一节)

- [ ] **Step 1: e2e 追加**(dev 模式无后端,MockProvider 生效——确认 mock 的 dryRun/applyBundle 返回;断言向导能走到第 4 步出现 YAML 预览即可,不要求 apply):

```ts
test('P2 wizard smoke', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('工作负载').click();
  await page.getByTestId('new-resource').click();
  await expect(page.getByText(/基本信息/)).toBeVisible();
  await page.getByLabel(/名称/).fill('e2e-demo');
  await page.getByLabel(/镜像/).fill('nginx:1.27');
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('button', { name: /下一步/ }).click();
  await expect(page.locator('.cm-content')).toContainText('kind: Deployment');
});
```

(选择器按实际 label 渲染调整;语言 zh 默认。)

- [ ] **Step 2: 全量验证 + README + 提交**

```bash
cd k7s-frontend && pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e
```

README「Features」加 Create-workload wizard 段(4 步、dry-run 把关、YAML 可编辑回填、入口位置)。

```bash
git add e2e README.md && git commit -m "test+docs: P2 wizard e2e smoke and README"
```

---

## 明确不做(本期)

- Service/ConfigMap/Secret 独立新表单——TemplatePicker 表单模式已覆盖且按当前 kind 预选,「新建」分流已把它们导向正确入口;Ingress 创建入口已在本期 Task 4 接线(路由到 IngressEditor 空表单)。
- 任意 YAML 的完整反向解析(只支持向导自身字段的尽力而为回填)。
- 桌面端 Tauri 命令改动(通道已有,零后端改动)。

## 风险与回退

- MockProvider 的 bundle mock 行为决定 e2e 上限——实现前先读 `mock/mockResources.ts` 确认返回形态。
- 每任务独立 commit,可单任务 revert。

---

## 执行结果(2026-08-19,P2 完成)

- 5 个任务全部完成,每任务独立实现+审查;Task 3 修 1 轮(边框令牌 + 探针 id);终审修复波 3 项(引号感知分词器 / 空 dry-run 门 / 路由按 kind 收窄)并复审通过。
- 分支 `feat/usability-p2`,a531883..7a2f90e,10 commits;全量 1188/1188 + typecheck + e2e 2/2。

### P2 遗留(P3 候选)

- 向导仅支持 Deployment/StatefulSet/DaemonSet;Job/CronJob 走 Templates(补向导支持)
- 成功提示复用 ErrorToast 样式(建议 Toast 加 kind 字段)
- --border-subtle 令牌在 HelmRollbackForm/AuditPanel/IngressEditor 无兜底使用(全局清理或定义令牌)
- 数字输入清空被强制回最小值;向导对话框嵌套在 overlay 壳内(外层 scrim 仅边缘可点)
- e2e 与 zh 文案耦合;检查/apply 的 e2e 快乐路径需要 VITE_DEMO Playwright project
- 回填只覆盖 name/ns/type/replicas/image/ports/env(删除 volumeMounts 后回填会复活表单字段)
