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
      /** Collapsible "Advanced" section header (holds poll/shell/MCP tuning). */
      advanced: string;
      advancedHint: string;
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
      /** Tooltip on the lock icon shown when a kind's watch returns 403. */
      forbidden: string;
      /** Section header above the tool/overlay entries (Dashboard, Observability,
       *  Security, Images, Tooling, System). Separates resources from tools. */
      toolsSection: string;
      /** Overlay entries in the sidebar — collapsible groups (Observability,
       *  Images) and flat items (Pod Files, Templates). Some overlays live
       *  inside their resource group instead (Helm Market → Helm, etc.). */
      tools: {
        helmMarket: string;
        podFiles: string;
        imageRepos: string;
        imageTransfer: string;
        templates: string;
        diff: string;
        dashboard: string;
        metrics: string;
        grafana: string;
        endpoints: string;
        topology: string;
        alerting: string;
        audit: string;
        ingressEditor: string;
        ingressRoutes: string;
        observability: string;
        images: string;
        /** Collapsible group headers for the Tools section. */
        security: string;
        tooling: string;
        system: string;
        close: string;
        sbom: string;
        plugins: string;
      };
    };
    /** The 5-section rail (P1 IA) — one label per SectionId in SECTION_ORDER,
     *  keyed by section id ("chrome.sections.overview", …). */
    sections: {
      overview: string;
      workloads: string;
      config: string;
      storage: string;
      tools: string;
    };
    topbar: {
      nsPrefix: string;
      searchPlaceholder: string;
      /** Tooltip when the ns filter is disabled because a tool panel is open. */
      nsDisabledOverlay: string;
      /** Tooltip when the ns filter is disabled on a cluster-scoped kind. */
      nsDisabledScope: string;
      /** Tooltip for the dark/light theme toggle button. */
      themeToggle: string;
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
      errorDetails: string;
      retry: string;
    };
    /** The floating AI assistant toggle button (bottom-right of the content area). */
    aiFab: {
      open: string;
      title: string;
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
        dashboard: string;
        metrics: string;
        grafana: string;
        endpoints: string;
        topology: string;
        alerting: string;
        helmMarket: string;
        podFiles: string;
        imageRepos: string;
        imageTransfer: string;
        templates: string;
        diff: string;
        sbom: string;
      };
      /** Right-aligned hint for an app-level action (settings, import). */
      actionHintApp: string;
      /** Right-aligned hint for a per-node action (cordon/uncordon). */
      actionHintNode: string;
      /** Right-aligned hint for an overlay view (Dashboard, PromQL, …). */
      actionHintView: string;
      /** Right-aligned hint for an overlay tool (Helm Market, Images, …). */
      actionHintTool: string;
      /** aria-label for the command palette container. */
      ariaLabel: string;
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
    scanner: {
      statusTitle: string;
      refresh: string;
      fallbackChain: string;
      trivyPath: { label: string; hint: string; placeholder: string };
      grypePath: { label: string; hint: string; placeholder: string };
      timeout: { label: string; hint: string; placeholder: string };
      engine: { builtIn: string; notFound: string; active: string };
    };
  };

  /** Detail panel — header meta, common buttons. Tab labels use tabLabel(). */
  detail: {
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
    /** Shown when a kind's watch returns 403 Forbidden (RBAC). */
    forbidden: string;
    /** "N selected" chip shown when multi-select has > 1 row picked. */
    selected: string;
    /**
     * Label on the "+ New" button that opens the create-from-template overlay
     * from any kind page. Mirrors the sidebar Tools → Templates entry.
     */
    new: string;
    /** Hover/tooltip for the same button — explains what the icon does. */
    newTitle: string;
    /** Tooltip for the CSV export button in the table toolbar. */
    csvExportTitle: string;
    /** aria-label for the resource table. */
    ariaLabel: string;
  };

  /** The shared action list and its confirmation wording. */
  actions: {
    labels: {
      viewPods: string;
      forward: string;
      scale: string;
      restart: string;
      files: string;
      /** "Edit ingress…" — opens the Ingress editor overlay pre-filled with the row. */
      editIngress: string;
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
      /** "Rollback to last" — rolls a workload back to its previous revision. */
      rollback: string;
    };
    confirm: {
      delete: (what: string, names: string) => string;
      restartPods: (what: string, names: string) => string;
      restartWorkload: (what: string, names: string) => string;
      drain: (what: string) => string;
      cordon: (what: string, names: string) => string;
      uncordon: (what: string, names: string) => string;
      generic: (id: string, what: string, names: string) => string;
      /** "Rollback <what> to its previous revision?" */
      rollback: (what: string) => string;
      /** "Rollback Helm release <what>?" */
      rollbackHelm: (what: string) => string;
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
    rollbackForm: {
      helmTitle: (name: string) => string;
      loadingHistory: string;
      applying: string;
      rollbackTo: (rev: string) => string;
    };
    /** In-flight indicator on the confirm buttons (Delete / Restart / Drain). */
    confirming: string;
    bulk: {
      allFailed: (n: number, list: string) => string;
      partial: (ok: number, failed: number, list: string) => string;
    };
    /** Modify-image form chrome (Bxx — KubePi parity). */
    modifyImage: {
      title: (name: string) => string;
      loading: string;
      empty: string;
      noContainers: string;
      reset: string;
      applying: string;
      invalidImage: string;
    };
  };

  /** Tab-specific UI strings (subset that's not already in chrome.*). */
  logs: {
    filterPlaceholder: string;
    searchPlaceholder: string;
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
  events: {
    loading: string;
    hint: string;
    empty: string;
    noEvents: string;
    sinceAll: string;
    sinceLast: (s: string) => string;
    howFarBack: string;
  };
  /** Revisions detail tab — history + current-image editing + rollback. */
  revisions: {
    noSelection: string;
    loading: string;
    currentImage: string;
    editImage: string;
    history: string;
    current: string;
    noCurrent: string;
    empty: string;
    rollbackTo: string;
    rollingBack: string;
    col: {
      revision: string;
      images: string;
      ready: string;
      age: string;
    };
  };
  nodePods: {
    pods: string;
    noNode: string;
    empty: string;
    col: {
      namespace: string;
      pod: string;
      status: string;
      cpu: string;
      memory: string;
      restarts: string;
    };
  };
  metrics: {
    waitingSamples: string;
    waitingSamplesBody: string;
    kubeMetricsFootnote: string;
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
    explain: string;
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
      invalidNamespace: string;
    };
    diff: {
      selectRevA: string;
      selectRevB: string;
      pickRevision: string;
      loading: string;
      identical: string;
      swap: string;
      emptyHint: string;
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
    /** Vulnerability scan sub-panel inside the image registries overlay. */
    scan: {
      title: string;
      close: string;
      noVulns: string;
      cveId: string;
      severity: string;
      package: string;
      installed: string;
      fixed: string;
      titleCol: string;
    };
    /** Severity level labels for vulnerability scan results. */
    severity: {
      critical: string;
      high: string;
      medium: string;
      low: string;
    };
  };
  /** Image-transfer overlay (air-gapped clusters): load a local .tar into a
   * node's container runtime via a temporary privileged pod. */
  imageTransfer: {
    title: string;
    close: string;
    desktopOnly: string;
    /** Top-level Import/Export tab labels. */
    tabImport: string;
    tabExport: string;
    /** Sub-tab labels for the Import flow. */
    tabToNode: string;
    tabToRegistry: string;
    /** Sub-tab labels for the Export flow. */
    tabFromNode: string;
    tabFromRegistry: string;
    /** Original single-import flow keys (kept for backwards compat). */
    whatTitle: string;
    description: string;
    node: string;
    pickNode: string;
    archive: string;
    chooseFile: string;
    importing: string;
    runtime: string;
    loadedImages: string;
    noImages: string;
    rawOutput: string;
    /** Import sub-panel — the component navigates through this as an object
     *  (e.g. `imageTransfer.import.whatTitle`). The former string leaf was
     *  moved into `label`. */
    import: {
      label: string;
      whatTitle: string;
      description: string;
      node: string;
      pickNode: string;
      chooseFiles: string;
      dragHint: string;
      batchSelected: string;
      dropHere: string;
      importing: string;
      import: string;
      runtime: string;
      loadedImages: string;
      rawOutput: string;
    };
    /** Export sub-panel — export from node or from registry to local .tar. */
    export: {
      nodeTitle: string;
      nodeDesc: string;
      sourceNode: string;
      pickNode: string;
      imageRef: string;
      imageRefPlaceholder: string;
      listImages: string;
      listingImages: string;
      runtime: string;
      savedTo: string;
      rawOutput: string;
      exporting: string;
      export: string;
      registryTitle: string;
      registryDesc: string;
      registry: string;
      pickRegistry: string;
      repo: string;
      pickRepo: string;
      tag: string;
      pickTag: string;
      insecureSrc: string;
      noRegistries: string;
      log: string;
      exportingRegistry: string;
      exportRegistry: string;
      /** Dialog title for the save-file picker in both FromNode and FromRegistry. */
      chooseSavePath: string;
    };
    /** To-Registry (skopeo) sub-flow. */
    registry: {
      whatTitle: string;
      description: string;
      registry: string;
      pickRegistry: string;
      noRegistries: string;
      repo: string;
      tag: string;
      source: string;
      srcCreds: string;
      srcCredsHelp: string;
      insecureSrc: string;
      insecureDest: string;
      inspect: string;
      inspecting: string;
      copy: string;
      copying: string;
      copied: string;
      destination: string;
      log: string;
      archWarn: string;
      skopeoMissing: string;
    };
  };
  tpl: {
    title: string;
    close: string;
    preview: string;
    applying: string;
    apply: string;
    cancel: string;
    pick: string;
    /** "Kind" label on the kind-bar dropdown (Bxx wizard pass). */
    kind: string;
    /** Create-overlay mode toggle (form vs. YAML import). */
    mode: { form: string; yaml: string };
    /** YAML-import mode strings (create overlay). */
    yaml: {
      placeholder: string;
      preview: string;
      checking: string;
      apply: string;
      applying: string;
      /** Per-doc review row — valid doc. `{kind}/{name}` interpolated. */
      docOk: string;
      /** Per-doc review row — errored doc. `{kind}/{name} — {error}`. */
      docErr: string;
      /** Hint shown when the draft changed since the last Preview. */
      stale: string;
    };
    /** Section title for the simple `params` block in the form. */
    section: { basic: string };
    /**
     * The structured "extras" sections (Bxx form-wizard pass) — labels
     * and resource requests. The form renders these as field sets
     * alongside the simple `params` fields; missing keys fall back to
     * the English copy via `t(key, fallback)`.
     */
    extras: {
      labels: string;
      resources: string;
      cpu: string;
      memory: string;
      addLabel: string;
      remove: string;
      keyPlaceholder: string;
      valuePlaceholder: string;
      /** Placeholder for the chip-editor's `key=value` input. */
      addPlaceholder: string;
    };
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
    source: string;
    query: string;
    result: string;
    instance: string;
    instant: string;
    range: string;
    placeholder: string;
    run: string;
    running: string;
    refresh: string;
    refreshTitle: string;
    empty: string;
    /** Hint shown when no query has been run yet. */
    emptyState: string;
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
    searchPlaceholder: string;
    searching: string;
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
    action: { logs: string; navigate: string; shell: string; yaml: string };
    ctx: { copy: string; logs: string; navigate: string; shell: string; yaml: string };
    health: { healthy: string; unhealthy: string; unknown: string; total: string };
    search: { placeholder: string; clear: string; prev: string; next: string };
    zoom: { fit: string; in: string; out: string };
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
    eventsPrev: string;
    eventsNext: string;
    noStatus: string;
    healthShow: string;
    healthHide: string;
    healthScore: string;
    quotas: string;
  };
  endpoints: {
    title: string;
    close: string;
    empty: string;
    col: {
      name: string;
      namespace: string;
      service: string;
      ready: string;
      addresses: string;
      address: string;
      target: string;
      node: string;
    };
  };
  alerts: {
    title: string;
    close: string;
    none: string;
    pick: string;
    tabs: { alerts: string; silences: string; rules: string };
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
    /** Alerting rules tab. */
    rules: {
      cols: {
        name: string;
        query: string;
        severity: string;
        state: string;
        for: string;
      };
      empty: string;
      noRules: string;
    };
    /** Alerting silences management. */
    silences: {
      addMatcher: string;
      comment: string;
      commentPlaceholder: string;
      create: string;
      createBtn: string;
      createTitle: string;
      createdBy: string;
      duration: string;
      expire: string;
      matchers: string;
    };
  };

  /** Audit log overlay panel (Loki-based). */
  audit: {
    title: string;
    close: string;
    loading: string;
    empty: string;
    refresh: string;
    add: string;
    instances: string;
    filter: {
      namespace: string;
      resource: string;
      user: string;
    };
    cols: {
      timestamp: string;
      user: string;
      verb: string;
      resource: string;
      namespace: string;
      name: string;
      sourceIp: string;
      status: string;
    };
  };

  /** Resource diff overlay panel. */
  diff: {
    title: string;
    close: string;
    loading: string;
    emptyHint: string;
    identical: string;
    left: string;
    right: string;
    modeResource: string;
    modeText: string;
    selectResource: string;
  };

  /** Plugins panel. */
  plugins: {
    title: string;
    close: string;
    empty: string;
    by: string;
    load: string;
    loadHint: string;
    enable: string;
    disable: string;
  };

  /** Security audit overlay. */
  security: {
    title: string;
    close: string;
    run: string;
    scanning: string;
    running: string;
    lastScan: string;
    filters: string;
    all: string;
    ruleId: string;
    emptyStart: string;
    emptyFindings: string;
  };

  /** CronJob timeline overlay. */
  timeline: {
    noSelection: string;
    noJobs: string;
    noJobsHint: string;
    schedule: string;
    lastRun: string;
    duration: string;
    status: string;
    age: string;
    active: string;
    completions: string;
    succeeded: string;
    failed: string;
    fail: string;
    ok: string;
    run: string;
  };

  /** SBOM (Software Bill of Materials) overlay panel. */
  sbom: {
    title: string;
    tab: { image: string; cluster: string; history: string; comingSoon: string };
    image: { placeholder: string; generate: string };
    cluster: { scan: string; comingSoon: string; useImage: string };
    history: {
      loading: string;
      empty: string;
      source: string;
      format: string;
      components: string;
      vulns: string;
      tool: string;
      date: string;
    };
    components: {
      title: string;
      name: string;
      version: string;
      type: string;
      licenses: string;
    };
    vulns: {
      title: string;
      id: string;
      severity: string;
      component: string;
      fix: string;
    };
    info: {
      components: string;
      vulns: string;
      tool: string;
      duration: string;
    };
    export: {
      button: string;
      success: (path: string) => string;
      failed: (error: string) => string;
    };
    historyLoadFailed: (error: string) => string;
    scanner: {
      via: string;
      fallback: string;
    };
  };

  /** Ingress editor overlay (form-based ingress creation/editing). */
  ingressEditor: {
    title: string;
    name: string;
    namespace: string;
    ingressClass: string;
    invalidNamespace: string;
    rules: string;
    host: string;
    path: string;
    pathType: string;
    port: string;
    serviceName: string;
    addRule: string;
    addPath: string;
    tls: string;
    tlsHosts: string;
    secretName: string;
    addTls: string;
    annotations: string;
    addAnnotation: string;
    basic: string;
    form: string;
    yaml: string;
    dryRun: string;
    apply: string;
    applying: string;
  };

  /** Ingress routes topology overlay. */
  ingressRoutes: {
    title: string;
    close: string;
    empty: string;
    col: { ingress: string; service: string };
    legend: { tls: string; noTls: string };
  };

  /** AI assistant — settings panel, chat, memory, cron, skills, tool calls. */
  ai: {
    settings: {
      title: string;
      beta: string;
      description: string;
      enable: string;
      providerPreset: string;
      custom: string;
      baseUrl: string;
      model: string;
      apiKey: string;
      stored: string;
      permissionMode: string;
      permReadWrite: string;
      permReadOnly: string;
      permFullAuto: string;
      testing: string;
      testConnection: string;
      saved: string;
      save: string;
      saveFailed: (e: string) => string;
    };
    welcome: {
      title: string;
      description: string;
      notConfigured: string;
      openSettings: string;
      setupAi: string;
      tryAsking: string;
      diagnose: string;
      diagnoseMsg: string;
      listResources: string;
      listResourcesMsg: string;
      healthCheck: string;
      healthCheckMsg: string;
      scaleWorkload: string;
      scaleWorkloadMsg: string;
    };
    chat: {
      title: string;
      tabChat: string;
      tabSkills: string;
      tabMemory: string;
      tabCron: string;
      /** Tooltip/title for the "⋯" overflow button holding the advanced tabs. */
      moreTabs: string;
      newConversation: string;
      close: string;
      you: string;
      assistant: string;
      placeholder: string;
      placeholderDisabled: string;
      stop: string;
      send: string;
      thinking: string;
      askAnything: string;
      examplePrompts: string;
      prompt1: string;
      prompt2: string;
      prompt3: string;
      writeOpsNote: string;
      toolRunning: string;
      toolDone: string;
      toolFailed: string;
      toolAwaiting: string;
      toolDenied: string;
      approve: string;
      deny: string;
    };
    memory: {
      tierAll: string;
      tierRecent: string;
      tierLongTerm: string;
      tierVault: string;
      loading: string;
      prefs: string;
      searchPlaceholder: string;
      learnedPrefs: string;
      noPrefs: string;
      addNote: string;
      tags: string;
      add: string;
      noMatches: string;
      noMemories: string;
      delete: string;
      referenced: (n: number) => string;
      autoPromotes: (n: number) => string;
    };
    cron: {
      loading: string;
      close: string;
      addPreset: string;
      presetTasks: string;
      noTasks: string;
      delete: string;
      enabled: string;
      disabled: string;
      last: string;
    };
    quickActions: {
      clusterHealth: string;
      listNodes: string;
      findCrashLoop: string;
      resourcePressure: string;
      diagnose: string;
      events: string;
      logs: string;
      describe: string;
      enableFirst: string;
      /** Localised prompts sent to the model when a quick action is clicked.
       *  Function leaves interpolate the selected resource's kind/name/namespace. */
      clusterHealthMsg: string;
      listNodesMsg: string;
      findCrashLoopMsg: string;
      resourcePressureMsg: string;
      diagnoseMsg: (kind: string, name: string, ns: string) => string;
      eventsMsg: (kind: string, name: string, ns: string) => string;
      logsMsg: (kind: string, name: string, ns: string) => string;
      describeMsg: (kind: string, name: string, ns: string) => string;
    };
    skills: {
      loading: string;
      description: string;
      active: string;
      tools: string;
    };
    toolCall: {
      running: string;
      done: string;
      failed: string;
      needsApproval: string;
      denied: string;
      parameters: string;
      approve: string;
      deny: string;
      error: string;
      result: string;
    };
  };

  /** Sidebar chrome that isn't covered by chrome.sidebar. */
  sidebar: {
    mainNav: string;
    brandSub: string;
    hotbar: {
      removeFromHotbar: string;
      pinContext: string;
    };
    navAriaLabel: string;
  };

  /** Detail tab strip. */
  detailTabs: {
    ariaLabel: string;
    closeTab: string;
    init: string;
  };

  /** Notification toast. */
  notifications: {
    ariaLabel: string;
    dismiss: string;
  };

  /** Properties tab additions. */
  propertiesExtra: {
    hideValues: string;
    showValues: string;
    decoding: string;
    key: string;
    value: string;
    clickToCopy: string;
    collapse: string;
    copied: string;
    noData: string;
  };

  /** Helm rollback form additions. */
  rollbackTable: {
    revision: string;
    status: string;
    chart: string;
    updated: string;
    description: string;
    current: string;
  };

  /** TopBar overlay labels. */
  overlayLabels: {
    helmMarket: string;
    podFiles: string;
    imageRepos: string;
    imageTransfer: string;
    templates: string;
    dashboard: string;
    metricsExplorer: string;
    grafana: string;
    endpoints: string;
    topology: string;
    ingressRoutes: string;
    alerting: string;
    audit: string;
    ingressEditor: string;
    diff: string;
    plugins: string;
    security: string;
    sbom: string;
  };

  /** Grafana time range labels. */
  grafanaRange: {
    last1h: string;
    last6h: string;
    last24h: string;
    last7d: string;
  };

  /** Audit filter placeholders. */
  auditExtra: {
    namePlaceholder: string;
    urlPlaceholder: string;
    usernamePlaceholder: string;
    passwordPlaceholder: string;
    eventsCount: (n: number) => string;
  };

  /** Ingress editor path type options. */
  ingressEditorExtra: {
    pathTypePrefix: string;
    pathTypeExact: string;
    pathTypeImplSpecific: string;
    dryRunPassed: string;
    keyPlaceholder: string;
    valuePlaceholder: string;
  };

  /** Security severity labels. */
  securityExtra: {
    critical: string;
    high: string;
    medium: string;
    low: string;
  };
}

/** English (default). */

// Locale dictionaries — split into separate files for maintainability.
export { en } from './en';
export { zh } from './zh';
