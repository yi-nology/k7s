# YAML Import Create Mode — Design

**Date:** 2026-08-03
**Status:** Design (pending approval)
**Scope:** Add a second creation mode — "YAML import" — alongside the existing template-form mode in the create overlay. Applies to **all resource kinds**, not just Deployments.

---

## 1. Background

Today the create overlay (`src/components/templates/TemplatePicker.tsx`) is a single
template-driven form: the user picks a Kind, fills in form fields (name / image /
replicas / …), optionally adds labels and resource requests, and clicks **Apply**.
The form renders a YAML string on the client, and that string is shipped to the
backend via `apply_yaml_bundle` (server-side apply per document).

There is **no** way to paste/import an arbitrary manifest. The user must fit their
intent into whatever params the template exposes. For Deployments specifically,
and really for any kind, users frequently want to drop in a manifest they already
have (from a colleague, a Git repo, a `kubectl get -o yaml` they tweaked).

The building blocks all exist:
- `CodeEditor` (`src/components/detail/CodeEditor.tsx`) — editable CodeMirror 6 wrapper, already used in `YamlTab` edit mode.
- `applyYamlBundle(yaml)` — multi-document server-side apply (`templates::multi_apply`).
- `dryRunYaml(ref, text)` — single-document server-side dry run returning `{current, proposed}` for a diff. Used by `YamlTab`'s three-stage apply.
- `DiffView` — rendered inline in `YamlTab.tsx`.

What's missing for the YAML-import flow: a **bundle-level dry run** (today's
`dry_run_yaml` takes a single named `{kind, namespace, name}` ref — a pasted
bundle may contain multiple docs of different kinds, and may be *creating*
resources that don't exist yet, so there is no `current` to fetch).

---

## 2. Goal & Non-Goals

**Goal:** When the user clicks **+ New** (on any kind page), they can choose between:
1. **Form** mode — the current template-driven flow, unchanged.
2. **YAML** mode — paste/edit arbitrary manifests in a CodeMirror editor, with a dry-run preview step, then apply.

**Non-goals:**
- A per-kind bespoke Deployment form (the generic template already covers it).
- File upload (paste is enough for v1; file upload is a follow-up).
- Kustomize/Helm chart rendering (raw multi-doc YAML only, as today).
- Restricting imported YAML to the current kind — a pasted bundle may contain any kinds (user decision, §3 Q4).

---

## 3. Key Design Decisions (from brainstorming)

| Question | Decision | Rationale |
|---|---|---|
| Scope | All kinds, not just Deployments | Matches the generic template-driven architecture; a mode toggle in `TemplatePicker` covers every kind for free. |
| Submit safety | **Dry-run preview** before apply | Matches the established `YamlTab` three-stage pattern (preview → diff → apply). The user explicitly wants the safety net. |
| Editor | Reuse `CodeEditor` | Zero new deps; consistent YAML highlighting with the edit-existing-resource flow. |
| Kind restriction | None | `multi_apply` already dispatches by each doc's `apiVersion/kind`. Matches `kubectl apply -f` mental model. |

---

## 4. Architecture

### 4.1 Frontend — mode toggle in `TemplatePicker`

`TemplatePicker` gains a two-option segmented control at the top of the body
(under the header, above/beside the kind bar):

```
┌─ Header ──────────────────────────────────────────────┐
│  Create                                        [×]    │
├─ Mode toggle ─────────────────────────────────────────┤
│  [ Form ] [ YAML import ]                              │
├─ (mode-dependent body) ───────────────────────────────┤
│  …                                                     │
└────────────────────────────────────────────────────────┘
```

- **Form mode (default):** exactly the current UI — kind bar, basic fields, extras, read-only YAML preview, Apply. No behavior change.
- **YAML mode:** hides the kind bar + form sections; shows:
  1. An editable `CodeEditor` seeded from the **current template's rendered YAML** (so switching modes preserves what the user built — they can tweak the generated manifest by hand). If no template is selected, seeded empty with a placeholder comment.
  2. A **Preview** button → bundle dry run → `DiffView`-style per-document review.
  3. **Apply** (shown after a successful preview, or directly available — see §4.3).

State additions to `TemplatePicker`:
- `mode: "form" | "yaml"` (default `"form"`).
- `yamlDraft: string` — the editor text in YAML mode.
- `review: BundleDryRunResult[] | null` — per-doc dry-run output.

Switching `mode` from `form` → `yaml` seeds `yamlDraft` from the current
`yamlPreview`. Switching back is lossless (form state preserved).

### 4.2 Backend — bundle dry run

New Tauri command + HTTP handler + Rust function:

```rust
// src-tauri/src/commands.rs
#[tauri::command]
pub async fn dry_run_yaml_bundle(
    yaml: String,
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<Vec<DocDryRun>>
```

```rust
// src-tauri/src/kube/templates.rs
#[derive(Clone, Debug, Serialize)]
pub struct DocDryRun {
    pub kind: String,
    pub namespace: String,
    pub name: String,
    /// What the server says this document would store (after defaulting +
    /// mutating webhooks), or `None` if the dry run errored.
    pub proposed: Option<String>,
    /// Per-document error message (parse failure, kind not discovered,
    /// admission rejection). UI shows this inline; other docs still run.
    pub error: Option<String>,
}

pub async fn multi_dry_run(yaml: &str, client: kube::Client) -> AppResult<Vec<DocDryRun>>
```

**Why a new bundle dry-run, not reusing `dry_run_yaml` per doc?**
`dry_run_yaml` requires `{kind, namespace, name}` and does `api.get(&name)` first
to diff against the live object. For a *create* (resource doesn't exist yet),
there's nothing to get — the "current" side is empty. And a bundle may contain
mixed kinds, so the caller would have to parse the bundle client-side, split it,
and call `dryRunYaml` once per doc with the right ref. That pushes parsing +
GVK resolution into the frontend, which the backend already does in `multi_apply`.
A single `dry_run_yaml_bundle` command reuses `split_documents` +
`resolve_api_resource` and returns one result per doc.

**Behavior** (mirrors `multi_apply`'s structure for consistency):
1. `split_documents(yaml)` → list of doc strings. Empty → `AppError::Other`.
2. For each doc:
   - Parse as `DynamicObject`. Parse error → `DocDryRun { error: Some("parse: …"), … }`, continue (don't abort the whole bundle — the user wants to see which docs are bad).
   - Resolve GVK → `ApiResource` + namespaced scope via `resolve_api_resource` (reuse). Not discovered → per-doc error, continue.
   - `api.patch(&name, &PatchParams::apply("k7s").dry_run(), &Patch::Apply(obj))`.
   - On success: strip managedFields, serialize → `proposed`. On error (admission rejection, etc.): `error: Some(e.to_string())`, continue.
3. Return `Vec<DocDryRun>` — one entry per doc, in order.

**Key difference from `multi_apply`:** `multi_apply` **stops at the first error**
and returns partial results. `multi_dry_run` **continues past errors** so the user
sees every problematic doc in one pass. This is deliberate: a dry run is
non-mutating, so there's no partial-commit risk, and the whole point is to surface
all problems before the user commits to a real apply.

### 4.3 Frontend submit flow (YAML mode)

Two-stage, mirroring `YamlTab.tsx:128-157`:

```
[ editor with yamlDraft ]
   │
   ▼  user clicks Preview
dry_run_yaml_bundle(yamlDraft)
   │
   ▼
review = [ { kind, name, proposed?, error? }, … ]
   │
   ├─ any doc errored?  → show per-doc errors inline, keep draft, block Apply
   ├─ all docs ok       → show per-doc proposed YAML (collapsed, expandable),
   │                       enable Apply
   ▼  user clicks Apply
applyYamlBundle(yamlDraft)
   │
   ▼
results = [ { kind, name, action, error? }, … ]
   │
   ▼
on success: close overlay (or show success results list as today);
on failure: keep draft, show per-doc errors
```

**Apply button availability:** Apply is enabled only after a Preview has run with
**zero** errored docs (a doc whose only outcome is "would create a new object"
counts as ok — `proposed` is populated, `error` is null). This enforces the
dry-run gate without trapping the user who has a known-bad doc they intend to
fix. If the user edits `yamlDraft` after a successful Preview, `review` is
cleared and Apply is disabled again until the next clean Preview.

If the user edits `yamlDraft` after a Preview, `review` is cleared (stale preview
guard, same as `YamlTab`'s pattern).

### 4.4 Provider interface

Add to `Provider` in `src/providers/types.ts`:

```ts
/** Per-document result of a bundle dry run (create-side preview). */
export interface DocDryRun {
  kind: string;
  namespace: string;
  name: string;
  /** Server-defaulted object that would be stored, or null on error. */
  proposed: string | null;
  /** Per-doc error (parse / discovery / admission). */
  error: string | null;
}

export interface Provider {
  // …existing…
  dryRunYamlBundle(yaml: string): Promise<DocDryRun[]>;
}
```

Implementations:
- **TauriProvider:** `invoke("dry_run_yaml_bundle", { yaml })`.
- **HttpProvider:** `POST /api/dry-run-yaml-bundle` with `{ yaml }` (new route in `src-tauri/src/web/server.rs`, handler in `handlers.rs` mirroring `apply_yaml`'s bundle handler).
- **MockProvider:** parse on `---`, return one `DocDryRun` per non-empty doc with `proposed: doc` (echoes input) and `error: null` — enough for the demo build to exercise the UI. (Lightweight: no YAML-schema validation in mock.)

### 4.5 i18n

New keys under the `tpl.*` namespace (the create overlay's existing namespace),
plus reuse of `yaml.*` keys where the UX is shared with `YamlTab`:

```
tpl.mode.form        = "Form"
tpl.mode.yaml        = "YAML import"
tpl.yaml.placeholder = "# Paste one or more manifests, separated by ---"
tpl.yaml.preview      = "Preview"        // (reuse yaml.preview if it fits)
tpl.yaml.applying     = "Applying…"
tpl.yaml.apply        = "Apply"
tpl.yaml.docOk        = "{kind}/{name} — valid"      // or per-doc proposed render
tpl.yaml.docErr       = "{kind}/{name} — {error}"
tpl.yaml.editToRefetch = "Edit detected — click Preview again"
```

Exact keys finalized during implementation; EN + ZH dictionaries updated
(`src/i18n/dictionaries.ts`).

---

## 5. Files to Change

### Backend (Rust)
| File | Change |
|---|---|
| `src-tauri/src/kube/templates.rs` | Add `DocDryRun` struct + `multi_dry_run` fn (reuses `split_documents`, `resolve_api_resource`). |
| `src-tauri/src/commands.rs` | Add `dry_run_yaml_bundle` Tauri command. |
| `src-tauri/src/lib.rs` | Register the new command in the `invoke_handler!` list. |
| `src-tauri/src/web/handlers.rs` | Add `dry_run_yaml_bundle` HTTP handler + `DryRunYamlBundleArgs` DTO. |
| `src-tauri/src/web/server.rs` | Register `POST /api/dry-run-yaml-bundle` route. |

### Frontend (TypeScript/React)
| File | Change |
|---|---|
| `src/providers/types.ts` | Add `DocDryRun` type + `dryRunYamlBundle` to `Provider`. |
| `src/providers/tauri/TauriProvider.ts` | Implement `dryRunYamlBundle` via `invoke`. |
| `src/providers/HttpProvider.ts` | Implement via `POST /api/dry-run-yaml-bundle`. |
| `src/providers/mock/MockProvider.ts` | Implement mock (split on `---`, echo docs). |
| `src/components/templates/TemplatePicker.tsx` | Add `mode` state + segmented toggle; render `CodeEditor` + Preview/Apply flow in YAML mode; seed `yamlDraft` from `yamlPreview` on mode switch. |
| `src/components/templates/TemplatePicker.module.css` | Styles for the mode toggle + YAML-mode body. |
| `src/i18n/dictionaries.ts` | Add `tpl.mode.*`, `tpl.yaml.*` keys (EN + ZH). |

### Tests
| File | Change |
|---|---|
| `src-tauri/src/kube/templates.rs` (or co-located `#[cfg(test)]`) | Unit tests for `multi_dry_run`: empty bundle errors; parse-error doc continues; one good + one bad doc returns 2 results; unknown kind → per-doc error; success → `proposed` populated. |
| `src/components/templates/TemplatePicker.test.tsx` (new or existing) | Mode toggle switches body; switching form→yaml seeds draft from rendered template; Preview calls `dryRunYamlBundle` and gates Apply; edit after preview clears review. |

---

## 6. Data Flow (YAML mode, end-to-end)

```
User pastes manifest(s) into CodeEditor
  → yamlDraft state
User clicks Preview
  → dryRunYamlBundle(yamlDraft)  [provider]
     → TauriProvider.invoke("dry_run_yaml_bundle")
        → commands::dry_run_yaml_bundle
           → templates::multi_dry_run
              → split_documents → per-doc parse + resolve + SSA-dry-run
              → Vec<DocDryRun>
     ← returned to UI as review[]
  → if any error: show per-doc errors, Apply disabled
  → else: show per-doc proposed YAML, Apply enabled
User clicks Apply
  → applyYamlBundle(yamlDraft)   [existing provider method]
     → templates::multi_apply → real SSA per doc
     ← Vec<ApplyResult>
  → on success: close overlay (or show results list)
  → on failure: per-doc errors, keep draft
```

---

## 7. Error Handling

- **Empty editor on Preview/Apply:** client-side guard, button disabled when `yamlDraft.trim()` is empty (mirrors how the Form mode disables Apply when no template selected).
- **Parse error in a doc:** backend continues to other docs; per-doc `error` shown. Apply stays disabled until Preview shows zero errors.
- **Unknown kind (not in cluster discovery):** per-doc `error: "kind X not discovered"`, others proceed.
- **Admission rejection on dry run:** per-doc `error` (admission webhook / validation message verbatim). This is the *value* of the dry run — catch it before the real apply.
- **Real apply failure:** `multi_apply` returns partial results + stops at first error (existing behavior). UI shows the per-doc results list as it does today. Draft is kept so the user can fix and retry.

---

## 8. Testing Strategy

- **Unit (Rust):** `multi_dry_run` — empty input, single good doc, single parse-error doc, mixed good/bad, unknown kind, admission-style error (mocked via a kind that exists but whose patch we can't easily fake — likely covered by the parse/discovery paths; full SSA-dry-run success path validated via integration/manual).
- **Unit (TS):** `TemplatePicker` mode toggle, draft seeding, preview gating, edit-clears-review. Use `MockProvider`'s `dryRunYamlBundle` to avoid cluster calls.
- **Manual:** paste a real Deployment+Service bundle, Preview, Apply, verify both created. Paste an invalid doc, verify per-doc error and Apply stays disabled.

---

## 9. Open Questions / Deferred

- **File upload** (drag a `.yaml` file into the editor): out of scope for v1; the CodeMirror instance can accept it later via a drop handler.
- **Reusing `DiffView` for per-doc review:** `DiffView` compares `current` vs `proposed`. For a *create* there's no `current`, so the review will show the full `proposed` manifest (not a diff). This is acceptable — showing "here's what will be created" is the right UX for create. If we later want a true diff (e.g. when re-applying an existing object), we can extend `DocDryRun` with an optional `current` and conditionally render a diff vs. full manifest.
- **Persistence of mode preference:** whether `mode` defaults to Form or remembers the last-used per kind. v1 defaults to Form (least surprising). A prefs follow-up can add `createMode` to `Prefs`.
