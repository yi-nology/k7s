//! Config mapping: ConfigMap, Secret, ServiceAccount.

use super::*;
use k7s_deps::k8s_openapi::api::core::v1::{ConfigMap, Secret, ServiceAccount};

/// ConfigMaps: NAME, NAMESPACE, DATA, AGE.
pub fn map_configmap(cm: &ConfigMap) -> Row {
    let data = cm.data.as_ref().map(|d| d.len()).unwrap_or(0)
        + cm.binary_data.as_ref().map(|d| d.len()).unwrap_or(0);
    let cells = vec![
        name_cell(cm),
        ns_cell(cm),
        Cell::new(data.to_string(), Tone::Secondary),
        age_cell(cm),
    ];
    simple_row(cm, cells)
}

/// Secrets: NAME, NAMESPACE, TYPE, DATA, AGE. (Values are never surfaced.)
pub fn map_secret(sec: &Secret) -> Row {
    let ty = sec.type_.clone().unwrap_or_else(|| "Opaque".into());
    let data = sec.data.as_ref().map(|d| d.len()).unwrap_or(0)
        + sec.string_data.as_ref().map(|d| d.len()).unwrap_or(0);
    let cells = vec![
        name_cell(sec),
        ns_cell(sec),
        Cell::new(ty, Tone::Secondary),
        Cell::new(data.to_string(), Tone::Secondary),
        age_cell(sec),
    ];
    simple_row(sec, cells)
}

/// ServiceAccounts: NAME, NAMESPACE, SECRETS, AGE.
///
/// SECRETS keeps kubectl's column even though Kubernetes stopped auto-creating
/// token Secrets in 1.24, so it reads 0 on any modern cluster (all 69 of murphy-yi's
/// do). It earns its place by the exception: a non-zero count means someone
/// attached a long-lived token by hand, which is exactly the thing worth
/// noticing — so it's toned rather than left as flat data.
pub fn map_serviceaccount(sa: &ServiceAccount) -> Row {
    let secrets = sa.secrets.as_ref().map(|s| s.len()).unwrap_or(0);
    let cells = vec![
        name_cell(sa),
        ns_cell(sa),
        Cell::new(
            secrets.to_string(),
            if secrets > 0 {
                Tone::Warn
            } else {
                Tone::Secondary
            },
        ),
        age_cell(sa),
    ];
    simple_row(sa, cells)
}

#[cfg(test)]
mod tests {
    use super::*;
    use k7s_deps::serde_json::json;

    /// A ServiceAccount's SECRETS column is 0 on any cluster since 1.24 — the
    /// column earns its place by the exception, so a hand-attached token reads
    /// amber rather than blending in as ordinary data.
    #[test]
    fn serviceaccount_flags_a_hand_attached_token() {
        let sa = |secrets: k7s_deps::serde_json::Value| -> ServiceAccount {
            k7s_deps::serde_json::from_value(json!({
                "metadata": { "name": "ci", "namespace": "prod", "uid": "a1" },
                "secrets": secrets,
            }))
            .unwrap()
        };
        // Columns: NAME,NAMESPACE,SECRETS,AGE
        let modern = map_serviceaccount(&sa(json!([])));
        assert_eq!(modern.cells[2].text, "0");
        assert_eq!(modern.cells[2].tone, Tone::Secondary);

        let legacy = map_serviceaccount(&sa(json!([{ "name": "ci-token-abc" }])));
        assert_eq!(legacy.cells[2].text, "1");
        assert_eq!(
            legacy.cells[2].tone,
            Tone::Warn,
            "a long-lived token is worth noticing"
        );
    }
}
