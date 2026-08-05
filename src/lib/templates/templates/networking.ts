/**
 * Networking templates: Ingress, Service, Ingress-TLS, NetworkPolicy.
 */

import type { Template } from '../types';
import { clampInt } from '../helpers';

export const NETWORKING_TEMPLATES: Template[] = [
  {
    id: 'ingress',
    kind: 'ingresses',
    title: 'Ingress (Nginx)',
    description: 'Ingress that routes a host to an existing Service.',
    params: [
      { key: 'name', label: 'Name', default: 'my-app-ingress', kind: 'text' },
      {
        key: 'host',
        label: 'Host',
        default: 'app.example.com',
        kind: 'text',
      },
      {
        key: 'service',
        label: 'Backend Service',
        default: 'my-app',
        kind: 'text',
      },
      {
        key: 'port',
        label: 'Service port',
        default: '80',
        kind: 'number',
        min: 1,
        max: 65535,
      },
      {
        key: 'namespace',
        label: 'Namespace',
        default: 'default',
        kind: 'text',
      },
      {
        key: 'ingressClass',
        label: 'Ingress class',
        default: 'nginx',
        kind: 'text',
      },
    ],
    render: (v) => {
      const name = v.name || 'my-app-ingress';
      const host = v.host || 'app.example.com';
      const service = v.service || 'my-app';
      const port = clampInt(v.port, 1, 65535, 80);
      const ns = v.namespace || 'default';
      const ic = v.ingressClass || 'nginx';
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
      ].join('\n');
    },
  },
  {
    id: 'ingress-tls',
    kind: 'ingresses',
    title: 'Ingress with TLS',
    description: 'Ingress with TLS termination and a secret reference.',
    params: [
      { key: 'name', label: 'Name', default: 'my-app-ingress', kind: 'text' },
      {
        key: 'host',
        label: 'Host',
        default: 'app.example.com',
        kind: 'text',
      },
      {
        key: 'service',
        label: 'Backend Service',
        default: 'my-app',
        kind: 'text',
      },
      {
        key: 'port',
        label: 'Service port',
        default: '80',
        kind: 'number',
        min: 1,
        max: 65535,
      },
      {
        key: 'tlsSecret',
        label: 'TLS secret',
        default: 'my-app-tls',
        kind: 'text',
      },
      {
        key: 'namespace',
        label: 'Namespace',
        default: 'default',
        kind: 'text',
      },
      {
        key: 'ingressClass',
        label: 'Ingress class',
        default: 'nginx',
        kind: 'text',
      },
    ],
    render: (v) => {
      const name = v.name || 'my-app-ingress';
      const host = v.host || 'app.example.com';
      const service = v.service || 'my-app';
      const port = clampInt(v.port, 1, 65535, 80);
      const tlsSecret = v.tlsSecret || 'my-app-tls';
      const ns = v.namespace || 'default';
      const ic = v.ingressClass || 'nginx';
      return [
        `apiVersion: networking.k8s.io/v1`,
        `kind: Ingress`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `  annotations:`,
        `    kubernetes.io/ingress.class: ${ic}`,
        `spec:`,
        `  tls:`,
        `  - hosts:`,
        `    - ${host}`,
        `    secretName: ${tlsSecret}`,
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
      ].join('\n');
    },
  },
  {
    id: 'service',
    kind: 'services',
    title: 'Service',
    description: 'ClusterIP Service selecting pods by label.',
    params: [
      { key: 'name', label: 'Name', default: 'my-svc', kind: 'text' },
      {
        key: 'selector',
        label: 'Selector (app label)',
        default: 'my-app',
        kind: 'text',
      },
      {
        key: 'port',
        label: 'Port',
        default: '80',
        kind: 'number',
        min: 1,
        max: 65535,
      },
      {
        key: 'targetPort',
        label: 'Target port',
        default: '80',
        kind: 'number',
        min: 1,
        max: 65535,
      },
      {
        key: 'namespace',
        label: 'Namespace',
        default: 'default',
        kind: 'text',
      },
    ],
    render: (v) => {
      const name = v.name || 'my-svc';
      const selector = v.selector || 'my-app';
      const port = clampInt(v.port, 1, 65535, 80);
      const targetPort = clampInt(v.targetPort, 1, 65535, 80);
      const ns = v.namespace || 'default';
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
      ].join('\n');
    },
  },
  {
    id: 'networkpolicy',
    kind: 'networkpolicies',
    title: 'NetworkPolicy',
    description: 'Allow ingress from a namespace and egress to a namespace.',
    params: [
      { key: 'name', label: 'Name', default: 'my-netpol', kind: 'text' },
      {
        key: 'namespace',
        label: 'Namespace',
        default: 'default',
        kind: 'text',
      },
      {
        key: 'podLabelKey',
        label: 'Pod label key',
        default: 'app',
        kind: 'text',
      },
      {
        key: 'podLabelValue',
        label: 'Pod label value',
        default: 'my-app',
        kind: 'text',
      },
      {
        key: 'ingressFromNs',
        label: 'Allow ingress from namespace',
        default: '',
        kind: 'text',
      },
      {
        key: 'egressToNs',
        label: 'Allow egress to namespace',
        default: '',
        kind: 'text',
      },
    ],
    render: (v) => {
      const name = v.name || 'my-netpol';
      const ns = v.namespace || 'default';
      const podKey = v.podLabelKey || 'app';
      const podVal = v.podLabelValue || 'my-app';
      const ingressNs = typeof v.ingressFromNs === 'string' ? v.ingressFromNs.trim() : '';
      const egressNs = typeof v.egressToNs === 'string' ? v.egressToNs.trim() : '';
      const lines = [
        `apiVersion: networking.k8s.io/v1`,
        `kind: NetworkPolicy`,
        `metadata:`,
        `  name: ${name}`,
        `  namespace: ${ns}`,
        `spec:`,
        `  podSelector:`,
        `    matchLabels:`,
        `      ${podKey}: ${podVal}`,
        `  policyTypes:`,
      ];
      if (ingressNs) {
        lines.push(`  - Ingress`);
      }
      if (egressNs) {
        lines.push(`  - Egress`);
      }
      if (ingressNs) {
        lines.push(
          `  ingress:`,
          `  - from:`,
          `    - namespaceSelector:`,
        `        matchLabels:`,
          `          kubernetes.io/metadata.name: ${ingressNs}`
        );
      }
      if (egressNs) {
        lines.push(
          `  egress:`,
          `  - to:`,
          `    - namespaceSelector:`,
        `        matchLabels:`,
          `          kubernetes.io/metadata.name: ${egressNs}`
        );
      }
      return lines.join('\n');
    },
  },
];
