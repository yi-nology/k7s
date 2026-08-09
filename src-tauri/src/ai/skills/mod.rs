//! k8s skill market — pre-built prompt+tool templates for common ops scenarios.
//!
//! A "skill" is a reusable instruction template that tells the AI how to
//! approach a specific k8s task. Each skill carries:
//!
//! - A **name** and **description** (for the UI / LLM selection).
//! - A **system_prompt_suffix** appended to the normal system prompt when the
//!   skill is active, steering the LLM toward the right strategy.
//! - A **tool_whitelist**: if non-empty, the LLM only sees these tools during
//!   the skill (preventing it from going off-script).
//! - **examples**: a few `{user, assistant}` pairs that teach the LLM the
//!   expected style.
//!
//! Skills live as JSON files under `<data_dir>/skills/` (user-installed) or
//! are compiled in as built-in defaults (the `builtin/` directory). The
//! [`SkillRegistry`] merges both sources at load time.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// A single skill definition.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    /// Extra system-prompt text appended when this skill is active.
    #[serde(default)]
    pub system_prompt_suffix: String,
    /// If non-empty, only these tools are offered to the LLM during this skill.
    /// Tool names must match the registry (`list_resources`, `scale_workload`, …).
    #[serde(default)]
    pub tool_whitelist: Vec<String>,
    /// Example conversations that teach the LLM the expected behaviour.
    #[serde(default)]
    pub examples: Vec<SkillExample>,
    /// Category tag for grouping in the UI (e.g. "troubleshooting", "deployment").
    #[serde(default)]
    pub category: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillExample {
    pub user: String,
    pub assistant: String,
}

/// Merged registry of built-in + user-installed skills.
pub struct SkillRegistry {
    by_id: HashMap<String, Skill>,
}

impl SkillRegistry {
    /// Load skills from built-ins + the user's data dir.
    pub fn load(data_dir: Option<&std::path::Path>) -> Self {
        let mut by_id: HashMap<String, Skill> = HashMap::new();
        // Built-in skills.
        for skill in builtin_skills() {
            by_id.insert(skill.id.clone(), skill);
        }
        // User-installed skills (from <data_dir>/skills/*.json).
        if let Some(dir) = data_dir {
            let skills_dir = dir.join("skills");
            if skills_dir.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&skills_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.extension().and_then(|e| e.to_str()) == Some("json") {
                            if let Ok(text) = std::fs::read_to_string(&path) {
                                if let Ok(skill) = serde_json::from_str::<Skill>(&text) {
                                    by_id.insert(skill.id.clone(), skill);
                                }
                            }
                        }
                    }
                }
            }
        }
        Self { by_id }
    }

    pub fn get(&self, id: &str) -> Option<&Skill> {
        self.by_id.get(id)
    }

    pub fn list(&self) -> Vec<&Skill> {
        self.by_id.values().collect()
    }

    pub fn list_by_category(&self) -> HashMap<String, Vec<&Skill>> {
        let mut map: HashMap<String, Vec<&Skill>> = HashMap::new();
        for skill in self.by_id.values() {
            let cat = if skill.category.is_empty() {
                "general".to_string()
            } else {
                skill.category.clone()
            };
            map.entry(cat).or_default().push(skill);
        }
        map
    }
}

/// The built-in skills shipped with every k7s install.
fn builtin_skills() -> Vec<Skill> {
    vec![
        Skill {
            id: "crashloop-fix".into(),
            name: "CrashLoopBackOff 诊断".into(),
            description: "系统性排查 CrashLoopBackOff：查 events → 查 previous logs → 分析原因 → 建议修复".into(),
            system_prompt_suffix: "\
You are diagnosing a CrashLoopBackOff pod. Follow this EXACT sequence:
1. get_events on the pod — look for OOMKilled, readiness probe failures, image errors
2. get_pod_logs with previous=true — read the crashed container's last logs
3. describe_resource — check resource limits, probes, image tag
4. Summarize: root cause in one sentence, then list the fix steps
Do NOT skip steps. Do NOT suggest fixes before gathering evidence.".into(),
            tool_whitelist: vec![
                "get_events".into(),
                "get_pod_logs".into(),
                "describe_resource".into(),
                "list_resources".into(),
                "restart_workload".into(),
            ],
            examples: vec![
                SkillExample {
                    user: "payment pod 一直 CrashLoopBackOff，帮我看看".into(),
                    assistant: "我来系统排查。先看 events 和 previous logs……\n\n[调用 get_events + get_pod_logs(previous=true)]\n\n**根因**：OOMKilled — 容器内存限制 128Mi 不够用（实际使用 ~180Mi）。\n\n**修复步骤**：\n1. 把 memory limit 提到 256Mi\n2. 重启 pod".into(),
                },
            ],
            category: "troubleshooting".into(),
        },
        Skill {
            id: "safe-drain".into(),
            name: "PDB 安全 Drain".into(),
            description: "在 drain 节点前检查 PDB 约束，确保不会中断关键服务".into(),
            system_prompt_suffix: "\
You are performing a safe node drain. Before draining:
1. get the node's pods (list_resources pods + label selector for node)
2. check if any pod has a PodDisruptionBudget
3. report which pods would be disrupted and whether PDB allows it
4. only proceed with drain after user confirms all PDBs are satisfied
Never drain without explicit user approval.".into(),
            tool_whitelist: vec![
                "list_resources".into(),
                "describe_resource".into(),
                "get_events".into(),
            ],
            examples: vec![],
            category: "operations".into(),
        },
        Skill {
            id: "rolling-upgrade".into(),
            name: "滚动升级 Checklist".into(),
            description: "指导 Deployment 滚动升级：检查 strategy → 更新镜像 → 监控 rollout status".into(),
            system_prompt_suffix: "\
Guide the user through a rolling upgrade:
1. describe_resource — check current strategy (maxSurge, maxUnavailable)
2. Show current image tag and replicas
3. Ask user for the new image tag
4. Apply the change (apply_manifest or scale as needed)
5. Monitor rollout progress
Always show the before/after diff. Never auto-proceed without user confirmation.".into(),
            tool_whitelist: vec![
                "describe_resource".into(),
                "get_resource_yaml".into(),
                "apply_manifest".into(),
                "restart_workload".into(),
                "get_events".into(),
            ],
            examples: vec![],
            category: "deployment".into(),
        },
        Skill {
            id: "resource-pressure".into(),
            name: "资源压力分析".into(),
            description: "分析节点/命名空间的 CPU/内存压力，找出资源大户".into(),
            system_prompt_suffix: "\
Analyze cluster resource pressure:
1. top_nodes — which nodes are under CPU/memory pressure
2. list_resources pods — find all pods, sort by resource usage
3. describe_resource on high-usage pods — check resource requests/limits
4. Report: which namespaces/pods are the biggest consumers, which nodes are
   approaching capacity, and recommendations (scale down, add nodes, adjust limits).".into(),
            tool_whitelist: vec![
                "top_nodes".into(),
                "list_resources".into(),
                "describe_resource".into(),
                "get_cluster_health".into(),
            ],
            examples: vec![],
            category: "troubleshooting".into(),
        },
        Skill {
            id: "image-pull-fix".into(),
            name: "ImagePullBackOff 修复".into(),
            description: "排查镜像拉取失败：registry 认证、镜像名/tag 错误、网络问题".into(),
            system_prompt_suffix: "\
Diagnose ImagePullBackOff:
1. get_events on the pod — look for specific pull error message
2. describe_resource — check the image field, imagePullSecrets
3. If the error mentions 'unauthorized' or 'forbidden', the issue is registry auth
4. If 'not found', check image name and tag spelling
5. If 'timeout' or 'network', check node DNS and registry reachability
Report the exact error message and the specific fix.".into(),
            tool_whitelist: vec![
                "get_events".into(),
                "describe_resource".into(),
                "list_resources".into(),
            ],
            examples: vec![],
            category: "troubleshooting".into(),
        },
        Skill {
            id: "service-debug".into(),
            name: "Service 连通性排查".into(),
            description: "排查 Service 无法访问：Endpoints、selector 匹配、port 配置".into(),
            system_prompt_suffix: "\
Debug service connectivity:
1. describe_resource on the Service — check selector, ports, type
2. list_resources endpoints — verify the Service has endpoints
3. If no endpoints: list_resources pods — check if any pod matches the selector
4. If endpoints exist but service unreachable: check the target port matches the container port
Report: the exact selector, what it matches, and where the disconnect is.".into(),
            tool_whitelist: vec![
                "describe_resource".into(),
                "list_resources".into(),
                "get_events".into(),
            ],
            examples: vec![],
            category: "troubleshooting".into(),
        },
        Skill {
            id: "cronjob-audit".into(),
            name: "CronJob 审计".into(),
            description: "审计集群中的 CronJob：调度、历史、失败记录".into(),
            system_prompt_suffix: "\
Audit CronJobs in the cluster:
1. list_resources cronjobs — get all CronJobs
2. For each active CronJob: describe_resource — check schedule, concurrency policy, history limits
3. list_resources jobs — find recent jobs, check for failures
4. Report: schedule summary, any failed jobs, any CronJobs with too many retained histories.".into(),
            tool_whitelist: vec![
                "list_resources".into(),
                "describe_resource".into(),
                "get_events".into(),
            ],
            examples: vec![],
            category: "operations".into(),
        },
    ]
}
