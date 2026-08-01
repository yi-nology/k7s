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
use k8s_openapi::api::apps::v1::{DaemonSet, Deployment, ReplicaSet, StatefulSet};
use k8s_openapi::api::batch::v1::{CronJob, Job};
use k8s_openapi::api::core::v1::{
    ConfigMap, Namespace, Node, PersistentVolumeClaim, Pod, Secret, Service,
};
use k8s_openapi::api::autoscaling::v1::HorizontalPodAutoscaler;
use kube::api::{Api, ListParams, LogParams, ResourceExt as _};
use kube::config::Kubeconfig;
use kube_client::Client;
use serde::Serialize;

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

    // --- All 14 k7s resource kinds (mirrors the sidebar). Empty results are
    //     expected on a fresh cluster; what matters is the call path works.
    section("All k7s resource kinds (coverage check)");
    println!("  kind                  count  api_ok");
    println!("  -------------------- ----- ------");
    for (label, count_fn) in build_kind_probes() {
        let count = count_fn(&client).await;
        println!(
            "  {:<20}  {:>5}  {}",
            label,
            count.as_ref().map(|n| n.to_string()).unwrap_or_else(|_| "—".to_string()),
            if count.is_ok() { "✓" } else { "✗" }
        );
    }

    // --- Emit the exact JSON k7s's Tauri command would send to the React
    //     frontend. The structure must match the TS Row types exactly.
    section("JSON shape (what k7s's React UI receives)");
    if let Some(pod) = plist.items.first() {
        let row = pod_to_row(pod);
        let json = serde_json::to_string_pretty(&row)?;
        println!("  PodRow for {}/{}:", "kube-system", pod.name_any());
        for line in json.lines().take(20) {
            println!("    {}", line);
        }
        println!("    ... ({} bytes total)", json.len());
    }

    // --- get_pod_logs (the path k7s's LogsModal uses)
    section("get_pod_logs (k7s :logs path)");
    if let Some(pod) = plist.items.first() {
        let api: Api<Pod> = Api::namespaced(client.clone(), "kube-system");
        let mut lp = LogParams::default();
        lp.follow = false;
        lp.tail_lines = Some(8);
        match api.logs(&pod.name_any(), &lp).await {
            Ok(text) => {
                let lines: Vec<&str> = text.lines().collect();
                println!("  ✓ fetched logs for {}/{} ({} bytes, {} lines)",
                    "kube-system", pod.name_any(), text.len(), lines.len());
                for line in lines.iter().take(5) {
                    println!("    | {}", line);
                }
                if lines.len() > 5 {
                    println!("    ... ({} more)", lines.len() - 5);
                }
            }
            Err(e) => println!("  ✗ logs failed: {}", e),
        }
    }

    // --- exec_pod (k7s's :exec path; shells out to kubectl)
    section("exec_pod (k7s :exec path; kubectl subprocess)");
    if let Some(pod) = plist.items.first() {
        let name = pod.name_any();
        let kc = Kubeconfig::read()?;
        let ctx = kc.current_context.unwrap_or_default();
        let mut args: Vec<String> = vec![
            "exec".into(),
            name.clone(),
            "-n".into(),
            "kube-system".into(),
        ];
        if !ctx.is_empty() {
            args.push("--context".into());
            args.push(ctx);
        }
        args.push("--".into());
        args.push("sh".into());
        args.push("-c".into());
        args.push("echo \"hello from probe on $(hostname)\"".into());

        match std::process::Command::new("kubectl")
            .args(&args)
            .output()
        {
            Ok(o) if o.status.success() => {
                let s = String::from_utf8_lossy(&o.stdout);
                println!("  ✓ exec succeeded: {}", s.trim());
            }
            Ok(o) => {
                let s = String::from_utf8_lossy(&o.stderr);
                println!("  ✗ exec failed (exit {:?}): {}",
                    o.status.code(), s.trim());
            }
            Err(e) => {
                println!("  ⚠ kubectl not in PATH ({}); skipping exec test", e);
            }
        }
    }

    // --- port-forward (k7s's :pf path): bind 127.0.0.1:19053 -> a pod port
    // and curl it. We try coredns's 9153 (metrics) if present, else skip.
    section("port-forward (k7s :pf path)");
    run_port_forward_probe(&client).await;

    println!("\n✓ probe succeeded — same code path k7s uses on Tauri");
    Ok(())
}

async fn run_port_forward_probe(client: &Client) {
    use std::time::Duration;
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpStream;

    // Pick a pod that exposes a TCP port we can talk to. Coredns has 9153/metrics.
    let pods: Api<Pod> = Api::namespaced(client.clone(), "kube-system");
    let lp = ListParams::default();
    let plist = match pods.list(&lp).await {
        Ok(p) => p,
        Err(e) => {
            println!("  ✗ pod list failed: {}", e);
            return;
        }
    };
    let target = plist.items.iter().find(|p| p.name_any().contains("coredns"));
    let Some(pod) = target else {
        println!("  ⚠ no coredns pod to forward to; skipping");
        return;
    };

    let local_port: u16 = 19053;
    let remote_port: u16 = 9153;

    let listener = match tokio::net::TcpListener::bind(("127.0.0.1", local_port)).await {
        Ok(l) => l,
        Err(e) => {
            println!("  ✗ bind 127.0.0.1:{}: {}", local_port, e);
            return;
        }
    };
    println!("  bound 127.0.0.1:{} (one-shot forward to coredns:{})", local_port, remote_port);

    // Spawn the forwarder task: every accept gets a fresh portforward subresource.
    let api: Api<Pod> = Api::namespaced(client.clone(), "kube-system");
    let name = pod.name_any();
    let fwd_task = tokio::spawn(async move {
        loop {
            let (mut local, _) = match listener.accept().await {
                Ok(p) => p,
                Err(_) => return,
            };
            let mut pf = match api.portforward(&name, &[remote_port]).await {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("    portforward setup: {}", e);
                    return;
                }
            };
            let mut remote = match pf.take_stream(remote_port) {
                Some(s) => s,
                None => {
                    eprintln!("    port {} not in portforwarder", remote_port);
                    return;
                }
            };
            let _keep = pf;  // keep portforwarder alive
            let _ = tokio::io::copy_bidirectional(&mut local, &mut remote).await;
        }
    });

    // Give the listener a moment, then talk to it.
    tokio::time::sleep(Duration::from_millis(300)).await;
    let mut stream = match TcpStream::connect(("127.0.0.1", local_port)).await {
        Ok(s) => s,
        Err(e) => {
            println!("  ✗ connect: {}", e);
            fwd_task.abort();
            return;
        }
    };
    // HTTP GET /metrics
    let req = b"GET /metrics HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n";
    if let Err(e) = stream.write_all(req).await {
        println!("  ✗ write: {}", e);
        fwd_task.abort();
        return;
    }
    let mut buf = Vec::new();
    let _ = tokio::io::AsyncReadExt::read_to_end(&mut stream, &mut buf).await;
    let resp = String::from_utf8_lossy(&buf);
    let status_line = resp.lines().next().unwrap_or("(empty)");
    let body_bytes = resp
        .find("\r\n\r\n")
        .map(|i| buf.len() - i - 4)
        .unwrap_or(0);
    println!("  HTTP response: {}", status_line);
    println!("  body bytes:    {}", body_bytes);
    if status_line.contains("200") && body_bytes > 0 {
        println!("  ✓ port-forward roundtrip OK");
    } else {
        println!("  ⚠ unexpected response (first 200 bytes):");
        let preview: String = resp.chars().take(200).collect();
        for line in preview.lines() {
            println!("    | {}", line);
        }
    }

    fwd_task.abort();
    let _ = fwd_task.await;
}

// --- end of main, helpers below ---

#[derive(Serialize)]
struct PodRowJson {
    name: String,
    namespace: String,
    status: String,
    ready: String,
    restarts: i32,
    age: String,
    node: String,
    ip: String,
    containers: String,
}

fn pod_to_row(p: &Pod) -> PodRowJson {
    let phase = p
        .status
        .as_ref()
        .and_then(|s| s.phase.clone())
        .unwrap_or_else(|| "Unknown".to_string());
    let (ready, restarts) = p
        .status
        .as_ref()
        .map(|s| {
            let total = s.container_statuses.as_ref().map(|c| c.len()).unwrap_or(0);
            let ready = s
                .container_statuses
                .as_ref()
                .map(|cs| cs.iter().filter(|c| c.ready).count())
                .unwrap_or(0);
            let restarts = s
                .container_statuses
                .as_ref()
                .map(|cs| cs.iter().map(|c| c.restart_count).sum())
                .unwrap_or(0);
            (format!("{}/{}", ready, total), restarts)
        })
        .unwrap_or_else(|| ("0/0".to_string(), 0));
    let containers = p
        .spec
        .as_ref()
        .map(|spec| {
            spec.containers
                .iter()
                .map(|c| c.name.clone())
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_default();
    PodRowJson {
        name: p.name_any(),
        namespace: p.namespace().unwrap_or_default(),
        status: phase,
        ready,
        restarts,
        age: "live".to_string(),
        node: p.spec.as_ref().and_then(|s| s.node_name.clone()).unwrap_or_default(),
        ip: p
            .status
            .as_ref()
            .and_then(|s| s.pod_ip.clone())
            .unwrap_or_default(),
        containers,
    }
}

/// All 14 resource kinds k7s supports, with a closure that lists each
/// (catching errors per-kind so a single failure doesn't break the rest).
type KindFuture = std::pin::Pin<Box<dyn std::future::Future<Output = Result<usize>> + Send>>;
type KindProbe = Box<dyn Fn(&Client) -> KindFuture + Send + Sync>;

fn build_kind_probes() -> Vec<(&'static str, KindProbe)> {
    fn pods(c: &Client) -> KindFuture {
        let c = c.clone();
        Box::pin(async move {
            let api: Api<Pod> = Api::all(c);
            Ok(api.list(&ListParams::default()).await?.items.len())
        })
    }
    fn deployments(c: &Client) -> KindFuture {
        let c = c.clone();
        Box::pin(async move {
            let api: Api<Deployment> = Api::all(c);
            Ok(api.list(&ListParams::default()).await?.items.len())
        })
    }
    fn statefulsets(c: &Client) -> KindFuture {
        let c = c.clone();
        Box::pin(async move {
            let api: Api<StatefulSet> = Api::all(c);
            Ok(api.list(&ListParams::default()).await?.items.len())
        })
    }
    fn daemonsets(c: &Client) -> KindFuture {
        let c = c.clone();
        Box::pin(async move {
            let api: Api<DaemonSet> = Api::all(c);
            Ok(api.list(&ListParams::default()).await?.items.len())
        })
    }
    fn replicasets(c: &Client) -> KindFuture {
        let c = c.clone();
        Box::pin(async move {
            let api: Api<ReplicaSet> = Api::all(c);
            Ok(api.list(&ListParams::default()).await?.items.len())
        })
    }
    fn jobs(c: &Client) -> KindFuture {
        let c = c.clone();
        Box::pin(async move {
            let api: Api<Job> = Api::all(c);
            Ok(api.list(&ListParams::default()).await?.items.len())
        })
    }
    fn cronjobs(c: &Client) -> KindFuture {
        let c = c.clone();
        Box::pin(async move {
            let api: Api<CronJob> = Api::all(c);
            Ok(api.list(&ListParams::default()).await?.items.len())
        })
    }
    fn services(c: &Client) -> KindFuture {
        let c = c.clone();
        Box::pin(async move {
            let api: Api<Service> = Api::all(c);
            Ok(api.list(&ListParams::default()).await?.items.len())
        })
    }
    fn configmaps(c: &Client) -> KindFuture {
        let c = c.clone();
        Box::pin(async move {
            let api: Api<ConfigMap> = Api::all(c);
            Ok(api.list(&ListParams::default()).await?.items.len())
        })
    }
    fn secrets(c: &Client) -> KindFuture {
        let c = c.clone();
        Box::pin(async move {
            let api: Api<Secret> = Api::all(c);
            Ok(api.list(&ListParams::default()).await?.items.len())
        })
    }
    fn pvc(c: &Client) -> KindFuture {
        let c = c.clone();
        Box::pin(async move {
            let api: Api<PersistentVolumeClaim> = Api::all(c);
            Ok(api.list(&ListParams::default()).await?.items.len())
        })
    }
    fn nodes(c: &Client) -> KindFuture {
        let c = c.clone();
        Box::pin(async move {
            let api: Api<Node> = Api::all(c);
            Ok(api.list(&ListParams::default()).await?.items.len())
        })
    }
    fn namespaces(c: &Client) -> KindFuture {
        let c = c.clone();
        Box::pin(async move {
            let api: Api<Namespace> = Api::all(c);
            Ok(api.list(&ListParams::default()).await?.items.len())
        })
    }
    fn hpa(c: &Client) -> KindFuture {
        let c = c.clone();
        Box::pin(async move {
            let api: Api<HorizontalPodAutoscaler> = Api::all(c);
            Ok(api.list(&ListParams::default()).await?.items.len())
        })
    }
    vec![
        ("pods", Box::new(pods)),
        ("deployments", Box::new(deployments)),
        ("statefulsets", Box::new(statefulsets)),
        ("daemonsets", Box::new(daemonsets)),
        ("replicasets", Box::new(replicasets)),
        ("jobs", Box::new(jobs)),
        ("cronjobs", Box::new(cronjobs)),
        ("services", Box::new(services)),
        ("configmaps", Box::new(configmaps)),
        ("secrets", Box::new(secrets)),
        ("pvc", Box::new(pvc)),
        ("nodes", Box::new(nodes)),
        ("namespaces", Box::new(namespaces)),
        ("hpa", Box::new(hpa)),
    ]
}
