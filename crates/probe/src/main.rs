// Standalone Rust probe - uses kube-rs directly, no Tauri dependency.
// This is the actual backend code path that k7s uses, just packaged as a
// regular binary (not cdylib) to bypass the Tauri DLL MinGW link issue.
//
// Run from repo root:
//   cargo run --manifest-path crates/probe/Cargo.toml
//   KUBECONFIG=... cargo run --manifest-path crates/probe/Cargo.toml

use std::env;
use std::path::PathBuf;

use anyhow::{Context, Result};
use k8s_openapi::api::apps::v1::Deployment;
use k8s_openapi::api::core::v1::{Namespace, Node, Pod, Service};
use kube::api::{Api, ListParams, ResourceExt as _};
use kube::config::Kubeconfig;
use kube_client::Client;

fn find_kubeconfig() -> Result<PathBuf> {
    if let Ok(p) = env::var("KUBECONFIG") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Ok(pb);
        }
    }
    for cand in &[
        "../kubeconfig.yaml",
        "kubeconfig.yaml",
        "../../kubeconfig.yaml",
        "C:/Users/zy843/Documents/k7s/kubeconfig.yaml",
    ] {
        let pb = PathBuf::from(cand);
        if pb.exists() {
            return Ok(pb);
        }
    }
    anyhow::bail!("no kubeconfig.yaml found (set KUBECONFIG or place file in repo root)")
}

async fn build_client() -> Result<Client> {
    let mut kc = Kubeconfig::read().context("read kubeconfig")?;
    if kc.current_context.is_none() {
        kc.current_context = Some("default".to_string());
    }
    let config = kube::Config::from_custom_kubeconfig(kc, &Default::default())
        .await
        .context("build kube config")?;
    Client::try_from(config).context("build kube client")
}

fn section(title: &str) {
    println!("\n=== {title} ===");
}

fn row(cells: &[&str], widths: &[usize]) -> String {
    cells
        .iter()
        .zip(widths)
        .map(|(c, w)| format!(" {:<w$} ", c, w = w))
        .collect::<Vec<_>>()
        .join("|")
}

fn table(headers: &[&str], rows: Vec<Vec<String>>) {
    let widths: Vec<usize> = headers
        .iter()
        .enumerate()
        .map(|(i, h)| {
            rows
                .iter()
                .map(|r| r.get(i).map(|s| s.len()).unwrap_or(0))
                .chain(std::iter::once(h.len()))
                .max()
                .unwrap_or(0)
        })
        .collect();
    println!("{}", row(&headers.iter().map(|s| s.as_ref()).collect::<Vec<_>>(), &widths));
    println!(
        "{}",
        widths
            .iter()
            .map(|w| "-".repeat(w + 2))
            .collect::<Vec<_>>()
            .join("+")
    );
    for r in &rows {
        let refs: Vec<&str> = r.iter().map(|s| s.as_str()).collect();
        println!("{}", row(&refs, &widths));
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let kc_path = find_kubeconfig()?;
    println!("→ using kubeconfig: {}", kc_path.display());
    env::set_var("KUBECONFIG", &kc_path);

    println!("→ building client...");
    let client = build_client().await?;
    println!("✓ client ready");

    section("Contexts");
    let kc = Kubeconfig::read()?;
    for ctx in &kc.contexts {
        let cur = kc.current_context.as_deref() == Some(ctx.name.as_str());
        let (cluster, user, namespace) = match ctx.context.as_ref() {
            Some(c) => (c.cluster.clone(), c.user.clone().unwrap_or_default(), c.namespace.clone()),
            None => (String::new(), String::new(), None),
        };
        println!(
            "  {}{} cluster={} user={} ns={}",
            if cur { "● " } else { "  " },
            ctx.name,
            cluster,
            user,
            namespace.as_deref().unwrap_or("<none>")
        );
    }

    section("Nodes");
    let nodes: Api<Node> = Api::all(client.clone());
    let ns_list = nodes.list(&ListParams::default()).await?;
    let rows: Vec<Vec<String>> = ns_list
        .iter()
        .map(|n| {
            let ready = n
                .status
                .as_ref()
                .and_then(|s| s.conditions.as_ref())
                .and_then(|c| c.iter().find(|c| c.type_ == "Ready"))
                .map(|c| if c.status == "True" { "Ready" } else { "NotReady" })
                .unwrap_or("Unknown")
                .to_string();
            let roles: Vec<String> = n
                .metadata
                .labels
                .as_ref()
                .map(|m| {
                    m.iter()
                        .filter(|(k, _)| k.starts_with("node-role.kubernetes.io/"))
                        .map(|(k, _)| {
                            k.trim_start_matches("node-role.kubernetes.io/").to_string()
                        })
                        .collect()
                })
                .unwrap_or_default();
            let ver = n
                .status
                .as_ref()
                .and_then(|s| s.node_info.clone())
                .map(|i| i.kubelet_version)
                .unwrap_or_default();
            vec![n.name_any(), ready, ver, roles.join(",")]
        })
        .collect();
    table(&["NAME", "STATUS", "VERSION", "ROLES"], rows);

    section("Namespaces");
    let nss: Api<Namespace> = Api::all(client.clone());
    let nss_list = nss.list(&ListParams::default()).await?;
    let rows: Vec<Vec<String>> = nss_list
        .iter()
        .map(|ns| {
            let phase = ns
                .status
                .as_ref()
                .and_then(|s| s.phase.clone())
                .unwrap_or_else(|| "—".to_string());
            vec![ns.name_any(), phase]
        })
        .collect();
    table(&["NAME", "STATUS"], rows);

    section("Deployments (all namespaces)");
    let deps: Api<Deployment> = Api::all(client.clone());
    let dlist = deps.list(&ListParams::default()).await?;
    let rows: Vec<Vec<String>> = dlist
        .iter()
        .map(|d| {
            let desired = d.spec.as_ref().and_then(|s| s.replicas).unwrap_or(0);
            let ready = d
                .status
                .as_ref()
                .and_then(|s| s.ready_replicas)
                .unwrap_or(0);
            vec![
                d.namespace().unwrap_or_default(),
                d.name_any(),
                format!("{}/{}", ready, desired),
                d.status
                    .as_ref()
                    .and_then(|s| s.available_replicas)
                    .unwrap_or(0)
                    .to_string(),
            ]
        })
        .collect();
    table(&["NAMESPACE", "NAME", "READY", "AVAILABLE"], rows);

    section("Services (all namespaces)");
    let svcs: Api<Service> = Api::all(client.clone());
    let slist = svcs.list(&ListParams::default()).await?;
    let rows: Vec<Vec<String>> = slist
        .iter()
        .map(|s| {
            let kind = s
                .spec
                .as_ref()
                .and_then(|sp| sp.type_.clone())
                .unwrap_or_else(|| "ClusterIP".to_string());
            let ports = s
                .spec
                .as_ref()
                .and_then(|sp| sp.ports.as_ref())
                .map(|ports| {
                    ports
                        .iter()
                        .map(|p| {
                            format!(
                                "{}/{}",
                                p.port,
                                p.target_port
                                    .as_ref()
                                    .map(|tp| match tp {
                                        k8s_openapi::apimachinery::pkg::util::intstr::IntOrString::Int(i) => i.to_string(),
                                        k8s_openapi::apimachinery::pkg::util::intstr::IntOrString::String(s) => s.clone(),
                                    })
                                    .unwrap_or_default()
                            )
                        })
                        .collect::<Vec<_>>()
                        .join(",")
                })
                .unwrap_or_default();
            vec![s.namespace().unwrap_or_default(), s.name_any(), kind, ports]
        })
        .collect();
    table(&["NAMESPACE", "NAME", "TYPE", "PORTS"], rows);

    section("Pods (kube-system)");
    let pods: Api<Pod> = Api::namespaced(client.clone(), "kube-system");
    let plist = pods.list(&ListParams::default()).await?;
    let rows: Vec<Vec<String>> = plist
        .iter()
        .map(|p| {
            let phase = p
                .status
                .as_ref()
                .and_then(|s| s.phase.clone())
                .unwrap_or_else(|| "Unknown".to_string());
            let (ready, total) = p
                .status
                .as_ref()
                .and_then(|s| s.container_statuses.as_ref())
                .map(|cs| {
                    let total = cs.len();
                    let ok = cs.iter().filter(|c| c.ready).count();
                    (ok, total)
                })
                .unwrap_or((0, 0));
            vec![
                p.name_any(),
                phase,
                format!("{}/{}", ready, total),
                p.spec
                    .as_ref()
                    .and_then(|s| s.node_name.clone())
                    .unwrap_or_default(),
            ]
        })
        .collect();
    table(&["NAME", "PHASE", "READY", "NODE"], rows);

    // --- get_yaml probe: this is the path k7s uses for the detail panel.
    section("get_yaml (k7s detail-panel code path)");
    let target_pod = plist.items.first();
    if let Some(pod) = target_pod {
        let api: Api<Pod> = Api::namespaced(client.clone(), "kube-system");
        let fetched = api.get(pod.name_any().as_str()).await?;
        let yaml = serde_yaml::to_string(&fetched)?;
        println!(
            "  ✓ fetched Pod {}/{} ({} bytes of YAML)",
            "kube-system",
            pod.name_any(),
            yaml.len()
        );
        println!("  --- first 12 lines ---");
        for line in yaml.lines().take(12) {
            println!("    {}", line);
        }
        println!("  ---");
    } else {
        println!("  (no pods in kube-system to fetch)");
    }

    let metrics_dep = dlist
        .items
        .iter()
        .find(|d| d.name_any() == "metrics-server")
        .cloned();
    if let Some(d) = metrics_dep {
        let api: Api<Deployment> = Api::namespaced(client.clone(), "kube-system");
        let fetched = api.get(d.name_any().as_str()).await?;
        let yaml = serde_yaml::to_string(&fetched)?;
        println!(
            "\n  ✓ fetched Deployment {}/{} ({} bytes of YAML)",
            "kube-system",
            d.name_any(),
            yaml.len()
        );
    }

    println!("\n✓ probe succeeded — same code path k7s uses on Tauri");
    Ok(())
}
