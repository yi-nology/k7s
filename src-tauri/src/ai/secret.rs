//! Encrypted-at-rest storage for the LLM api_key.
//!
//! k7s already ships `base64` (used by kube raw-HTTP requests), so we lean on
//! it for the wire encoding and add a lightweight XOR-with-a-fixed-key layer on
//! top. This is **not** real cryptography — it only stops the key from showing
//! up in plaintext on disk or in a `cat`. The TODO at the bottom tracks an
//! upgrade to the OS keychain (macOS Keychain / Linux secret-service).
//!
//! The key file lives at `<config_dir>/ai-key.bin` next to `ai-config.json`.

use crate::ai::error::{AiError, AiResult};
use std::path::PathBuf;

// A fixed obfuscation key. Again: obfuscation, not encryption. Good enough to
// keep the key out of `git diff` screenshots; upgrade to the OS keychain before
// claiming this protects against a determined local attacker.
#[allow(non_upper_case_globals)]
const OBfuscATION_KEY: &[u8] = b"k7s-ai-do-not-put-this-key-in-source-2026";

fn xor(buf: &mut [u8]) {
    for (i, b) in buf.iter_mut().enumerate() {
        *b ^= OBfuscATION_KEY[i % OBfuscATION_KEY.len()];
    }
}

fn default_config_dir() -> AiResult<PathBuf> {
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

fn key_path(data_dir: Option<&std::path::Path>) -> AiResult<PathBuf> {
    Ok(match data_dir {
        Some(d) => d.join("ai-key.bin"),
        None => default_config_dir()?.join("ai-key.bin"),
    })
}

/// Persist the api_key, obfuscated. Empty `key` deletes the file.
pub fn save(data_dir: Option<&std::path::Path>, key: &str) -> AiResult<()> {
    let path = key_path(data_dir)?;
    if key.is_empty() {
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
        return Ok(());
    }
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let mut buf = key.as_bytes().to_vec();
    xor(&mut buf);
    let encoded = B64.encode(&buf);
    std::fs::write(&path, encoded)
        .map_err(|e| AiError::Other(format!("write {}: {e}", path.display())))?;
    // Restrict permissions on Unix so other users can't read the key.
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

/// Load and de-obfuscate the api_key. Returns `None` if no key file exists.
pub fn load(data_dir: Option<&std::path::Path>) -> AiResult<Option<String>> {
    let path = key_path(data_dir)?;
    if !path.exists() {
        return Ok(None);
    }
    let encoded = std::fs::read_to_string(&path)
        .map_err(|e| AiError::Other(format!("read {}: {e}", path.display())))?;
    if encoded.trim().is_empty() {
        return Ok(None);
    }
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let mut buf = B64
        .decode(encoded.trim())
        .map_err(|e| AiError::Other(format!("decode key: {e}")))?;
    xor(&mut buf);
    String::from_utf8(buf)
        .map(Some)
        .map_err(|e| AiError::Other(format!("key not utf8: {e}")))
}

// TODO(ai): replace file obfuscation with the OS keychain —
// `security` CLI / keychain on macOS, `secret-service` crate on Linux,
// `keyring` crate as a cross-platform wrapper. The trait surface (`save`/`load`)
// should stay the same so callers don't change.
