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
  workloadType: 'deployment' | 'statefulset' | 'daemonset';
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
}

/**
 * A blank form with sensible wizard defaults (namespace "default", one
 * replica, IfNotPresent pull policy, probes disabled).
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
  return errs;
}

// ---------------------------------------------------------------------------
// YAML generation
// ---------------------------------------------------------------------------

const KIND_OF: Record<WorkloadType, readonly [string, string]> = {
  deployment: ['apps/v1', 'Deployment'],
  statefulset: ['apps/v1', 'StatefulSet'],
  daemonset: ['apps/v1', 'DaemonSet'],
};

/** Escape a string for embedding inside a double-quoted YAML scalar. */
const escapeDq = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Render a flow-sequence token as a double-quoted YAML scalar. */
const dq = (s: string): string => `"${escapeDq(s)}"`;

/**
 * Render the workload (Deployment/StatefulSet/DaemonSet) as a single YAML
 * document. Only the workload itself — no Service. Empty optional blocks
 * (ports, env, resources, probes, mounts) are omitted entirely.
 */
export function generateWorkloadYaml(f: WorkloadForm): string {
  const [api, kind] = KIND_OF[f.workloadType];
  const L: string[] = [];
  const push = (indent: number, s: string) => L.push(' '.repeat(indent) + s);

  push(0, `apiVersion: ${api}`);
  push(0, `kind: ${kind}`);
  push(0, 'metadata:');
  push(2, `name: ${f.name}`);
  push(2, `namespace: ${f.namespace}`);
  push(0, 'spec:');
  // DaemonSet does not take a replicas field.
  if (f.workloadType !== 'daemonset') push(2, `replicas: ${f.replicas}`);
  push(2, 'selector:');
  push(4, 'matchLabels:');
  push(6, `app: ${f.name}`);
  push(2, 'template:');
  push(4, 'metadata:');
  push(6, 'labels:');
  push(8, `app: ${f.name}`);
  push(4, 'spec:');
  push(6, 'containers:');
  push(8, `- name: ${f.name}`);
  push(10, `image: ${f.image}`);
  push(10, `imagePullPolicy: ${f.imagePullPolicy}`);
  if (f.command) {
    push(10, `command: [${f.command.split(/\s+/).map(dq).join(', ')}]`);
  }
  if (f.args) {
    push(10, `args: [${f.args.split(/\s+/).map(dq).join(', ')}]`);
  }
  if (f.ports.length) {
    push(10, 'ports:');
    for (const p of f.ports) {
      push(12, `- name: ${p.name}`);
      push(14, `containerPort: ${p.port}`);
      push(14, `protocol: ${p.protocol}`);
    }
  }
  if (f.env.length) {
    push(10, 'env:');
    for (const e of f.env) {
      push(12, `- name: ${e.key}`);
      push(14, `value: "${escapeDq(e.value)}"`);
    }
  }
  const hasReq = !!(f.cpuRequest || f.memRequest);
  const hasLim = !!(f.cpuLimit || f.memLimit);
  if (hasReq || hasLim) {
    push(10, 'resources:');
    if (hasReq) {
      push(12, 'requests:');
      if (f.cpuRequest) push(14, `cpu: ${f.cpuRequest}`);
      if (f.memRequest) push(14, `memory: ${f.memRequest}`);
    }
    if (hasLim) {
      push(12, 'limits:');
      if (f.cpuLimit) push(14, `cpu: ${f.cpuLimit}`);
      if (f.memLimit) push(14, `memory: ${f.memLimit}`);
    }
  }
  const probes: readonly [string, ProbeCfg][] = [
    ['readinessProbe', f.readiness],
    ['livenessProbe', f.liveness],
  ];
  for (const [label, p] of probes) {
    if (!p.enabled) continue;
    push(10, `${label}:`);
    push(12, 'httpGet:');
    push(14, `path: ${p.path}`);
    push(14, `port: ${p.port}`);
    push(12, `initialDelaySeconds: ${p.initialDelay}`);
  }
  if (f.mounts.length) {
    push(10, 'volumeMounts:');
    for (const m of f.mounts) {
      push(12, `- name: ${m.pvcName}`);
      push(14, `mountPath: ${m.mountPath}`);
      if (m.readOnly) push(14, 'readOnly: true');
    }
    push(6, 'volumes:');
    for (const m of f.mounts) {
      push(8, `- name: ${m.pvcName}`);
      push(10, 'persistentVolumeClaim:');
      push(12, `claimName: ${m.pvcName}`);
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
 * Best-effort parse of a workload YAML back into form fields (name,
 * namespace, workloadType, replicas, image, ports, env). Returns null when
 * the document is unparseable or is not a Deployment/StatefulSet/DaemonSet.
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

  const kind = typeof root.kind === 'string' ? root.kind : '';
  const type: WorkloadType | null =
    kind === 'Deployment'
      ? 'deployment'
      : kind === 'StatefulSet'
        ? 'statefulset'
        : kind === 'DaemonSet'
          ? 'daemonset'
          : null;
  if (!type) return null;

  const md = asRecord(root.metadata);
  const spec = asRecord(root.spec);
  const tmpl = asRecord(spec?.template);
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

  return {
    name: String(md?.name ?? ''),
    namespace: String(md?.namespace ?? 'default'),
    workloadType: type,
    replicas: num(spec?.replicas) ?? 1,
    image: String(ctn?.image ?? ''),
    ports,
    env,
  };
}
