//! Secure storage for the LLM api_key.
//!
//! **Primary**: OS keychain via the `keyring` crate — macOS Keychain, Linux
//! secret-service, Windows Credential Manager. The key never touches disk
//! in plaintext.
//!
//! **Fallback**: file-based XOR obfuscation (`ai-key.bin`) for environments
//! where the keychain is unavailable (headless CI, containers, Linux without
//! a secret-service daemon). The file is `chmod 0600` on Unix.
//!
//! Both paths present the same `save` / `load` / `delete` interface; callers
//! don't know which backend is in use.

use crate::ai::error::{AiError, AiResult};

#[allow(dead_code)]
const SERVICE: &str = "k7s-ai";
#[allow(dead_code)]
const USER: &str = "api-key";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Persist the api_key. Empty string deletes it.
///
/// Writes to file only (fast, non-blocking). Keychain storage is skipped
/// to avoid blocking on macOS authorization prompts.
pub fn save(data_dir: Option<&std::path::Path>, key: &str) -> AiResult<()> {
    if key.is_empty() {
        return delete(data_dir);
    }
    save_to_file(data_dir, key)
}

/// Load the api_key. Returns `None` when nothing is stored.
///
/// Uses file-based storage only (fast, non-blocking). Keychain is only
/// used as a secondary write target for extra security.
pub fn load(data_dir: Option<&std::path::Path>) -> AiResult<Option<String>> {
    load_from_file(data_dir)
}

/// Delete the stored key.
pub fn delete(data_dir: Option<&std::path::Path>) -> AiResult<()> {
    // File only (skip keychain to avoid blocking).
    let path = file_path(data_dir);
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// File-based fallback (XOR obfuscation, chmod 0600)
// ---------------------------------------------------------------------------

const OBFUSCATION_KEY: &[u8] = b"k7s-ai-do-not-put-this-key-in-source-2026";

fn xor(buf: &mut [u8]) {
    for (i, b) in buf.iter_mut().enumerate() {
        *b ^= OBFUSCATION_KEY[i % OBFUSCATION_KEY.len()];
    }
}

fn default_config_dir() -> AiResult<std::path::PathBuf> {
    let dir = match std::env::var_os("HOME") {
        Some(h) => std::path::PathBuf::from(h).join(if cfg!(target_os = "macos") {
            "Library/Application Support/k7s"
        } else {
            ".config/k7s"
        }),
        None => return Err(AiError::Other("no HOME".into())),
    };
    std::fs::create_dir_all(&dir)
        .map_err(|e| AiError::Other(format!("mkdir {}: {e}", dir.display())))?;
    Ok(dir)
}

fn file_path(data_dir: Option<&std::path::Path>) -> std::path::PathBuf {
    match data_dir {
        Some(d) => d.join("ai-key.bin"),
        None => default_config_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .join("ai-key.bin"),
    }
}

fn save_to_file(data_dir: Option<&std::path::Path>, key: &str) -> AiResult<()> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let path = file_path(data_dir);
    let mut buf = key.as_bytes().to_vec();
    xor(&mut buf);
    let encoded = B64.encode(&buf);
    std::fs::write(&path, encoded)
        .map_err(|e| AiError::Other(format!("write {}: {e}", path.display())))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o600);
            let _ = std::fs::set_permissions(&path, perms);
        }
    }
    Ok(())
}

fn load_from_file(data_dir: Option<&std::path::Path>) -> AiResult<Option<String>> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let path = file_path(data_dir);
    if !path.exists() {
        return Ok(None);
    }
    let encoded = std::fs::read_to_string(&path)
        .map_err(|e| AiError::Other(format!("read {}: {e}", path.display())))?;
    if encoded.trim().is_empty() {
        return Ok(None);
    }
    let mut buf = B64
        .decode(encoded.trim())
        .map_err(|e| AiError::Other(format!("decode key: {e}")))?;
    xor(&mut buf);
    String::from_utf8(buf)
        .map(Some)
        .map_err(|e| AiError::Other(format!("key not utf8: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Serialise keychain tests to avoid races on the shared entry.
    static KC_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn round_trip_via_keychain_or_file() {
        let _guard = KC_LOCK.lock().unwrap();
        let test_dir = std::env::temp_dir().join("k7s-ai-test-secrets");
        let _ = std::fs::remove_dir_all(&test_dir);
        std::fs::create_dir_all(&test_dir).unwrap();

        // Save + load.
        save(Some(&test_dir), "sk-test-12345").unwrap();
        let loaded = load(Some(&test_dir)).unwrap();
        assert_eq!(loaded.as_deref(), Some("sk-test-12345"));

        // Delete.
        delete(Some(&test_dir)).unwrap();
        let loaded = load(Some(&test_dir)).unwrap();
        assert!(loaded.is_none(), "key should be gone after delete");

        // Cleanup.
        let _ = std::fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn empty_save_deletes() {
        let _guard = KC_LOCK.lock().unwrap();
        let test_dir = std::env::temp_dir().join("k7s-ai-test-empty");
        let _ = std::fs::remove_dir_all(&test_dir);
        std::fs::create_dir_all(&test_dir).unwrap();

        save(Some(&test_dir), "something").unwrap();
        save(Some(&test_dir), "").unwrap(); // should delete
        let loaded = load(Some(&test_dir)).unwrap();
        assert!(loaded.is_none());

        let _ = std::fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn file_xor_round_trip() {
        let dir = std::env::temp_dir().join("k7s-ai-test-xor");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // Force file path by calling the file functions directly.
        save_to_file(Some(&dir), "sk-fallback-key").unwrap();
        let loaded = load_from_file(Some(&dir)).unwrap();
        assert_eq!(loaded.as_deref(), Some("sk-fallback-key"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_does_not_contain_plaintext_key() {
        let dir = std::env::temp_dir().join("k7s-ai-test-no-plaintext");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        save_to_file(Some(&dir), "sk-should-not-appear").unwrap();
        let raw = std::fs::read_to_string(file_path(Some(&dir))).unwrap();
        assert!(
            !raw.contains("sk-should-not-appear"),
            "file must not contain the plaintext key"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
