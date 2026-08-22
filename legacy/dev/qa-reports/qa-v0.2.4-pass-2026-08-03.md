# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai)

## Area tested

**Command palette (B28) — ⌘K**, end to end in both EN and ZH:

- Open via the topbar button and via `Ctrl/Cmd+K` keyboard shortcut
- Empty palette — kinds + app commands listed, objects omitted
- Live search by object name (`valkyrie`) — kinds + object hits ranked together
- `ns:` prefix scope (`ns:prod wiki`)
- Arrow-key cursor movement, mouse hover syncs cursor, Enter to run, Esc to close
- Language switch to `中文` and back
- App-command labels in the palette (the bug)
- Cordon / Uncordon node-action labels (with `selectedRow.name`)
- Hint chip on the right of each action

## Findings

### high — palette app-command labels were hardcoded English in zh locale

`src/lib/palette.ts` (lines around 226–254, before this pass) built
`Open settings`, `Import kubeconfig…`, `Cordon ${node}`, `Uncordon
${node}` as raw English strings. The `chrome.palette` dict already
shipped localised copies of the placeholder, empty state, and footer
text, so the palette was mostly translated — except the very row the
user picks.

The right-hand `app` / `node` hint chips were also hardcoded English,
so even after the action label was translated, the chip on the right
still read `app`.

**Repro** (before the fix, in zh):
- Open palette → see `Open settings  app` and `Import kubeconfig…  app`
  in a fully Chinese UI.

### low — object-candidate kind hints are in English even in zh

`palette.ts`'s `objectCandidates` uses `kindLabelFor(kind, customKinds)`
which reads the ENGLISH label from `KIND_META`, so an object hit in zh
reads `valkyrie-api  Pods · prod` (English) instead of `valkyrie-api  Pod · prod`
(Chinese). The kind *candidates* above are localised correctly via
`i18nKindLabel`, so only the object hint is mixed-language.

Not fixed in this pass because (a) it is consistent with how k9s
renders kind names, and (b) the user can usually read the row name
itself and the kind is just a tag. Logged for a future pass; if the
project wants this translated, change `kindLabelFor` to take `locale`
and route through `i18nKindLabel` for the built-ins.

## Fixes applied

| File | Change |
|---|---|
| `src/lib/i18n/dictionaries.ts` | Added `chrome.palette.actions.{settings, importKubeconfig, cordon, uncordon}` and `chrome.palette.actionHint{App, Node}` to both EN and ZH dicts, plus the matching entries in the `Dictionary` interface. |
| `src/lib/palette.ts` | `actionCandidates` now reads every label and hint through a small `paletteStr(locale, key, fallback, ...args)` helper that walks the active dict, then the English one, then a hardcoded string. Targets keep the canonical English verb so a zh user typing `settings` still hits `打开设置`. |
| `src/lib/palette.test.ts` | +4 tests covering zh app-action labels, EN defaults, zh node-action labels, and bilingual search. |

Commit: **`29b0fd5`** — *fix(i18n): translate palette action labels and hints*

## Verification

```
$ npx tsc --noEmit          # silent
$ npx vitest run            # 17 files, 309 tests, all green
$ cargo check --manifest-path src-tauri/Cargo.toml
  Finished `dev` profile in 1.98s   # 4 pre-existing dead-code warnings, unrelated
```

Browser re-verified in dev server:

- **EN** palette shows `Open settings  app`, `Import kubeconfig…  app`,
  footer `↑↓ move ⏎ open esc close`.
- **ZH** palette shows `打开设置  应用`, `导入 kubeconfig…  应用`,
  footer `↑↓ 选择 ⏎ 打开 esc 关闭`.
- Search by `valkyrie` still returns the same set of kind + object hits
  in both locales, with highlighting.
- `Esc` still closes the palette without clearing the table filter
  underneath (the existing `e.stopPropagation()` in `onKeyDown` is
  untouched).

## Notes for next pass

- ⌘K palette is now clean. The next biggest target is probably
  **Service Topology** (#3) — d3-force rendering over an overlay is the
  usual kind of "looks great in mock, breaks in Tauri" surface, and the
  recent UX pass for the dashboard overlay suggests there are
  similar overlay-vs-canvas patterns worth a dedicated look.
- Keep an eye on the **Object-candidate kind-hint** English leak
  (logged as low in this pass). If the project wants a fully zh chrome,
  a five-line `kindLabelFor(locale)` swap closes it.
