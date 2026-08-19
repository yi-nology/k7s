/**
 * Workload create-wizard: form model, YAML generator and best-effort parse-back.
 *
 * Pure, stateless functions — no React, no i18n, no store access. The wizard
 * UI (Tasks 3/4) owns the form state and maps validation keys to messages.
 *
 * YAML generation is plain string concatenation, matching the conventions of
 * `src/lib/templates/helpers.ts` (template literals, unquoted scalar values,
 * double-quoted strings when escaping is needed). Parse-back uses the `yaml`
 * package and is best-effort: anything it cannot recognise is simply omitted
 * from the returned partial form.
 */

import { parseDocument } from 'yaml';
import { isValidK8sName, isValidNamespace } from '../../lib/security';

// ---------------------------------------------------------------------------
// Form model
// ---------------------------------------------------------------------------

export interface ContainerPort {
  name: string;
  port: number;
  protocol: 'TCP' | 'UDP';
}

export interface EnvVar {
  key: string;
  value: string;
}

export interface ProbeCfg {
  enabled: boolean;
  path: string;
  port: number;
  initialDelay: number;
}

export interface VolumeMount {
  pvcName: string;
  mountPath: string;
  readOnly: boolean;
}

export type WorkloadType = WorkloadForm['workloadType'];

export interface WorkloadForm {
  name: string;
  namespace: string;
  workloadType: 'deployment' | 'statefulset' | 'daemonset' | 'job' | 'cronjob';
  replicas: number;
  image: string;
  imagePullPolicy: 'IfNotPresent' | 'Always';
  command: string; // 空格分隔,可留空
  args: string; // 空格分隔,可留空
  ports: ContainerPort[];
  env: EnvVar[];
  cpuRequest: string;
  memRequest: string;
  cpuLimit: string;
  memLimit: string;
  liveness: ProbeCfg;
  readiness: ProbeCfg;
  mounts: VolumeMount[];
  /** CronJob 专用 — 5 段 cron 表达式,默认 '0 * * * *'。 */
  schedule: string;
  /** Job 专用 — 0 = 在 YAML 中省略 completions。 */
  completions: number;
}

/**
 * A blank form with sensible wizard defaults (namespace "default", one
 * replica, IfNotPresent pull policy, probes disabled). The job/cronjob
 * defaults are harmless for other types — their generators ignore them.
 */
export function emptyWorkloadForm(type: WorkloadType = 'deployment'): WorkloadForm {
  return {
    name: '',
    namespace: 'default',
    workloadType: type,
    replicas: 1,
    image: '',
    imagePullPolicy: 'IfNotPresent',
    command: '',
    args: '',
    ports: [],
    env: [],
    cpuRequest: '',
    memRequest: '',
    cpuLimit: '',
    memLimit: '',
    liveness: { enabled: false, path: '/', port: 80, initialDelay: 15 },
    readiness: { enabled: false, path: '/', port: 80, initialDelay: 5 },
    mounts: [],
    schedule: '0 * * * *',
    completions: 0,
  };
}

/**
 * Validate a form and return the list of invalid field keys
 * (i18n key suffixes, e.g. `['name', 'image']`). Empty array = valid.
 */
export function validateWorkloadForm(f: WorkloadForm): string[] {
  const errs: string[] = [];
  if (!f.name || !isValidK8sName(f.name)) errs.push('name');
  if (f.namespace && !isValidNamespace(f.namespace)) errs.push('namespace');
  if (!f.image) errs.push('image');
  if (f.replicas < 0) errs.push('replicas');
  // CronJob: a coarse five-field cron check (minute hour day month dow) —
  // full cron grammar validation belongs to the API server dry run.
  if (f.workloadType === 'cronjob' && !/\S+\s+\S+\s+\S+\s+\S+\s+\S+/.test(f.schedule)) {
    errs.push('schedule');
  }
  if (f.workloadType === 'job' && f.completions < 0) errs.push('completions');
  return errs;
}

// ---------------------------------------------------------------------------
// YAML generation
// ---------------------------------------------------------------------------

const KIND_OF: Record<WorkloadType, readonly [string, string]> = {
  deployment: ['apps/v1', 'Deployment'],
  statefulset: ['apps/v1', 'StatefulSet'],
  daemonset: ['apps/v1', 'DaemonSet'],
  job: ['batch/v1', 'Job'],
  cronjob: ['batch/v1', 'CronJob'],
};

/** Escape a string for embedding inside a double-quoted YAML scalar. */
const escapeDq = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Render a flow-sequence token as a double-quoted YAML scalar. */
const dq = (s: string): string => `"${escapeDq(s)}"`;

/**
 * Split a command/args input line into tokens, honouring double quotes so an
 * arg containing spaces stays one token (the args hint promises this:
 * `空格分隔,含空格的参数请加引号`). `sh -c "echo hello"` →
 * `['sh', '-c', 'echo hello']`. A trailing/leading quote swallows nothing —
 * unbalanced quotes simply end at the string boundary — and empty tokens
 * (stray whitespace) are dropped, so `'sh '` yields `['sh']`, not
 * `['sh', '']`.
 */
function tokenize(s: string): string[] {
  return (s.match(/[^\s"]+|"([^"]*)"/g) ?? []).map((tok) =>
    tok.startsWith('"') ? tok.slice(1, -1) : tok
  ).filter(Boolean);
}

/** Keep only the string items of a YAML flow-sequence array. */
const strTokens = (arr: unknown[]): string[] =>
  arr.filter((tok): tok is string => typeof tok === 'string');

/**
 * Inverse of tokenize: render tokens back into the one-line input format,
 * re-quoting tokens that contain whitespace or quotes so that
 * generate→parse→generate is byte-identical (`["-c", "echo hello"]` →
 * `-c "echo hello"` → the same tokens again).
 */
const detokize = (toks: string[]): string =>
  toks.map((tok) => (/\s|"/.test(tok) ? `"${escapeDq(tok)}"` : tok)).join(' ');

/**
 * Render the workload (Deployment/StatefulSet/DaemonSet/Job/CronJob) as a
 * single YAML document. Only the workload itself — no Service. Empty optional
 * blocks (ports, env, resources, probes, mounts) are omitted entirely.
 */
export function generateWorkloadYaml(f: WorkloadForm): string {
  const [api, kind] = KIND_OF[f.workloadType];
  const L: string[] = [];
  const push = (indent: number, s: string) => L.push(' '.repeat(indent) + s);
  // CronJob nests the whole pod template one level deeper
  // (spec.jobTemplate.spec.template): everything from `template:` inward
  // shifts by 4 spaces; the wrapper lines below are emitted cronjob-only.
  const isCron = f.workloadType === 'cronjob';
  const isBatch = f.workloadType === 'job' || isCron;
  const t = isCron ? 4 : 0;

  push(0, `apiVersion: ${api}`);
  push(0, `kind: ${kind}`);
  push(0, 'metadata:');
  push(2, `name: ${f.name}`);
  push(2, `namespace: ${f.namespace}`);
  push(0, 'spec:');
  // Only the rollout types take replicas: DaemonSet runs one pod per node,
  // Job/CronJob have no replicas knob at all.
  if (f.workloadType === 'deployment' || f.workloadType === 'statefulset') {
    push(2, `replicas: ${f.replicas}`);
  }
  // A label selector is required by Deployment/StatefulSet/DaemonSet; batch
  // workloads must NOT carry one (the job controller injects its own labels,
  // and a fixed selector conflicts with re-created jobs).
  if (!isBatch) {
    push(2, 'selector:');
    push(4, 'matchLabels:');
    push(6, `app: ${f.name}`);
  }
  if (f.workloadType === 'job' && f.completions > 0) push(2, `completions: ${f.completions}`);
  if (isCron) push(2, `schedule: ${dq(f.schedule)}`);
  if (isCron) {
    push(2, 'jobTemplate:');
    push(4, 'spec:');
  }
  push(2 + t, 'template:');
  push(4 + t, 'metadata:');
  push(6 + t, 'labels:');
  push(8 + t, `app: ${f.name}`);
  push(4 + t, 'spec:');
  // Batch pod specs require an explicit restartPolicy (the API default
  // Always would restart a job's containers forever without progressing).
  if (isBatch) push(6 + t, 'restartPolicy: OnFailure');
  push(6 + t, 'containers:');
  push(8 + t, `- name: ${f.name}`);
  push(10 + t, `image: ${f.image}`);
  push(10 + t, `imagePullPolicy: ${f.imagePullPolicy}`);
  if (f.command) {
    push(10 + t, `command: [${tokenize(f.command).map(dq).join(', ')}]`);
  }
  if (f.args) {
    push(10 + t, `args: [${tokenize(f.args).map(dq).join(', ')}]`);
  }
  if (f.ports.length) {
    push(10 + t, 'ports:');
    for (const p of f.ports) {
      push(12 + t, `- name: ${p.name}`);
      push(14 + t, `containerPort: ${p.port}`);
      push(14 + t, `protocol: ${p.protocol}`);
    }
  }
  if (f.env.length) {
    push(10 + t, 'env:');
    for (const e of f.env) {
      push(12 + t, `- name: ${e.key}`);
      push(14 + t, `value: "${escapeDq(e.value)}"`);
    }
  }
  const hasReq = !!(f.cpuRequest || f.memRequest);
  const hasLim = !!(f.cpuLimit || f.memLimit);
  if (hasReq || hasLim) {
    push(10 + t, 'resources:');
    if (hasReq) {
      push(12 + t, 'requests:');
      if (f.cpuRequest) push(14 + t, `cpu: ${f.cpuRequest}`);
      if (f.memRequest) push(14 + t, `memory: ${f.memRequest}`);
    }
    if (hasLim) {
      push(12 + t, 'limits:');
      if (f.cpuLimit) push(14 + t, `cpu: ${f.cpuLimit}`);
      if (f.memLimit) push(14 + t, `memory: ${f.memLimit}`);
    }
  }
  const probes: readonly [string, ProbeCfg][] = [
    ['readinessProbe', f.readiness],
    ['livenessProbe', f.liveness],
  ];
  for (const [label, p] of probes) {
    if (!p.enabled) continue;
    push(10 + t, `${label}:`);
    push(12 + t, 'httpGet:');
    push(14 + t, `path: ${p.path}`);
    push(14 + t, `port: ${p.port}`);
    push(12 + t, `initialDelaySeconds: ${p.initialDelay}`);
  }
  if (f.mounts.length) {
    push(10 + t, 'volumeMounts:');
    for (const m of f.mounts) {
      push(12 + t, `- name: ${m.pvcName}`);
      push(14 + t, `mountPath: ${m.mountPath}`);
      if (m.readOnly) push(14 + t, 'readOnly: true');
    }
    push(6 + t, 'volumes:');
    for (const m of f.mounts) {
      push(8 + t, `- name: ${m.pvcName}`);
      push(10 + t, 'persistentVolumeClaim:');
      push(12 + t, `claimName: ${m.pvcName}`);
    }
  }
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Parse-back (best effort)
// ---------------------------------------------------------------------------

/** Narrow unknown to a plain-object record, or null. */
const asRecord = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Coerce a YAML scalar to number; undefined for anything non-numeric. */
const num = (v: unknown): number | undefined => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
};

/**
 * Best-effort parse of a workload YAML back into form fields. Recovers
 * everything the generator emits for a container-centric workload: name,
 * namespace, workloadType, replicas/completions/schedule, image, ports, env,
 * command/args, resources and PVC mounts. Returns null when the document is
 * unparseable or is not one of the five wizard kinds.
 */
export function parseWorkloadYaml(yaml: string): Partial<WorkloadForm> | null {
  let doc;
  try {
    doc = parseDocument(yaml, { strict: false });
  } catch {
    return null;
  }
  if (doc.errors.length > 0) return null;

  const root = asRecord(doc.toJS());
  if (!root) return null;

  const KIND_TO_TYPE: Record<string, WorkloadType> = {
    Deployment: 'deployment',
    StatefulSet: 'statefulset',
    DaemonSet: 'daemonset',
    Job: 'job',
    CronJob: 'cronjob',
  };
  const kind = typeof root.kind === 'string' ? root.kind : '';
  const type = KIND_TO_TYPE[kind] ?? null;
  if (!type) return null;

  const md = asRecord(root.metadata);
  const spec = asRecord(root.spec);
  // CronJob nests the pod template under spec.jobTemplate.spec.template.
  const jobSpec = asRecord(asRecord(spec?.jobTemplate)?.spec);
  const tmpl = asRecord(jobSpec ? jobSpec.template : spec?.template);
  const podSpec = asRecord(tmpl?.spec);
  const containers = podSpec?.containers;
  const ctn =
    Array.isArray(containers) && containers.length > 0 ? asRecord(containers[0]) : undefined;

  const ports: ContainerPort[] = Array.isArray(ctn?.ports)
    ? ctn.ports
        .map(asRecord)
        .filter((p): p is Record<string, unknown> => p !== null)
        .map((p) => ({
          name: String(p.name ?? ''),
          // k8s manifests use containerPort; accept port as a fallback.
          port: num(p.containerPort ?? p.port) ?? 0,
          protocol: p.protocol === 'UDP' ? 'UDP' : 'TCP',
        }))
    : [];

  const env: EnvVar[] = Array.isArray(ctn?.env)
    ? ctn.env
        .map(asRecord)
        .filter((e): e is Record<string, unknown> => e !== null)
        .map((e) => ({ key: String(e.name ?? ''), value: String(e.value ?? '') }))
    : [];

  // Resources: numeric scalars (cpu: 1) come back as numbers — stringify so
  // they re-render identically (`String(1)` → '1' → `cpu: 1`).
  const resources = asRecord(ctn?.resources);
  const req = asRecord(resources?.requests);
  const lim = asRecord(resources?.limits);
  const scalar = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

  // Mounts: resolve each volumeMount's name against podSpec.volumes[] to the
  // persistentVolumeClaim.claimName (the PVC the wizard form models); a mount
  // without a matching volume keeps its own name as pvcName.
  const claimOf = new Map<string, string>();
  if (Array.isArray(podSpec?.volumes)) {
    for (const v of podSpec.volumes.map(asRecord)) {
      if (!v) continue;
      const name = String(v.name ?? '');
      const claim = asRecord(v.persistentVolumeClaim)?.claimName;
      if (name && claim !== undefined) claimOf.set(name, String(claim));
    }
  }
  const mounts: VolumeMount[] = Array.isArray(ctn?.volumeMounts)
    ? ctn.volumeMounts
        .map(asRecord)
        .filter((m): m is Record<string, unknown> => m !== null)
        .map((m) => ({
          pvcName: claimOf.get(String(m.name ?? '')) ?? String(m.name ?? ''),
          mountPath: String(m.mountPath ?? ''),
          readOnly: m.readOnly === true,
        }))
    : [];

  return {
    name: String(md?.name ?? ''),
    namespace: String(md?.namespace ?? 'default'),
    workloadType: type,
    replicas: num(spec?.replicas) ?? 1,
    completions: num(spec?.completions) ?? 0,
    schedule: typeof spec?.schedule === 'string' ? spec.schedule : '',
    image: String(ctn?.image ?? ''),
    // Array→string joins are the tokenize inverse: multi-word tokens come
    // back re-quoted so generate→parse→generate is byte-identical.
    command: Array.isArray(ctn?.command) ? detokize(strTokens(ctn.command)) : '',
    args: Array.isArray(ctn?.args) ? detokize(strTokens(ctn.args)) : '',
    cpuRequest: scalar(req?.cpu),
    memRequest: scalar(req?.memory),
    cpuLimit: scalar(lim?.cpu),
    memLimit: scalar(lim?.memory),
    ports,
    env,
    mounts,
  };
}
