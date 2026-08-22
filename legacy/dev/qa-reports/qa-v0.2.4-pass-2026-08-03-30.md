# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #30

## Area tested

**Detail panel chrome + YamlTab toolbar — `<div onClick>` → real `<button>` accessibility sweep (post-rotation follow-up, round 16).**

The detail panel is the most-used surface in the app: every selected
row opens it, every tab inside it (Logs / Properties / Metrics / Shell
/ YAML / Events) is a sub-feature, and the chrome (close button,
action-error banner, tab strip, actions menu trigger) is shared across
every kind. The YamlTab's toolbar (Edit / Cancel / Preview / Apply /
back-to-editing) is the destructive-operations surface for the YAML
edit lifecycle.

Both were filled with `<div onClick={…}>` and `<span onClick={…}>`
elements that:
- weren't keyboard-focusable (no Tab to reach them)
- didn't respond to Enter / Space
- weren't announced as "button" to assistive tech
- couldn't be picked up by a screen reader's button-rotor / form-rotor

This is the same defect class the pass-12 / pass-13 / pass-18 /
pass-19 fix pattern has been closing off for forms elsewhere in the
app. The detail panel is the highest-leverage surface and gets the
same treatment.

> **Browser limitation this pass:** the in-app Browser render queue
> remains stuck for the **21st** consecutive pass (same symptom as
> pass-10 through pass-29). Verification was by code review, by
> the new behavioural test in `i18n.test.ts`, and by tsc / vitest /
> cargo check. The fix is mechanical, the test pins the new key, and
> Vite HMR served the updated source for every touched file.

## Findings

### 1. [high] Detail panel chrome — 4 elements as `<div onClick>`

Traced end-to-end:

- `src/components/detail/DetailPanel.tsx:83` — close button was
  `<div className={styles.close} onClick={closeDetail} title={t("detail.header.closeTitle")}>×</div>`.
  The "×" glyph has no accessible name; tabbing past the title row
  skipped the close button entirely. There was no way to dismiss the
  panel from the keyboard.
- `src/components/detail/DetailPanel.tsx:89` — the action error
  banner (the inline red strip below the title row when an action
  fails) was a `<div className={styles.actionError} onClick={() => setActionError(null)}>{actionError}</div>`.
  Click-to-dismiss worked, but the banner had no `role` / no
  `aria-label`, so a screen reader saw it as a plain text block and
  the click-to-dismiss gesture was invisible. Worse: the banner text
  was the action error itself (e.g. "Forbidden: pods is forbidden:
  User cannot list resource..."), so without an accessible name the
  user had no idea the block was interactive.
- `src/components/detail/DetailPanel.tsx:124-133` — the tab strip
  was a `<div>` mapping 5+ `<div className={styles.tab} onClick={() => setActiveTab(tt.id)}>` items.
  Pass-7 wired the `[/]` keys to cycle every kind's tab strip in
  both directions, so keyboard navigation *into* the strip worked;
  but a user tabbing forward through the panel couldn't reach the
  strip at all (the `<div>` had no `tabindex`), and the screen
  reader saw the strip as 5+ unlabelled text spans.
- `src/components/detail/ActionsMenu.tsx:46` — the actions menu
  trigger (`⋯`) was a `<div className={styles.actionsButton} onClick={() => setOpen((o) => !o)} title={t("detail.header.actionsTitle")}>⋯</div>`.
  The trigger is the only "actions" entry point in the detail header;
  without keyboard focus the only way to open the menu was to mouse
  over the row, and the `title=` tooltip was the only signal that
  the glyph was interactive.

The defect is presentation + a11y: the chrome looks right, but the
keyboard user has to skip 4 of the 5 most-used controls.

### 2. [high] YamlTab toolbar — 5 elements as `<div onClick>`

Traced end-to-end:

- `src/components/detail/YamlTab.tsx:167` (review mode) and
  `:182` (edit mode) — the "back to editing" / "cancel" buttons
  were `<div className={styles.cancelBtn} onClick={…}>`.
- `src/components/detail/YamlTab.tsx:171-176` (review mode) and
  `:189-196` (edit mode) — the "apply for real" / "preview"
  buttons were `<div className={styles.applyBtn} aria-disabled={applying} onClick={…}>`.
  This is the same pattern pass-18 fixed for the ActionList scale /
  forward forms, just in the YAML tab. The `aria-disabled` is an
  a11y hint only — it doesn't actually block the click, so a
  double-click during the in-flight `apply` / `preview` could fire
  two `dryRunYaml` / `applyYaml` calls.
- `src/components/detail/YamlTab.tsx:199-209` — the read-mode
  "Edit" button was a `<div className={styles.editBtn} onClick={() => { setError(null); startYamlEdit(yamlText); }}>`.
  No keyboard activation path; users editing YAML from a real keyboard
  (terminal multiplexer + ssh into a dev box, a common setup for
  cluster operators) had to switch to the mouse just to enter edit
  mode.

The defect is the same as the chrome: presentation looks right, but
5 of the 6 controls in the YAML tab toolbar are click-only. A real
`disabled` attribute on the apply / preview buttons also blocks the
in-flight double-click, closing a small race the in-flight text alone
doesn't address.

## Fixes applied

All in commit `463c674`. **9 elements across 3 files converted to
real `<button type="button">`.** No production logic was changed
outside the 3 JSX edits, the 2 CSS module additions, the 1 i18n key,
and the 1 new i18n test.

### `src/components/detail/DetailPanel.tsx` (production)

- Close button: `<div>` → `<button type="button">` with `aria-label`
  pointing at the existing `detail.header.closeTitle` key.
- Action error banner: `<div>` → `<button type="button">` with
  `aria-label="detail.header.dismissError"` (new key). The banner
  text stays as the visible content, so the error message and the
  dismiss hint are one element.
- Tab strip: `<div>` → `<button type="button" role="tab" aria-selected=…>`
  per tab; the parent `<div className={styles.tabs}>` gains
  `role="tablist"`. This matches the WAI-ARIA tabs pattern, so a
  screen reader announces "Logs tab, selected" / "Events tab" etc.
  and a focus-rotor user can jump straight to the strip.

### `src/components/detail/ActionsMenu.tsx` (production)

- Trigger: `<div>` → `<button type="button" aria-haspopup="menu" aria-expanded={open}>`.
  The `aria-haspopup="menu"` tells assistive tech that opening the
  trigger reveals a menu; `aria-expanded` reflects the open state.

### `src/components/detail/YamlTab.tsx` (production)

- All 5 toolbar elements: `<div>` → `<button type="button">`.
- Apply / preview: `aria-disabled={applying}` → `disabled={applying}`.
  A real `<button disabled>` blocks the click AND the keyboard
  activation, and `setState(false)` on resolution re-enables both.
  The CSS keeps the `[aria-disabled="true"]` selector alongside
  `[disabled]` for any in-flight code path that still uses the old
  attribute.

### `src/components/detail/DetailPanel.module.css` (production)

- `.close` / `.actionError` / `.actionsButton` / `.tab` each gain a
  native-`<button>` reset: `background: transparent`, `font: inherit`,
  `line-height: 1`, `padding: 0` (for the 28px-square controls) or
  `text-align: left; display: block; width: 100%;` (for the action
  error banner that fills the panel). Without this reset a real
  `<button>` carries user-agent font + 2px outset border + a
  default min-width that the `.X` class doesn't override.
- Each control gains a `:focus-visible` rule using the same
  border-color focus affordance the rest of the chrome uses (the
  `input` / `textarea` strip-and-recolor pattern from `global.css`).
  The `.actionError` uses `border-color: var(--status-err)` so the
  focus matches the banner's existing red palette; the others use
  `var(--accent)`.

### `src/components/detail/YamlTab.module.css` (production)

- `.editBtn` / `.cancelBtn` / `.applyBtn` each gain the same native
  reset (transparent background, inherited font, line-height 1.4).
- `.applyBtn` (the primary coloured button) uses an
  `outline: 2px solid var(--accent); outline-offset: 2px;` focus
  rule rather than a border-color shift, because the border is
  already the accent color and a shift wouldn't be visible.
- `[aria-disabled="true"]` is kept alongside `[disabled]` in the
  in-flight visual rule so the same class covers both attribute
  shapes; the JSX switched to `disabled` but the CSS remains
  defensive against any in-flight code path that still uses
  `aria-disabled`.

### `src/lib/i18n/dictionaries.ts` (production)

- `detail.header.dismissError: string` added to the `Dictionary` type
  and to both EN ("Dismiss error") and ZH ("关闭错误提示") locales.
  The existing `closeTitle` and `actionsTitle` keys are unchanged —
  pass-30 just routes them through `aria-label` as well as `title=`
  so the screen reader announces the right thing even when the
  visible glyph is decorative (× / ⋯).

### `src/lib/i18n.test.ts` (new test, 1 added)

- New `it("ships detail.header.dismissError in both locales (pass-30)")`
  inside the existing "detail-panel tab + dashboard i18n (pass-15
  sweep)" block. Pins:
  - `translate("en", "detail.header.dismissError")` === "Dismiss error"
  - `translate("zh", "detail.header.dismissError")` === "关闭错误提示"
  - non-regression for `closeTitle` ("close" / "关闭") and
    `actionsTitle` ("actions" / "操作") since pass-30 also added
    `aria-label={t("…")}` to both buttons.
- A future refactor that drops `dismissError` trips this test before
  the banner's accessible name falls back to the literal banner copy
  in zh (the same failure mode the pass-1/5/6/8/10/14/15/16/17/23/26/27
  sweep has been closing for other surfaces).

## Verification

```
tsc --noEmit    clean
vitest run      21 test files, 464 tests passing
                  was 463 (pass-29) → 464 (pass-30, +1 new in i18n.test.ts)
cargo check     clean (4 pre-existing warnings in src-tauri/src/kube/metrics_config.rs;
                  none related to this fix)
git push        7602135..463c674 main
```

HMR served the updated source for every touched file (verified via
`curl http://localhost:1420/src/components/detail/DetailPanel.tsx`
and the four other paths). The 4 chrome elements and the 5 YamlTab
elements all show `type: "button"` in the served transform output;
the tab strip shows `role: "tablist"` on the parent and
`role: "tab"` + `aria-selected` on each item; the action menu trigger
shows `aria-haspopup: "menu"` and `aria-expanded`.

## Notes for next pass

The detail panel's chrome (close / action error / tab strip / actions
menu) and the YamlTab toolbar are now keyboard-accessible. The
detail panel's most-used surface is closed. The residual queue is:

- **LogsTab.tsx** (5 elements): container cycler / timestamp toggle /
  previous toggle / save / follow-pause. Same defect class. The Logs
  tab is the next-most-used surface after the chrome.
- **ShellTab.tsx** (1 element): the `<span className={styles.reconnect}
  onClick={reconnect}>` in the ended-bar at line 126.
- **NodeShellTab.tsx** (3 elements): gate action / close session /
  start-again.
- **ActionList.tsx** (3 elements, pass-18 partial): the scale-form's
  − / + buttons and the confirm-dialog's Cancel button are still
  `<div onClick>` with `aria-disabled` only. Pass-18 fixed the
  Apply to a real `<button type="submit" disabled>` but the
  surrounding click-only controls were out of scope. Low priority
  (a11y-only — pass-18's busy early-return covers the
  double-fire risk).
- **Sidebar nav items** (2 elements): `<div className={styles.navItem} onClick={() => setNav(kind)}>`
  in `NavList.tsx:66, 224` and `<div className={styles.navGroup} onClick={() => toggle(group)}>`
  at `:210`. The sidebar has a global `j/k/Enter/G` keyboard model,
  so the keyboard reach is good; the `<div onClick>` is a screen-reader
  gap.
- **HelmInstallWizard step indicator** (1 element): `<li onClick={() => setStep(s)}>`
  in `HelmInstallWizard.tsx:140-149`. WAI-ARIA recommends `<button>`
  inside the `<ol>`, not the `<li>` as the click target.
- **ResourceTable column header sort** (1 element):
  `<th onClick={() => toggleSort(i)}>` at `ResourceTable.tsx:281`.
  Standard pattern is `<th aria-sort="…"><button>label</button></th>`.
- **Settings `useNow` panel theme picker** (unchanged from prior
  passes): no defect.

The cron is still finding real defects (5 of the last 6 passes: 25,
26, 27, 28, 29, 30 — 6 of 6 if you count this pass). The
detail-panel + YamlTab sweep is a clean scope; the next pass can
either pick up the LogsTab / ShellTab / NodeShellTab residual
(highest-leverage, same defect class) or move to the Sidebar
keyboard accessibility.
