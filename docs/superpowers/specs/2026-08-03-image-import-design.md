# External Image Import — Design

**Date:** 2026-08-03
**Status:** Design (pending approval)
**Scope:** Import a local `.tar` image archive into a target cluster node's container
runtime — for air-gapped (intranet, no public internet) clusters that can't pull from
public registries.

---

## 1. Background & Motivation

Air-gapped clusters cannot pull images from public registries (docker.io, gcr.io, …).
The standard workflow is: on a machine with internet, `docker save`/`ctr images export`
the image to a `.tar` file → move the file to the cluster network → `docker load`/
`ctr images import` it on each node. Today k7s has no UI for the second half of that.

k7s already has every primitive this needs (verified by exploration):

| Capability | Where | Reuse for import |
|---|---|---|
| Privileged node-shell (`nsenter` into host) | `kube/nodeshell.rs` | Gives a root shell on the node with access to the container runtime socket. |
| Tar-over-exec byte streaming | `kube/pod_files.rs::run_pipe` | The pattern for piping bytes into an exec stdin and capturing exit status. |
| Native file picker (Tauri) | `@tauri-apps/plugin-dialog` (kubeconfig import) | Pick the `.tar` file from disk → pass path to a backend command. |
| OCI registry client (read-only) | `kube/imagerepo.rs` | **Not reused in v1** — v1 is local-tar-only (see §3 scope decision). |
| Runtime string on nodes | `Node.status.nodeInfo.containerRuntimeVersion` | Parse the `containerd://` / `docker://` prefix to pick the import command. |

**What's net-new:** runtime detection + command dispatch, the import command itself
(spawn debug pod → nsenter → stream tar → runtime load), progress reporting, and the UI.

---

## 2. Goals & Non-Goals

**Goals (v1):**
- Pick a `.tar` file on the user's machine, pick a target node, import the image into
  that node's container runtime — one node at a time.
- Auto-detect the runtime from `containerRuntimeVersion` (`containerd://` → `ctr`,
  `docker://` → `docker load`). The user does not pick the runtime.
- Show progress: pod creation → transfer → load → result (with the loaded image refs).
- Work in the Tauri desktop app. (Web shell: best-effort stub, see §6.)

**Non-goals (v1):**
- **Pulling from a private registry** (Harbor/Nexus) and assembling a tar. That needs
  OCI blob fetch + tar assembly — a separate, larger feature. v1 is local-tar-only.
- **Batch import to multiple nodes at once.** v1 is one node per import. Multi-node is
  a follow-up (the command is node-scoped; the UI would just loop).
- **Pushing into a cluster-internal registry** (Harbor). k7s has no OCI push; out of scope.
- **cri-o support.** cri-o has no native "load from tar" — you go through the runtime.
  v1 supports containerd and docker (the two `containerRuntimeVersion` prefixes k7s
  encounters in practice). cri-o nodes get a clear "runtime not supported" error.
- **Web shell full support.** The web shell has no access to the user's local disk, so
  the native file picker path doesn't apply. The web `importImageToNode` provider
  method will throw a clear "desktop app only" error (mirroring how kubeconfig file
  import is Tauri-only in the web build).

---

## 3. Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Image source | Local `.tar` file only (v1) | Simplest, most common air-gapped path; reuses the file picker. Registry-pull is a separate feature. |
| Target | One node per import | Matches `start_node_shell`'s single-node model; avoids concurrent privileged-pod sprawl. Multi-node is a UI loop later. |
| Runtime detection | Auto, from `containerRuntimeVersion` | The user shouldn't have to know; the prefix is authoritative. |
| Transport | Spawn a privileged debug pod (reuse `nodeshell`), `nsenter` into host, pipe the tar to the runtime's load command over exec stdin | Identical mechanism to the existing node-shell — no new transport. |
| UI entry | New `image-import` overlay in the Tools sidebar, next to `image-repos` | Matches the existing overlay pattern; conceptually adjacent to the registry browser. |

---

## 4. Architecture

### 4.1 The import mechanism (end to end)

```
User picks .tar file (native dialog) + target node (dropdown)
  │
  ▼  invokes import_image_to_node { node, path }
┌──────────────── Backend (new Tauri command) ────────────────┐
│ 1. Read node.status.nodeInfo.containerRuntimeVersion         │
│    → parse prefix → pick runtime command                     │
│    (containerd → ctr; docker → docker; else → error)        │
│ 2. Create a privileged debug pod on the node                 │
│    (reuse nodeshell::debug_pod_spec, same labels/sweep)      │
│ 3. await pod Running (reuse nodeshell::await_debug_pod)      │
│ 4. exec into pod:                                            │
│      nsenter --target 1 --mount --uts --ipc --net --pid --   │
│        /bin/sh -c "<runtime-cmd>"                            │
│    with the .tar bytes streamed over exec stdin              │
│      containerd:                                              │
│        ctr --address /run/containerd/containerd.sock \       │
│          images import --no-unpack -                          │
│      docker:                                                  │
│        docker load                                            │
│ 5. Capture stdout (the "Loaded image: …" / "unpacking …"     │
│    lines) + exit status                                       │
│ 6. Delete the debug pod (always — success or failure)        │
│ 7. Return ImportResult { runtime, output, images[], error? } │
└──────────────────────────────────────────────────────────────┘
```

**Why `--no-unpack` for containerd?** `ctr images import` by default also unpacks
layers into snapshots, which is slower and can fail on edge cases. The image is still
usable (kubelet/containerd pulls from the content store; unpack happens lazily on first
use). For docker there's no equivalent flag — `docker load` unpacks always, which is
fine.

### 4.2 New Rust function — `kube/imageimport.rs`

A focused module (keeps `nodeshell.rs` unchanged — it's the interactive-shell path; this
is the one-shot import path):

```rust
// src-tauri/src/kube/imageimport.rs

#[derive(Clone, Debug, Serialize)]
pub struct ImportResult {
    /// Detected runtime family: "containerd" | "docker".
    pub runtime: String,
    /// Raw stdout from the load command (the "Loaded image: …" lines).
    pub output: String,
    /// Image refs parsed out of the output (e.g. "nginx:1.25").
    pub images: Vec<String>,
    /// None on success; error message on failure.
    pub error: Option<String>,
}

/// Detect runtime family from containerRuntimeVersion ("containerd://1.7" →
/// "containerd"; "docker://20.10" → "docker"). Returns Err for anything else.
pub fn detect_runtime(version: &str) -> AppResult<String>;

/// Build the nsenter argv that runs the runtime's load command, reading the
/// tar from stdin. Returns the argv (passed to kube exec).
pub fn load_command(runtime: &str) -> AppResult<Vec<String>>;

/// Parse "Loaded image: …" / "Loaded image ID: …" / "imported" lines out of
/// the load command's stdout → list of image refs.
pub fn parse_loaded_images(output: &str) -> Vec<String>;

/// The full one-shot import: create debug pod → await → exec(nsenter, tar→stdin)
/// → parse output → delete pod. Pod cleanup is unconditional (uses a
/// `defer`-style guard: even on error the pod is deleted before returning).
pub async fn import_to_node(
    client: kube::Client,
    node: &str,
    tar_bytes: &[u8],
) -> AppResult<ImportResult>;
```

**Why a separate module from `nodeshell.rs`?** `nodeshell` is the *interactive*
session (long-lived, TTY, event-streamed stdout, user types commands). Import is a
*one-shot* operation (no TTY, byte-stream stdin, capture-all stdout, return a result).
Sharing the pod-spec builder (`debug_pod_spec`) is the right boundary; the exec style
(`run_pipe`-like, no event sink) differs, so the exec glue lives here.

**Pod lifecycle:** import reuses `nodeshell::debug_pod_spec` + the orphan-sweep-on-
start pattern, but with a short lifetime — the pod is created, used for one exec, and
deleted in the same command. It never lingers. (It still gets the 1-hour
`active_deadline_seconds` backstop from the spec in case the command hangs and the
process dies before cleanup.)

**Reuse boundary (concrete):** `nodeshell::debug_pod_spec` and `nodeshell::pod_name` /
`node_selector` are already `pub` and reused as-is. The `await_debug_pod` and
`delete_debug_pod` helpers are currently *private* in `commands.rs` — to avoid
duplicating the wait-for-Running + cleanup logic, **promote them to `pub`** (or move
them into `nodeshell.rs` as the canonical home) so `imageimport::import_to_node` can
call them. This is the one small refactor the feature requires; it's net-positive (the
functions are shared infrastructure, not command-specific).

### 4.3 New Tauri command

```rust
// src-tauri/src/commands.rs
#[tauri::command]
pub async fn import_image_to_node(
    node: String,
    path: String,           // absolute path to the .tar (from the file picker)
    mgr: State<'_, Arc<CoreState>>,
) -> AppResult<imageimport::ImportResult> {
    let client = require_client(&(*mgr).manager).await?;
    let tar_bytes = std::fs::read(&path)?;   // read on backend, not frontend
    imageimport::import_to_node(client, &node, &tar_bytes).await
}
```

**Why read the file on the backend?** A `.tar` can be hundreds of MB to GB. Passing it
through the frontend as base64 (the kubeconfig pattern) would balloon memory and IPC.
Reading the path server-side keeps it as one streamed `Vec<u8>` that goes straight into
the exec stdin. The path comes from `tauri-plugin-dialog`'s native picker, which returns
an absolute filesystem path.

**Size guard:** before reading, stat the file and refuse if it exceeds a sane cap
(e.g. **8 GB** — configurable). This prevents a typo'd path to a disk image from
OOMing the app. The cap is a soft guard, surfaced as a clear error.

### 4.4 Runtime detection & command dispatch

```rust
pub fn detect_runtime(version: &str) -> AppResult<String> {
    let v = version.trim();
    if v.starts_with("containerd://") { return Ok("containerd".into()); }
    if v.starts_with("docker://")     { return Ok("docker".into()); }
    Err(AppError::Other(format!(
        "unsupported container runtime '{v}' — image import supports containerd and docker"
    )))
}

pub fn load_command(runtime: &str) -> AppResult<Vec<String>> {
    let inner = match runtime {
        "containerd" => "ctr --address /run/containerd/containerd.sock images import --no-unpack -",
        "docker"     => "docker load",
        other        => return Err(AppError::Other(format!("unsupported runtime '{other}'"))),
    };
    Ok(vec![
        "nsenter".into(), "--target".into(), "1".into(),
        "--mount".into(), "--uts".into(), "--ipc".into(),
        "--net".into(), "--pid".into(), "--".into(),
        "/bin/sh".into(), "-c".into(), inner.into(),
    ])
}
```

The `nsenter` prefix mirrors `nodeshell::nsenter_cmd` exactly — same namespaces, same
target (PID 1). Only the final `/bin/sh -c <cmd>` differs.

### 4.5 Output parsing

The two runtimes print recognisable lines:

- **containerd** (`ctr images import`): `unpacking … done`, `sha256:<digest>…`, and
  image refs in the form `docker.io/library/nginx:1.25`. We extract lines matching a
  `<registry>/<repo>:<tag>` or `<registry>/<repo>@sha256:…` pattern.
- **docker** (`docker load`): `Loaded image: nginx:1.25` or
  `Loaded image ID: sha256:…`. We extract everything after `Loaded image:` (the ID
  variant we keep as the digest string).

```rust
pub fn parse_loaded_images(output: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in output.lines() {
        let l = line.trim();
        if let Some(rest) = l.strip_prefix("Loaded image:") {
            out.push(rest.trim().to_string());
        }
        // containerd prints refs without a prefix; keep lines that look like
        // image refs (contain a ':' for tag or '@sha256:' for digest) and
        // aren't progress noise.
        else if (l.contains(':') || l.contains("@sha256:"))
            && !l.contains('%')
            && !l.starts_with("unpacking")
            && !l.starts_with("elapsed")
        {
            out.push(l.to_string());
        }
    }
    out.dedup();
    out
}
```

The exact heuristics are pinned by unit tests (§7).

---

## 5. Frontend

### 5.1 Provider interface

Add to `DataProvider` in `src/providers/types.ts`:

```ts
export interface ImportImageResult {
  runtime: string;        // "containerd" | "docker"
  output: string;         // raw load-command stdout
  images: string[];       // parsed image refs
  error: string | null;
}

export interface Provider {
  // …existing…
  /**
   * Import a local .tar image archive into a node's container runtime.
   * `path` is an absolute filesystem path from the native file picker —
   * desktop (Tauri) only. The web shell throws (no local-disk access).
   */
  importImageToNode(node: string, path: string): Promise<ImportImageResult>;
}
```

- **TauriProvider:** `invoke("import_image_to_node", { node, path })`.
- **MockProvider:** returns a fake success (`{ runtime: "containerd", images: ["demo:latest"], … }`) so the demo build can exercise the UI.
- **HttpProvider:** throws `Error("Image import is only available in the desktop app")` — mirrors how kubeconfig *file* import is Tauri-only in the web build (the web build uses *content* import instead, which doesn't apply here).

### 5.2 File picker

Reuse the kubeconfig-import pattern. The overlay holds a hidden
`<input type="file" accept=".tar">` is **not** used in Tauri (the native dialog is
better and returns a real path). Instead:

```ts
const { open } = await import("@tauri-apps/plugin-dialog");
const selected = await open({
  title: "Select image archive",
  multiple: false,
  filters: [{ name: "Image archive", extensions: ["tar"] }],
});
if (typeof selected === "string") setPath(selected);
```

The native dialog returns an absolute path, which is what the backend command expects.

### 5.3 The overlay — `src/components/imageimport/ImageImportPanel.tsx`

A new overlay component. Layout:

```
┌─ Header ──────────────────────────────────────────────┐
│  Import Image                                  [×]    │
├─ Body ────────────────────────────────────────────────┤
│  ┌─ What this does ───────────────────────────────┐   │
│  │ Imports a .tar image archive into the chosen   │   │
│  │ node's container runtime via a temporary       │   │
│  │ privileged pod. Use for air-gapped clusters.   │   │
│  └────────────────────────────────────────────────┘   │
│                                                        │
│  Target node   [ node-01 ▼ ]   containerd://1.7.22    │
│  Image archive [ Choose .tar file… ]  nginx.tar       │
│                                                        │
│  ▾ (after import:)                                     │
│  Runtime: containerd                                   │
│  Loaded images:                                        │
│    • nginx:1.25                                        │
│    • busybox:latest                                    │
└─ Footer ──────────────────────────────────────────────┘
                              [ Import → ]
```

State: `node` (string, from a node-list dropdown), `path` (string, from picker),
`busy`, `result: ImportImageResult | null`, `error`.

**Node dropdown:** populated from the existing `listNodes()` provider method. Shows
node name + runtime version (so the user sees what'll be detected). Disabled nodes
(NotReady) are greyed but selectable (import might still work on a cordoned node —
the debug pod tolerates all taints).

**Consent gate:** like `NodeShellTab`, the panel shows a short "what this does" blurb
(spawn privileged pod, nsenter to host, run container-runtime load). No separate click
to proceed — the Import button itself is the consent. The blurb sets expectations.

**Import button:** disabled until both `node` and `path` are set. While busy, shows
"Importing…". On success, the result section appears with the loaded image list. On
failure, the error shows inline (the backend's `ImportResult.error`, e.g. "unsupported
runtime 'cri-o://'").

**No progress bar in v1.** Real progress would need streaming the load command's stdout
incrementally (the `exec_pump` event path), which is a bigger lift. v1 shows a spinner +
"Importing…" with the final result. Streaming progress is a follow-up (§9).

### 5.4 Wiring — overlay key, sidebar, render switch

1. **`store.ts`** — add `"image-import"` to the `OverlayKey` union.
2. **`sidebar/NavList.tsx`** — add an entry to the Tools `items` array:
   `{ key: "image-import", label: t("chrome.sidebar.tools.imageImport", "Image Import"), icon: "⬆" }`.
3. **`App.tsx`** — add a render case:
   ```tsx
   {overlay === "image-import" && (
     <div className={styles.overlay}>
       <ImageImportPanel onClose={closeOverlay} />
     </div>
   )}
   ```

### 5.5 i18n

New keys under `chrome.sidebar.tools` (sidebar entry) and a new `imageImport.*`
namespace (panel):

```
chrome.sidebar.tools.imageImport = "Image Import"
imageImport.title            = "Import Image"
imageImport.close            = "Close"
imageImport.description      = "Imports a .tar image archive into the chosen node's container runtime via a temporary privileged pod. Use for air-gapped clusters that can't pull from public registries."
imageImport.node             = "Target node"
imageImport.archive          = "Image archive"
imageImport.chooseFile       = "Choose .tar file…"
imageImport.import           = "Import"
imageImport.importing        = "Importing…"
imageImport.runtime          = "Runtime"
imageImport.loadedImages     = "Loaded images"
imageImport.noImages         = "(no image refs parsed from output)"
imageImport.error            = "{error}"   // shown inline
imageImport.sizeWarning      = "File is large ({size}); import may take a while."
```

EN + ZH in `src/lib/i18n/dictionaries.ts`.

---

## 6. Web Shell (k7s-web)

The web shell has no local-disk access, so the native file picker doesn't apply.
`HttpProvider.importImageToNode` throws `Error("Image import is only available in the
desktop app")`. The panel can detect this (provider name / a capability flag) and show
a "desktop app only" notice instead of the picker.

We do **not** bridge `import_image_to_node` through HTTP (no `/api/invoke/...` route),
matching how the file-based kubeconfig import is Tauri-only. (If browser support is
wanted later, the path would be: `<input type=file>` → `file.arrayBuffer()` → base64 →
POST — but base64 of a multi-GB tar is impractical, which is why v1 is desktop-only.)

---

## 7. Testing

- **Unit (Rust):** `imageimport.rs` — `detect_runtime` (all three prefixes + unknown),
  `load_command` (per runtime, error on unknown), `parse_loaded_images` (docker
  `Loaded image:` lines, containerd ref lines, progress-noise filtering). These are pure
  functions, no cluster needed.
- **Unit (TS):** `ImageImportPanel` — picker sets path, node dropdown populates, Import
  disabled until both set, success renders result, error renders inline. Use
  `MockProvider.importImageToNode`.
- **Manual:** on a real cluster, `docker save nginx:1.25 -o nginx.tar`, import to a
  node, `kubectl run --image=nginx:1.25` to confirm it's usable. Repeat for a
  containerd node.

---

## 8. Files to Change

### Backend (Rust)
| File | Change |
|---|---|
| `src-tauri/src/kube/imageimport.rs` | **New.** `ImportResult`, `detect_runtime`, `load_command`, `parse_loaded_images`, `import_to_node`. Unit tests. |
| `src-tauri/src/commands.rs` | Add `import_image_to_node` Tauri command (reads file, calls `import_to_node`). |
| `src-tauri/src/lib.rs` | Register `import_image_to_node` in `invoke_handler!`. |
| `src-tauri/src/kube/mod.rs` | `pub mod imageimport;` |

**Note:** `nodeshell.rs` gains two `pub` re-exports (`await_debug_pod`,
`delete_debug_pod` — promoted from `commands.rs`, see §4.2). `exec.rs` and
`pod_files.rs` are **not** modified — import reuses their public surface. The exec
byte-streaming in `import_to_node` follows the `pod_files::run_pipe` pattern (stdin +
stdout capture + exit status) but is implemented inline in `imageimport.rs` because it
needs the `nsenter` argv rather than a pod path; it does not call `run_pipe` directly.

### Frontend (TS/React)
| File | Change |
|---|---|
| `src/providers/types.ts` | Add `ImportImageResult` type + `importImageToNode` to `Provider`. |
| `src/providers/tauri/TauriProvider.ts` | Implement via `invoke`. |
| `src/providers/mock/MockProvider.ts` | Implement mock success. |
| `src/providers/HttpProvider.ts` | Throw "desktop app only". |
| `src/store.ts` | Add `"image-import"` to `OverlayKey`. |
| `src/components/sidebar/NavList.tsx` | Add Tools entry. |
| `src/App.tsx` | Add overlay render case. |
| `src/components/imageimport/ImageImportPanel.tsx` | **New.** The overlay UI. |
| `src/components/imageimport/ImageImportPanel.module.css` | **New.** Styles. |
| `src/lib/i18n/dictionaries.ts` | Add `chrome.sidebar.tools.imageImport` + `imageImport.*` (EN + ZH). |

---

## 9. Open Questions / Deferred

- **Streaming progress:** v1 shows a spinner only. Real progress (transfer %, load %)
  would reuse the `exec_pump` event channel to stream stdout incrementally. Follow-up.
- **Multi-node batch import:** v1 is one node. A "import to all nodes" toggle would loop
  the command per node with per-node status. Follow-up.
- **Pull from private registry → tar → import:** a combined flow reusing the OCI client
  (`imagerepo.rs`) would need blob fetch + OCI tar assembly. Separate feature.
- **cri-o support:** cri-o nodes get a clear "unsupported runtime" error in v1. cri-o
  load goes through `crictl` + a registry, which doesn't fit the tar-import model.
- **Disk-size guard value:** 8 GB default. Tunable via prefs if real-world images are
  larger.
