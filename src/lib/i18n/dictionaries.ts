/**
 * The i18n dictionaries for every locale the app ships.
 *
 * Keys are namespaced with a dot (`chrome.settings.title`) so the message
 * catalogue stays grep-able as it grows. Two locales only today, but the shape
 * is fixed: any new language is a new dictionary file plus a one-line entry in
 * `index.ts`. Anything missing from a dictionary falls back to English rather
 * than to a blank string — the worst case is a half-translated button, not a
 * blank one.
 *
 * `Parameters` is a free-form record of `{ name: value }` placeholders resolved
 * at render time. Strings use `{name}` syntax; values are coerced through
 * `String()` so a count or a name works without ceremony.
 */

export type Parameters = Record<string, string | number>;

export interface Dictionary {
  chrome: {
    /** Generic chrome — close buttons, reset/save notes, etc. */
    common: {
      close: string;
      cancel: string;
      apply: string;
      confirm: string;
      back: string;
      loading: string;
      dismiss: string;
    };
    settings: {
      title: string;
      footerNote: string;
      reset: string;
    };
    sidebar: {
      settings: string;
      watch: (n: number) => string;
      noKinds: string;
      filterKinds: string;
      importKubeconfig: string;
      noContexts: string;
    };
    topbar: {
      nsPrefix: string;
    };
    statusbar: {
      api: (ms: number | null) => string;
      nodes: (ready: number, total: number) => string;
      cpu: (pct: number | null) => string;
      mem: (pct: number | null) => string;
      kubectlCtx: (ctx: string | null) => string;
    };
    forwards: {
      label: string;
      copyAddress: string;
      stopForward: string;
      podTarget: (ns: string, pod: string, port: number) => string;
      serviceTarget: (ns: string, svc: string, port: number, pod: string, remote: number) => string;
    };
    palette: {
      placeholder: string;
      nothingMatches: string;
      typeToSearch: string;
      move: string;
      open: string;
      escClose: string;
    };
  };

  /** Settings panel rows and their option lists. */
  settings: {
    theme: { label: string; hint: string; system: string; dark: string; light: string };
    language: { label: string; hint: string; en: string; zh: string };
    logBuffer: { label: string; hint: (min: number, max: number) => string };
    metricsPoll: { label: string; hint: (min: number, max: number, applies: boolean) => string };
    statusPoll: { label: string; hint: (min: number, max: number, applies: boolean) => string };
    defaultNamespace: { label: string; hint: string; placeholder: string };
    shellCommand: { label: string; hint: string; placeholder: string };
    nodeShellImage: { label: string; hint: string; placeholder: string };
  };

  /** Detail panel — tabs, header meta, common buttons. */
  detail: {
    tabs: { logs: string; properties: string; metrics: string; shell: string; yaml: string; events: string };
    header: {
      kind: string;
      ns: string;
      node: string;
      age: string;
      closeTitle: string;
      actionsTitle: string;
    };
    drain: {
      pdbBlocked: (n: number, names: string) => string;
    };
  };

  /** Resource table chrome. */
  table: {
    filterPlaceholder: string;
    empty: string;
  };

  /** The shared action list and its confirmation wording. */
  actions: {
    labels: {
      viewPods: string;
      forward: string;
      scale: string;
      restart: string;
      cordon: string;
      uncordon: string;
      drain: string;
      delete: string;
    };
    confirm: {
      delete: (what: string, names: string) => string;
      restartPods: (what: string, names: string) => string;
      restartWorkload: (what: string, names: string) => string;
      drain: (what: string) => string;
      cordon: (what: string, names: string) => string;
      uncordon: (what: string, names: string) => string;
      generic: (id: string, what: string, names: string) => string;
    };
    scope: (n: number, what: string) => string;
    scaleForm: { title: (name: string) => string };
    forwardForm: {
      titlePod: string;
      titleService: string;
      apply: string;
    };
    bulk: { allFailed: (n: number, list: string) => string; partial: (ok: number, failed: number, list: string) => string };
  };

  /** Tab-specific UI strings (subset that's not already in chrome.*). */
  logs: {
    filterPlaceholder: string;
    container: string;
    ts: string;
    previous: string;
    saveTitle: string;
    save: string;
    pause: string;
    follow: string;
    streaming: string;
    paused: string;
    previousContainer: string;
    sinceAll: string;
    sinceLast: (s: string) => string;
    howFarBack: string;
    previousTitle: string;
    saveInProgress: string;
    saved: (n: number) => string;
    saveFailed: (e: string) => string;
    containerAll: string;
  };
  properties: { loading: string };
  events: { loading: string; hint: string };
  metrics: {
    waitingSamples: string;
    noMetrics: (name: string) => string;
    cpuTitle: (pct: string) => string;
    memTitle: (used: string, total: string, pct: string) => string;
    netTitle: (rx: string, tx: string) => string;
    loadTitle: (l1: string, l5: string, l15: string) => string;
    filesystemsTitle: (n: number) => string;
  };
  podMetrics: {
    waitingSamples: string;
    cpuTitle: (cpu: string, suffix: string) => string;
    memTitle: (mem: string, suffix: string) => string;
    reqCpu: (v: string) => string;
    limitCpu: (v: string) => string;
    reqMem: (v: string) => string;
    limitMem: (v: string) => string;
  };
  shell: {
    container: string;
    reconnectTitle: string;
  };
  nodeShell: {
    title: (node: string) => string;
    body: (node: string) => string;
    podDeletedOnClose: string;
    expiresAfterHour: string;
    changesAreReal: string;
    endTitle: string;
    backTitle: string;
  };
  yaml: {
    edit: string;
    cancel: string;
    backToEditing: string;
    applyForReal: string;
    preview: string;
    checking: string;
    noChanges: string;
    diffNote: string;
  };
}

/** English (default). */
export const en: Dictionary = {
  chrome: {
    common: {
      close: "close",
      cancel: "Cancel",
      apply: "Apply",
      confirm: "Confirm",
      back: "Back",
      loading: "loading…",
      dismiss: "dismiss",
    },
    settings: {
      title: "Settings",
      footerNote: "changes save automatically",
      reset: "reset to defaults",
    },
    sidebar: {
      settings: "settings",
      watch: (n) => `watch: ${n} streams active`,
      noKinds: "no kinds match",
      filterKinds: "filter kinds…",
      importKubeconfig: "Import kubeconfig…",
      noContexts: "no contexts",
    },
    topbar: {
      nsPrefix: "ns:",
    },
    statusbar: {
      api: (ms) => (ms == null ? "api: —" : `api: ${ms}ms`),
      nodes: (ready, total) => `nodes ${ready}/${total} ready`,
      cpu: (pct) => (pct == null ? "cpu —" : `cpu ${pct}%`),
      mem: (pct) => (pct == null ? "mem —" : `mem ${pct}%`),
      kubectlCtx: (ctx) => `kubectl ctx: ${ctx ?? "—"}`,
    },
    forwards: {
      label: "forwards:",
      copyAddress: "copy address",
      stopForward: "stop forward",
      podTarget: (ns, pod, port) => `${ns}/pod ${pod}:${port}`,
      serviceTarget: (ns, svc, port, pod, remote) =>
        `${ns}/service ${svc}:${port} → pod ${pod}:${remote}`,
    },
    palette: {
      placeholder: "go to a kind, an object, or a command…    ns:prod to scope",
      nothingMatches: "nothing matches",
      typeToSearch: "type to search",
      move: "↑↓ move",
      open: "⏎ open",
      escClose: "esc close",
    },
  },

  settings: {
    theme: {
      label: "Theme",
      hint: "“system” follows your desktop’s light/dark setting",
      system: "system",
      dark: "dark",
      light: "light",
    },
    language: {
      label: "Language",
      hint: "switches the UI language; takes effect immediately",
      en: "English",
      zh: "中文",
    },
    logBuffer: {
      label: "Log buffer",
      hint: (min, max) =>
        `lines kept in the log view (${min}–${max}); applies immediately`,
    },
    metricsPoll: {
      label: "Metrics poll",
      hint: (min, max, applies) =>
        `seconds between CPU/MEM polls (${min}–${max})${applies ? " — applies on next connect" : ""}`,
    },
    statusPoll: {
      label: "Status poll",
      hint: (min, max, applies) =>
        `seconds between cluster-status polls (${min}–${max})${applies ? " — applies on next connect" : ""}`,
    },
    defaultNamespace: {
      label: "Default namespace",
      hint: "selected on connect; “all” for no filter",
      placeholder: "all",
    },
    shellCommand: {
      label: "Shell command",
      hint: "blank uses bash if present, else sh; applies to the next shell",
      placeholder: "(auto: bash or sh)",
    },
    nodeShellImage: {
      label: "Node shell image",
      hint: "blank uses nicolaka/netshoot; must be multi-arch on a mixed-arch cluster",
      placeholder: "(nicolaka/netshoot)",
    },
  },

  detail: {
    tabs: {
      logs: "Logs",
      properties: "Properties",
      metrics: "Metrics",
      shell: "Shell",
      yaml: "YAML",
      events: "Events",
    },
    header: {
      kind: "kind",
      ns: "ns",
      node: "node",
      age: "age",
      closeTitle: "close",
      actionsTitle: "actions",
    },
    drain: {
      pdbBlocked: (n, names) =>
        `${n} pod${n > 1 ? "s" : ""} held by a PodDisruptionBudget — they need more replicas elsewhere, or the budget relaxed: ${names}`,
    },
  },

  table: {
    filterPlaceholder: "filter…",
    empty: "no resources match filter",
  },

  actions: {
    labels: {
      viewPods: "View pods",
      forward: "Forward…",
      scale: "Scale…",
      restart: "Restart…",
      cordon: "Cordon",
      uncordon: "Uncordon",
      drain: "Drain…",
      delete: "Delete…",
    },
    confirm: {
      delete: (what, names) => `Delete ${what}?${names}`,
      restartPods: (what, names) =>
        `Restart ${what}?${names} Deletes the ${names ? "pods" : "pod"}; ${names ? "their controllers recreate them" : "its controller recreates it"}.`,
      restartWorkload: (what, names) =>
        `Restart ${what}?${names} Rolls every pod (kubectl rollout restart).`,
      drain: (what) =>
        `Drain ${what}? This cordons it and evicts every pod on it (DaemonSet and static pods stay).`,
      cordon: (what, names) => `Cordon ${what}?${names}`,
      uncordon: (what, names) => `Uncordon ${what}?${names}`,
      generic: (id, what, names) => `${id} ${what}?${names}`,
    },
    scope: (n, what) => `${n} ${what} selected`,
    scaleForm: { title: (name) => `Replicas for ${name}` },
    forwardForm: { titlePod: "Forward pod port", titleService: "Forward service port", apply: "Forward" },
    bulk: {
      allFailed: (n, list) => `all ${n} failed — ${list}`,
      partial: (ok, failed, list) => `${ok} succeeded, ${failed} failed — ${list}`,
    },
  },

  logs: {
    filterPlaceholder: "filter logs…",
    container: "container",
    ts: "ts",
    previous: "↺ previous",
    saveTitle: "save the full log to a file",
    save: "save",
    pause: "⏸ pause",
    follow: "▶ follow",
    streaming: "● streaming",
    paused: "⏸ paused",
    previousContainer: "↺ previous container",
    sinceAll: "all time",
    sinceLast: (s) => `last ${s}`,
    howFarBack: "how far back to read",
    previousTitle: "read the previous container — what it printed before it died",
    saveInProgress: "saving…",
    saved: (n) => `saved ${n} lines`,
    saveFailed: (e) => `save failed: ${e}`,
    containerAll: "(all)",
  },
  properties: { loading: "loading properties…" },
  events: { loading: "loading events…", hint: "see Cluster → Events for the live feed" },
  metrics: {
    waitingSamples: "waiting for the first samples…",
    noMetrics: (name) => `no metrics for ${name}`,
    cpuTitle: (pct) => `CPU — ${pct}% busy`,
    memTitle: (used, total, pct) => `Memory — ${used} of ${total} (${pct})`,
    netTitle: (rx, tx) => `Network — ↓ ${rx}  ↑ ${tx}`,
    loadTitle: (l1, l5, l15) => `Load — ${l1} / ${l5} / ${l15}`,
    filesystemsTitle: (n) => `Filesystems (${n})`,
  },
  podMetrics: {
    waitingSamples: "waiting for the first samples…",
    cpuTitle: (cpu, suffix) => `CPU — ${cpu}${suffix}`,
    memTitle: (mem, suffix) => `Memory — ${mem}${suffix}`,
    reqCpu: (v) => `req ${v}`,
    limitCpu: (v) => `limit ${v}`,
    reqMem: (v) => `req ${v}`,
    limitMem: (v) => `limit ${v}`,
  },
  shell: { container: "container", reconnectTitle: "start a new session" },
  nodeShell: {
    title: (node) => `Root shell on ${node}`,
    body: (node) =>
      `This starts a privileged pod on ${node} and enters the host's PID, mount, and network namespaces — root on the underlying node.`,
    podDeletedOnClose: "The pod is deleted when you close the session.",
    expiresAfterHour:
      "It also expires on its own after an hour, so it can't outlive k7s if something crashes.",
    changesAreReal: "Anything you change on the node is real and is not tracked by Kubernetes.",
    endTitle: "end the session and delete the pod",
    backTitle: "back to the start screen",
  },
  yaml: {
    edit: "✎ Edit",
    cancel: "Cancel",
    backToEditing: "Back to editing",
    applyForReal: "Apply for real",
    preview: "Preview changes ⏎",
    checking: "Checking…",
    noChanges: "No changes — the server would store this object exactly as it is now.",
    diffNote: "as the server would store it, after defaulting and any mutating webhooks",
  },
};

/** Simplified Chinese. */
export const zh: Dictionary = {
  chrome: {
    common: {
      close: "关闭",
      cancel: "取消",
      apply: "应用",
      confirm: "确认",
      back: "返回",
      loading: "加载中…",
      dismiss: "忽略",
    },
    settings: {
      title: "设置",
      footerNote: "修改自动保存",
      reset: "恢复默认",
    },
    sidebar: {
      settings: "设置",
      watch: (n) => `监听: ${n} 路活跃`,
      noKinds: "无匹配类型",
      filterKinds: "过滤类型…",
      importKubeconfig: "导入 kubeconfig…",
      noContexts: "无 context",
    },
    topbar: {
      nsPrefix: "命名空间:",
    },
    statusbar: {
      api: (ms) => (ms == null ? "api: —" : `api: ${ms}ms`),
      nodes: (ready, total) => `节点 ${ready}/${total} 就绪`,
      cpu: (pct) => (pct == null ? "cpu —" : `cpu ${pct}%`),
      mem: (pct) => (pct == null ? "mem —" : `mem ${pct}%`),
      kubectlCtx: (ctx) => `kubectl ctx: ${ctx ?? "—"}`,
    },
    forwards: {
      label: "端口转发:",
      copyAddress: "复制地址",
      stopForward: "停止转发",
      podTarget: (ns, pod, port) => `${ns}/pod ${pod}:${port}`,
      serviceTarget: (ns, svc, port, pod, remote) =>
        `${ns}/service ${svc}:${port} → pod ${pod}:${remote}`,
    },
    palette: {
      placeholder: "跳转到类型、对象或命令…    ns:prod 限定命名空间",
      nothingMatches: "无匹配项",
      typeToSearch: "输入以搜索",
      move: "↑↓ 选择",
      open: "⏎ 打开",
      escClose: "esc 关闭",
    },
  },

  settings: {
    theme: {
      label: "颜色",
      hint: "「跟随系统」会跟随你系统的明暗设置",
      system: "跟随系统",
      dark: "黑色",
      light: "白色",
    },
    language: {
      label: "语言",
      hint: "切换界面语言,立即生效",
      en: "English",
      zh: "中文",
    },
    logBuffer: {
      label: "日志缓冲",
      hint: (min, max) => `日志视图保留行数 (${min}–${max});立即生效`,
    },
    metricsPoll: {
      label: "指标轮询",
      hint: (min, max, applies) =>
        `CPU / 内存轮询间隔 (${min}–${max} 秒)${applies ? " — 下次连接时生效" : ""}`,
    },
    statusPoll: {
      label: "状态轮询",
      hint: (min, max, applies) =>
        `集群状态轮询间隔 (${min}–${max} 秒)${applies ? " — 下次连接时生效" : ""}`,
    },
    defaultNamespace: {
      label: "默认命名空间",
      hint: "连接时选择;输入 all 表示不过滤",
      placeholder: "all",
    },
    shellCommand: {
      label: "Shell 命令",
      hint: "留空时优先 bash,否则 sh;对新 shell 生效",
      placeholder: "(自动: bash 或 sh)",
    },
    nodeShellImage: {
      label: "节点 Shell 镜像",
      hint: "留空使用 nicolaka/netshoot;混合架构集群需要多架构镜像",
      placeholder: "(nicolaka/netshoot)",
    },
  },

  detail: {
    tabs: {
      logs: "日志",
      properties: "属性",
      metrics: "指标",
      shell: "终端",
      yaml: "YAML",
      events: "事件",
    },
    header: {
      kind: "类型",
      ns: "命名空间",
      node: "节点",
      age: "存活",
      closeTitle: "关闭",
      actionsTitle: "操作",
    },
    drain: {
      pdbBlocked: (n, names) =>
        `${n} 个 Pod 被 PodDisruptionBudget 卡住 — 需要在其他位置补足副本,或放宽预算: ${names}`,
    },
  },

  table: {
    filterPlaceholder: "过滤…",
    empty: "无匹配资源",
  },

  actions: {
    labels: {
      viewPods: "查看 Pod",
      forward: "端口转发…",
      scale: "伸缩…",
      restart: "重启…",
      cordon: "禁止调度",
      uncordon: "允许调度",
      drain: "驱逐…",
      delete: "删除…",
    },
    confirm: {
      delete: (what, names) => `删除 ${what}?${names}`,
      restartPods: (what, names) =>
        `重启 ${what}?${names} 将删除这些 Pod,由控制器重新创建。`,
      restartWorkload: (what, names) =>
        `重启 ${what}?${names} 滚动所有 Pod (kubectl rollout restart)。`,
      drain: (what) => `驱逐 ${what}?将禁止调度并驱逐节点上所有 Pod (DaemonSet 与静态 Pod 除外)。`,
      cordon: (what, names) => `禁止调度 ${what}?${names}`,
      uncordon: (what, names) => `允许调度 ${what}?${names}`,
      generic: (id, what, names) => `${id} ${what}?${names}`,
    },
    scope: (n, what) => `已选 ${n} 个 ${what}`,
    scaleForm: { title: (name) => `${name} 的副本数` },
    forwardForm: { titlePod: "转发 Pod 端口", titleService: "转发 Service 端口", apply: "开始转发" },
    bulk: {
      allFailed: (n, list) => `全部 ${n} 个失败 — ${list}`,
      partial: (ok, failed, list) => `${ok} 成功,${failed} 失败 — ${list}`,
    },
  },

  logs: {
    filterPlaceholder: "过滤日志…",
    container: "容器",
    ts: "时间",
    previous: "↺ 上一个",
    saveTitle: "保存完整日志到文件",
    save: "保存",
    pause: "⏸ 暂停",
    follow: "▶ 跟随",
    streaming: "● 接收中",
    paused: "⏸ 已暂停",
    previousContainer: "↺ 上一容器",
    sinceAll: "全部",
    sinceLast: (s) => `最近 ${s}`,
    howFarBack: "回溯时长",
    previousTitle: "读取上一个容器 — 退出前打印的内容",
    saveInProgress: "保存中…",
    saved: (n) => `已保存 ${n} 行`,
    saveFailed: (e) => `保存失败: ${e}`,
    containerAll: "(全部)",
  },
  properties: { loading: "属性加载中…" },
  events: { loading: "事件加载中…", hint: "查看 Cluster → Events 获取实时事件流" },
  metrics: {
    waitingSamples: "等待首批样本…",
    noMetrics: (name) => `${name} 无指标`,
    cpuTitle: (pct) => `CPU — ${pct}% 占用`,
    memTitle: (used, total, pct) => `内存 — ${used} / ${total} (${pct})`,
    netTitle: (rx, tx) => `网络 — ↓ ${rx}  ↑ ${tx}`,
    loadTitle: (l1, l5, l15) => `负载 — ${l1} / ${l5} / ${l15}`,
    filesystemsTitle: (n) => `文件系统 (${n})`,
  },
  podMetrics: {
    waitingSamples: "等待首批样本…",
    cpuTitle: (cpu, suffix) => `CPU — ${cpu}${suffix}`,
    memTitle: (mem, suffix) => `内存 — ${mem}${suffix}`,
    reqCpu: (v) => `请求 ${v}`,
    limitCpu: (v) => `上限 ${v}`,
    reqMem: (v) => `请求 ${v}`,
    limitMem: (v) => `上限 ${v}`,
  },
  shell: { container: "容器", reconnectTitle: "开启新会话" },
  nodeShell: {
    title: (node) => `${node} 上的 Root Shell`,
    body: (node) =>
      `会在 ${node} 上启动一个特权 Pod,进入宿主的 PID、挂载和网络命名空间 — 即节点本身的 root。`,
    podDeletedOnClose: "关闭会话时 Pod 会被删除。",
    expiresAfterHour: "Pod 自身也会在一小时后过期,即便 k7s 崩溃也不会遗留。",
    changesAreReal: "在节点上的所有更改都是真实生效的,不会被 Kubernetes 追踪。",
    endTitle: "结束会话并删除 Pod",
    backTitle: "返回起始页",
  },
  yaml: {
    edit: "✎ 编辑",
    cancel: "取消",
    backToEditing: "返回编辑",
    applyForReal: "真正应用",
    preview: "预览变更 ⏎",
    checking: "检查中…",
    noChanges: "无变更 — 服务端将原样存储此对象。",
    diffNote: "这是服务端经默认值与变更 webhook 处理后实际存储的版本",
  },
};
