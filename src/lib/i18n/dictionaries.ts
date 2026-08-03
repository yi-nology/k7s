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
    copy: string;
    copied: string;
    copyFailed: string;
    sidebar: {
      settings: string;
      watch: (n: number) => string;
      noKinds: string;
      filterKinds: string;
      importKubeconfig: string;
      noContexts: string;
      /** The "Tools" section in the sidebar — overlays for Helm Market,
       *  Pod Files, Image Registries, Templates, and the Tier-2 features
       *  (Dashboard, Metrics, Grafana, Endpoints, Topology, Alerting). */
      tools: {
        header: string;
        helmMarket: string;
        podFiles: string;
        imageRepos: string;
        templates: string;
        dashboard: string;
        metrics: string;
        grafana: string;
        endpoints: string;
        topology: string;
        alerting: string;
        close: string;
      };
    };
    topbar: {
      nsPrefix: string;
      searchPlaceholder: string;
    };
    /** Status bar (Design §5) — every fact is "label value" pair; the value is
     *  rendered in a stronger colour by the StatusBar component. Keys here are
     *  label-only (no units / values) so the component owns the formatting and
     *  the value can stay in a `<b>`. Pre-fix, the dict shipped these as
     *  full-sentence function leaves (`api: (ms) => "api: ${ms}ms"`) that
     *  no call site ever used, and the StatusBar rendered raw English labels. */
    statusbar: {
      api: string;
      nodes: string;
      ready: string;
      cpu: string;
      mem: string;
      kubectlCtx: string;
    };
    /** Cluster switcher status line (the dot + "connected · v1.28.0" string
     *  under the cluster name). "connected" interpolates the k8s version. */
    clusterSwitcher: {
      connected: (version: string | undefined) => string;
      connecting: string;
      disconnected: string;
      noCluster: string;
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
      actions: {
        settings: string;
        importKubeconfig: string;
        cordon: (node: string) => string;
        uncordon: (node: string) => string;
      };
      /** Right-aligned hint for an app-level action (settings, import). */
      actionHintApp: string;
      /** Right-aligned hint for a per-node action (cordon/uncordon). */
      actionHintNode: string;
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
    /** The "AI integration" panel at the bottom of the Settings dialog.
        Surfaces the MCP endpoint URL + ready-to-paste configs for
        Claude Desktop, Claude Code, and Cursor. */
    mcp: {
      sectionTitle: string;
      sectionHint: (url: string) => string;
      tools: (n: number) => string;
      stdioNote: string;
      claudeDesktop: {
        title: string;
        hint: string;
        configPath: string;
      };
      claudeCode: {
        title: string;
        hint: string;
        configPath: string;
        cliHint: string;
      };
      cursor: {
        title: string;
        hint: string;
        configPath: string;
      };
    };
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
      dismissError: string;
    };
    drain: {
      pdbBlocked: (n: number, names: string) => string;
    };
  };

  /** Resource table chrome. */
  table: {
    filterPlaceholder: string;
    /**
     * Shown when the rendered row set is empty AND the user typed a filter.
     * The "filter" here means the text input — the namespace picker in the
     * topbar is the user's other filter, but it's always visible so the empty
     * state doesn't need to repeat it.
     */
    empty: string;
    /**
     * Shown when the rendered row set is empty AND the filter input is empty.
     * Either the kind has no resources on this cluster, or the namespace
     * picker is filtering them all out. Either way, no filter was typed —
     * saying "no resources match filter" would be a lie.
     */
    emptyNone: string;
    /** "N selected" chip shown when multi-select has > 1 row picked. */
    selected: string;
    /**
     * Label on the "+ New" button that opens the create-from-template overlay
     * from any kind page. Mirrors the sidebar Tools → Templates entry.
     */
    new: string;
    /** Hover/tooltip for the same button — explains what the icon does. */
    newTitle: string;
  };

  /** The shared action list and its confirmation wording. */
  actions: {
    labels: {
      viewPods: string;
      forward: string;
      scale: string;
      restart: string;
      files: string;
      cordon: string;
      uncordon: string;
      drain: string;
      delete: string;
      /** "Download YAML" — fetches the resource's YAML and saves it locally.
       *  Works for every kind (Bxx — KubePi parity). */
      downloadYaml: string;
      /** "Modify image…" — opens a form that re-writes one or more
       *  containers' `image:` values and applies the result. */
      modifyImage: string;
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
    scaleForm: {
      title: (name: string) => string;
      /** Apply-button label while a scale request is in flight. */
      applying: string;
      /** Inline hint next to the numeric input ("replicas" / "副本数"). */
      replicasLabel: string;
    };
    forwardForm: {
      titlePod: string;
      titleService: string;
      apply: string;
      /** Apply-button label while a port-forward is being set up. */
      applying: string;
      /** Inline hint next to the port input ("port" / "端口"). */
      portLabel: string;
    };
    /** In-flight indicator on the confirm buttons (Delete / Restart / Drain). */
    confirming: string;
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
    /** Lines-in-buffer counter at the bottom of the log viewer. */
    linesCount: (n: number) => string;
  };
  properties: {
    loading: string;
    /** Tooltip on a cross-reference link (e.g. a pod's owner → its Deployment). */
    navTitle: (kind: string, name: string) => string;
  };
  events: { loading: string; hint: string; empty: string };
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
    /** Body under the "waiting for first sample" state on a pod's metrics tab. */
    waitingBody: string;
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
    /** Label on the reconnect button shown when the pod-exec session ends. */
    reconnect: string;
    /** Fallback reason when the backend reports an empty end reason. */
    endedFallback: string;
  };
  nodeShell: {
    title: (node: string) => string;
    body: (node: string) => string;
    podDeletedOnClose: string;
    expiresAfterHour: string;
    changesAreReal: string;
    endTitle: string;
    backTitle: string;
    /** Button on the consent gate that starts a privileged debug pod. */
    startBtn: string;
    /** Header label while the debug pod is still starting up. */
    starting: string;
    /** Header label for the node name column once the session is running. */
    nodeLabel: string;
    /** Button on the live session header that ends the session and deletes the pod. */
    endSession: string;
    /** Button on the ended-bar that returns the user to the consent gate. */
    startAgain: string;
    /** Fallback reason when the backend reports an empty end reason. */
    endedFallback: string;
    /** Reason recorded when the user explicitly closes the session. */
    closedFallback: string;
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

  /** Feature overlay panels (Phase 1/2/4/5 of KubePi parity). Each panel
   *  has a title + close, plus a per-feature nested block for the rest. */
  helm: {
    title: string;
    close: string;
    tabs: { charts: string; repos: string };
    search: { placeholder: string };
    repos: {
      refreshAll: string;
      empty: string;
      error: string;
      ok: string;
      never: string;
      refresh: string;
      remove: string;
      add: string;
      confirmRemove: (name: string) => string;
      form: {
        name: string;
        url: string;
        desc: string;
        add: string;
        cancel: string;
        /** Add-button label while the helm add is in flight. */
        adding: string;
        /** `title=` attribute on the name input — describes the regex the
         *  `pattern` attribute enforces. Surfaced by the browser as a native
         *  tooltip on focus, so the user can see why their input is invalid
         *  before they hit submit. */
        nameTitle: string;
      };
    };
    empty: { noMatch: string; noRepos: string };
    detail: { pickChart: string };
    wizard: {
      step: { version: string; values: string; review: string };
      releaseName: string;
      namespace: string;
      createNs: string;
      version: string;
      next: string;
      back: string;
      chart: string;
      installing: string;
      install: string;
      done: string;
    };
  };
  podFiles: { title: string; close: string; noPod: string; placeholder: string };
  files: {
    up: string;
    close: string;
    empty: string;
    save: string;
    download: string;
    pickFile: string;
  };
  image: {
    title: string;
    close: string;
    test: string;
    confirmRemove: string;
    remove: string;
    add: string;
    pick: string;
    repos: string;
    reposEmpty: string;
    tags: string;
    manifest: string;
    mediaType: string;
    digest: string;
    schemaVersion: string;
    size: string;
    layers: string;
    raw: string;
    /**
     * Tooltip on each tag row in the drill-down (the click target for
     * `loadManifest`). Pre-fix, this was the literal `title="Inspect
     * manifest"` HTML attribute, which leaked English in the zh locale the
     * same way the other manifest chrome did.
     */
    inspectTitle: string;
    form: {
      title: string;
      name: string;
      url: string;
      username: string;
      password: string;
      description: string;
      save: string;
      cancel: string;
    };
  };
  tpl: {
    title: string;
    close: string;
    preview: string;
    applying: string;
    apply: string;
    pick: string;
    /**
     * Per-template title translations keyed by the template id (`deployment`,
     * `ingress`, `configmap`). Each `Template.title` in `lib/templates.ts` is
     * the English fallback; the picker routes through `t("tpl.titles." + id,
     * fallback)` so a missing key still renders the English copy.
     */
    titles: { deployment: string; ingress: string; configmap: string };
    /**
     * Per-template one-line description translations, keyed the same way as
     * `titles`. Same fallback contract: each `Template.description` is the
     * English fallback for a missing key.
     */
    descs: { deployment: string; ingress: string; configmap: string };
  };
  metricsExplorer: {
    title: string;
    close: string;
    instance: string;
    instant: string;
    range: string;
    placeholder: string;
    run: string;
    running: string;
    refresh: string;
    refreshTitle: string;
    empty: string;
    noSources: string;
    addSource: string;
    saved: {
      title: string;
      saveTitle: string;
      save: string;
      namePlaceholder: string;
      notePlaceholder: string;
      saveAction: string;
      /** Action-button text when the typed name matches an existing
       *  saved query. The save bar swaps the label from `saveAction`
       *  → `updateAction` so the user can see they're overwriting,
       *  not creating. */
      updateAction: string;
      /** Inline hint rendered inside the save bar when the typed
       *  name matches an existing saved query. */
      overwriteHint: string;
      /** In-flight text on the save action while the upsert is
       *  in progress. The button is `disabled` during this state
       *  so a double-click can't queue a second write. */
      saving: string;
      clearCache: string;
      clearCacheBtn: string;
      /** Transient feedback shown for ~1.5s after a successful
       *  `savedQueriesClearCache()`. The button text reverts on
       *  its own; no toast. Same `ok / err / idle` pattern as
       *  the McpPanel CopyButton. */
      clearCacheOk: string;
      refreshHint: string;
      removeHint: string;
      confirmRemove: (name: string) => string;
    };
    /** Column headers for the instant-query result table (a `{__name__, …}`
     *  series label set + a single numeric value). Pre-fix, the TSX rendered
     *  the literal English "Series" / "Value" — same i18n leak class as the
     *  pass-8 Alerting column fix. */
    instantTable: {
      series: string;
      value: string;
    };
  };
  grafana: {
    title: string;
    close: string;
    none: string;
    test: string;
    confirmRemove: string;
    remove: string;
    add: string;
    pick: string;
    dashboards: string;
    openInGrafana: string;
    form: {
      title: string;
      name: string;
      url: string;
      apiToken: string;
      ds: string;
      save: string;
      cancel: string;
    };
  };
  topology: {
    title: string;
    close: string;
    empty: string;
    loading: string;
    pick: string;
    col: { service: string; endpoints: string; pods: string };
    legend: { service: string; endpoint: string; pod: string; container: string };
  };
  dashboard: {
    title: string;
    close: string;
    cluster: string;
    phase: string;
    nodes: string;
    cpu: string;
    mem: string;
    events: string;
    eventsEmpty: string;
    noStatus: string;
  };
  endpoints: {
    title: string;
    close: string;
    empty: string;
    col: { name: string; namespace: string; service: string; ready: string; addresses: string; address: string; target: string; node: string };
  };
  alerts: {
    title: string;
    close: string;
    none: string;
    pick: string;
    tabs: { alerts: string; silences: string };
    empty: { alerts: string; silences: string };
    /** Column headers for the alerts + silences tables inside the
     *  Alerting overlay. Kept short and uppercased like the rest of
     *  the chrome, but routed through the dictionary so zh doesn't
     *  read the English originals. */
    cols: {
      alert: string;
      severity: string;
      state: string;
      summary: string;
      activeSince: string;
      matchers: string;
      comment: string;
      createdBy: string;
      starts: string;
      ends: string;
      status: string;
    };
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
    copy: "copy",
    copied: "copied",
    copyFailed: "copy failed",
    sidebar: {
      settings: "settings",
      watch: (n) => `watch: ${n} streams active`,
      noKinds: "no kinds match",
      filterKinds: "filter kinds…",
      importKubeconfig: "Import kubeconfig…",
      noContexts: "no contexts",
      tools: {
        header: "Tools",
        helmMarket: "Helm Market",
        podFiles: "Pod Files",
        imageRepos: "Image Registries",
        templates: "Templates",
        dashboard: "Dashboard",
        metrics: "Metrics",
        grafana: "Grafana",
        endpoints: "Endpoints",
        topology: "Service Topology",
        alerting: "Alerting",
        close: "Click to close",
      },
    },
    topbar: {
      nsPrefix: "ns:",
      searchPlaceholder: "Search anything…",
    },
    statusbar: {
      api: "api",
      nodes: "nodes",
      ready: "ready",
      cpu: "cpu",
      mem: "mem",
      kubectlCtx: "kubectl ctx:",
    },
    clusterSwitcher: {
      // "connected · v1.28.0" — the "·" is a mid-dot, matching the rest of
      // the chrome (ForwardsBar, StatusBar). Falls back to plain "connected"
      // when no version is reported.
      connected: (version) => (version ? `connected · ${version}` : "connected"),
      connecting: "connecting…",
      disconnected: "disconnected",
      noCluster: "no cluster",
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
      actions: {
        settings: "Open settings",
        importKubeconfig: "Import kubeconfig…",
        cordon: (node) => `Cordon ${node}`,
        uncordon: (node) => `Uncordon ${node}`,
      },
      actionHintApp: "app",
      actionHintNode: "node",
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
    mcp: {
      sectionTitle: "AI integration (MCP)",
      sectionHint: (url) =>
        `Exposes the same tools you see here as a Model Context Protocol server. The current page origin is the URL: ${url}`,
      tools: (n) => `${n} tools available — list / get / describe / logs / apply / scale / drain / port-forward / shell`,
      stdioNote: "For local stdio, run the `k7s-mcp` binary instead (see README).",
      claudeDesktop: {
        title: "Claude Desktop",
        hint: "Restart Claude Desktop after editing the config.",
        configPath: "~/Library/Application Support/Claude/claude_desktop_config.json",
      },
      claudeCode: {
        title: "Claude Code",
        hint: "Either edit ~/.claude.json or use the CLI below.",
        configPath: "~/.claude.json  (or .mcp.json in a project)",
        cliHint: "CLI",
      },
      cursor: {
        title: "Cursor",
        hint: "Per-project file takes precedence over the global one.",
        configPath: "~/.cursor/mcp.json  (or .cursor/mcp.json in a project)",
      },
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
      dismissError: "Dismiss error",
    },
    drain: {
      pdbBlocked: (n, names) =>
        `${n} pod${n > 1 ? "s" : ""} held by a PodDisruptionBudget — they need more replicas elsewhere, or the budget relaxed: ${names}`,
    },
  },

  table: {
    filterPlaceholder: "filter…",
    empty: "no resources match filter",
    emptyNone: "no resources",
    selected: "selected",
    new: "New",
    newTitle: "Create a resource from a YAML template",
  },

  actions: {
    labels: {
      viewPods: "View pods",
      forward: "Forward…",
      scale: "Scale…",
      restart: "Restart…",
      files: "Open files…",
      cordon: "Cordon",
      uncordon: "Uncordon",
      drain: "Drain…",
      delete: "Delete…",
      downloadYaml: "Download YAML",
      modifyImage: "Modify image…",
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
    scaleForm: {
      title: (name) => `Replicas for ${name}`,
      applying: "Applying…",
      replicasLabel: "replicas",
    },
    forwardForm: {
      titlePod: "Forward pod port",
      titleService: "Forward service port",
      apply: "Forward",
      applying: "Forwarding…",
      portLabel: "port",
    },
    confirming: "…",
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
    linesCount: (n) => `${n} lines`,
  },
  properties: {
    loading: "loading properties…",
    navTitle: (kind, name) => `Go to ${kind} ${name}`,
  },
  events: {
    loading: "loading events…",
    hint: "see Cluster → Events for the live feed",
    empty: "no recent events — events expire after ~1h",
  },
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
    waitingBody:
      'Usage is polled on an interval, so the first point takes a few seconds to arrive. If it never does, this cluster likely has no metrics-server — the pod list would show CPU and memory as "—" too.',
    cpuTitle: (cpu, suffix) => `CPU — ${cpu}${suffix}`,
    memTitle: (mem, suffix) => `Memory — ${mem}${suffix}`,
    reqCpu: (v) => `req ${v}`,
    limitCpu: (v) => `limit ${v}`,
    reqMem: (v) => `req ${v}`,
    limitMem: (v) => `limit ${v}`,
  },
  shell: {
    container: "container",
    reconnectTitle: "start a new session",
    reconnect: "↻ reconnect",
    endedFallback: "session ended",
  },
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
    startBtn: "Start debug session",
    starting: "starting debug pod…",
    nodeLabel: "node",
    endSession: "✕ end session",
    startAgain: "↻ start again",
    endedFallback: "session ended",
    closedFallback: "session closed",
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

  helm: {
    title: "Helm Market",
    close: "Close",
    tabs: { charts: "Charts", repos: "Repositories" },
    search: { placeholder: "Search charts…" },
    repos: {
      refreshAll: "Refresh all",
      empty: "No repos yet",
      error: "error",
      ok: "fresh",
      never: "never refreshed",
      refresh: "Refresh",
      remove: "Remove",
      add: "Add repository",
      confirmRemove: (name) => `Remove repo "${name}"?`,
      form: {
        name: "name",
        url: "https://charts.example.com",
        desc: "description (optional)",
        add: "Add",
        cancel: "Cancel",
        adding: "Adding…",
        nameTitle: "lowercase letters, digits, and '-'",
      },
    },
    empty: {
      noMatch: "No charts match this search",
      noRepos: "No repos yet — add one in Repositories",
    },
    detail: { pickChart: "Pick a chart on the left to install" },
    wizard: {
      step: { version: "Version", values: "Values", review: "Review" },
      releaseName: "Release name",
      namespace: "Namespace",
      createNs: "Create namespace if missing",
      version: "Version",
      next: "Next",
      back: "Back",
      chart: "Chart",
      installing: "Installing…",
      install: "Install",
      done: "Done",
    },
  },
  podFiles: {
    title: "Pod Files",
    close: "Close",
    noPod: "Open Pod Files from a Pod's row context menu.",
    placeholder: "/path/in/pod",
  },
  files: {
    up: "Up",
    close: "Close",
    empty: "(empty directory)",
    save: "Save",
    download: "Download",
    pickFile: "Pick a file to view or edit",
  },
  image: {
    title: "Image registries",
    close: "Close",
    test: "Test",
    confirmRemove: "Remove this registry?",
    remove: "Remove",
    add: "Add registry",
    pick: "Pick a registry on the left",
    repos: "Repositories",
    reposEmpty: "No repositories (or registry does not support /v2/_catalog)",
    tags: "Tags",
    manifest: "Manifest",
    mediaType: "Media type",
    digest: "Digest",
    schemaVersion: "Schema",
    size: "Size",
    layers: "Layers",
    raw: "Raw JSON",
    inspectTitle: "Inspect manifest",
    form: {
      title: "Registry",
      name: "Name",
      url: "URL",
      username: "Username (optional)",
      password: "Password (optional)",
      description: "Description",
      save: "Save",
      cancel: "Cancel",
    },
  },
  tpl: {
    title: "Create from template",
    close: "Close",
    preview: "YAML preview",
    applying: "Applying…",
    apply: "Apply",
    pick: "Pick a template on the left",
    titles: {
      deployment: "Deployment",
      ingress: "Ingress (Nginx)",
      configmap: "ConfigMap",
    },
    descs: {
      deployment: "Single-container Deployment with a Service (ClusterIP).",
      ingress: "Ingress that routes a host to an existing Service.",
      configmap: "ConfigMap with two key-value pairs.",
    },
  },
  metricsExplorer: {
    title: "Metrics Explorer",
    close: "Close",
    instance: "Prometheus",
    instant: "Instant",
    range: "Range",
    placeholder: "PromQL expression…",
    run: "Run",
    running: "Running…",
    refresh: "Refresh",
    refreshTitle: "Re-run the current query",
    empty: "No series returned.",
    noSources: "No Prometheus instances yet — add one to start querying.",
    addSource: "Add Prometheus",
    saved: {
      title: "Saved queries",
      saveTitle: "Save this query",
      save: "Save",
      namePlaceholder: "Name",
      notePlaceholder: "Note (optional)",
      saveAction: "Save",
      updateAction: "Update",
      overwriteHint: "Will overwrite the existing query with this name.",
      saving: "Saving…",
      clearCache: "Wipe the in-memory query cache",
      clearCacheBtn: "Clear cache",
      clearCacheOk: "Cleared",
      refreshHint: "Run, ignoring the cache",
      removeHint: "Delete saved query",
      confirmRemove: (name) => `Delete saved query "${name}"?`,
    },
    instantTable: {
      series: "Series",
      value: "Value",
    },
  },
  grafana: {
    title: "Grafana",
    close: "Close",
    none: "No Grafana instances yet",
    test: "Test",
    confirmRemove: "Remove this instance?",
    remove: "Remove",
    add: "Add instance",
    pick: "Add a Grafana instance to get started",
    dashboards: "Preset dashboards",
    openInGrafana: "Open in Grafana",
    form: {
      title: "Grafana instance",
      name: "Name",
      url: "URL",
      apiToken: "API token (optional)",
      ds: "Default datasource",
      save: "Save",
      cancel: "Cancel",
    },
  },
  topology: {
    title: "Service Topology",
    close: "Close",
    empty: "No services with endpoints",
    loading: "Loading…",
    pick: "Pick a service on the left",
    col: { service: "Service", endpoints: "Endpoints", pods: "Pods" },
    legend: { service: "Service", endpoint: "Endpoint", pod: "Pod", container: "Container" },
  },
  dashboard: {
    title: "Dashboard",
    close: "Close",
    cluster: "Cluster",
    phase: "Status",
    nodes: "Nodes",
    cpu: "CPU",
    mem: "Memory",
    events: "Recent events",
    eventsEmpty: "No recent events",
    noStatus: "Cluster status unavailable",
  },
  endpoints: {
    title: "Endpoints",
    close: "Close",
    empty: "No EndpointSlices in this cluster",
    col: {
      name: "Name",
      namespace: "Namespace",
      service: "Service",
      ready: "Ready",
      addresses: "Addresses",
      address: "Address",
      target: "Target",
      node: "Node",
    },
  },
  alerts: {
    title: "Alerts",
    close: "Close",
    none: "No AlertManager instances yet",
    pick: "Add an AlertManager instance to get started",
    tabs: { alerts: "Alerts", silences: "Silences" },
    empty: { alerts: "No active alerts", silences: "No silences" },
    cols: {
      alert: "Alert",
      severity: "Severity",
      state: "State",
      summary: "Summary",
      activeSince: "Active since",
      matchers: "Matchers",
      comment: "Comment",
      createdBy: "Created by",
      starts: "Starts",
      ends: "Ends",
      status: "Status",
    },
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
    copy: "复制",
    copied: "已复制",
    copyFailed: "复制失败",
    sidebar: {
      settings: "设置",
      watch: (n) => `监听: ${n} 路活跃`,
      noKinds: "无匹配类型",
      filterKinds: "过滤类型…",
      importKubeconfig: "导入 kubeconfig…",
      noContexts: "无 context",
      tools: {
        header: "工具",
        helmMarket: "Helm 市场",
        podFiles: "Pod 文件",
        imageRepos: "镜像仓库",
        templates: "模板",
        dashboard: "总览",
        metrics: "指标查询",
        grafana: "Grafana",
        endpoints: "Endpoints",
        topology: "服务拓扑",
        alerting: "告警",
        close: "点击关闭",
      },
    },
    topbar: {
      nsPrefix: "命名空间:",
      searchPlaceholder: "搜索任何内容…",
    },
    statusbar: {
      // zh statusbar labels — `cpu` / `mem` / `api` / `kubectl 上下文:` are
      // common abbreviations in Chinese tech docs and stay English; only
      // `nodes` → `节点` and `ready` → `就绪` get the zh noun, matching the
      // pre-refactor full-sentence dict ("节点 2/3 就绪").
      api: "api",
      nodes: "节点",
      ready: "就绪",
      cpu: "cpu",
      mem: "mem",
      kubectlCtx: "kubectl 上下文:",
    },
    clusterSwitcher: {
      // zh cluster-switcher status — `connecting…` keeps the ellipsis (zh
      // punctuation uses "…" too); `connected` / `disconnected` get the
      // natural zh verbs (已连接 / 已断开), with the version in parens
      // matching the chrome's mid-dot style.
      connected: (version) => (version ? `已连接 · ${version}` : "已连接"),
      connecting: "连接中…",
      disconnected: "已断开",
      noCluster: "未选择集群",
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
      actions: {
        settings: "打开设置",
        importKubeconfig: "导入 kubeconfig…",
        cordon: (node) => `禁止调度 ${node}`,
        uncordon: (node) => `允许调度 ${node}`,
      },
      actionHintApp: "应用",
      actionHintNode: "节点",
    },
  },

  settings: {
    theme: {
      label: "颜色",
      hint: "「跟随系统」会跟随你系统的明暗设置",
      system: "跟随系统",
      dark: "深色",
      light: "浅色",
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
    mcp: {
      sectionTitle: "AI 集成 (MCP)",
      sectionHint: (url) =>
        `把这套界面下同样的工具以 Model Context Protocol 协议暴露给 AI 客户端。当前页面源就是接入地址:${url}`,
      tools: (n) => `共 ${n} 个工具,涵盖 list / get / describe / logs / apply / scale / drain / port-forward / shell`,
      stdioNote: "本地 stdio 模式请跑 `k7s-mcp` 二进制(详见 README)。",
      claudeDesktop: {
        title: "Claude Desktop",
        hint: "编辑后重启 Claude Desktop 生效。",
        configPath: "~/Library/Application Support/Claude/claude_desktop_config.json",
      },
      claudeCode: {
        title: "Claude Code",
        hint: "可以编辑 ~/.claude.json,也可以用下面的 CLI。",
        configPath: "~/.claude.json(或项目里的 .mcp.json)",
        cliHint: "命令行",
      },
      cursor: {
        title: "Cursor",
        hint: "项目级 .cursor/mcp.json 优先级高于全局配置。",
        configPath: "~/.cursor/mcp.json(或项目里的 .cursor/mcp.json)",
      },
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
      dismissError: "关闭错误提示",
    },
    drain: {
      pdbBlocked: (n, names) =>
        `${n} 个 Pod 被 PodDisruptionBudget 卡住 — 需要在其他位置补足副本,或放宽预算: ${names}`,
    },
  },

  table: {
    filterPlaceholder: "过滤…",
    empty: "无匹配资源",
    emptyNone: "无资源",
    selected: "已选",
    new: "新建",
    newTitle: "从 YAML 模板创建资源",
  },

  actions: {
    labels: {
      viewPods: "查看 Pod",
      forward: "端口转发…",
      scale: "伸缩…",
      restart: "重启…",
      files: "打开文件…",
      cordon: "禁止调度",
      uncordon: "允许调度",
      drain: "驱逐…",
      delete: "删除…",
      downloadYaml: "下载 YAML",
      modifyImage: "修改镜像…",
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
    scaleForm: {
      title: (name) => `${name} 的副本数`,
      applying: "正在调整…",
      replicasLabel: "副本数",
    },
    forwardForm: {
      titlePod: "转发 Pod 端口",
      titleService: "转发 Service 端口",
      apply: "开始转发",
      applying: "正在转发…",
      portLabel: "端口",
    },
    confirming: "…",
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
    linesCount: (n) => `${n} 行`,
  },
  properties: {
    loading: "属性加载中…",
    navTitle: (kind, name) => `前往 ${kind} ${name}`,
  },
  events: {
    loading: "事件加载中…",
    hint: "查看 Cluster → Events 获取实时事件流",
    empty: "无最近事件 — 事件约 1 小时后过期",
  },
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
    waitingBody:
      "使用率按周期轮询,首个数据点需要数秒到达。若始终没有,可能是因为该集群未部署 metrics-server —— 此时 Pod 列表的 CPU 和内存也会显示为 \"—\"。",
    cpuTitle: (cpu, suffix) => `CPU — ${cpu}${suffix}`,
    memTitle: (mem, suffix) => `内存 — ${mem}${suffix}`,
    reqCpu: (v) => `请求 ${v}`,
    limitCpu: (v) => `上限 ${v}`,
    reqMem: (v) => `请求 ${v}`,
    limitMem: (v) => `上限 ${v}`,
  },
  shell: {
    container: "容器",
    reconnectTitle: "开启新会话",
    reconnect: "↻ 重新连接",
    endedFallback: "会话已结束",
  },
  nodeShell: {
    title: (node) => `${node} 上的 Root Shell`,
    body: (node) =>
      `会在 ${node} 上启动一个特权 Pod,进入宿主的 PID、挂载和网络命名空间 — 即节点本身的 root。`,
    podDeletedOnClose: "关闭会话时 Pod 会被删除。",
    expiresAfterHour: "Pod 自身也会在一小时后过期,即便 k7s 崩溃也不会遗留。",
    changesAreReal: "在节点上的所有更改都是真实生效的,不会被 Kubernetes 追踪。",
    endTitle: "结束会话并删除 Pod",
    backTitle: "返回起始页",
    startBtn: "开启调试会话",
    starting: "调试 Pod 启动中…",
    nodeLabel: "节点",
    endSession: "✕ 结束会话",
    startAgain: "↻ 重新开始",
    endedFallback: "会话已结束",
    closedFallback: "会话已关闭",
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

  helm: {
    title: "Helm 市场",
    close: "关闭",
    tabs: { charts: "Charts", repos: "仓库" },
    search: { placeholder: "搜索 Charts…" },
    repos: {
      refreshAll: "全部刷新",
      empty: "暂无仓库",
      error: "出错",
      ok: "正常",
      never: "未刷新",
      refresh: "刷新",
      remove: "删除",
      add: "添加仓库",
      confirmRemove: (name) => `删除仓库 "${name}"?`,
      form: {
        name: "name",
        url: "https://charts.example.com",
        desc: "描述(可选)",
        add: "添加",
        cancel: "取消",
        adding: "正在添加…",
        nameTitle: "小写字母、数字与 '-'",
      },
    },
    empty: {
      noMatch: "无匹配的 Charts",
      noRepos: "暂无仓库 — 先在仓库页添加一个",
    },
    detail: { pickChart: "在左侧选一个 Chart 安装" },
    wizard: {
      step: { version: "版本", values: "配置", review: "确认" },
      releaseName: "Release 名",
      namespace: "命名空间",
      createNs: "必要时创建命名空间",
      version: "版本",
      next: "下一步",
      back: "上一步",
      chart: "Chart",
      installing: "安装中…",
      install: "安装",
      done: "完成",
    },
  },
  podFiles: {
    title: "Pod 文件",
    close: "关闭",
    noPod: "从 Pod 行的右键菜单打开 Pod Files。",
    placeholder: "/容器内路径",
  },
  files: {
    up: "上一级",
    close: "关闭",
    empty: "(空目录)",
    save: "保存",
    download: "下载",
    pickFile: "选一个文件查看或编辑",
  },
  image: {
    title: "镜像仓库",
    close: "关闭",
    test: "测试",
    confirmRemove: "删除此仓库?",
    remove: "删除",
    add: "添加仓库",
    pick: "在左侧选一个仓库",
    repos: "镜像",
    reposEmpty: "无镜像(或仓库不支持 /v2/_catalog)",
    tags: "Tag",
    manifest: "清单",
    mediaType: "Media Type",
    digest: "摘要",
    schemaVersion: "Schema",
    size: "大小",
    layers: "层",
    raw: "原始 JSON",
    inspectTitle: "查看清单",
    form: {
      title: "仓库",
      name: "名称",
      url: "URL",
      username: "用户名(可选)",
      password: "密码(可选)",
      description: "描述",
      save: "保存",
      cancel: "取消",
    },
  },
  tpl: {
    title: "从模板创建",
    close: "关闭",
    preview: "YAML 预览",
    applying: "应用中…",
    apply: "应用",
    pick: "在左侧选一个模板",
    titles: {
      deployment: "Deployment",
      ingress: "Ingress (Nginx)",
      configmap: "ConfigMap",
    },
    descs: {
      deployment: "单容器 Deployment 搭配 ClusterIP Service。",
      ingress: "将一个域名路由到已有 Service 的 Ingress。",
      configmap: "包含两组键值对的 ConfigMap。",
    },
  },
  metricsExplorer: {
    title: "指标查询",
    close: "关闭",
    instance: "Prometheus",
    instant: "瞬时",
    range: "范围",
    placeholder: "PromQL 表达式…",
    run: "运行",
    running: "运行中…",
    refresh: "刷新",
    refreshTitle: "重新运行当前查询",
    empty: "无返回数据",
    noSources: "暂无 Prometheus 实例 — 添加一个开始查询。",
    addSource: "添加 Prometheus",
    saved: {
      title: "已保存查询",
      saveTitle: "保存此查询",
      save: "保存",
      namePlaceholder: "名称",
      notePlaceholder: "备注(可选)",
      saveAction: "保存",
      updateAction: "更新",
      overwriteHint: "将覆盖已存在的同名查询。",
      saving: "保存中…",
      clearCache: "清空内存查询缓存",
      clearCacheBtn: "清空缓存",
      clearCacheOk: "已清空",
      refreshHint: "运行,忽略缓存",
      removeHint: "删除已保存查询",
      confirmRemove: (name) => `删除已保存查询 "${name}"?`,
    },
    // zh: 序列 / 值 — the two columns of the instant-query result table.
    instantTable: {
      series: "序列",
      value: "值",
    },
  },
  grafana: {
    title: "Grafana",
    close: "关闭",
    none: "暂无 Grafana 实例",
    test: "测试",
    confirmRemove: "删除此实例?",
    remove: "删除",
    add: "添加实例",
    pick: "添加 Grafana 实例开始",
    dashboards: "预设仪表板",
    openInGrafana: "在 Grafana 中打开",
    form: {
      title: "Grafana 实例",
      name: "名称",
      url: "URL",
      apiToken: "API Token(可选)",
      ds: "默认数据源",
      save: "保存",
      cancel: "取消",
    },
  },
  topology: {
    title: "服务拓扑",
    close: "关闭",
    empty: "无带 Endpoints 的服务",
    loading: "加载中…",
    pick: "在左侧选一个服务",
    col: { service: "服务", endpoints: "Endpoints", pods: "Pods" },
    legend: { service: "服务", endpoint: "Endpoint", pod: "Pod", container: "容器" },
  },
  dashboard: {
    title: "总览",
    close: "关闭",
    cluster: "集群",
    phase: "状态",
    nodes: "节点",
    cpu: "CPU",
    mem: "内存",
    events: "最近事件",
    eventsEmpty: "无最近事件",
    noStatus: "集群状态不可用",
  },
  endpoints: {
    title: "Endpoints",
    close: "关闭",
    empty: "此集群无 EndpointSlice",
    col: {
      name: "名称",
      namespace: "命名空间",
      service: "服务",
      ready: "就绪",
      addresses: "地址",
      address: "地址",
      target: "目标",
      node: "节点",
    },
  },
  alerts: {
    title: "告警",
    close: "关闭",
    none: "暂无 AlertManager 实例",
    pick: "添加 AlertManager 实例开始",
    tabs: { alerts: "告警", silences: "静默" },
    empty: { alerts: "无活动告警", silences: "无静默" },
    cols: {
      alert: "告警",
      severity: "严重程度",
      state: "状态",
      summary: "摘要",
      activeSince: "激活时间",
      matchers: "匹配规则",
      comment: "备注",
      createdBy: "创建者",
      starts: "开始",
      ends: "结束",
      status: "状态",
    },
  },
};
