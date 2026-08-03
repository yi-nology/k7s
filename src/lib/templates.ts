/**
 * Template registry — Phase 4 of KubePi parity.
 *
 * A small, deliberately plain template system: each template is a function
 * from `Record<string, string | number | boolean>` to a multi-document YAML
 * string. The renderer doesn't have to be a full Go text/template clone;
 * the templates are hand-written because the parametrisation is small
 * (image, replicas, port, name) and the resulting YAML reads better when
 * authored as TypeScript than as a curly-braced string.
 *
 * `applyTemplate` then runs the result through `applyYamlBundle`, which
 * creates or replaces each document through the dynamic API and returns
 * a per-document status. That's the whole feature; preview is just
 * `renderTemplate(...)` returning the YAML to show in the editor.
 */

export interface TemplateParam {
  /** Field key, also the placeholder name in `{{key}}` substitutions. */
  key: string;
  /** Human label shown in the form. */
  label: string;
  /** Default value. */
  default: string;
  /** Input kind: text, number, or boolean. */
  kind: "text" | "number" | "boolean";
  /**
   * Optional validation regex. Only consulted for `kind: "text"` inputs; the
   * browser applies it as a native `pattern` attribute.
   */
  pattern?: string;
  /** One-line help text. */
  help?: string;
  /**
   * Optional lower / upper bound for `kind: "number"` inputs. The form mirrors
   * these as the native `min` / `max` attributes so the browser surfaces
   * out-of-range values to the user; the renderer in `clampInt` enforces the
   * same bounds as a server-side safety net. Bounds are inclusive.
   */
  min?: number;
  max?: number;
  /**
   * Whether the form should refuse submission with an empty value. Defaults
   * to `true` for `kind: "text" | "number"` and `false` for `kind: "boolean"`
   * (a checkbox's "empty" state is `false`, which is still a value). The form
   * mirrors this as the native `required` attribute so the browser surfaces a
   * "Please fill out this field" tooltip instead of silently falling through
   * to the renderer's `||` default — the pass-13 follow-up noted that the
   * silent fallback hides user intent (a user clearing a field expects a
   * validation error, not a quietly-rendered "default" name).
   */
  required?: boolean;
}

export interface TemplateExtras {
  /**
   * Pod-level labels. Rendered as `spec.template.metadata.labels` for
   * workloads (the place that `matchLabels` and Service selectors
   * actually consult) and as `metadata.labels` for non-workload kinds.
   * The form renders a key-value table; empty keys are stripped.
   */
  labels?: {
    default: Record<string, string>;
  };
  /**
   * Resource requests, rendered as
   * `spec.template.spec.containers[0].resources.requests`. Either
   * field can be empty — the renderer emits only the lines the user
   * filled in. The single-container assumption is the same one the
   * templates already make; multi-container resource requests are
   * the YAML editor's job.
   */
  resources?: {
    default: { cpu?: string; memory?: string };
  };
}

export interface Template {
  id: string;
  /**
   * The k7s `KindId` this template creates. The picker uses it to pre-select
   * the template that matches the user's current page (e.g. landing on the
   * StatefulSets view opens the StatefulSet template). Optional: a template
   * without a `kind` (e.g. an Ingress that fronts a Service on any kind) is
   * still listed but never auto-selected.
   */
  kind?: string;
  /**
   * Title shown in the picker. The English canonical name (also the YAML
   * `kind:` for the rendered resource) and the i18n fallback for the
   * `tpl.titles.<id>` dictionary key — the picker passes it as the second
   * argument to `t()` so a missing translation still renders sensibly.
   */
  title: string;
  /**
   * One-line description. English canonical copy and the i18n fallback for
   * `tpl.descs.<id>`; same fallback contract as `title`.
   */
  description: string;
  /** Parameters the form renders. */
  params: TemplateParam[];
  /**
   * Optional form sections beyond `params`. Each becomes a labelled card
   * in the wizard form, alongside the simple `params` fields. Values
   * are passed to the render function under their own keys in the
   * `values` dict:
   *   - `labels`: `Record<string, string>` (key→value)
   *   - `resources`: `{ cpu?: string; memory?: string }`
   */
  extras?: TemplateExtras;
  /**
   * Render to a (possibly multi-document) YAML bundle. Implementations
   * substitute `{{key}}` from `values` (the merged `params` + `extras`
   * dict) and produce a string of one or more YAML documents separated
   * by `---`.
   */
  render: (values: Record<string, unknown>) => string;
}

const TEMPLATES: Template[] = [
  {
    id: "deployment",
    kind: "deployments",
    title: "Deployment",
    description: "Single-container Deployment with a Service (ClusterIP).",
    params: [
      { key: "name", label: "Name", default: "my-app", kind: "text" },
      {
        key: "image",
        label: "Image",
        default: "nginx:1.25",
        kind: "text",
        help: "registry/repo:tag",
      },
      {
        key: "replicas",
        label: "Replicas",
        default: "1",
        kind: "number",
        min: 1,
        max: 100,
      },
      {
        key: "port",
        label: "Container port",
        default: "80",
        kind: "number",
        min: 1,
        max: 65535,
      },
      {
        key: "namespace",
        label: "Namespace",
        default: "default",
        kind: "text",
      },
    ],
    extras: {
      // The default `app: my-app` is the baseline the Service selector
      // and `matchLabels` already reference. The wizard starts the
      // labels table with this entry pre-filled so the rendered YAML
      // is internally consistent on first open; the user can add more
      // or change the value.
      labels: { default: { app: "my-app" } },
      resources: { default: { cpu: "100m", memory: "128Mi" } },
    },
    render: (v) => {
      const name = v.name || "my-app";
      const image = v.image || "nginx:1.25";
      const replicas = clampInt(v.replicas, 1, 100, 1);
      const port = clampInt(v.port, 1, 65535, 80);
      const ns = v.namespace || "default";
      // The pod-level labels go under `spec.template.metadata.labels`
      // — the place a Service selector and `matchLabels` actually
      // read. Top-level `metadata.labels` is omitted because nothing
      // else in this template uses it; a user wanting cluster-wide
      // labels can add them in the YAML editor after apply.
      const podLabels = labelsBlock(v.labels, 8) || `        app: ${name}`;
      const containerRes = resourcesRequestsBlock(v.resources, 8);
      return [
        `apiVersion: apps/v1`,
        `kind: Deployment`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `spec:`,
        `  replicas: ${replicas}`,
        `  selector:`,
        `    matchLabels:`,
        `      app: ${name}`,
        `  template:`,
        `    metadata:`,
        `      labels:`,
        podLabels,
        `    spec:`,
        `      containers:`,
        `      - name: ${name}`,
        `        image: ${image}`,
        // Resources slot in between `image:` and `ports:` so the
        // standard k8s field order is preserved (image, resources,
        // ports, env, …). An empty `resourcesRequestsBlock` skips the
        // line entirely.
        ...(containerRes ? containerRes.split("\n") : []),
        `        ports:`,
        `        - containerPort: ${port}`,
        `---`,
        `apiVersion: v1`,
        `kind: Service`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `spec:`,
        `  type: ClusterIP`,
        `  selector:`,
        `    app: ${name}`,
        `  ports:`,
        `  - port: ${port}`,
        `    targetPort: ${port}`,
      ].join("\n");
    },
  },
  {
    id: "ingress",
    kind: "ingresses",
    title: "Ingress (Nginx)",
    description: "Ingress that routes a host to an existing Service.",
    params: [
      { key: "name", label: "Name", default: "my-app-ingress", kind: "text" },
      {
        key: "host",
        label: "Host",
        default: "app.example.com",
        kind: "text",
      },
      {
        key: "service",
        label: "Backend Service",
        default: "my-app",
        kind: "text",
      },
      {
        key: "port",
        label: "Service port",
        default: "80",
        kind: "number",
        min: 1,
        max: 65535,
      },
      {
        key: "namespace",
        label: "Namespace",
        default: "default",
        kind: "text",
      },
      {
        key: "ingressClass",
        label: "Ingress class",
        default: "nginx",
        kind: "text",
      },
    ],
    render: (v) => {
      const name = v.name || "my-app-ingress";
      const host = v.host || "app.example.com";
      const service = v.service || "my-app";
      const port = clampInt(v.port, 1, 65535, 80);
      const ns = v.namespace || "default";
      const ic = v.ingressClass || "nginx";
      return [
        `apiVersion: networking.k8s.io/v1`,
        `kind: Ingress`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `  annotations:`,
        `    kubernetes.io/ingress.class: ${ic}`,
        `spec:`,
        `  rules:`,
        `  - host: ${host}`,
        `    http:`,
        `      paths:`,
        `      - path: /`,
        `        pathType: Prefix`,
        `        backend:`,
        `          service:`,
        `            name: ${service}`,
        `            port:`,
        `              number: ${port}`,
      ].join("\n");
    },
  },
  {
    id: "configmap",
    kind: "configmaps",
    title: "ConfigMap",
    description: "ConfigMap with two key-value pairs.",
    params: [
      { key: "name", label: "Name", default: "my-config", kind: "text" },
      {
        key: "namespace",
        label: "Namespace",
        default: "default",
        kind: "text",
      },
      { key: "key1", label: "Key 1", default: "log.level", kind: "text" },
      { key: "value1", label: "Value 1", default: "info", kind: "text" },
      { key: "key2", label: "Key 2", default: "feature.flag", kind: "text" },
      {
        key: "value2",
        label: "Value 2",
        default: "true",
        kind: "text",
      },
    ],
    render: (v) => {
      const name = v.name || "my-config";
      const ns = v.namespace || "default";
      const k1 = v.key1 || "log.level";
      const v1 = v.value1 || "info";
      const k2 = v.key2 || "feature.flag";
      const v2 = v.value2 || "true";
      return [
        `apiVersion: v1`,
        `kind: ConfigMap`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `data:`,
        `  ${k1}: ${v1}`,
        `  ${k2}: ${v2}`,
      ].join("\n");
    },
  },
  // ---- Bxx: full KubePi parity — every kind the sidebar lists gets a template
  // for one-click create. Each template's `kind` is the k7s KindId of the
  // resource it creates, which the picker uses to pre-select the matching
  // entry on the corresponding list page (see TemplatePicker.tsx). ----
  {
    id: "statefulset",
    kind: "statefulsets",
    title: "StatefulSet",
    description: "Single-container StatefulSet with a headless Service.",
    params: [
      { key: "name", label: "Name", default: "my-app", kind: "text" },
      {
        key: "image",
        label: "Image",
        default: "nginx:1.25",
        kind: "text",
        help: "registry/repo:tag",
      },
      {
        key: "replicas",
        label: "Replicas",
        default: "3",
        kind: "number",
        min: 1,
        max: 100,
      },
      {
        key: "port",
        label: "Container port",
        default: "80",
        kind: "number",
        min: 1,
        max: 65535,
      },
      {
        key: "namespace",
        label: "Namespace",
        default: "default",
        kind: "text",
      },
    ],
    extras: {
      // StatefulSet pods need labels that match `spec.selector.matchLabels`
      // (defaulted to `app: <name>` below) so the headless Service's
      // selector actually routes to them. The pre-filled `app: my-app`
      // keeps the form usable on first open.
      labels: { default: { app: "my-app" } },
      resources: { default: { cpu: "100m", memory: "128Mi" } },
    },
    render: (v) => {
      const name = v.name || "my-app";
      const image = v.image || "nginx:1.25";
      const replicas = clampInt(v.replicas, 1, 100, 3);
      const port = clampInt(v.port, 1, 65535, 80);
      const ns = v.namespace || "default";
      const podLabels = labelsBlock(v.labels, 8) || `        app: ${name}`;
      const containerRes = resourcesRequestsBlock(v.resources, 8);
      // A StatefulSet without `serviceName` has no stable network identity — the
      // headless Service in this template is the per-pod DNS, and the two have
      // to agree. `volumeClaimTemplates` is omitted on purpose: PVs are a topic
      // of their own, and a follow-up that needs them should layer on top
      // rather than the template silently allocating default storage.
      return [
        `apiVersion: v1`,
        `kind: Service`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `spec:`,
        `  clusterIP: None`,
        `  selector:`,
        `    app: ${name}`,
        `  ports:`,
        `  - port: ${port}`,
        `    targetPort: ${port}`,
        `---`,
        `apiVersion: apps/v1`,
        `kind: StatefulSet`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `spec:`,
        `  serviceName: ${name}`,
        `  replicas: ${replicas}`,
        `  selector:`,
        `    matchLabels:`,
        `      app: ${name}`,
        `  template:`,
        `    metadata:`,
        `      labels:`,
        podLabels,
        `    spec:`,
        `      containers:`,
        `      - name: ${name}`,
        `        image: ${image}`,
        ...(containerRes ? containerRes.split("\n") : []),
        `        ports:`,
        `        - containerPort: ${port}`,
      ].join("\n");
    },
  },
  {
    id: "daemonset",
    kind: "daemonsets",
    title: "DaemonSet",
    description: "One pod per node, e.g. a node-level log shipper.",
    params: [
      { key: "name", label: "Name", default: "my-agent", kind: "text" },
      {
        key: "image",
        label: "Image",
        default: "fluentd:1.16",
        kind: "text",
        help: "registry/repo:tag",
      },
      {
        key: "port",
        label: "Container port",
        default: "24224",
        kind: "number",
        min: 1,
        max: 65535,
      },
      {
        key: "namespace",
        label: "Namespace",
        default: "kube-system",
        kind: "text",
      },
    ],
    extras: {
      // DaemonSet pods need labels that match the workload's
      // `spec.selector.matchLabels` (defaulted to `app: <name>` below)
      // — the controller refuses to apply a DS whose pod template
      // doesn't have a matching label set.
      labels: { default: { app: "my-agent" } },
      resources: { default: { cpu: "50m", memory: "64Mi" } },
    },
    render: (v) => {
      const name = v.name || "my-agent";
      const image = v.image || "fluentd:1.16";
      const port = clampInt(v.port, 1, 65535, 24224);
      const ns = v.namespace || "kube-system";
      const podLabels = labelsBlock(v.labels, 8) || `        app: ${name}`;
      const containerRes = resourcesRequestsBlock(v.resources, 8);
      // Default namespace is `kube-system` because that's where node-level
      // agents actually live in real clusters — a user picking this template
      // is almost always provisioning infra, not an app.
      return [
        `apiVersion: apps/v1`,
        `kind: DaemonSet`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `  labels:`,
        `    app: ${name}`,
        `spec:`,
        `  selector:`,
        `    matchLabels:`,
        `      app: ${name}`,
        `  template:`,
        `    metadata:`,
        `      labels:`,
        podLabels,
        `    spec:`,
        `      containers:`,
        `      - name: ${name}`,
        `        image: ${image}`,
        ...(containerRes ? containerRes.split("\n") : []),
        `        ports:`,
        `        - containerPort: ${port}`,
      ].join("\n");
    },
  },
  {
    id: "job",
    kind: "jobs",
    title: "Job",
    description: "Run-to-completion workload, e.g. a one-shot batch task.",
    params: [
      { key: "name", label: "Name", default: "my-job", kind: "text" },
      {
        key: "image",
        label: "Image",
        default: "busybox:1.36",
        kind: "text",
        help: "registry/repo:tag",
      },
      {
        key: "completions",
        label: "Completions",
        default: "1",
        kind: "number",
        min: 1,
        max: 1000,
      },
      {
        key: "namespace",
        label: "Namespace",
        default: "default",
        kind: "text",
      },
    ],
    extras: {
      labels: { default: { app: "my-job" } },
      resources: { default: { cpu: "100m", memory: "128Mi" } },
    },
    render: (v) => {
      const name = v.name || "my-job";
      const image = v.image || "busybox:1.36";
      const completions = clampInt(v.completions, 1, 1000, 1);
      const ns = v.namespace || "default";
      const containerRes = resourcesRequestsBlock(v.resources, 8);
      // `restartPolicy: OnFailure` is the only sensible default for a Job
      // pod — the alternative (Never) would silently swallow transient
      // failures and leave a job wedged at "0/1" with no record of why.
      return [
        `apiVersion: batch/v1`,
        `kind: Job`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `spec:`,
        `  completions: ${completions}`,
        `  template:`,
        `    metadata:`,
        `      labels:`,
        `        app: ${name}`,
        `    spec:`,
        `      restartPolicy: OnFailure`,
        `      containers:`,
        `      - name: ${name}`,
        `        image: ${image}`,
        ...(containerRes ? containerRes.split("\n") : []),
      ].join("\n");
    },
  },
  {
    id: "cronjob",
    kind: "cronjobs",
    title: "CronJob",
    description: "Scheduled Job, e.g. a nightly cleanup.",
    params: [
      { key: "name", label: "Name", default: "my-cron", kind: "text" },
      {
        key: "image",
        label: "Image",
        default: "busybox:1.36",
        kind: "text",
        help: "registry/repo:tag",
      },
      {
        key: "schedule",
        label: "Schedule",
        default: "0 * * * *",
        kind: "text",
        help: "Standard 5-field cron expression (minute hour day month dow).",
        pattern: "^\\S+\\s+\\S+\\s+\\S+\\s+\\S+\\s+\\S+$",
      },
      {
        key: "namespace",
        label: "Namespace",
        default: "default",
        kind: "text",
      },
    ],
    extras: {
      labels: { default: { app: "my-cron" } },
      resources: { default: { cpu: "100m", memory: "128Mi" } },
    },
    render: (v) => {
      const name = v.name || "my-cron";
      const image = v.image || "busybox:1.36";
      const schedule = v.schedule || "0 * * * *";
      const ns = v.namespace || "default";
      const containerRes = resourcesRequestsBlock(v.resources, 10);
      return [
        `apiVersion: batch/v1`,
        `kind: CronJob`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `spec:`,
        `  schedule: "${schedule}"`,
        `  jobTemplate:`,
        `    spec:`,
        `      template:`,
        `        metadata:`,
        `          labels:`,
        `            app: ${name}`,
        `        spec:`,
        `          restartPolicy: OnFailure`,
        `          containers:`,
        `          - name: ${name}`,
        `            image: ${image}`,
        ...(containerRes ? containerRes.split("\n") : []),
      ].join("\n");
    },
  },
  {
    id: "service",
    kind: "services",
    title: "Service",
    description: "ClusterIP Service that fronts a workload.",
    params: [
      { key: "name", label: "Name", default: "my-svc", kind: "text" },
      {
        key: "selector",
        label: "Selector (app=…)",
        default: "my-app",
        kind: "text",
        help: "The pod label this Service routes to. Match the workload's template labels.",
      },
      {
        key: "port",
        label: "Port",
        default: "80",
        kind: "number",
        min: 1,
        max: 65535,
      },
      {
        key: "targetPort",
        label: "Target port",
        default: "80",
        kind: "number",
        min: 1,
        max: 65535,
      },
      {
        key: "namespace",
        label: "Namespace",
        default: "default",
        kind: "text",
      },
    ],
    render: (v) => {
      const name = v.name || "my-svc";
      const selector = v.selector || "my-app";
      const port = clampInt(v.port, 1, 65535, 80);
      const targetPort = clampInt(v.targetPort, 1, 65535, 80);
      const ns = v.namespace || "default";
      // ClusterIP-only by default — NodePort/LoadBalancer expose the cluster
      // to the world, and a user who wants that should reach for the YAML
      // editor, not a checkbox on a one-off template.
      return [
        `apiVersion: v1`,
        `kind: Service`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `spec:`,
        `  type: ClusterIP`,
        `  selector:`,
        `    app: ${selector}`,
        `  ports:`,
        `  - port: ${port}`,
        `    targetPort: ${targetPort}`,
        `    protocol: TCP`,
      ].join("\n");
    },
  },
  {
    id: "secret",
    kind: "secrets",
    title: "Secret (Opaque)",
    description: "Opaque Secret with two key/value pairs.",
    params: [
      { key: "name", label: "Name", default: "my-secret", kind: "text" },
      {
        key: "namespace",
        label: "Namespace",
        default: "default",
        kind: "text",
      },
      {
        key: "key1",
        label: "Key 1",
        default: "username",
        kind: "text",
      },
      {
        key: "value1",
        label: "Value 1",
        default: "admin",
        kind: "text",
        help: "Stored verbatim — this template is for non-sensitive test data. Production secrets should be set via the YAML editor or an external operator.",
      },
      {
        key: "key2",
        label: "Key 2",
        default: "password",
        kind: "text",
      },
      {
        key: "value2",
        label: "Value 2",
        default: "changeme",
        kind: "text",
      },
    ],
    render: (v) => {
      const name = v.name || "my-secret";
      const ns = v.namespace || "default";
      const k1 = v.key1 || "username";
      const v1 = v.value1 || "admin";
      const k2 = v.key2 || "password";
      const v2 = v.value2 || "changeme";
      // Opaque is the catch-all type; the YAML editor is the right tool for
      // kubernetes.io/tls, dockerconfigjson, and the rest. The form's help
      // text steers users away from treating the rendered YAML as production
      // credentials.
      return [
        `apiVersion: v1`,
        `kind: Secret`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `type: Opaque`,
        `stringData:`,
        `  ${k1}: ${v1}`,
        `  ${k2}: ${v2}`,
      ].join("\n");
    },
  },
  {
    id: "pvc",
    kind: "persistentvolumeclaims",
    title: "PersistentVolumeClaim",
    description: "ReadWriteOnce claim bound to a StorageClass.",
    params: [
      { key: "name", label: "Name", default: "my-pvc", kind: "text" },
      {
        key: "namespace",
        label: "Namespace",
        default: "default",
        kind: "text",
      },
      {
        key: "storageClass",
        label: "StorageClass",
        default: "standard",
        kind: "text",
        help: "Must exist in the cluster, otherwise the claim stays Pending.",
      },
      {
        key: "capacity",
        label: "Capacity (Gi)",
        default: "10",
        kind: "number",
        min: 1,
        max: 100000,
      },
    ],
    render: (v) => {
      const name = v.name || "my-pvc";
      const ns = v.namespace || "default";
      const sc = v.storageClass || "standard";
      const capacity = clampInt(v.capacity, 1, 100000, 10);
      // RWO is the safest default — most clusters don't have multi-node
      // ReadWriteMany provisioners, and a "pending forever" PVC is a worse
      // outcome than a slightly-stricter default.
      return [
        `apiVersion: v1`,
        `kind: PersistentVolumeClaim`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `spec:`,
        `  accessModes:`,
        `  - ReadWriteOnce`,
        `  storageClassName: ${sc}`,
        `  resources:`,
        `    requests:`,
        `      storage: ${capacity}Gi`,
      ].join("\n");
    },
  },
  {
    id: "namespace",
    kind: "namespaces",
    title: "Namespace",
    description: "Cluster-scoped namespace for isolating workloads.",
    params: [
      { key: "name", label: "Name", default: "my-namespace", kind: "text" },
    ],
    render: (v) => {
      const name = v.name || "my-namespace";
      // `kube-system`, `default`, and `kube-public` are the three namespaces
      // every cluster has — recreating them under a new name is a real footgun.
      // The picker doesn't enforce it, but the form's help text on `name`
      // (added in the i18n entry) is the place to mention this; the renderer
      // keeps the default simple and lets the YAML editor handle the edge.
      return [
        `apiVersion: v1`,
        `kind: Namespace`,
        `metadata:`,
        `  name: ${name}`,
      ].join("\n");
    },
  },
];

export function listTemplates(): Template[] {
  return TEMPLATES;
}

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function renderTemplate(
  id: string,
  values: Record<string, unknown>,
): string {
  const t = getTemplate(id);
  if (!t) throw new Error(`template '${id}' not found`);
  return t.render(values);
}

export function defaultValuesFor(t: Template): Record<string, string> {
  return Object.fromEntries(t.params.map((p) => [p.key, p.default]));
}

/**
 * Format a `Record<string, string>` as a multi-line, `indent`-spaced
 * YAML block. Empty keys are dropped, and the function returns "" when
 * the input is missing or empty so the caller can use a simple
 * truthiness check.
 *
 * Used by template renderers to expand the wizard's `labels` extra
 * into a YAML `labels:` block at the right indent.
 */
export function labelsBlock(
  labels: unknown,
  indent: number,
): string {
  if (!labels || typeof labels !== "object") return "";
  const pad = " ".repeat(indent);
  const entries = Object.entries(labels as Record<string, string>).filter(
    ([k, v]) => k.length > 0 && v !== undefined && v !== null,
  );
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${pad}${k}: ${v}`).join("\n");
}

/**
 * Format `{cpu, memory}` as a YAML `resources.requests:` block at the
 * requested indent. Either field may be empty; the block is omitted
 * entirely when both are. Indents:
 *   indent+0 → `resources:`
 *   indent+2 → `requests:`
 *   indent+4 → `cpu:` / `memory:`
 *
 * The +4 / +2 spacing matches the standard k8s manifest style so the
 * result diffs cleanly against `kubectl get -o yaml` output.
 */
export function resourcesRequestsBlock(
  res: unknown,
  indent: number,
): string {
  if (!res || typeof res !== "object") return "";
  const r = res as { cpu?: string; memory?: string };
  const lines: string[] = [];
  const pad0 = " ".repeat(indent);
  const pad2 = " ".repeat(indent + 2);
  if (r.cpu) {
    lines.push(`${pad0}resources:`);
    lines.push(`${pad2}requests:`);
    lines.push(`${" ".repeat(indent + 4)}cpu: ${r.cpu}`);
  }
  if (r.memory) {
    if (lines.length === 0) {
      lines.push(`${pad0}resources:`);
      lines.push(`${pad2}requests:`);
    }
    lines.push(`${" ".repeat(indent + 4)}memory: ${r.memory}`);
  }
  return lines.join("\n");
}

function clampInt(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  // `raw` is `unknown` because the wizard passes the merged
  // params + extras values dict; non-number extras (e.g. a labels
  // Record) are never actually fed to this function, but the wider
  // type lets the existing renderers stay un-annotated.
  const n = Number.parseInt(typeof raw === "string" ? raw : "", 10);
  if (Number.isNaN(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
