import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
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
  it('requires a five-field cron schedule for cronjob', () => {
    const f = { ...base, workloadType: 'cronjob' as const, name: 'n', image: 'i' };
    expect(validateWorkloadForm({ ...f, schedule: '' })).toContain('schedule');
    expect(validateWorkloadForm({ ...f, schedule: 'too few' })).toContain('schedule');
    expect(validateWorkloadForm({ ...f, schedule: '0 * * * *' })).not.toContain('schedule');
  });
  it('does not require a schedule for other types', () => {
    expect(
      validateWorkloadForm({ ...base, name: 'n', image: 'i', schedule: '' })
    ).not.toContain('schedule');
  });
  it('rejects negative completions for job', () => {
    const f = { ...base, workloadType: 'job' as const, name: 'n', image: 'i' };
    expect(validateWorkloadForm({ ...f, completions: -1 })).toContain('completions');
    expect(validateWorkloadForm({ ...f, completions: 0 })).not.toContain('completions');
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

describe('generateWorkloadYaml — Job', () => {
  const job = { ...base, workloadType: 'job' as const, name: 'migrate', image: 'busybox:1.36' };

  it('renders batch/v1 with restartPolicy inside template.spec, no replicas/selector', () => {
    const y = generateWorkloadYaml(job);
    expect(y).toContain('apiVersion: batch/v1');
    expect(y).toContain('kind: Job');
    expect(y).not.toContain('replicas:');
    expect(y).not.toContain('selector:');
    expect(y).not.toContain('matchLabels:');
    // Same pod-template depth as Deployment (spec.template.spec…), with the
    // batch restartPolicy first in template.spec, as in the reference template.
    expect(y).toContain(
      '  template:\n' +
        '    metadata:\n' +
        '      labels:\n' +
        '        app: migrate\n' +
        '    spec:\n' +
        '      restartPolicy: OnFailure\n' +
        '      containers:\n' +
        '        - name: migrate\n' +
        '          image: busybox:1.36\n'
    );
  });
  it('omits completions when 0, emits it when > 0', () => {
    expect(generateWorkloadYaml(job)).not.toContain('completions:');
    const y = generateWorkloadYaml({ ...job, completions: 3 });
    expect(y).toContain('completions: 3');
  });
  it('produces structurally valid YAML (independent parse)', () => {
    const doc = parseYaml(generateWorkloadYaml({ ...job, completions: 2 })) as Record<string, unknown>;
    const spec = doc.spec as Record<string, unknown>;
    expect(spec.completions).toBe(2);
    const tmpl = (spec.template as Record<string, unknown>).spec as Record<string, unknown>;
    expect(tmpl.restartPolicy).toBe('OnFailure');
    expect(Array.isArray(tmpl.containers)).toBe(true);
  });
});

describe('generateWorkloadYaml — CronJob', () => {
  const cron = {
    ...base, workloadType: 'cronjob' as const,
    name: 'cleanup', image: 'busybox:1.36', schedule: '*/5 * * * *',
  };

  it('double-quotes the schedule and nests the pod template under jobTemplate.spec.template', () => {
    const y = generateWorkloadYaml(cron);
    expect(y).toContain('apiVersion: batch/v1');
    expect(y).toContain('kind: CronJob');
    expect(y).toContain('schedule: "*/5 * * * *"');
    expect(y).not.toContain('replicas:');
    expect(y).not.toContain('selector:');
    // The whole pod template sits 6 spaces deep (jobTemplate.spec.template),
    // matching the reference template's nesting.
    expect(y).toContain(
      '  jobTemplate:\n' +
        '    spec:\n' +
        '      template:\n' +
        '        metadata:\n' +
        '          labels:\n' +
        '            app: cleanup\n' +
        '        spec:\n' +
        '          restartPolicy: OnFailure\n' +
        '          containers:\n' +
        '            - name: cleanup\n' +
        '              image: busybox:1.36\n'
    );
  });
  it('produces structurally valid YAML (independent parse)', () => {
    const doc = parseYaml(generateWorkloadYaml(cron)) as Record<string, unknown>;
    const spec = doc.spec as Record<string, unknown>;
    expect(spec.schedule).toBe('*/5 * * * *');
    const jobSpec = (spec.jobTemplate as Record<string, unknown>).spec as Record<string, unknown>;
    const podSpec = ((jobSpec.template as Record<string, unknown>).spec) as Record<string, unknown>;
    expect(podSpec.restartPolicy).toBe('OnFailure');
    expect(Array.isArray(podSpec.containers)).toBe(true);
  });
  it('indents mounts/probes blocks into the nested template too', () => {
    const y = generateWorkloadYaml({
      ...cron,
      readiness: { enabled: true, path: '/healthz', port: 8080, initialDelay: 5 },
      mounts: [{ pvcName: 'data', mountPath: '/data', readOnly: false }],
    });
    // volumeMounts at container level (10+4 spaces), volumes at pod-spec
    // level (6+4) — both inside the jobTemplate chain, still valid YAML.
    expect(y).toContain('              volumeMounts:\n');
    expect(y).toContain('          volumes:\n');
    expect(y).toContain('              readinessProbe:\n');
    const doc = parseYaml(y) as Record<string, unknown>;
    const spec = doc.spec as Record<string, unknown>;
    const jobSpec = (spec.jobTemplate as Record<string, unknown>).spec as Record<string, unknown>;
    const podSpec = ((jobSpec.template as Record<string, unknown>).spec) as Record<string, unknown>;
    expect(Array.isArray(podSpec.volumes)).toBe(true);
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
  it('parses Job: kind map + completions recovery', () => {
    const y = generateWorkloadYaml({
      ...base, workloadType: 'job', name: 'j', image: 'img', completions: 4,
    });
    const back = parseWorkloadYaml(y);
    expect(back?.workloadType).toBe('job');
    expect(back?.name).toBe('j');
    expect(back?.image).toBe('img');
    expect(back?.completions).toBe(4);
  });
  it('parses CronJob through the spec.jobTemplate.spec.template chain', () => {
    const y = generateWorkloadYaml({
      ...base, workloadType: 'cronjob', name: 'c', image: 'img', schedule: '5 0 * * *',
    });
    const back = parseWorkloadYaml(y);
    expect(back?.workloadType).toBe('cronjob');
    expect(back?.name).toBe('c');
    expect(back?.schedule).toBe('5 0 * * *');
    expect(back?.image).toBe('img');
  });
  it('round-trips command/args/resources/mounts identically (generate→parse→generate)', () => {
    const f = {
      ...base, name: 'web', image: 'web:1',
      command: 'sh -c', args: '-c "echo hello" plain',
      cpuRequest: '100m', memRequest: '128Mi', cpuLimit: '500m', memLimit: '1Gi',
      mounts: [
        { pvcName: 'data', mountPath: '/data', readOnly: true },
        { pvcName: 'cfg', mountPath: '/etc/cfg', readOnly: false },
      ],
    };
    const y1 = generateWorkloadYaml(f);
    const back = parseWorkloadYaml(y1);
    expect(back?.command).toBe('sh -c');
    // Multi-word tokens come back re-quoted — the tokenize inverse — so the
    // regenerated flow-sequence keeps them as single tokens.
    expect(back?.args).toBe('-c "echo hello" plain');
    expect(back?.cpuRequest).toBe('100m');
    expect(back?.memRequest).toBe('128Mi');
    expect(back?.cpuLimit).toBe('500m');
    expect(back?.memLimit).toBe('1Gi');
    expect(back?.mounts).toEqual(f.mounts);
    const y2 = generateWorkloadYaml({ ...f, ...back });
    expect(y2).toBe(y1);
  });
  it('round-trips a fully-loaded CronJob identically (nesting does not break recovery)', () => {
    const f = {
      ...base, workloadType: 'cronjob' as const, name: 'nightly', image: 'img:2',
      schedule: '30 2 * * *', command: 'sh', args: '-c "db backup"',
      cpuLimit: '1', mounts: [{ pvcName: 'bk', mountPath: '/bk', readOnly: false }],
    };
    const y1 = generateWorkloadYaml(f);
    const back = parseWorkloadYaml(y1);
    const y2 = generateWorkloadYaml({ ...f, ...back });
    expect(y2).toBe(y1);
  });
  it('maps volumeMount names to the matching volumes[].claimName when present', () => {
    const y = [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: web',
      'spec:',
      '  template:',
      '    spec:',
      '      containers:',
      '      - name: web',
      '        image: i',
      '        volumeMounts:',
      '        - name: vol',
      '          mountPath: /data',
      '          readOnly: true',
      '      volumes:',
      '      - name: vol',
      '        persistentVolumeClaim:',
      '          claimName: data-pvc',
    ].join('\n') + '\n';
    const back = parseWorkloadYaml(y);
    expect(back?.mounts).toEqual([{ pvcName: 'data-pvc', mountPath: '/data', readOnly: true }]);
  });
  it('falls back to the mount name as pvcName when no volumes block matches', () => {
    const y = [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: web',
      'spec:',
      '  template:',
      '    spec:',
      '      containers:',
      '      - name: web',
      '        image: i',
      '        volumeMounts:',
      '        - name: vol',
      '          mountPath: /data',
    ].join('\n') + '\n';
    const back = parseWorkloadYaml(y);
    expect(back?.mounts).toEqual([{ pvcName: 'vol', mountPath: '/data', readOnly: false }]);
  });
  it('deleting volumeMounts in the YAML backfills an empty mounts list (no resurrection)', () => {
    // The wizard merges the parsed partial over the form — an absent
    // volumeMounts block must resolve to [], not keep the form's mounts.
    const y = [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: web',
      'spec:',
      '  template:',
      '    spec:',
      '      containers:',
      '      - name: web',
      '        image: i',
    ].join('\n') + '\n';
    const back = parseWorkloadYaml(y);
    expect(back?.mounts).toEqual([]);
    expect(back?.command).toBe('');
    expect(back?.args).toBe('');
    expect(back?.cpuRequest).toBe('');
  });
});
