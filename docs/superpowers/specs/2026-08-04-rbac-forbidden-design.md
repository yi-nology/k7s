# RBAC Forbidden State — Design

Date: 2026-08-04
Status: approved by user

## Background

When a kubeconfig uses a low-privilege ServiceAccount (or any RBAC-scoped user),
certain resource kinds return 403 Forbidden on list/watch. The current behavior:
- Backend: `default_backoff()` retries silently forever, emitting nothing to the frontend
- Frontend: table shows "no resources", sidebar shows "0" — both indistinguishable from "truly empty"

The user wants the UI to **distinguish empty vs no permission**.

## Scope

Rust backend + TypeScript frontend. Changes are additive (new event type, new store
field, new UI states). No changes to existing behavior for authorized resources.

## Design

### Backend (Rust)

**New event**: `WATCH_KIND_STATUS` (`"watch-kind-status"`)
- Payload: `{ kind: String, status: "ok" | "forbidden" }`
- Emitted from the `pump()` function in `watchers.rs`

**Detection**: `kube::Error` from `watcher::Error` wraps HTTP status codes. When the
error string contains `"403"` or `"Forbidden"`, classify as `"forbidden"`. When the
next watch event succeeds, emit `"ok"` to clear the status.

**Implementation in `pump()`**:
```rust
// In the match arm for Some(Err(e)):
let status = if is_forbidden(&e) { "forbidden" } else { "error" };
if status == "forbidden" {
    let _ = sink.emit(events::WATCH_KIND_STATUS, &KindStatus { kind: kind.clone(), status: "forbidden" });
}
```

When `Some(Ok(_))` fires (watch recovered), emit `"ok"`:
```rust
Some(Ok(_)) => {
    if was_forbidden {
        let _ = sink.emit(events::WATCH_KIND_STATUS, &KindStatus { kind: kind.clone(), status: "ok" });
        was_forbidden = false;
    }
    dirty = true;
}
```

### Frontend — Store

New field in the Zustand store:
```ts
watchStatus: Record<string, "ok" | "forbidden" | "loading">;
setWatchStatus: (kind: string, status: "ok" | "forbidden" | "loading") => void;
```

Initialized as `{}`. Updated by the new `watch-kind-status` event listener.

### Frontend — Sidebar

In `NavList.tsx`, for each kind item, check `watchStatus[kind]`:
- `"forbidden"`: render a lock icon (`<Lock size={14} />` from lucide) instead of the
  row count, with `color: var(--text-faint)` and a tooltip "RBAC: no permission to list"
- `"ok"` or undefined: render the count as before

### Frontend — Table

In `ResourceTable.tsx`, when `rows[kind]` is empty AND `watchStatus[kind] === "forbidden"`:
- Show a dedicated forbidden state instead of "no resources":
  ```
  🔒 当前账户无权查看此资源 (RBAC Forbidden)
  [重试]
  ```
- The "重试" button triggers a reconnect or re-watch for that kind

### Frontend — Provider interface

Add to `ProviderTypes.ts`:
```ts
onWatchKindStatus(cb: (kind: string, status: "ok" | "forbidden") => void): Unsub;
```

Implement in both `TauriProvider` and `HttpProvider` (SSE) and `MockProvider` (noop).

## Files to modify

| Layer | File | Change |
|---|---|---|
| Rust | `src-tauri/src/kube/mod.rs` | Add `WATCH_KIND_STATUS` constant + `KindStatus` struct |
| Rust | `src-tauri/src/kube/watchers.rs` | Detect 403 in `pump()`, emit kind status |
| TS | `src/providers/types.ts` | Add `onWatchKindStatus` to provider interface |
| TS | `src/providers/tauri/TauriProvider.ts` | Implement `onWatchKindStatus` |
| TS | `src/providers/HttpProvider.ts` | Implement `onWatchKindStatus` |
| TS | `src/providers/mock/MockProvider.ts` | Implement `onWatchKindStatus` (noop) |
| TS | `src/store.ts` | Add `watchStatus` field + setter |
| TS | `src/hooks/useBootstrap.ts` | Wire up `onWatchKindStatus` listener |
| TS | `src/components/sidebar/NavList.tsx` | Lock icon for forbidden kinds |
| TS | `src/components/sidebar/Sidebar.module.css` | Forbidden state styles |
| TS | `src/components/table/ResourceTable.tsx` | Forbidden empty state |
| TS | `src/components/table/ResourceTable.module.css` | Forbidden state styles |
| TS | `src/lib/i18n/dictionaries.ts` | Add i18n keys for forbidden message |

## Testing

- Unit test: `pump()` emitting `WATCH_KIND_STATUS` on simulated 403
- Unit test: store `watchStatus` setter
- Unit test: sidebar renders lock icon when status is "forbidden"
- Manual: switch to a low-privilege kubeconfig, verify forbidden kinds show lock + message
