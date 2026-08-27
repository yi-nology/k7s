//! Command-surface reconciliation tests.
//!
//! The Tauri IPC list (`register_commands!`), the `#[tauri::command]`
//! functions, and the `CommandRegistry` are three hand-maintained views of
//! one surface. v0.5.2 shipped with 27 commands present in one view and
//! missing from another; these tests make that class of drift fail the
//! build instead:
//!
//! 1. `COMMAND_NAMES` == the macro list (parsed from lib.rs source)
//! 2. `COMMAND_NAMES` == every `#[tauri::command]` fn (parsed from
//!    commands/**.rs source)
//! 3. registry ⊇ COMMAND_NAMES − WEB_BESPOKE (the interactive AI commands
//!    and prefs live on dedicated k7s-server routes instead), and the
//!    registry contains nothing outside COMMAND_NAMES.
//!
//! Tests parse source files with plain string scans — no syn/proc-macro
//! machinery — so they run anywhere the crate builds.

use std::collections::BTreeSet;
use std::path::PathBuf;

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn command_names_const() -> BTreeSet<&'static str> {
    k7s_commands::COMMAND_NAMES.iter().copied().collect()
}

/// Names parsed from the `register_commands!` macro body in src/lib.rs.
fn macro_names() -> BTreeSet<String> {
    let src =
        std::fs::read_to_string(manifest_dir().join("src/lib.rs")).expect("src/lib.rs is readable");
    src.lines()
        .filter_map(|l| {
            let l = l.trim();
            // Macro entries look like `$crate::commands::name,` possibly
            // behind a `#[cfg(...)]` line (which we ignore — the const is
            // the union across platforms).
            l.strip_prefix("$crate::commands::")
                .map(|rest| rest.trim_end_matches(',').to_string())
        })
        .collect()
}

/// Names parsed from `#[tauri::command]` / `#[cfg_attr(feature = "ipc",
/// tauri::command)]` attribute occurrences in src/commands/**.rs. We scan
/// backwards for the attribute, forwards for the fn name — no parsing of
/// the fn body.
fn tauri_command_fns() -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let commands_dir = manifest_dir().join("src/commands");
    let mut stack = vec![commands_dir.clone()];
    let mut files = Vec::new();
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().and_then(|x| x.to_str()) == Some("rs") {
                files.push(p);
            }
        }
    }
    for f in files {
        let src = std::fs::read_to_string(&f).expect("readable");
        // Index of every command attribute; the fn name is the first
        // `fn <name>` after each one (attributes sit directly above it,
        // possibly with doc comments between — those don't contain "fn ").
        let idxs: Vec<usize> = src
            .match_indices("tauri::command")
            .map(|(i, _)| i)
            .collect();
        for i in idxs {
            let rest = &src[i..];
            if let Some(fn_at) = rest.find("fn ") {
                let after = &rest[fn_at + 3..];
                let name: String = after
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                    .collect();
                if !name.is_empty() {
                    out.insert(name);
                }
            }
        }
    }
    out
}

/// The interactive AI surface + prefs commands: present in the macro (and
/// behind `#[tauri::command]`), but served by dedicated k7s-server routes
/// (they need WebState: SSE streaming, approval flow, file dialogs). The
/// k7s-server reconciliation test asserts exactly these names have routes
/// there. Everything else must be in the registry.
const WEB_BESPOKE: &[&str] = &[
    "ai_approve_tool_call",
    "ai_cancel",
    "ai_chat",
    "ai_cron_add",
    "ai_cron_delete",
    "ai_cron_list",
    "ai_cron_presets",
    "ai_cron_toggle",
    "ai_evolution_strategies",
    "ai_get_config",
    "ai_get_context",
    "ai_list_skills",
    "ai_memory_add",
    "ai_memory_clear",
    "ai_memory_delete",
    "ai_memory_list",
    "ai_memory_preferences",
    "ai_memory_search",
    "ai_memory_search_vault",
    "ai_save_api_key",
    "ai_save_config",
    "ai_test_connection",
    "load_prefs",
    "save_prefs",
];

#[test]
fn command_names_matches_macro_list() {
    let expect: BTreeSet<String> = command_names_const()
        .into_iter()
        .map(|s| s.to_string())
        .collect();
    let got = macro_names();
    let missing: Vec<_> = expect.difference(&got).collect();
    let extra: Vec<_> = got.difference(&expect).collect();
    assert!(
        missing.is_empty() && extra.is_empty(),
        "COMMAND_NAMES drifted from the register_commands! macro.\n  missing from const: {missing:?}\n  extra in const: {extra:?}"
    );
}

#[test]
fn command_names_matches_tauri_command_fns() {
    let expect: BTreeSet<String> = command_names_const()
        .into_iter()
        .map(|s| s.to_string())
        .collect();
    let got = tauri_command_fns();
    let missing: Vec<_> = expect.difference(&got).collect();
    let extra: Vec<_> = got.difference(&expect).collect();
    assert!(
        missing.is_empty() && extra.is_empty(),
        "COMMAND_NAMES drifted from the #[tauri::command] fns.\n  const lists but no command fn: {missing:?}\n  command fn but not in const: {extra:?}"
    );
}

#[test]
fn registry_covers_every_non_bespoke_command() {
    let registry = k7s_commands::registry::build_registry();
    let registered: BTreeSet<&str> = registry.names().collect();
    let const_names = command_names_const();
    let bespoke: BTreeSet<&str> = WEB_BESPOKE.iter().copied().collect();

    let unregistered: Vec<_> = const_names
        .difference(&registered)
        .filter(|n| !bespoke.contains(**n))
        .collect();
    assert!(
        unregistered.is_empty(),
        "commands reachable on Tauri but NOT via the web registry (add a \
         register() call or list them in WEB_BESPOKE with a reason): {unregistered:?}"
    );

    let outside: Vec<_> = registered.difference(&const_names).collect::<Vec<_>>();
    assert!(
        outside.is_empty(),
        "registry contains names that are not #[tauri::command]s: {outside:?}"
    );

    // The bespoke list must stay minimal — every entry needs a dedicated
    // k7s-server route (checked by k7s-server's reconciliation test).
    for n in &bespoke {
        assert!(
            !registered.contains(n),
            "`{n}` is registered AND listed as bespoke — remove one of the two"
        );
    }
}

#[test]
fn command_names_has_no_duplicates() {
    let mut seen = std::collections::BTreeSet::new();
    for n in k7s_commands::COMMAND_NAMES {
        assert!(
            seen.insert(n),
            "duplicate command name in COMMAND_NAMES: {n}"
        );
    }
}
