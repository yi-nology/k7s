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
}

export interface Template {
  id: string;
  /** Title shown in the picker. */
  title: string;
  /** One-line description. */
  description: string;
  /** Parameters the form renders. */
  params: TemplateParam[];
  /**
   * Render to a (possibly multi-document) YAML bundle. Implementations should
   * `{{key}}`-substitute from the provided values and produce a string of
   * one or more YAML documents separated by `---`.
   */
  render: (values: Record<string, string>) => string;
}

const TEMPLATES: Template[] = [
  {
    id: "deployment",
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
    render: (v) => {
      const name = v.name || "my-app";
      const image = v.image || "nginx:1.25";
      const replicas = clampInt(v.replicas, 1, 100, 1);
      const port = clampInt(v.port, 1, 65535, 80);
      const ns = v.namespace || "default";
      return [
        `apiVersion: apps/v1`,
        `kind: Deployment`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `  labels:`,
        `    app: ${name}`,
        `spec:`,
        `  replicas: ${replicas}`,
        `  selector:`,
        `    matchLabels:`,
        `      app: ${name}`,
        `  template:`,
        `    metadata:`,
        `      labels:`,
        `        app: ${name}`,
        `    spec:`,
        `      containers:`,
        `      - name: ${name}`,
        `        image: ${image}`,
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
];

export function listTemplates(): Template[] {
  return TEMPLATES;
}

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function renderTemplate(
  id: string,
  values: Record<string, string>,
): string {
  const t = getTemplate(id);
  if (!t) throw new Error(`template '${id}' not found`);
  return t.render(values);
}

export function defaultValuesFor(t: Template): Record<string, string> {
  return Object.fromEntries(t.params.map((p) => [p.key, p.default]));
}

function clampInt(
  raw: string | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (Number.isNaN(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
