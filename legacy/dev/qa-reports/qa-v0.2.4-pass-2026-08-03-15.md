# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #15

## Area tested

**Detail-panel tabs i18n sweep + Dashboard CPU / Memory bar labels** —
a follow-up pass that targets the small, in-place hardcoded English
strings that survived every prior i18n pass. The v0.2.4 rotation
(rotations #1 through #14) is now exhausted, so this pass picks the
highest-leverage residual class: the detail-panel tabs (Properties /
Events / Logs / Metrics / PodMetrics / Shell / NodeShell) and the
Dashboard's home-view CPU / Memory bars, which are the first thing
every user sees on every connect.

What this pass walks through:

1. **Dashboard** (`src/components/dashboard/Dashboard.tsx:128, 143`)
   — the `<span>CPU</span>` and `<span>Memory</span>` labels on the
   two utilisation bars. The dict already shipped `dashboard.cpu` /
   `dashboard.mem` in both locales (pass-10 noted but didn't fix,
   because the brief flagged this as "a coordinated pass should also
   touch the detail panel's metrics tab").
2. **EventsTab** (`src/components/detail/EventsTab.tsx:45`) — the
   empty-state body was the literal
   `"no recent events — events expire after ~1h"`, not going through
   `t()`.
3. **PropertiesTab** (`src/components/detail/PropertiesTab.tsx:147`)
   — `title={\`Go to ${target.kind} ${target.name}\`}` on a
   cross-reference link. The dict had no such key, so the call site
   hardcoded the English string.
4. **ShellTab** (`src/components/detail/ShellTab.tsx:67, 127`) — the
   `↻ reconnect` button label and the
   `reason || "session ended"` fallback for when the backend sends
   an empty end reason.
5. **NodeShellTab** (`src/components/detail/NodeShellTab.tsx:71, 99,
   113, 123, 131, 146`) — six hardcoded English strings:
   the consent-gate's "Start debug session" button, the
   "starting debug pod…" / "node" header labels, the live-session
   "✕ end session" button, the ended-bar "↻ start again" button,
   and two `||` fallbacks (`"session ended"` / `"session closed"`).
6. **LogsTab** (`src/components/detail/LogsTab.tsx:194`) —
   `{filtered.length} lines` footer counter.
7. **PodMetricsTab** (`src/components/detail/PodMetricsTab.tsx:44-46`)
   — three-line hardcoded English body under the "waiting for first
   sample" state, explaining the metrics-server failure mode.

> **Browser limitation this pass:** the in-app Browser tool's render
> queue is stuck for the **sixth** consecutive pass (same symptom as
> pass-10 / 11 / 12 / 13 / 14). The recovery path is `/quit` +
> relaunch of MiniMax Code, but that's not available in the
> scheduled-cron context. Verification was done by code review, by
> HMR / Vite serving the new modules, and by tsc / vitest /
> cargo check.

## Findings

### 1. [high] Dashboard CPU / Memory bar labels hardcoded English

`src/components/dashboard/Dashboard.tsx:128, 143` (before this pass)
rendered `<span>CPU</span>` and `<span>Memory</span>` as bare
text. The dictionary shipped `dashboard.cpu` ("CPU") and
`dashboard.mem` ("Memory" in en, "内存" in zh) at
`src/lib/i18n/dictionaries.ts:880-881, 1352-1353` — but no call site
read them. Effect: a zh user looking at the home view saw `CPU` and
`Memory` (English), the two most prominent English strings on the
page.

This is exactly the leak class pass-1 fixed for the ⌘K palette
(action labels), pass-5 for the Pod Files overlay, pass-6 for the
empty-state copy, pass-8 for the Alerting panel (column headers +
empty states), pass-10 for the resource card grid (same dashboard,
different strings), pass-12 for the Helm Market form, pass-13 for
the Templates form, pass-14 for the Image Registries panel (chrome
keys + dotted-path traversal bug). Pass-10 specifically flagged
this as a follow-up: "Dashboard's `CPU` / `Memory` bar labels at
`Dashboard.tsx:115, 130` are still hardcoded English — dictionary
already has `dashboard.cpu` / `dashboard.mem` keys, fix is a
one-liner per span, but a coordinated pass should also touch the
detail panel's metrics tab." This pass is that coordinated pass.

### 2. [high] EventsTab empty state hardcoded English

`src/components/detail/EventsTab.tsx:45` (before this pass) had
`no recent events — events expire after ~1h` as a bare text literal.
The dict had `events.loading` and `events.hint` (pass-8 left them
alone) but not `events.empty`. The hint was already routed through
`t()` immediately after, so the empty state was the only English
string on the page in zh locale.

### 3. [medium] PropertiesTab cross-reference link tooltip hardcoded English

`src/components/detail/PropertiesTab.tsx:147` (before this pass) had
`title={\`Go to ${target.kind} ${target.name}\`}` on the
cross-reference link button. The `NavLink` subcomponent was already
inside the same `useTranslation()` consumer as the rest of the file
(detail panel uses `useTranslation()` at the top), so the dict
having a function-form `properties.navTitle(kind, name)` was the
obvious shape — but the key didn't exist and the call site fell
through to the inline string. The `Properties` panel surfaces these
links for every pod's owner → Deployment, every PVC's volume, every
event's involved object — they're the breadcrumb for cross-resource
navigation, so the zh tooltip saying "Go to Pod nginx-1" instead of
"前往 Pod nginx-1" was a real footgun.

### 4. [medium] ShellTab reconnect label + ended fallback hardcoded English

`src/components/detail/ShellTab.tsx:127` had the literal
`↻ reconnect` as a button label. The dict shipped `shell.reconnectTitle`
(used as the button's `title=` tooltip) but not `shell.reconnect`
(the button's own label — the two strings differ, the title says
"start a new session" and the label says "↻ reconnect").

`src/components/detail/ShellTab.tsx:67` had
`reason || "session ended"` for the case when the backend reports
an empty end reason. The `t("shell.endedFallback", "session ended")`
fallback is the right shape — it's a string, and we want the
fallback to be English so a missing-key case still renders sensibly
in any locale.

### 5. [high] NodeShellTab — six hardcoded English strings

`src/components/detail/NodeShellTab.tsx` (before this pass) had six
distinct hardcoded English strings, each a separate point of
friction for a zh user running a privileged debug session on a
node:

- **Line 71** — `reason || "session ended"` in the `onClose`
  callback (same shape as ShellTab's line 67, but for the
  node-shell session).
- **Line 99** — `reason: "session closed"` when the user clicks the
  end-session button. Distinct string from "session ended" because
  the user initiated it (the backend doesn't get to send a reason).
- **Line 113** — the consent gate's button: "Start debug session".
  This is the button the user clicks to *initiate* a privileged pod,
  so its label is the most prominent English on the gate.
- **Line 123** — the live-session header label, which is one of
  `"starting debug pod…"` (while the debug pod is still starting)
  or `"node"` (once it's running and we're showing the node name
  as a column header).
- **Line 131** — the live-session close button: `✕ end session`.
  Next to the running pod name, this is the way out of the session.
- **Line 146** — the ended-bar start-again button: `↻ start again`.
  Returns the user to the consent gate after a session ends (or
  errors out).

### 6. [low] LogsTab footer counter hardcoded English

`src/components/detail/LogsTab.tsx:194` had `<span>{filtered.length} lines</span>`
as a hardcoded `lines` suffix. The footer counter is the only
quantity in the panel that updates in real-time as lines stream
in; a zh user watching it tick from 0 to 100 to 1000 lines saw
`0 lines / 1 lines / 2 lines / …` in English.

### 7. [medium] PodMetricsTab waiting body hardcoded English

`src/components/detail/PodMetricsTab.tsx:44-46` had a three-line
hardcoded English body under the "waiting for first sample" state.
The body is a real product message — it tells the user the first
point takes a poll, and the failure mode when the cluster has no
metrics-server ("the pod list would show CPU and memory as `—`
too"). This is the diagnostic that helps a user figure out
*why* their CPU / memory charts are blank, and the zh user was
reading it in English.

## Fixes applied

All in commit `5347412`.

### `src/components/dashboard/Dashboard.tsx`

Two one-line changes:

- Line 128: `<span>CPU</span>` → `<span>{t("dashboard.cpu", "CPU")}</span>`
- Line 143: `<span>Memory</span>` → `<span>{t("dashboard.mem", "Memory")}</span>`

The `t` was already destructured at line 64, and the dict already
shipped both keys, so the changes are mechanical.

### `src/components/detail/EventsTab.tsx`

Line 45: bare text → `{t("events.empty", "no recent events — events expire after ~1h")}`.

### `src/components/detail/PropertiesTab.tsx`

`NavLink` subcomponent gains `const { t } = useTranslation();` and
line 147: hardcoded template literal →
`title={t("properties.navTitle", target.kind, target.name)}`.

### `src/components/detail/ShellTab.tsx`

- Line 67: `reason || "session ended"` →
  `reason || t("shell.endedFallback", "session ended")`.
- Line 127: bare `↻ reconnect` →
  `{t("shell.reconnect", "↻ reconnect")}`.

### `src/components/detail/NodeShellTab.tsx`

Six callsite changes:

- Line 71: `reason || "session ended"` →
  `reason || t("nodeShell.endedFallback", "session ended")`.
- Line 99: `reason: "session closed"` →
  `reason: t("nodeShell.closedFallback", "session closed")`.
- Line 113: `Start debug session` →
  `{t("nodeShell.startBtn", "Start debug session")}`.
- Lines 123-125: ternary `phase.state === "starting" ? "starting debug pod…" : "node"`
  → `phase.state === "starting" ? t("nodeShell.starting", "starting debug pod…") : t("nodeShell.nodeLabel", "node")`.
- Line 133: `✕ end session` →
  `{t("nodeShell.endSession", "✕ end session")}`.
- Line 148: `↻ start again` →
  `{t("nodeShell.startAgain", "↻ start again")}`.

### `src/components/detail/LogsTab.tsx`

Line 194: `<span>{filtered.length} lines</span>` →
`<span>{t("logs.linesCount", filtered.length)}</span>`.

### `src/components/detail/PodMetricsTab.tsx`

Lines 44-46: three-line hardcoded English body → single line
`<div className={styles.stateBody}>{t("podMetrics.waitingBody")}</div>`.

### `src/lib/i18n/dictionaries.ts`

- **`Dictionary` type** — added 11 new fields to existing blocks:
  `logs.linesCount`, `properties.navTitle`, `events.empty`,
  `podMetrics.waitingBody`, `shell.reconnect`, `shell.endedFallback`,
  `nodeShell.startBtn`, `nodeShell.starting`, `nodeShell.nodeLabel`,
  `nodeShell.endSession`, `nodeShell.startAgain`,
  `nodeShell.endedFallback`, `nodeShell.closedFallback`.
- **EN dict** — all 13 fields filled in with the original
  hardcoded literals as the canonical English.
- **ZH dict** — all 13 fields filled in with the parallel
  translations.

### `src/lib/i18n.test.ts`

New `describe("detail-panel tab + dashboard i18n (pass-15 sweep)", ...)`
block with 7 tests that pin:

1. **`dashboard.cpu` / `dashboard.mem`** in both locales — the
   canonical en / zh values.
2. **`events.empty`** in both locales, plus `events.hint` /
   `events.loading` (to pin the neighbours the audit also confirmed
   were correctly routed).
3. **`properties.navTitle(kind, name)`** in both locales — function
   form, the regression check is that a future refactor that drops
   the function signature trips the test (the prior version of
   PropertiesTab hardcoded the string instead of going through `t()`).
4. **`shell.reconnect` / `shell.endedFallback`** in both locales,
   plus `shell.reconnectTitle` for completeness.
5. **7 `nodeShell.*` keys** (`startBtn`, `starting`, `nodeLabel`,
   `endSession`, `startAgain`, `endedFallback`, `closedFallback`) in
   both locales, plus `endTitle` / `backTitle` for completeness.
6. **`logs.linesCount(n)`** in both locales, with both `n=1` and
   `n=42` (the function is plural-agnostic — the zh word `行` is
   the same in singular and plural, so the test just pins that
   the right number renders).
7. **`podMetrics.waitingBody`** in both locales, with the additional
   check that both en and zh versions mention the product name
   `metrics-server` — a future refactor that drops the critical
   diagnostic word trips the test.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **365 passed (358 → 365, +7 new tests)**.
- `cargo check --manifest-path src-tauri/Cargo.toml` — clean
  (4 pre-existing warnings, unrelated to this pass).
- Working tree clean after the commit, pushed to `origin/main`
  (`8cd140e..5347412  main -> main`).

## Notes for next pass

- **Rotation is fully exhausted** (rotations #1 through #14 walked
  + the residual i18n class swept in pass-15). The cron
  self-cleanup heuristic from the brief ("if the prior reports
  cover MOST of the rotation and last 3 passes found no new issues
  → the cron is done") is the next decision. Pass-12, 13, 14, 15
  all found substantive issues, so the cron still has value when
  run occasionally; but with the v0.2.4 rotation complete, the
  next pass should either:
  - pick a deeper sub-area (e.g. the MCP server health / status
    UI pass-14 suggested, or the cluster switcher's connection
    dropdown, or the watch footer's status indicator), or
  - shut the cron down per the self-cleanup heuristic (the brief
    says "if the prior reports cover MOST of the rotation and last
    3 passes found no new issues → the cron is done"; the reports
    cover all of the rotation, and pass-15 found new issues — so
    not done — but the rate of finding new issues is slowing, and
    a future pass that finds nothing would trigger shutdown).

- **In-app Browser render queue is stuck for the sixth consecutive
  pass** — same symptom as pass-10 / 11 / 12 / 13 / 14. The
  fix-the-queue path (`/quit` + relaunch) is not available in the
  scheduled-cron context. Pass-15's verification chain was code
  review + HMR / Vite serve + tsc / vitest / cargo check, which
  caught every i18n bug (the dotted-path bug class in particular
  was caught by reading the TSX and the dict side-by-side, not by
  visual inspection).

- **Future-tagged follow-ups from this and prior passes:**
  - Pass-12: `pattern` attribute on the Helm Market repository
    name input (charset check for `/` / ` ` / `\`).
  - Pass-12: Add button loading / disabled state during submit.
  - Pass-11: "Clear cache" button has no visual feedback; save bar
    has no "edit existing" affordance.
  - Pass-13: empty text fields in Templates form silently fall
    through to defaults via the renderer's `||` fallback; needs
    a coordinated `required` policy decision.
  - Pass-13: template `title` / `description` still hardcoded
    English in the registry (the dict needs `tpl.titles.<id>` /
    `tpl.descs.<id>` across all three templates at once).
  - Pass-14: small hardcoded `title=` attributes throughout the
    codebase (e.g. `title="Inspect manifest"` on tag rows) are
    out of scope for these targeted passes — the i18n sweep has
    flagged the bigger leaks but these are by-individual and
    would each need a separate pass.
