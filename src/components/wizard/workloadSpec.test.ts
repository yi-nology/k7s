import { describe, it, expect } from 'vitest';
import { emptyWorkloadForm, generateWorkloadYaml, validateWorkloadForm, parseWorkloadYaml } from './workloadSpec';

const base = emptyWorkloadForm('deployment');

describe('validateWorkloadForm', () => {
  it('requires name and image', () => {
    expect(validateWorkloadForm({ ...base })).toContain('name');
    expect(validateWorkloadForm({ ...base, name: 'nginx', image: '' })).toContain('image');
    expect(validateWorkloadForm({ ...base, name: 'nginx', image: 'nginx:1.27' })).toEqual([]);
  });
  it('rejects invalid k8s names', () => {
    expect(validateWorkloadForm({ ...base, name: 'Bad_Name', image: 'nginx' })).toContain('name');
  });
});

describe('generateWorkloadYaml', () => {
  it('renders a minimal Deployment', () => {
    const y = generateWorkloadYaml({ ...base, name: 'nginx', image: 'nginx:1.27', replicas: 3 });
    expect(y).toContain('kind: Deployment');
    expect(y).toContain('name: nginx');
    expect(y).toContain('replicas: 3');
    expect(y).toContain('image: nginx:1.27');
    expect(y).toContain('namespace: default');
  });
  it('renders ports, env, resources, probes and mounts when set', () => {
    const y = generateWorkloadYaml({
      ...base, name: 'web', image: 'web:1',
      ports: [{ name: 'http', port: 8080, protocol: 'TCP' }],
      env: [{ key: 'MODE', value: 'prod' }],
      cpuRequest: '100m', memLimit: '512Mi',
      readiness: { enabled: true, path: '/healthz', port: 8080, initialDelay: 5 },
      mounts: [{ pvcName: 'data', mountPath: '/data', readOnly: false }],
    });
    expect(y).toContain('containerPort: 8080');
    expect(y).toContain('name: MODE');
    expect(y).toContain('cpu: 100m');
    expect(y).toContain('memory: 512Mi');
    expect(y).toContain('path: /healthz');
    expect(y).toContain('persistentVolumeClaim:');
  });
  it('omits empty optional blocks entirely', () => {
    const y = generateWorkloadYaml({ ...base, name: 'n', image: 'i' });
    expect(y).not.toContain('ports:');
    expect(y).not.toContain('resources:');
    expect(y).not.toContain('livenessProbe:');
    expect(y).not.toContain('volumeMounts:');
  });
  it('statefulset/daemonset kinds', () => {
    expect(generateWorkloadYaml({ ...base, workloadType: 'statefulset', name: 'a', image: 'i' })).toContain('kind: StatefulSet');
    expect(generateWorkloadYaml({ ...base, workloadType: 'daemonset', name: 'a', image: 'i' })).toContain('kind: DaemonSet');
  });
  it('tokenizes quoted command/args correctly and drops empty tokens', () => {
    // The args hint promises `含空格的参数请加引号` — a quoted arg must stay
    // one token, not be re-split on its inner spaces. Trailing whitespace
    // must not produce an empty token ('sh ' → ["sh"], not ["sh", ""]).
    const y = generateWorkloadYaml({
      ...base, name: 'w', image: 'i',
      command: 'sh ', args: '-c "echo hello" plain',
    });
    expect(y).toContain('command: ["sh"]');
    expect(y).toContain('args: ["-c", "echo hello", "plain"]');
  });
});

describe('parseWorkloadYaml (round-trip)', () => {
  it('round-trips wizard-generated yaml back into form fields', () => {
    const f = { ...base, name: 'web', image: 'web:1', replicas: 2,
      ports: [{ name: 'http', port: 8080, protocol: 'TCP' as const }],
      env: [{ key: 'MODE', value: 'prod' }] };
    const back = parseWorkloadYaml(generateWorkloadYaml(f));
    expect(back?.name).toBe('web');
    expect(back?.image).toBe('web:1');
    expect(back?.replicas).toBe(2);
    expect(back?.ports).toEqual(f.ports);
    expect(back?.env).toEqual(f.env);
  });
  it('returns null for non-workload yaml', () => {
    expect(parseWorkloadYaml('kind: Service\napiVersion: v1\n')).toBeNull();
  });
});
