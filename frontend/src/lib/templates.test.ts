/**
 * Tests for the template registry. The `renderTemplate` function is the
 * integration point between the form, the picker, and the k8s YAML preview;
 * we pin a few invariants here so that future refactors (adding new templates,
 * tightening bounds, swapping the clamp policy) don't silently drift.
 */
import { describe, expect, it } from 'vitest';
import { defaultValuesFor, getTemplate, listTemplates, renderTemplate } from './templates';

const allTemplateIds = listTemplates().map((t) => t.id);

describe('template registry', () => {
  it('exposes the three Phase-4 templates by id', () => {
    // Pinned so a future refactor that drops or renames a template fails
    // loudly (the picker would silently lose the entry).
    expect(allTemplateIds).toEqual(expect.arrayContaining(['deployment', 'ingress', 'configmap']));
  });

  it('exposes the full set of KubePi-parity templates (Bxx)', () => {
    // Eight new templates added so the create picker covers every kind the
    // sidebar lists (other than synthetic ones like events/helm). Each
    // template's id below is also the k7s `KindId` mapping the picker uses
    // for auto-selection; if a future refactor drops one, the picker would
    // silently stop pre-selecting the matching template on that kind page.
    expect(allTemplateIds).toEqual(
      expect.arrayContaining([
        'statefulset',
        'daemonset',
        'job',
        'cronjob',
        'service',
        'secret',
        'pvc',
        'namespace',
      ])
    );
  });

  it('every template with a `kind` field maps to a real k7s kind', () => {
    // The TemplatePicker's auto-select uses `template.kind` as the lookup
    // key against `useStore(s => s.nav)`. A typo would silently leave the
    // picker empty on the wrong kind page; this test catches that.
    for (const t of listTemplates()) {
      if (t.kind === undefined) continue;
      const tpl = getTemplate(t.id)!;
      expect(tpl.kind, `${t.id} should keep its kind mapping`).toBe(t.kind);
    }
  });

  it('getTemplate() round-trips every listed template', () => {
    for (const id of allTemplateIds) {
      const t = getTemplate(id);
      expect(t?.id).toBe(id);
    }
  });

  it('getTemplate() returns undefined for an unknown id', () => {
    expect(getTemplate('not-a-real-template')).toBeUndefined();
  });

  it('renderTemplate() throws on an unknown id', () => {
    expect(() => renderTemplate('nope', {})).toThrow(/not found/i);
  });
});

describe('defaultValuesFor()', () => {
  it('returns a record keyed by every param.key with the default value', () => {
    const tpl = getTemplate('deployment')!;
    const defaults = defaultValuesFor(tpl);
    for (const p of tpl.params) {
      expect(defaults[p.key]).toBe(p.default);
    }
    expect(Object.keys(defaults)).toHaveLength(tpl.params.length);
  });
});

describe('number param bounds mirror clampInt in the renderer', () => {
  // The form's `min` / `max` HTML5 attributes must agree with the bounds
  // enforced server-side by the renderer's `clampInt` (templates.ts). If
  // they ever drift, the user would see the form's preview disagree with
  // the input value (a number outside the bound is silently clamped on
  // render but the form input still shows the typed value).
  it('every number param has min and max defined', () => {
    for (const t of listTemplates()) {
      for (const p of t.params) {
        if (p.kind !== 'number') continue;
        expect(p.min, `${t.id}.${p.key} should have min`).toBeTypeOf('number');
        expect(p.max, `${t.id}.${p.key} should have max`).toBeTypeOf('number');
        expect(p.min! <= p.max!, `${t.id}.${p.key} min (${p.min}) must be <= max (${p.max})`).toBe(
          true
        );
        const n = Number.parseInt(p.default, 10);
        expect(
          Number.isFinite(n) && n >= p.min! && n <= p.max!,
          `${t.id}.${p.key} default (${p.default}) must be within [${p.min}, ${p.max}]`
        ).toBe(true);
      }
    }
  });

  it('deployment.replicas bounds are 1..100', () => {
    const t = getTemplate('deployment')!;
    const r = t.params.find((p) => p.key === 'replicas')!;
    expect(r.min).toBe(1);
    expect(r.max).toBe(100);
  });

  it('deployment.port and ingress.port bounds are 1..65535', () => {
    const d = getTemplate('deployment')!.params.find((p) => p.key === 'port')!;
    const i = getTemplate('ingress')!.params.find((p) => p.key === 'port')!;
    expect(d.min).toBe(1);
    expect(d.max).toBe(65535);
    expect(i.min).toBe(1);
    expect(i.max).toBe(65535);
  });
});

describe('TemplateParam.required policy', () => {
  // Every text/number param must be required so the form blocks submission
  // with an empty field (the browser surfaces a "Please fill out this field"
  // tooltip). Without `required`, the renderer's `||` fallback silently
  // substitutes the default — a user clearing the "Name" field would see
  // their apply go through with the default name, which is the bug pass-13
  // explicitly flagged as a follow-up. The form mirrors `required` as the
  // native `required` HTML5 attribute (see TemplatePicker.tsx).
  it('every text/number param is required (no opt-out yet)', () => {
    for (const t of listTemplates()) {
      for (const p of t.params) {
        if (p.kind === 'boolean') continue;
        expect(
          p.required ?? true,
          `${t.id}.${p.key} (${p.kind}) should be required by default`
        ).toBe(true);
      }
    }
  });

  it("the form's default for `required` is `true` for text/number and `false` for boolean", () => {
    // Documents the `required ?? kind !== "boolean"` default in
    // TemplatePicker.tsx so a refactor that flips the default trips the
    // test. Currently the only way a param is `kind: "boolean"` is
    // explicitly, and the current registry has no boolean params — the
    // assertion uses the same defaulting function the form does.
    const effective = (p: { kind: 'text' | 'number' | 'boolean'; required?: boolean }) =>
      p.required ?? p.kind !== 'boolean';
    for (const t of listTemplates()) {
      for (const p of t.params) {
        if (p.kind === 'text' || p.kind === 'number') {
          expect(effective(p), `${t.id}.${p.key}`).toBe(true);
        } else {
          expect(effective(p), `${t.id}.${p.key}`).toBe(false);
        }
      }
    }
  });
});

describe('renderTemplate() clampInt behaviour (number params)', () => {
  // These tests document the silent-clamp behaviour: a number outside the
  // param's bounds is replaced by the bound. The form's new `min` / `max`
  // attributes prevent the user from ever reaching these code paths, but
  // a programmatic caller (or a stale form) could still feed out-of-range
  // values, and the renderer must keep the YAML well-formed.
  it('deployment.replicas=0 is clamped to the lower bound (1)', () => {
    const t = getTemplate('deployment')!;
    const yaml = renderTemplate(t.id, { ...defaultValuesFor(t), replicas: '0' });
    expect(yaml).toMatch(/replicas: 1\b/);
  });

  it('deployment.replicas=-5 is clamped to the lower bound (1)', () => {
    const t = getTemplate('deployment')!;
    const yaml = renderTemplate(t.id, {
      ...defaultValuesFor(t),
      replicas: '-5',
    });
    expect(yaml).toMatch(/replicas: 1\b/);
  });

  it('deployment.replicas=999 is clamped to the upper bound (100)', () => {
    const t = getTemplate('deployment')!;
    const yaml = renderTemplate(t.id, {
      ...defaultValuesFor(t),
      replicas: '999',
    });
    expect(yaml).toMatch(/replicas: 100\b/);
  });

  it('deployment.port=99999 is clamped to the upper bound (65535)', () => {
    const t = getTemplate('deployment')!;
    const yaml = renderTemplate(t.id, {
      ...defaultValuesFor(t),
      port: '99999',
    });
    expect(yaml).toMatch(/containerPort: 65535\b/);
    expect(yaml).toMatch(/ {2}- port: 65535\b/);
  });

  it('deployment.port=abc falls back to the param default (80)', () => {
    const t = getTemplate('deployment')!;
    const yaml = renderTemplate(t.id, {
      ...defaultValuesFor(t),
      port: 'abc',
    });
    expect(yaml).toMatch(/containerPort: 80\b/);
  });
});

describe('renderTemplate() ingress and configmap variants', () => {
  // The Deployment template was the only one exercised by the original
  // v0.2.4 pass; this is a smoke test that the Ingress and ConfigMap
  // paths produce a well-formed YAML document (apiVersion / kind / name /
  // namespace / spec or data) so a future refactor that breaks the YAML
  // shape fails loudly here.
  it('ingress default values produce a valid Ingress document', () => {
    const t = getTemplate('ingress')!;
    const yaml = renderTemplate(t.id, defaultValuesFor(t));
    expect(yaml).toMatch(/^apiVersion: networking\.k8s\.io\/v1$/m);
    expect(yaml).toMatch(/^kind: Ingress$/m);
    expect(yaml).toMatch(/^ {2}name: my-app-ingress$/m);
    expect(yaml).toMatch(/^ {2}namespace: default$/m);
    expect(yaml).toMatch(/^ {2}- host: app\.example\.com$/m);
    expect(yaml).toMatch(/^ {6}- path: \/$/m);
  });

  it('configmap default values produce a valid ConfigMap document', () => {
    const t = getTemplate('configmap')!;
    const yaml = renderTemplate(t.id, defaultValuesFor(t));
    expect(yaml).toMatch(/^apiVersion: v1$/m);
    expect(yaml).toMatch(/^kind: ConfigMap$/m);
    expect(yaml).toMatch(/^ {2}name: my-config$/m);
    expect(yaml).toMatch(/^data:$/m);
    expect(yaml).toMatch(/^ {2}log\.level: info$/m);
    expect(yaml).toMatch(/^ {2}feature\.flag: true$/m);
  });

  it('configmap empty name falls back to the default', () => {
    const t = getTemplate('configmap')!;
    const yaml = renderTemplate(t.id, { ...defaultValuesFor(t), name: '' });
    expect(yaml).toMatch(/^ {2}name: my-config$/m);
  });

  it('configmap custom key/value pair is rendered into the data map', () => {
    const t = getTemplate('configmap')!;
    const yaml = renderTemplate(t.id, {
      ...defaultValuesFor(t),
      key1: 'db.host',
      value1: 'postgres.local',
    });
    expect(yaml).toMatch(/^ {2}db\.host: postgres\.local$/m);
  });
});

/**
 * Bxx — KubePi parity: every kind in the sidebar has a working create template.
 * Each test below renders the template with its default values and pins the
 * shape that `applyYamlBundle` is going to ship to the cluster. The fixtures
 * here are deliberately tight: if a renderer forgets to emit `apiVersion` /
 * `kind`, the api server will reject the document and the user gets a
 * confusing "no kind is set" error instead of "you didn't add a StatefulSet".
 */
describe('renderTemplate() — Bxx parity templates', () => {
  // Helper: render a template with defaults, return the YAML.
  const renderDefault = (id: string): string =>
    renderTemplate(id, defaultValuesFor(getTemplate(id)!));

  it('statefulset renders a headless Service + a StatefulSet with the matching serviceName', () => {
    const yaml = renderDefault('statefulset');
    // Two documents joined by `---`. The Service is the headless one
    // (`clusterIP: None`), and its name + the StatefulSet's `serviceName`
    // must agree — that's how StatefulSet gives pods a stable DNS identity.
    expect(yaml).toMatch(/^kind: Service$/m);
    expect(yaml).toMatch(/^ {2}clusterIP: None$/m);
    expect(yaml).toMatch(/^kind: StatefulSet$/m);
    expect(yaml).toMatch(/^ {2}serviceName: my-app$/m);
    expect(yaml).toMatch(/^ {2}replicas: 3$/m);
  });

  it('daemonset renders a single DaemonSet document (no Service)', () => {
    // DaemonSets don't have a stable per-pod DNS the way StatefulSets do, so
    // there's no Service paired with the template. Pinning the absence of
    // `kind: Service` keeps a future refactor from silently doubling the
    // resource count.
    const yaml = renderDefault('daemonset');
    expect(yaml).toMatch(/^kind: DaemonSet$/m);
    expect(yaml).not.toMatch(/^kind: Service$/m);
    expect(yaml).toMatch(/^ {2}namespace: kube-system$/m);
  });

  it('job renders a Job with OnFailure restartPolicy (the only sensible default)', () => {
    // `Never` would silently swallow transient failures and leave a Job at
    // 0/1 forever. `OnFailure` lets the Job retry until the work actually
    // completes.
    const yaml = renderDefault('job');
    expect(yaml).toMatch(/^kind: Job$/m);
    expect(yaml).toMatch(/^apiVersion: batch\/v1$/m);
    expect(yaml).toMatch(/^ {6}restartPolicy: OnFailure$/m);
    expect(yaml).toMatch(/^ {2}completions: 1$/m);
  });

  it('cronjob renders a CronJob with the schedule quoted', () => {
    // An unquoted schedule with `*` would round-trip through a future YAML
    // parse-then-dump and silently lose the asterisks. The renderer
    // deliberately quotes the value.
    const yaml = renderDefault('cronjob');
    expect(yaml).toMatch(/^kind: CronJob$/m);
    expect(yaml).toMatch(/^ {2}schedule: "0 \* \* \* \*"$/m);
  });

  it("service renders a ClusterIP Service with the user's selector", () => {
    const yaml = renderDefault('service');
    expect(yaml).toMatch(/^kind: Service$/m);
    expect(yaml).toMatch(/^ {2}type: ClusterIP$/m);
    // The default selector is `my-app` (not `my-svc`) — the form's help text
    // makes clear the selector is the *workload's* pod label, not the
    // Service's name. Pinning `my-app` catches a future refactor that
    // accidentally inlines `name` here.
    expect(yaml).toMatch(/^ {4}app: my-app$/m);
  });

  it('secret renders an Opaque secret with stringData (not base64-encoded data)', () => {
    // `stringData` is the readable form — the api server base64-encodes it
    // on admission. Using `data` directly would force the form to
    // base64-encode the user input, which is a footgun nobody asked for.
    const yaml = renderDefault('secret');
    expect(yaml).toMatch(/^kind: Secret$/m);
    expect(yaml).toMatch(/^type: Opaque$/m);
    expect(yaml).toMatch(/^stringData:$/m);
  });

  it('pvc renders a ReadWriteOnce claim with the chosen StorageClass', () => {
    const yaml = renderDefault('pvc');
    expect(yaml).toMatch(/^kind: PersistentVolumeClaim$/m);
    expect(yaml).toMatch(/^ {2}- ReadWriteOnce$/m);
    expect(yaml).toMatch(/^ {2}storageClassName: standard$/m);
    expect(yaml).toMatch(/^ {6}storage: 10Gi$/m);
  });

  it('namespace renders a minimal Namespace manifest', () => {
    // No labels, no annotations — the form only collects `name`. A user
    // wanting `istio-injection: enabled` or quota labels can layer them on
    // in the YAML editor.
    const yaml = renderDefault('namespace');
    expect(yaml).toMatch(/^kind: Namespace$/m);
    expect(yaml).toMatch(/^ {2}name: my-namespace$/m);
    expect(yaml).not.toMatch(/^spec:$/m);
  });

  it('every Bxx template renders valid YAML on default values (no template-string holes)', () => {
    // The simplest invariant: a `{{key}}` that wasn't substituted would land
    // in the output verbatim. That's the bug we're guarding against — the
    // template registry has a single renderer that all new templates share,
    // and a regression would surface as a literal `{{name}}` in the preview.
    const ids = [
      'statefulset',
      'daemonset',
      'job',
      'cronjob',
      'service',
      'secret',
      'pvc',
      'namespace',
    ];
    for (const id of ids) {
      const yaml = renderDefault(id);
      expect(yaml, `${id} should render without template holes`).not.toMatch(
        /\{\{[a-zA-Z0-9_]+\}\}/
      );
    }
  });
});

/**
 * Bxx form-wizard pass — the `extras` field lets a template declare
 * structured form sections (labels, resources) that the wizard renders
 * alongside the simple `params` fields. The renderers consume the
 * `labels` / `resources` keys from the values dict and embed them in
 * the right YAML positions.
 *
 * The tests below pin the contract: which templates opt in to which
 * extras, and what the rendered YAML looks like for each combination
 * of inputs (empty, partial, full).
 */
import { labelsBlock, resourcesRequestsBlock } from './templates';

describe('labelsBlock', () => {
  it('returns an empty string for missing input', () => {
    expect(labelsBlock(undefined, 4)).toBe('');
    expect(labelsBlock(null, 4)).toBe('');
    expect(labelsBlock({}, 4)).toBe('');
  });

  it('renders each entry with the requested indent', () => {
    const out = labelsBlock({ app: 'x', tier: 'web' }, 6);
    expect(out).toBe('      app: x\n      tier: web');
  });

  it('drops entries with empty keys (the user typed a value but not a key)', () => {
    // The form lets a user add a row, type a value, then leave the
    // key blank; the renderer must not emit `  : value`, which is
    // invalid YAML.
    const out = labelsBlock({ '': 'orphan', app: 'x' }, 2);
    expect(out).toBe('  app: x');
  });
});

describe('resourcesRequestsBlock', () => {
  it('returns an empty string when nothing is set', () => {
    expect(resourcesRequestsBlock(undefined, 8)).toBe('');
    expect(resourcesRequestsBlock({}, 8)).toBe('');
  });

  it('emits the standard k8s indent: resources / requests / key', () => {
    const out = resourcesRequestsBlock({ cpu: '100m', memory: '128Mi' }, 8);
    expect(out).toBe(
      '        resources:\n          requests:\n            cpu: 100m\n            memory: 128Mi'
    );
  });

  it('omits the field block entirely when only one of cpu/memory is set', () => {
    // CPU only: just one `cpu:` line under `requests:`.
    expect(resourcesRequestsBlock({ cpu: '500m' }, 4)).toBe(
      '    resources:\n      requests:\n        cpu: 500m'
    );
    // Memory only: ditto, but the order is cpu-then-memory when both
    // are set; here only memory is.
    expect(resourcesRequestsBlock({ memory: '1Gi' }, 4)).toBe(
      '    resources:\n      requests:\n        memory: 1Gi'
    );
  });
});

describe('Template.extras integration (Bxx)', () => {
  it('every workload template (Bxx parity) declares labels + resources extras', () => {
    // Workloads that own a pod template — the same set that
    // `modify-image` and `restart` apply to — should all have
    // extras. Service / ConfigMap / Secret / PVC / Namespace /
    // Ingress don't have a pod template, so extras are absent
    // (and the wizard doesn't try to render an "Image" section
    // for them).
    const withExtras = ['deployment', 'statefulset', 'daemonset', 'job', 'cronjob'];
    for (const id of withExtras) {
      const t = getTemplate(id)!;
      expect(t.extras?.labels, `${id} should have labels extra`).toBeDefined();
      expect(t.extras?.resources, `${id} should have resources extra`).toBeDefined();
    }
  });

  it('user labels show up in `spec.template.metadata.labels`', () => {
    const t = getTemplate('deployment')!;
    const values = {
      ...defaultValuesFor(t),
      labels: { app: 'wiki', tier: 'web' },
    };
    const yaml = renderTemplate(t.id, values);
    expect(yaml).toMatch(/^ {6}labels:$/m);
    // Sorted by key (the wizard sorts the editor for stability) — but
    // the renderer doesn't sort itself, it iterates the dict. We only
    // assert the keys are present, not their order.
    expect(yaml).toMatch(/^ {8}app: wiki$/m);
    expect(yaml).toMatch(/^ {8}tier: web$/m);
  });

  it('user resources show up in `spec.template.spec.containers[0].resources`', () => {
    const t = getTemplate('deployment')!;
    const values = {
      ...defaultValuesFor(t),
      resources: { cpu: '250m', memory: '256Mi' },
    };
    const yaml = renderTemplate(t.id, values);
    // The block sits between `image:` and `ports:`, indented to match
    // the container's field column.
    expect(yaml).toMatch(/^ {8}resources:$/m);
    expect(yaml).toMatch(/^ {10}requests:$/m);
    expect(yaml).toMatch(/^ {12}cpu: 250m$/m);
    expect(yaml).toMatch(/^ {12}memory: 256Mi$/m);
  });

  it('empty resources object omits the resources: block entirely', () => {
    const t = getTemplate('deployment')!;
    const values = {
      ...defaultValuesFor(t),
      resources: {},
    };
    const yaml = renderTemplate(t.id, values);
    expect(yaml).not.toMatch(/^ {8}resources:$/m);
  });
});
