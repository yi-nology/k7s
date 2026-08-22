/**
 * Ingress utility functions for IngressEditor.
 *
 * Extracted to reduce IngressEditor.tsx size and improve reusability.
 */

export interface IngressPath {
  path: string;
  pathType: string;
  serviceName: string;
  servicePort: number;
}

export interface IngressRule {
  host: string;
  paths: IngressPath[];
}

export interface TlsEntry {
  secretName: string;
  hosts: string[];
}

export interface Annotation {
  key: string;
  value: string;
}

export interface IngressForm {
  name: string;
  namespace: string;
  ingressClass: string;
  rules: IngressRule[];
  tls: TlsEntry[];
  annotations: Annotation[];
}

export const emptyPath = (): IngressPath => ({
  path: '/',
  pathType: 'Prefix',
  serviceName: '',
  servicePort: 80,
});

export const emptyRule = (): IngressRule => ({
  host: '',
  paths: [emptyPath()],
});

export const emptyForm: IngressForm = {
  name: '',
  namespace: 'default',
  ingressClass: '',
  rules: [emptyRule()],
  tls: [],
  annotations: [],
};

/**
 * Generate YAML from an IngressForm.
 *
 * @param form - The ingress form data
 * @returns YAML string representation of the ingress
 */
export function generateYaml(form: IngressForm): string {
  const lines: string[] = [];
  lines.push('apiVersion: networking.k8s.io/v1');
  lines.push('kind: Ingress');
  lines.push('metadata:');
  lines.push(`  name: ${form.name || 'my-ingress'}`);
  if (form.namespace && form.namespace !== 'default') {
    lines.push(`  namespace: ${form.namespace}`);
  }
  if (form.annotations.length > 0 || form.ingressClass) {
    lines.push('  annotations:');
    if (form.ingressClass) {
      lines.push(`    kubernetes.io/ingress.class: "${form.ingressClass}"`);
    }
    for (const a of form.annotations) {
      if (a.key) lines.push(`    ${a.key}: "${a.value}"`);
    }
  }
  lines.push('spec:');
  if (form.ingressClass) {
    lines.push(`  ingressClassName: ${form.ingressClass}`);
  }
  if (form.tls.length > 0) {
    lines.push('  tls:');
    for (const t of form.tls) {
      lines.push(`  - secretName: ${t.secretName || 'tls-secret'}`);
      if (t.hosts.length > 0) {
        lines.push('    hosts:');
        for (const h of t.hosts) {
          if (h) lines.push(`    - ${h}`);
        }
      }
    }
  }
  if (form.rules.length > 0) {
    lines.push('  rules:');
    for (const r of form.rules) {
      if (r.host) {
        lines.push(`  - host: ${r.host}`);
      }
      lines.push('    http:');
      lines.push('      paths:');
      for (const p of r.paths) {
        lines.push(`      - path: ${p.path || '/'}`);
        lines.push(`        pathType: ${p.pathType}`);
        lines.push('        backend:');
        lines.push('          service:');
        lines.push(`            name: ${p.serviceName || 'my-service'}`);
        lines.push(`            port:`);
        lines.push(`              number: ${p.servicePort || 80}`);
      }
    }
  }
  return lines.join('\n');
}
