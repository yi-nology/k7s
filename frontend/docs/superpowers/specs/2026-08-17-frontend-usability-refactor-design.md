# k7s 前端易用性重构设计(Phase 0–5)

> 状态:待用户评审
> 范围:`k7s-frontend`(React 19 + Vite + Zustand + CodeMirror 6 + xterm 6)
> 基调:保留 2026-08 v2 视觉语言(tokens、布局骨架)不动,专注交互质量。

## 1. 背景与目标

前端功能已齐,但编辑类交互质量参差:YAML 编辑器缺搜索/折叠/校验,终端只有 fit
插件,PodFiles 与 Helm values 用裸 textarea,切换资源会静默丢弃未保存草稿,表单
无共享原语、校验时机不一。本次重构目标:

1. **一个编辑内核**:所有文本编辑面(YAML、Helm values、PodFiles、模板)统一走
   `EditorCore`,能力对齐 VSCode 基线(搜索、折叠、lint、格式化、快捷键)。
2. **一套编辑契约**:统一的 dirty 跟踪、未保存离开保护、即时校验、`⌘S` 保存。
3. **一组表单原语**:Dialog/ConfirmDialog/Field 等共享组件,替换 inline style 与
   原生控件,校验从"提交时报错"改为"输入时反馈"。
4. **终端补齐专业能力**:搜索、链接点击、剪贴板、字号/scrollback 可配、常驻工具栏。
5. **日志与布局收尾**:换行开关、级别过滤、虚拟化;面板拖宽;快捷键速查。

### 非目标

- 不改 v2 视觉 tokens、不改整体布局骨架(sidebar | topbar | content | statusbar)。
- 不引入 UI 框架(继续 CSS Modules + tokens)。
- Helm 安装向导的 manifest 渲染预览需要后端 `helm template` 能力,本期不做(后端
  支持后另立故事)。
- k8s 字段 schema 自动补全(YAML completion)作为 Phase 1 后置增强,不阻塞主线。

## 2. 现状诊断摘要

| 问题 | 位置 |
|---|---|
| CodeMirror 无 search/folding/lint/bracketMatching/indentOnInput,字号硬编码 11.5px | `detail/CodeEditor.tsx` |
| xterm 仅 fit addon;字号 12 硬编码;scrollback 默认 1000 不可配;无搜索/链接/剪贴板 | `detail/useTerminal.ts`、`ShellTab.tsx`、`NodeShellTab.tsx` |
| `LOG_RESET_PATCH` 在 selectRow/setActiveTab/closeTab/jump 时静默清空 yamlDraft | `store/detailPanelSlice.ts` |
| PodFiles 用裸 textarea,无语法高亮/行号/搜索;切换文件、关 overlay 均无脏数据保护;无二进制检测 | `podfiles/PodFilesPanel.tsx` |
| Helm values 用裸 textarea;校验只在 install 时汇总报错 | `helm/HelmInstallWizard.tsx` |
| IngressEditor 660 行全 inline style;校验 apply 时才做;`Number()||80` 静默兜底 | `ingress/IngressEditor.tsx` |
| `common/` 只有 ErrorToast;无共享 Dialog/Field;Helm 仓库删除用原生 `confirm()` | `common/`、`helm/HelmMarket.tsx` |
| Logs 无换行开关、无级别过滤、无虚拟化;`logSearch` 每次重置 | `detail/LogsTab.tsx` |
| DetailPanel 固定 48% 宽不可拖;快捷键无处发现 | `detail/DetailPanel.tsx`、`hooks/useGlobalKeys.ts` |

**保留的优点**(重构中不动):dry-run → diff 审查 → apply 门禁;终端与会话分离
生命周期(重连保 scrollback);scoped token 双主题;命令面板与表格 vim 导航。

## 3. 总体架构

### 3.1 新目录与组件

```
src/components/editor/           # Phase 0 新建
├── EditorCore.tsx               # 增强版 CodeMirror 封装(替代 detail/CodeEditor.tsx)
├── EditorToolbar.tsx            # 编辑器统一工具栏
├── yamlLint.ts                  # 客户端 YAML lint(解析错误 → CodeMirror diagnostics)
└── EditorCore.test.tsx / yamlLint.test.ts

src/components/common/           # Phase 0 扩充
├── Dialog.tsx                   # 模态壳:焦点圈定、Esc、backdrop、尺寸档位
├── ConfirmDialog.tsx            # 危险/丢弃确认(替换原生 confirm)
├── Field.tsx                    # 字段壳:label、说明、错误文案即时显示
├── FormControls.tsx             # TextInput / NumberInput(带 clamp)/ Select / Toggle
└── *.module.css                 # 全部走 tokens,复用 shared.module.css 变量
```

### 3.2 新依赖

| 包 | 用途 |
|---|---|
| `@codemirror/search` | 编辑器搜索/替换(⌘F/⌘⇧F) |
| `@codemirror/lint` | lint gutter 与诊断渲染 |
| `@codemirror/autocomplete` | Phase 1 后置的键名补全 |
| `yaml` | 客户端 YAML 解析(lint、格式化),k8s 生态标准库 |

不引入 `@xterm/addon-clipboard`(遗留 Edge 方案);剪贴板用
`attachCustomKeyEventHandler` + `navigator.clipboard` 自实现。

### 3.3 设置新增(`lib/settings.ts`)

```ts
interface Settings {
  // …现有字段不动…
  editorFontSize: number;      // 默认 12,clamp 9–18(LIMITS 增加条目)
  terminalFontSize: number;    // 默认 12,clamp 9–18
  terminalScrollback: number;  // 默认 5000,clamp 1000–50000
}
```

`sanitizeSettings` 同步增加三个字段的 clamp;Settings 面板重组为分组:外观 /
终端(shellCommand、nodeShellImage、terminalFontSize、terminalScrollback)/
日志 / 扫描 / AI。

## 4. Phase 0 — 共享编辑内核与表单原语

### 4.1 EditorCore

在现 `CodeEditor` 基础上扩展(保留:Compartment 主题热切、remount-by-key 策略、
CSS 变量取色):

```ts
interface EditorCoreProps {
  value: string;                       // 初始文档(uncontrolled,同现策略)
  language: 'yaml';                    // 预留 'json'
  editable: boolean;
  fontSize?: number;                   // 缺省读 settings.editorFontSize
  wrap?: boolean;                      // 缺省 true;>5000 行自动关并提示
  onChange?(text: string): void;       // 每次编辑
  onSave?(text: string): void;         // ⌘S/⌃S(editable 时启用)
  onDirtyChange?(dirty: boolean): void;// doc !== 初始 value 时上报
  onViewReady?(view: EditorView): void;
}
```

扩展列表:`@codemirror/search` 全套、`codeFolding`、`foldGutter`、
`bracketMatching`、`indentOnInput`、`highlightActiveLine`、`@codemirror/lint`
接 `yamlLint`(仅 editable 时启用 lint;只读视图仍要搜索/折叠)。
`⌘S` 用 `Prec.highest` 的 keymap 拦截,阻止浏览器默认。

迁移:`YamlTab`、`templates/TemplatePicker` 切换到 `EditorCore`;
`detail/CodeEditor.tsx` 删除,其测试迁到 `EditorCore.test.tsx`。

### 4.2 yamlLint

`yaml` 包 `parseDocument` 捕获 `YAMLParseError`(含 line/col 与
`pos:[start,end]`)→ `Diagnostic[]`(error 级)。附两条 k8s 启发式(可增量):
- 值为 `"3"`、`"true"` 这类字符串包数字/布尔 → warning("应为数字/布尔")。
- 顶层缺 `apiVersion`/`kind`/`metadata` → warning。

lint 只做提示,不阻塞 Preview(dry-run 门禁才是权威)。

### 4.3 EditorToolbar

按钮:格式化(整理缩进/排序 key 关闭,仅重排缩进与空行)、复制全文、
⌕ 搜索(触发 CodeMirror search panel)、字号 A−/A+、换行切换。
Props:`{ fontSize, wrap, onFontSize, onWrap, onCopy, onFormat? }`。
只读视图显示其中可用子集。所有按钮走 `title` + `aria-label`(i18n)。

### 4.4 表单原语

- `Dialog`:portal 到 body;焦点圈定(Tab 循环)、初始焦点、Esc、backdrop 点击
  可配置是否关闭;尺寸 sm/md/lg;复用 scrim token。
- `ConfirmDialog`:`{ title, body, confirmLabel, danger?, onConfirm, onCancel }`,
  danger 时确认按钮走 `--danger`。
- `Field`:`{ label, hint?, error?, children }`,错误文案红字常驻于字段下。
- `NumberInput` 受控 clamp(onBlur 落定,不打断输入)、`Select` 走统一样式。

现有 Settings modal、overlay 的 Esc/backdrop 逻辑不动;新组件只服务新迁移面,
避免一次性返工全部 overlay。

## 5. Phase 1 — YAML 编辑重构

### 5.1 布局:编辑态双栏

```
┌ pods/default/nginx-7d8f.yaml        ● 未保存            [+3 −1] ┐
│ [预览 ⌘S] [取消]        格式化 ⤢ ⌕ Aa 12px                       │
├────────────────────────────────┬─────────────────────────────────┤
│ 1  apiVersion: v1              │ 变更 (+3 −1)  ← 本地/服务端 diff │
│ 2  kind: Pod                   │ − spec.replicas: 2              │
│ 3  metadata:                   │ + spec.replicas: 3              │
│ 4  spec:                       │                                 │
│ ⚠5  replicas: "3"              │ [返回编辑] [应用 ⌘⏎]             │
└────────────────────────────────┴─────────────────────────────────┘
```

- 编辑态:左侧 `EditorCore`(宽 ~62%),右侧**实时本地 diff**(防抖 300ms,
  `lib/diff` 现有 LCS),只显示变更 hunk;Preview(dry-run)成功后右侧切换为
  服务端 diff(现 DiffView 逻辑),并出现"应用 ⌘⏎"。
- diff 视图(本地或服务端)点击行 → 编辑器 `dispatch`Selection 跳到对应行并
  高亮;服务端 diff 行号来自 `YamlDiff.current`,需映射(见 5.4)。
- 工具栏 dirty 指示:`● 未保存`(黄点)/ 无变更时灰字"无修改";Preview 按钮
  在 dirty=false 时禁用。
- `⌘S` = Preview,`⌘⏎` = 应用(仅 review 态可用)。只读态 `⌘C` 复制全文。

### 5.2 草稿保护(store 改动,核心)

`detailPanelSlice` 现状:`LOG_RESET_PATCH` 在 selectRow/setActiveTab/close/jump
时清 `yamlEditing/yamlDraft`。改为**守卫 + 确认**:

```ts
// 新增 state
yamlBase: string;                  // startYamlEdit(text) 时记录,脏判定基准
pendingDetail: DetailIntent | null; // 被拦截的导航意图

type DetailIntent =
  | { type: 'select'; row: Row }
  | { type: 'tab'; tab: DetailTab }
  | { type: 'closeTab'; uid: string }
  | { type: 'closePanel' }
  | { type: 'jump'; kind: KindId; row?: Row };

const isYamlDirty = (s) => s.yamlEditing && s.yamlDraft !== s.yamlBase;
```

- `selectRow/setActiveTab/closeDetailTab/closePanel/jump` 先查 `isYamlDirty`:
  脏 → 写 `pendingDetail` 直接 return(不应用任何变更);干净 → 原逻辑。
- 新增 actions:`confirmPendingDetail()`(重放 intent + `logResetPatch()`)、
  `cancelPendingDetail()`。
- App 级 `<EditGuardDialog />`(ConfirmDialog,danger 语义:"放弃未保存的修改?")
  挂在 pendingDetail 非空时;Esc = 取消守卫(留在编辑态)。
- `logSearch/containerIndex` 等 log 字段仍随重置,不受守卫影响。
- Palette 跳转(`jump`)同受守卫;表格选中另一行时行高亮先变会被守卫拦住,
  因此守卫发生在 store,表格状态一致。

### 5.3 错误处理

- 客户端 lint 错误:行内标记 + 悬停;Preview 不被阻塞,但 review 前若 lint 有
  error 级诊断,Preview 按钮角标提示数量。
- dry-run / apply 失败:沿用现 inline error 条 + 草稿保留;错误条可复制。

### 5.4 后置增强(不阻塞)

- k8s 键名补全:`@codemirror/autocomplete` + 内置常见字段表(apiVersion/kind/
  metadata/spec 顶层 + 常用 workload 字段),静态数据不依赖后端。
- 服务端 diff 行映射:`dryRunYaml` 返回行号若与文本对齐,可精确跳转;先用本地
  diff 行号兜底。

## 6. Phase 2 — 终端重构

### 6.1 工具栏(常驻)

```
┌ ● 已连接  容器: main ▾  A− 12 A+  ⌕  清屏  ↻ 重连 ┐
```

- 状态点:connecting(黄脉冲)/ live(绿)/ ended(灰),含 title 说明。
- 容器下拉:`Select` 原语(替换原生 `<select>`;单容器时隐藏,与现状一致)。
- `A−/A+`:步进 1,clamp 9–18,写 `settings.terminalFontSize`(持久化)。
- `⌕`:`addon-search` 的 `showSearchBar`(自带 UI,Esc 关闭)。
- 清屏:`term.clear()`,语义对齐 shell `clear`(提示行回到首行;不提供
  `reset()`,避免误触重置整个会话)。
- `↻ 重连`:常驻可用(现仅 ended 后出现);连接中禁用。重连仍写
  `── reconnecting ──` 分隔线并保留 scrollback。
- NodeShellTab 复用同一工具栏(无容器下拉,多"结束会话"按钮);其 consent
  门禁流程不动。

### 6.2 插件与剪贴板

- `addon-search`、`addon-web-links`(URL 可点击)。
- 剪贴板:`attachCustomKeyEventHandler` 拦 `⌘C/⌘⇧C`(有选区 →
  `navigator.clipboard.writeText(term.getSelection())`)与 `⌘V`(readText →
  `h.input`);Ctrl+Shift+V 同理。右键:有选区复制、无选区粘贴。
- `useTerminal` 增加 props:`{ fontSize, scrollback }` 从 settings 读,字号变更
  热更新(`term.options.fontSize`),不重建终端(保 scrollback)。

### 6.3 设置

Settings 新"终端"分组:`shellCommand`(迁入)、`terminalFontSize`、
`terminalScrollback`、`nodeShellImage`(迁入)。scrollback 变更提示"新会话生效"。

## 7. Phase 3 — 表单系统迁移

### 7.1 编辑面统一到 EditorCore

- **PodFiles**(`podfiles/PodFilesPanel.tsx`):
  - textarea → `EditorCore`。语言按扩展名判断:`.yml/.yaml` 启用 yaml 高亮 +
    lint;`.json/.conf/.properties/.toml` 等仅行号 + 搜索;其余纯文本走
    EditorCore 的无语言模式(能力仍完整:搜索、折叠禁用、⌘S)。
  - 二进制/大文件守卫:后端返回内容前 8KB 含 NUL 或扩展名在二进制白名单 →
    只读提示 + 仅下载;>1MB 拒编辑(可下载)。
  - 脏保护:切换左侧文件、Up 导航、关闭 overlay(Esc/backdrop)前,dirty 则弹
    `ConfirmDialog`。App 的 overlay 关闭需可被面板拦截:overlayPanels 增加可选
    `shouldConfirmClose()`,App 在 Esc/backdrop 时询问。
- **Helm values**(`HelmInstallWizard.tsx` 步骤 2):textarea → `EditorCore`
  (yaml lint 即时报错);release name/namespace 字段在步骤 1 即时校验
  (`Field` + 现有 `isValidHelmReleaseName/isValidNamespace`),不合格时
  Review 按钮禁用并标错,替代 install 时汇总失败。
  `isSafeHelmValues` 保留为提交前最后防线。
- **TemplatePicker**:迁移到 `EditorCore`(行为等价,获得搜索/折叠)。

### 7.2 IngressEditor 重写

- 拆分:`BasicSection / TlsSection / RulesSection / AnnotationsSection` 子组件
  + CSS module(去 inline style)。
- 字段即时校验:host 格式、path 前缀 `/`、端口 1–65535(`NumberInput` clamp,
  移除 `Number()||80`)、k8s 名称/命名空间规则;错误文案中英双语。
- Form↔YAML 切换保留;YAML 面用 EditorCore。apply 前校验全部通过才可点。

### 7.3 零散统一

- Helm 仓库删除、其余原生 `confirm()` → `ConfirmDialog`。
- `AlertsPanel` 静默表单 inline style → CSS module + Field;duration clamp。
- 端口转发表单:空输入不再静默变 1,标"必填";范围外即时红字。
- Scale 表单维持(现 clamp 行为合理),仅换 `NumberInput` 外观。

## 8. Phase 4 — 日志与列表微调

- **换行开关**:工具栏 toggle,默认开;关时横向滚动。与 `wrap` 一致的图标语言。
- **级别过滤**:chips 行 ALL/INFO/WARN/ERROR/DEBUG(客户端按现有着色正则归类,
  未识别归 ALL);多选;空结果提示。过滤只影响渲染,不清 buffer。
- **虚拟化**:LogRow 列表接 `lib/virtual`(行高固定,wrap 开启时按最长行预算
  或退化为不虚拟化——wrap+虚拟化冲突时优先正确性,仅 nowrap+大 buffer 时启用)。
- 过滤器语法提示:表格过滤输入框 placeholder 展示 `key=value 或关键字`,
  focus 时下拉说明(轻量 tooltip 即可)。
- `logSearch` 重置行为维持(会话级搜索语义)。

## 9. Phase 5 — 布局收尾

- **DetailPanel 拖宽**:面板左缘 6px 拖柄(cursor: col-resize),范围
  320px–视口 70%;宽度持久化到 settings(新 `detailWidthPct`,clamp 25–70)。
  拖动中禁用文本选择;双击复位 48%。
- **快捷键速查**:`?`(及 palette 内入口)打开 overlay,分组列出全局键、表格
  键、编辑器键、终端键;数据驱动(`lib/keymapDocs.ts`),zh/en 词典化。
- **关闭符统一**:全部 close affordance 统一 `✕`(lucide `X` size 14)。

## 10. 数据流与状态总览

```
EditorCore(局部 doc)─onChange→ yamlDraft ──脏判定 yamlDraft≠yamlBase──→ 守卫
                                │                            │
                 ⌘S→ dryRunYaml(服务端)                 pendingDetail+ConfirmDialog
                                │                            │
                    YamlDiff(review 态)              confirm→重放 intent+reset
                                │
                 ⌘⏎→ applyYaml → 重取 canonical YAML
```

- 编辑器文档始终 uncontrolled(remount-by-key),React 不持有 doc;draft 只在
  store 存字符串用于脏判定与提交,不回写编辑器。
- 终端:settings(fontSize/scrollback)→ `useTerminal` 热应用;会话句柄仍在
  组件局部(现状不变)。
- PodFiles 脏状态:组件局部(useState),不进全局 store(作用域仅 overlay 内)。

## 11. 错误处理原则

1. 客户端校验(lint/Field)是提示,服务端(dry-run/apply)是门禁,二者共存。
2. 任何提交失败保留用户输入,错误 inline 展示且可复制。
3. 守卫对话框只拦"会丢数据"的路径(草稿/脏文件),不做无谓打扰。

## 12. 测试策略

- 单元:`yamlLint`(解析错误定位、启发式)、dirty 守卫 slice(select/tab/close/
  jump × 脏/干净 × confirm/cancel)、settings 新字段 sanitize、`NumberInput`
  clamp、diff 行跳转映射。
- 组件:EditorCore(搜索面板挂载、⌘S 回调、只读无 lint)、EditorToolbar、
  ConfirmDialog 焦点圈定、EditGuardDialog 交互、终端工具栏(jsdom 下 xterm mock)。
- e2e(Playwright,沿用 demo provider):YAML 编辑→预览→diff→应用主路径;
  脏守卫弹窗确认/取消;PodFiles 脏保护;终端工具栏渲染与字号持久化。
- 全程 `pnpm test` / `pnpm lint` / `pnpm typecheck` 保持绿;每个 Phase 结束跑
  全量 e2e。

## 13. i18n

新增 key 集中在 `yaml.*`(未保存、返回编辑、应用快捷键提示)、`shell.*`
(工具栏 aria)、`files.*`(二进制/过大提示、脏确认)、`helm.*`(字段校验)、
`ingress.*`(字段校验)、`common.*`(确认/取消/放弃)、`settings.terminal*`、
`shortcuts.*`。zh/en 同步补齐,沿用 `t(key, fallback)` 模式。

## 14. 实施顺序与验收

| Phase | 内容 | 验收标准 |
|---|---|---|
| 0 | EditorCore + 原语 | YamlTab/TemplatePicker 已迁移;⌘F 可用;旧 CodeEditor 删除 |
| 1 | YAML 重构 | 双栏+本地 diff;lint 即时;脏守卫覆盖 select/tab/close/jump/palette;⌘S/⌘⏎ |
| 2 | 终端 | 搜索/链接/剪贴板/字号/清屏/常驻重连;设置分组;scrollback 可配 |
| 3 | 表单 | PodFiles/Helm/Ingress 全迁;无原生 confirm;无裸 textarea 编辑面 |
| 4 | 日志 | wrap toggle/级别过滤/大 buffer 虚拟化 |
| 5 | 布局 | 面板拖宽持久化;`?` 速查;✕ 统一 |

依赖:Phase 1/2/3 均依赖 Phase 0;3、4 可并行;5 收尾。
