/**
 * Store unit tests: the log ring buffer cap and the selection/nav reset behavior
 * that the design relies on.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useStore, LOG_BUFFER_CAP, POD_SAMPLE_CAP } from "./store";
import { DEFAULT_SETTINGS } from "./lib/settings";
import type { LogLine, NodeSample, PodResources, PodSample, Row } from "./providers/types";

/** No requests/limits — fixtures don't exercise the Metrics overlay. */
const NO_RESOURCES: PodResources = {
  cpuRequestMillis: null,
  cpuLimitMillis: null,
  memRequestBytes: null,
  memLimitBytes: null,
};

// Reset to a clean slate before each test (Zustand store is a singleton).
beforeEach(() => {
  useStore.setState({
    logBuffer: [],
    selectedRow: null,
    nav: "pods",
    following: true,
    openMenu: null,
    tableFilter: "",
    // Settings are now part of that slate: a test that raises the log cap would
    // otherwise leak it into every test that runs after it (B23).
    settings: DEFAULT_SETTINGS,
    namespace: "all",
    paletteOpen: false,
  });
});

describe("jumpTo (B28)", () => {
  const pod = (name: string, namespace: string): Row => ({
    uid: `${namespace}/${name}`,
    name,
    namespace,
    cells: [],
    pod: {
      node: "murphy-yi",
      containers: ["app"],
      status: "Running",
      ready: "1/1",
      restarts: 0,
      creationTs: "",
      statusTone: "ok",
      resources: NO_RESOURCES,
    },
  });

  it("navigates to a kind and clears the selection", () => {
    useStore.setState({ selectedRow: pod("x", "prod") });
    useStore.getState().jumpTo("nodes");
    const s = useStore.getState();
    expect(s.nav).toBe("nodes");
    expect(s.selectedRow).toBeNull();
  });

  // The reason jumpTo exists: setNav and setNamespace each clear the selection,
  // so doing this in three calls lands on the kind with nothing selected.
  it("sets kind and selection together", () => {
    const row = pod("wiki-6b6d775f4-djpwx", "wiki");
    useStore.setState({ nav: "nodes" });
    useStore.getState().jumpTo("pods", row);
    const s = useStore.getState();
    expect(s.nav).toBe("pods");
    expect(s.selectedRow).toBe(row);
    expect(s.activeTab).toBe("logs");
  });

  it("moves the namespace filter when it would hide the row", () => {
    useStore.setState({ namespace: "prod" });
    useStore.getState().jumpTo("pods", pod("wiki-x", "wiki"));
    // Landing on an empty table because of a filter set ten minutes ago is worse
    // than the filter moving.
    expect(useStore.getState().namespace).toBe("wiki");
    expect(useStore.getState().selectedRow?.name).toBe("wiki-x");
  });

  it("leaves an 'all' filter alone — it already shows the row", () => {
    useStore.setState({ namespace: "all" });
    useStore.getState().jumpTo("pods", pod("wiki-x", "wiki"));
    expect(useStore.getState().namespace).toBe("all");
  });

  it("leaves a filter that already matches alone", () => {
    useStore.setState({ namespace: "wiki" });
    useStore.getState().jumpTo("pods", pod("wiki-x", "wiki"));
    expect(useStore.getState().namespace).toBe("wiki");
  });

  it("leaves the filter alone for a cluster-scoped row", () => {
    useStore.setState({ namespace: "prod" });
    const node: Row = { uid: "murphy-yi", name: "murphy-yi", cells: [] };
    useStore.getState().jumpTo("nodes", node);
    expect(useStore.getState().namespace).toBe("prod");
  });

  it("clears the table filter and sort, which belonged to the old kind", () => {
    useStore.setState({ tableFilter: "old", sortCol: 2, sortDir: "desc" });
    useStore.getState().jumpTo("pods", pod("x", "prod"));
    const s = useStore.getState();
    expect(s.tableFilter).toBe("");
    expect(s.sortCol).toBeNull();
  });

  it("closes the palette behind you", () => {
    useStore.setState({ paletteOpen: true });
    useStore.getState().jumpTo("nodes");
    expect(useStore.getState().paletteOpen).toBe(false);
  });

  it("opens a non-pod on YAML, matching a click", () => {
    const release: Row = { uid: "helm:kube-system/traefik", name: "traefik", namespace: "kube-system", cells: [] };
    useStore.getState().jumpTo("helm", release);
    expect(useStore.getState().activeTab).toBe("yaml");
  });
});

const line = (msg: string): LogLine => ({ ts: "", level: "INFO", msg });

const podRow = (name: string): Row => ({
  uid: `pod:prod/${name}`,
  name,
  namespace: "prod",
  cells: [],
  pod: {
    node: "n1",
    containers: ["app"],
    status: "Running",
    ready: "1/1",
    restarts: 0,
    creationTs: "",
    statusTone: "ok",
    resources: NO_RESOURCES,
  },
});

describe("log ring buffer", () => {
  it("keeps at most LOG_BUFFER_CAP lines, dropping the oldest", () => {
    const { appendLogs } = useStore.getState();
    // Push more than the cap.
    for (let i = 0; i < LOG_BUFFER_CAP + 50; i++) appendLogs([line(`msg-${i}`)]);

    const buf = useStore.getState().logBuffer;
    expect(buf.length).toBe(LOG_BUFFER_CAP);
    // Oldest 50 were dropped; the newest line is last.
    expect(buf[0].msg).toBe(`msg-50`);
    expect(buf[buf.length - 1].msg).toBe(`msg-${LOG_BUFFER_CAP + 49}`);
  });

  it("appends a batch and caps correctly in one call", () => {
    const { appendLogs } = useStore.getState();
    const batch = Array.from({ length: LOG_BUFFER_CAP + 10 }, (_, i) => line(`b-${i}`));
    appendLogs(batch);
    expect(useStore.getState().logBuffer.length).toBe(LOG_BUFFER_CAP);
  });

  // B23's accept criterion: the cap is a setting, and a setting that only takes
  // effect after a restart isn't one.
  it("shrinking the cap trims the existing buffer immediately", () => {
    const { appendLogs, setSettings } = useStore.getState();
    appendLogs(Array.from({ length: 200 }, (_, i) => line(`m-${i}`)));
    expect(useStore.getState().logBuffer.length).toBe(200);

    setSettings({ logBufferCap: 50 });

    const buf = useStore.getState().logBuffer;
    expect(buf.length).toBe(50);
    // It keeps the newest, which is what you're looking at.
    expect(buf[buf.length - 1].msg).toBe("m-199");
    expect(buf[0].msg).toBe("m-150");
  });

  it("respects a raised cap on subsequent appends", () => {
    const { appendLogs, setSettings } = useStore.getState();
    setSettings({ logBufferCap: 500 });
    appendLogs(Array.from({ length: 400 }, (_, i) => line(`r-${i}`)));
    expect(useStore.getState().logBuffer.length).toBe(400);
  });

  it("raising the cap does not resurrect already-dropped lines", () => {
    const { appendLogs, setSettings } = useStore.getState();
    setSettings({ logBufferCap: 50 });
    appendLogs(Array.from({ length: 100 }, (_, i) => line(`d-${i}`)));
    expect(useStore.getState().logBuffer.length).toBe(50);

    setSettings({ logBufferCap: 500 });
    // They're gone from memory, not hidden — the buffer stays at what survived.
    expect(useStore.getState().logBuffer.length).toBe(50);
  });
});

/** A non-pod row (no `pod` meta). */
const plainRow = (name: string): Row => ({
  uid: `svc:prod/${name}`,
  name,
  namespace: "prod",
  cells: [],
});

describe("selection & nav reset", () => {
  it("selectRow opens a pod on the logs tab and clears log/view state", () => {
    useStore.setState({ activeTab: "yaml", logBuffer: [line("old")], containerIndex: 3 });
    useStore.getState().selectRow(podRow("valkyrie"));
    const s = useStore.getState();
    expect(s.selectedRow?.name).toBe("valkyrie");
    expect(s.activeTab).toBe("logs");
    expect(s.logBuffer).toEqual([]);
    expect(s.containerIndex).toBe(0);
    expect(s.following).toBe(true);
  });

  it("selectRow opens a non-pod row on the yaml tab (no logs)", () => {
    useStore.getState().selectRow(plainRow("valkyrie-api"));
    const s = useStore.getState();
    expect(s.selectedRow?.name).toBe("valkyrie-api");
    expect(s.activeTab).toBe("yaml");
  });

  it("setNav clears the selection, menus, and the table filter", () => {
    useStore.setState({ selectedRow: podRow("valkyrie"), openMenu: "ns", tableFilter: "valk" });
    useStore.getState().setNav("nodes");
    const s = useStore.getState();
    expect(s.nav).toBe("nodes");
    expect(s.selectedRow).toBeNull();
    expect(s.openMenu).toBeNull();
    expect(s.tableFilter).toBe("");
  });

  it("cycleContainer advances the index and clears the buffer", () => {
    useStore.setState({ containerIndex: 0, logBuffer: [line("x")] });
    useStore.getState().cycleContainer();
    const s = useStore.getState();
    expect(s.containerIndex).toBe(1);
    expect(s.logBuffer).toEqual([]);
  });
});

describe("navigateTo (B33: owner link / event click-through)", () => {
  const dep = (name: string, namespace: string): Row => ({
    uid: `deployments:${namespace}/${name}`,
    name,
    namespace,
    cells: [{ text: name, tone: "primary" }],
  });

  it("selects the live row when the target kind is loaded", () => {
    const row = dep("wiki", "wiki");
    useStore.setState({ rows: { deployments: [row] }, nav: "pods" });
    useStore.getState().navigateTo({ kind: "deployments", namespace: "wiki", name: "wiki" });
    const s = useStore.getState();
    expect(s.nav).toBe("deployments");
    // The real row — so the table highlights and the panel shows real cells.
    expect(s.selectedRow).toBe(row);
  });

  it("falls back to a synthetic row when the kind isn't loaded", () => {
    useStore.setState({ rows: { deployments: [] } });
    useStore
      .getState()
      .navigateTo({ kind: "deployments", namespace: "argocd", name: "argocd-repo-server" });
    const s = useStore.getState();
    expect(s.nav).toBe("deployments");
    expect(s.selectedRow?.name).toBe("argocd-repo-server");
    expect(s.selectedRow?.namespace).toBe("argocd");
    // Empty cells: the detail panel fetches by ref, so a stub row still works.
    expect(s.selectedRow?.cells).toEqual([]);
  });

  it("moves the namespace filter if it would hide the target", () => {
    useStore.setState({ rows: { deployments: [] }, namespace: "prod" });
    useStore.getState().navigateTo({ kind: "deployments", namespace: "wiki", name: "wiki" });
    expect(useStore.getState().namespace).toBe("wiki");
  });
});

describe("viewPods (B33: workload → pods)", () => {
  it("lands on pods, scoped to the workload namespace, selector in the filter", () => {
    useStore.setState({
      nav: "deployments",
      namespace: "all",
      selectedRow: { uid: "d", name: "wiki", cells: [] },
    });
    useStore.getState().viewPods("wiki", "app=wiki");
    const s = useStore.getState();
    expect(s.nav).toBe("pods");
    expect(s.namespace).toBe("wiki");
    expect(s.tableFilter).toBe("app=wiki");
    expect(s.selectedRow).toBeNull();
  });
});

describe("addPodSample", () => {
  const sample = (ts: number, cpu = 10): PodSample => ({ ts, cpuMillis: cpu, memBytes: ts });

  beforeEach(() => useStore.setState({ podSamples: {} }));

  it("appends samples per pod, oldest first", () => {
    const key = "prod/api-0";
    useStore.getState().addPodSample(key, sample(1000));
    useStore.getState().addPodSample(key, sample(2000));
    expect(useStore.getState().podSamples[key].map((s) => s.ts)).toEqual([1000, 2000]);
  });

  it("keeps each pod's series independent", () => {
    useStore.getState().addPodSample("prod/a", sample(1));
    useStore.getState().addPodSample("prod/b", sample(2));
    expect(useStore.getState().podSamples["prod/a"].map((s) => s.ts)).toEqual([1]);
    expect(useStore.getState().podSamples["prod/b"].map((s) => s.ts)).toEqual([2]);
  });

  it("caps the series at POD_SAMPLE_CAP, dropping the oldest", () => {
    const key = "prod/busy";
    for (let i = 0; i < POD_SAMPLE_CAP + 25; i++) useStore.getState().addPodSample(key, sample(i));
    const got = useStore.getState().podSamples[key];
    expect(got.length).toBe(POD_SAMPLE_CAP);
    // The window keeps the newest points; the oldest 25 fell off the front.
    expect(got[0].ts).toBe(25);
    expect(got[got.length - 1].ts).toBe(POD_SAMPLE_CAP + 24);
  });
});

describe("seedNodeSamples (B38: Prometheus backfill)", () => {
  const sample = (ts: number, cpu = 1): NodeSample => ({
    ts,
    cpuPercent: cpu,
    memUsedBytes: 1,
    memTotalBytes: 2,
    netRxBps: 0,
    netTxBps: 0,
    load1: 0,
    load5: 0,
    load15: 0,
    filesystems: [],
  });

  beforeEach(() => useStore.setState({ nodeSamples: {} }));

  it("seeds an empty series with history, oldest first", () => {
    useStore.getState().seedNodeSamples("murphy-yi", [sample(1000), sample(2000)]);
    expect(useStore.getState().nodeSamples["murphy-yi"].map((s) => s.ts)).toEqual([1000, 2000]);
  });

  it("puts history before live points", () => {
    useStore.setState({ nodeSamples: { "murphy-yi": [sample(5000)] } });
    useStore.getState().seedNodeSamples("murphy-yi", [sample(3000), sample(4000)]);
    expect(useStore.getState().nodeSamples["murphy-yi"].map((s) => s.ts)).toEqual([3000, 4000, 5000]);
  });

  // The two sources overlap in time; the live scrape measures the value directly
  // rather than re-deriving it from a rate over a wider window, so it wins.
  it("drops history that overlaps a live point, keeping the live reading", () => {
    useStore.setState({ nodeSamples: { "murphy-yi": [sample(4000, 99)] } });
    useStore.getState().seedNodeSamples("murphy-yi", [sample(3000, 1), sample(4000, 1), sample(5000, 1)]);
    const got = useStore.getState().nodeSamples["murphy-yi"];
    expect(got.map((s) => s.ts)).toEqual([3000, 4000]);
    expect(got[1].cpuPercent).toBe(99);
  });

  it("is a no-op when there's no history — the common no-Prometheus case", () => {
    useStore.setState({ nodeSamples: { "murphy-yi": [sample(1000)] } });
    useStore.getState().seedNodeSamples("murphy-yi", []);
    expect(useStore.getState().nodeSamples["murphy-yi"].map((s) => s.ts)).toEqual([1000]);
  });

  it("caps the merged series so a long backfill can't grow it without bound", () => {
    const history = Array.from({ length: LOG_BUFFER_CAP * 3 }, (_, i) => sample(i));
    useStore.getState().seedNodeSamples("murphy-yi", history);
    expect(useStore.getState().nodeSamples["murphy-yi"].length).toBeLessThanOrEqual(240);
  });
});

describe("multi-row selection (B39)", () => {
  const r = (name: string): Row => ({ uid: `uid-${name}`, name, namespace: "prod", cells: [] });

  beforeEach(() => {
    useStore.setState({
      nav: "pods",
      namespace: "all",
      selectedRow: null,
      selection: { selected: [], anchor: null },
    });
  });

  it("setSelection replaces the selection", () => {
    useStore.getState().setSelection({ selected: ["a", "b"], anchor: "a" });
    expect(useStore.getState().selection.selected).toEqual(["a", "b"]);
  });

  /**
   * Clicking a row opens its panel; leaving a stale multi-selection behind would
   * mean the row menu acts on objects the panel isn't showing.
   */
  it("a plain row click collapses the selection to that row", () => {
    useStore.getState().setSelection({ selected: ["x", "y"], anchor: "x" });
    useStore.getState().selectRow(r("api"));
    expect(useStore.getState().selection).toEqual({ selected: ["uid-api"], anchor: "uid-api" });
  });

  /**
   * The invariant that matters: a selection is scoped to the table it was made
   * in. Surviving a nav or namespace change would let a bulk delete fire at
   * objects from a table the user has left.
   */
  it("is cleared everywhere the detail selection is", () => {
    const armed = { selected: ["a", "b"], anchor: "a" };

    useStore.getState().setSelection(armed);
    useStore.getState().setNav("services");
    expect(useStore.getState().selection.selected).toEqual([]);

    useStore.getState().setSelection(armed);
    useStore.getState().setNamespace("prod");
    expect(useStore.getState().selection.selected).toEqual([]);

    useStore.getState().setSelection(armed);
    useStore.getState().viewPods("prod", "app=x");
    expect(useStore.getState().selection.selected).toEqual([]);

    useStore.getState().setSelection(armed);
    useStore.getState().resetData();
    expect(useStore.getState().selection.selected).toEqual([]);

    useStore.getState().setSelection(armed);
    useStore.getState().jumpTo("nodes");
    expect(useStore.getState().selection.selected).toEqual([]);
  });

  it("clearSelection leaves the detail panel open", () => {
    useStore.getState().selectRow(r("api"));
    useStore.getState().setSelection({ selected: ["uid-api", "uid-b"], anchor: "uid-api" });
    useStore.getState().clearSelection();
    expect(useStore.getState().selection.selected).toEqual([]);
    expect(useStore.getState().selectedRow?.name).toBe("api");
  });
});

/**
 * The YAML edit-mode lifecycle (B36). The draft lives in the store so Preview and
 * Apply can read it; the question is when it gets cleared.
 *
 * The fix here is: any of the three actions that close the edit session also clear
 * the draft. Without it, the draft becomes "dead state" — the user thinks their
 * work is preserved, but the next Edit click on the *new* row overwrites the draft
 * with the fresh YAML, silently discarding every keystroke they typed.
 */
describe("yamlDraft lifecycle (pass-24)", () => {
  beforeEach(() => {
    useStore.setState({
      selectedRow: null,
      yamlEditing: false,
      yamlDraft: "",
    });
  });

  /** A non-pod row — opens on the yaml tab (no logs). */
  const row = (name: string): Row => ({
    uid: `cronjobs:prod/${name}`,
    name,
    namespace: "prod",
    cells: [],
  });

  /**
   * selectRow closes any in-progress edit (yamlEditing → false) and now also
   * clears the draft. Without the clear, switching rows leaves the old draft in
   * the store, where the next Edit click on the new row overwrites it with the
   * fresh fetch — the user's work vanishes with no warning.
   *
   * (The "click the same row" case is also covered by this: selectRow resets
   * yamlEditing to false unconditionally, so the user has already lost the edit
   * by the time selectRow returns. Carrying a draft that the editor no longer
   * shows is dead state.)
   */
  it("selectRow clears the stale yamlDraft", () => {
    useStore.setState({ yamlEditing: true, yamlDraft: "edited content" });
    useStore.getState().selectRow(row("B"));
    expect(useStore.getState().yamlEditing).toBe(false);
    expect(useStore.getState().yamlDraft).toBe("");
  });

  /**
   * Cancel is the user saying "abandon this edit". That includes the draft — a
   * preserved draft is invisible (the editor is read-only), and the next Edit
   * click overwrites it. Clearing makes the discard explicit.
   */
  it("cancelYaml clears the yamlDraft (Cancel means discard)", () => {
    useStore.setState({ yamlEditing: true, yamlDraft: "edited content" });
    useStore.getState().cancelYaml();
    expect(useStore.getState().yamlEditing).toBe(false);
    expect(useStore.getState().yamlDraft).toBe("");
  });

  /**
   * Switching tabs closes the edit session the same way Cancel does: the editor
   * is read-only, the user is now looking at a different surface. Leaving the
   * draft behind invites the same silent-overwrite bug as Cancel.
   */
  it("setActiveTab clears the yamlDraft", () => {
    useStore.setState({ yamlEditing: true, yamlDraft: "edited content" });
    useStore.getState().setActiveTab("logs");
    expect(useStore.getState().yamlEditing).toBe(false);
    expect(useStore.getState().yamlDraft).toBe("");
  });

  /**
   * The happy path: startYamlEdit sets the draft, setYamlDraft updates it on each
   * keystroke, and a fresh startYamlEdit still overwrites — that's the one case
   * where the user is explicitly asking to start a new edit session.
   */
  it("startYamlEdit then setYamlDraft round-trips through the store", () => {
    useStore.getState().startYamlEdit("original: 1");
    expect(useStore.getState().yamlEditing).toBe(true);
    expect(useStore.getState().yamlDraft).toBe("original: 1");
    useStore.getState().setYamlDraft("original: 2");
    expect(useStore.getState().yamlDraft).toBe("original: 2");
    useStore.getState().startYamlEdit("fresh fetch");
    expect(useStore.getState().yamlDraft).toBe("fresh fetch");
  });
});

/**
 * The "+ New" toolbar button on every kind page calls `openOverlay("templates")`
 * to surface the create-from-template picker (Bxx). The store-level behavior
 * we're locking down: opening a templates overlay must also close any open
 * topbar dropdown (cluster / namespace / language), so the overlay doesn't
 * stack on top of a still-open menu.
 */
describe("openOverlay (Bxx — table New button)", () => {
  beforeEach(() => {
    useStore.setState({
      overlay: null,
      overlayPodRef: null,
      openMenu: null,
    });
  });

  it("openOverlay('templates') sets the overlay key", () => {
    useStore.getState().openOverlay("templates");
    expect(useStore.getState().overlay).toBe("templates");
  });

  /** Without the openMenu reset, the cluster switcher or namespace menu
   *  would remain on screen behind the overlay. */
  it("openOverlay closes any open topbar dropdown", () => {
    useStore.setState({ openMenu: "ns" });
    useStore.getState().openOverlay("templates");
    expect(useStore.getState().openMenu).toBeNull();
  });

  it("closeOverlay clears the overlay state", () => {
    useStore.getState().openOverlay("templates");
    useStore.getState().closeOverlay();
    expect(useStore.getState().overlay).toBeNull();
    expect(useStore.getState().overlayPodRef).toBeNull();
  });
});
